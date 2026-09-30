/// <reference types="node" />
/**
 * Test helper: a small D1Database stand-in over Node's built-in SQLite (node:sqlite), with every
 * migration in apps/worker/migrations applied. D1 is SQLite, so SQL built by the pure statement
 * builders (json_each, RETURNING, MAX(a, b)…) can run for real in unit tests. Only what the
 * Worker uses is implemented: prepare → bind → all / first / run, and batch (one transaction).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { NewsAudience } from '@smartstack/shared'
import type { CampaignRow } from '../env'
import type { Statement as SqlStatement } from '../logic'
import { insertCampaignStatement, newCampaignRow } from '../news/campaigns'

const MIGRATIONS = new URL('../../migrations/', import.meta.url)

/**
 * Migration 0004 (M8) as written in docs/smartstack-phase2-prompt.md §6. A test fixture only:
 * used when the real migration isn't in apps/worker/migrations yet, ignored once it is.
 */
const HEALTH_PROFILES_FIXTURE = `
CREATE TABLE IF NOT EXISTS health_profiles (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  birth_year INTEGER CHECK (birth_year BETWEEN 1900 AND 2100),
  gender TEXT CHECK (gender IN ('woman', 'man', 'non_binary', 'another', 'prefer_not')),
  pregnancy TEXT CHECK (pregnancy IN ('pregnant', 'breastfeeding', 'trying', 'none', 'prefer_not')),
  conditions TEXT NOT NULL DEFAULT '[]',
  goals TEXT NOT NULL DEFAULT '[]',
  diet TEXT NOT NULL DEFAULT '[]',
  avoids TEXT NOT NULL DEFAULT '[]',
  activity TEXT CHECK (activity IN ('low', 'moderate', 'high')),
  storage_consent_at INTEGER NOT NULL,
  targeting_consent_at INTEGER,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  rev INTEGER NOT NULL
);`

type Value = string | number | null

/**
 * node:sqlite binds positional arguments to anonymous `?` only, while D1 also binds them to
 * numbered `?N`: rewrite `?N` as `?` with the arguments in textual order.
 */
export function positional(sql: string, params: readonly Value[]): { sql: string; args: Value[] } {
  if (!/\?\d/.test(sql)) return { sql, args: [...params] }
  const args: Value[] = []
  const text = sql.replace(/\?(\d+)/g, (_, n: string) => {
    args.push(params[Number(n) - 1] ?? null)
    return '?'
  })
  return { sql: text, args }
}

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: Value[] = [],
  ) {}

  bind(...params: Value[]): Statement {
    return new Statement(this.db, this.sql, params)
  }

  private prepared() {
    const { sql, args } = positional(this.sql, this.params)
    return { statement: this.db.prepare(sql), args: args as SQLInputValue[] }
  }

  rows(): Record<string, unknown>[] {
    const { statement, args } = this.prepared()
    return statement.all(...args) as Record<string, unknown>[]
  }

  async all<T>() {
    return { success: true, results: this.rows() as T[], meta: {} }
  }

  async first<T>(): Promise<T | null> {
    return (this.rows()[0] as T | undefined) ?? null
  }

  async run() {
    const { statement, args } = this.prepared()
    const info = statement.run(...args)
    return {
      success: true,
      results: [],
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
    }
  }
}

export interface TestDb {
  /** Pass to code under test. */
  d1: D1Database
  /** Direct access for fixtures and assertions. */
  sql: DatabaseSync
  /** Statements run, in order (batches expanded). */
  log: string[]
}

export function createTestDb(): TestDb {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys = ON')
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const file of files) sql.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  sql.exec(HEALTH_PROFILES_FIXTURE)
  const log: string[] = []

  const d1 = {
    prepare(query: string) {
      log.push(query)
      return new Statement(sql, query)
    },
    async batch(statements: Statement[]) {
      sql.exec('BEGIN')
      try {
        const results = statements.map((s) => {
          const rows = s.rows()
          const changes = Number(
            (sql.prepare('SELECT changes() AS n').get() as { n: number } | undefined)?.n ?? 0,
          )
          return { success: true, results: rows, meta: { changes } }
        })
        sql.exec('COMMIT')
        return results
      } catch (err) {
        sql.exec('ROLLBACK')
        throw err
      }
    },
  }
  return { d1: d1 as unknown as D1Database, sql, log }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function addAccount(
  db: TestDb,
  id: string,
  options: { role?: 'user' | 'admin'; verified?: boolean } = {},
): void {
  db.sql
    .prepare(
      `INSERT INTO accounts (id, email, email_verified_at, role, created_at, updated_at, last_active_at)
       VALUES (?, ?, ?, ?, 0, 0, 0)`,
    )
    .run(id, `${id}@example.com`, options.verified === false ? null : 1, options.role ?? 'user')
}

export function addDevice(
  db: TestDb,
  id: string,
  options: {
    accountId?: string | null
    locale?: string
    optIn?: boolean
    lastNewsAt?: number | null
  } = {},
): void {
  db.sql
    .prepare(
      `INSERT INTO users (id, tz, platform, created_at, last_seen_at, account_id, locale,
         news_opt_in, last_news_at)
       VALUES (?, 'America/Toronto', 'android', 0, 0, ?, ?, ?, ?)`,
    )
    .run(
      id,
      options.accountId ?? null,
      options.locale ?? 'en',
      options.optIn === false ? 0 : 1,
      options.lastNewsAt ?? null,
    )
}

/** Returns the subscription id. */
export function addSubscription(db: TestDb, userId: string, endpoint?: string): number {
  const info = db.sql
    .prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
       VALUES (?, ?, 'p256dh', 'auth', 0)`,
    )
    .run(userId, endpoint ?? `https://push.invalid/${userId}/${Math.random()}`)
  return Number(info.lastInsertRowid)
}

export function addProfile(
  db: TestDb,
  accountId: string,
  profile: {
    birthYear?: number | null
    gender?: string | null
    pregnancy?: string | null
    conditions?: string[] | string
    goals?: string[]
    targeting?: boolean
    deleted?: boolean
  } = {},
): void {
  db.sql
    .prepare(
      `INSERT INTO health_profiles (account_id, birth_year, gender, pregnancy, conditions, goals,
         storage_consent_at, targeting_consent_at, updated_at, deleted_at, rev)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1, ?, 1)`,
    )
    .run(
      accountId,
      profile.birthYear ?? null,
      profile.gender ?? null,
      profile.pregnancy ?? null,
      typeof profile.conditions === 'string'
        ? profile.conditions
        : JSON.stringify(profile.conditions ?? []),
      JSON.stringify(profile.goals ?? []),
      profile.targeting === false ? null : 1,
      profile.deleted ? 1 : null,
    )
}

/** Runs one statement from a pure builder (numbered or anonymous placeholders). */
export function runStatement(db: TestDb, s: SqlStatement): void {
  const { sql, args } = positional(s.sql, s.params)
  db.sql.prepare(sql).run(...(args as SQLInputValue[]))
}

/** A campaign (sending, due a minute before `now`, audience "everyone" unless told otherwise). */
export function addCampaign(
  db: TestDb,
  id: string,
  options: {
    now: number
    status?: CampaignRow['status']
    sendAt?: number
    audience?: NewsAudience | string
    createdAt?: number
  },
): void {
  const row = newCampaignRow(
    id,
    {
      name: id,
      titleEn: `New Roots Herbal: ${id}`,
      titleFr: `New Roots Herbal\u00a0: ${id} FR`,
      bodyEn: 'Body',
      bodyFr: 'Corps',
      url: `https://newrootsherbal.com/?utm_campaign=${id}`,
      audience: { type: 'all' },
    },
    null,
    options.createdAt ?? options.now - 60 * 60 * 1000,
  )
  row.status = options.status ?? 'sending'
  row.send_at = options.sendAt ?? options.now - 60 * 1000
  if (options.audience !== undefined) {
    row.audience =
      typeof options.audience === 'string' ? options.audience : JSON.stringify(options.audience)
  }
  runStatement(db, insertCampaignStatement(row))
}
