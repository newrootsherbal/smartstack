/**
 * The sync statements and POST /api/sync run against a real SQLite database (node:sqlite, an
 * in-memory copy of the D1 schema built from migrations/*.sql), behind a minimal D1 stand-in.
 * Skipped where node:sqlite isn't available (Node < 22.13 without a flag).
 */
import type {
  SyncCheckLive,
  SyncProductLive,
  SyncSettings,
  SyncShoppingLive,
  SyncStackLive,
} from '@smartstack/shared'
import { SYNC_MAX_ROWS, SyncResponse, type SyncRequestBody } from '@smartstack/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { api } from './api'
import { insertAccountStatement, newAccountRow } from './auth/account'
import { createSessionStatements, newSession } from './auth/session'
import type { Env } from './env'
import type { Statement } from './logic'
import {
  limitReadStatement,
  LIMITED_TABLES,
  syncCleanupStatements,
  syncExportStatements,
} from './sync'

// ---------------------------------------------------------------------------
// node:sqlite behind a D1-shaped object (only what the sync route and these tests use)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
interface SqliteStatement {
  all(...params: unknown[]): Row[]
}
interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
}
interface SqliteModule {
  DatabaseSync: new (path: string) => SqliteDatabase
}
interface FsModule {
  readFileSync(path: URL, encoding: 'utf8'): string
}

// Non-literal specifiers: the Worker's tsconfig has no Node types, and Vite leaves these alone.
const sqlite = (await import(/* @vite-ignore */ 'node:' + 'sqlite').catch(
  () => null,
)) as SqliteModule | null
const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as FsModule

const MIGRATIONS = ['0001_init.sql', '0002_accounts.sql', '0003_user_data.sql']

function freshDatabase(): SqliteDatabase {
  const db = new sqlite!.DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON') // D1 enforces foreign keys
  for (const file of MIGRATIONS) {
    db.exec(
      fs.readFileSync(
        new URL(`../migrations/${file}`, (import.meta as unknown as { url: string }).url),
        'utf8',
      ),
    )
  }
  return db
}

/**
 * node:sqlite binds positional arguments to anonymous `?` only (`?NNN` counts as named), so
 * each `?NNN` becomes `?` with its value repeated in order, as D1 would bind it.
 */
function query(db: SqliteDatabase, sql: string, params: readonly unknown[]): Row[] {
  const values: unknown[] = []
  const text = sql.replace(/\?(\d+)/g, (_, n: string) => {
    values.push(params[Number(n) - 1])
    return '?'
  })
  return db
    .prepare(text)
    .all(...values)
    .map((row) => ({ ...row }))
}

/** A D1Database stand-in: prepare/bind/first/all/run, and batch as one transaction. */
function d1(db: SqliteDatabase): D1Database {
  const statement = (sql: string, params: unknown[] = []) => ({
    sql,
    params,
    bind: (...values: unknown[]) => statement(sql, values),
    first: async (column?: string) => {
      const row = query(db, sql, params)[0] ?? null
      return column && row ? row[column] : row
    },
    all: async () => ({ results: query(db, sql, params), success: true, meta: {} }),
    run: async () => {
      query(db, sql, params)
      const changes = Number(query(db, 'SELECT changes() AS n', [])[0]?.n ?? 0)
      return { results: [], success: true, meta: { changes } }
    },
  })
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: { sql: string; params: unknown[] }[]) => {
      db.exec('BEGIN')
      try {
        const results = statements.map((s) => ({
          results: query(db, s.sql, s.params),
          success: true,
          meta: {},
        }))
        db.exec('COMMIT')
        return results
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    },
  } as unknown as D1Database
}

function runAll(db: SqliteDatabase, statements: readonly Statement[]): Row[][] {
  return statements.map((s) => query(db, s.sql, s.params))
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VERSION = '2026-10'
const T = Date.UTC(2026, 9, 5, 12, 0, 0)
const PRODUCT_ID = 'u_0f8fad5b-d9cb-469f-a165-70867728950e'

const routine = {
  wake: '06:30',
  bedtime: '22:30',
  coffee: null,
  breakfast: '07:15',
  lunch: null,
  dinner: '18:00',
  exercise: null,
}
const settings: z.input<typeof SyncSettings> = {
  routine,
  tz: 'America/Toronto',
  locale: 'fr',
  theme: 'wild',
  updatedAt: T,
}
const product: z.input<typeof SyncProductLive> = {
  id: PRODUCT_ID,
  productType: 'nhp',
  brand: 'Other Brand',
  name: 'Test product',
  upc: null,
  npn: null,
  din: null,
  strength: null,
  form: 'capsule',
  doseUnit: 'capsule',
  unitsPerDose: 2,
  dosesPerDay: 1,
  packageQuantity: 60,
  packageUnit: 'unit',
  timing: ['WITH_FOOD'],
  ingredients: [{ ingredientId: null, name: 'Something', amount: 100, unit: 'mg' }],
  directions: null,
  warnings: null,
  notes: 'kept in the kitchen',
  createdAt: T,
  updatedAt: T,
}
const stackItem: z.input<typeof SyncStackLive> = {
  productId: 'magnesium',
  dosesPerDay: 2,
  pins: ['bedtime', null],
  dismissed: ['SUGGEST_BEDTIME'],
  unitsPerDose: 1.5,
  variantUpc: '00000000',
  inventory: { remaining: 60, unit: 'unit', packageSize: 90, lowFlaggedAt: null },
  addedAt: T,
  updatedAt: T,
}
const shoppingItem: z.input<typeof SyncShoppingLive> = {
  productId: 'iron',
  reason: 'low',
  addedAt: T,
  updatedAt: T,
}
const check: z.input<typeof SyncCheckLive> = {
  day: '2026-10-05',
  productId: 'magnesium',
  doseIndex: 0,
  units: 1,
  updatedAt: T,
}

interface Account {
  id: string
  token: string
}

async function createAccount(
  db: SqliteDatabase,
  id: string,
  consentVersion: string | null = VERSION,
): Promise<Account> {
  const row = newAccountRow({
    id,
    email: `${id}@example.com`,
    locale: 'en',
    displayName: null,
    now: T,
    emailVerified: true,
    consentVersion,
    password: null,
  })
  const session = await newSession()
  runAll(db, [
    insertAccountStatement(row),
    ...createSessionStatements(session.id, id, null, Date.now()),
  ])
  return { id, token: session.token }
}

function env(db: SqliteDatabase): Env {
  return {
    DB: d1(db),
    ACCOUNTS_MODE: 'public',
    CONSENT_VERSION: VERSION,
    STAFF_EMAIL_DOMAINS: '',
    APP_ORIGIN: 'http://localhost:8791',
  } as Env
}

async function sync(
  db: SqliteDatabase,
  account: Account,
  body: SyncRequestBody | string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await api.request(
    '/api/sync',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${account.token}`, 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    env(db),
  )
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

async function ok(db: SqliteDatabase, account: Account, body: SyncRequestBody) {
  const res = await sync(db, account, body)
  expect(res.status, JSON.stringify(res.json)).toBe(200)
  return SyncResponse.parse(res.json)
}

// ---------------------------------------------------------------------------

describe.skipIf(!sqlite)('POST /api/sync against SQLite', () => {
  let db: SqliteDatabase
  let alice: Account

  beforeEach(async () => {
    db = freshDatabase()
    alice = await createAccount(db, 'alice')
  })

  it('round-trips every entity: push, then pull from 0', async () => {
    const pushed = await ok(db, alice, {
      since: 0,
      changes: {
        settings,
        products: [product],
        stack: [stackItem],
        shopping: [shoppingItem],
        checks: [check],
      },
    })
    // Every pushed row won: nothing to send back.
    const empty = { settings: null, products: [], stack: [], shopping: [], checks: [] }
    expect(pushed).toEqual({ rev: 1, changes: empty })
    const expected = {
      settings: { ...settings, deletedAt: null },
      products: [{ ...product, deletedAt: null }],
      stack: [{ ...stackItem, deletedAt: null }],
      shopping: [{ ...shoppingItem, deletedAt: null }],
      checks: [{ ...check, deletedAt: null }],
    }
    expect(await ok(db, alice, { since: 0 })).toEqual({ rev: 1, changes: expected })
    // Up to date: nothing newer than rev 1, and a pull writes nothing.
    expect(await ok(db, alice, { since: 1, changes: {} })).toEqual({ rev: 1, changes: empty })
    expect(query(db, 'SELECT rev FROM accounts WHERE id = ?1', ['alice'])).toEqual([{ rev: 1 }])
  })

  it("answers another device's changes with a push, never this push's winners", async () => {
    await ok(db, alice, { since: 0, changes: { stack: [stackItem] } }) // device B, rev 1
    // Device A last pulled at rev 0 and pushes a shopping item.
    const a = await ok(db, alice, { since: 0, changes: { shopping: [shoppingItem] } })
    expect(a.rev).toBe(2)
    expect(a.changes.stack).toEqual([{ ...stackItem, deletedAt: null }])
    expect(a.changes.shopping).toEqual([])
    // A retry of a push whose answer was lost: same rows, same updatedAt → they tie, the
    // server's (identical) copies come back and the device ends up where it was.
    const retry = await ok(db, alice, { since: 0, changes: { shopping: [shoppingItem] } })
    expect(retry.rev).toBe(3)
    expect(retry.changes.shopping).toEqual([{ ...shoppingItem, deletedAt: null }])
  })

  it('last write wins by updatedAt; a tie keeps the server copy; the loser learns it', async () => {
    await ok(db, alice, { since: 0, changes: { stack: [stackItem], settings } })

    // Older: loses. The revision still moves, and the answer carries the server's copy.
    const older = await ok(db, alice, {
      since: 1,
      changes: {
        stack: [{ ...stackItem, dosesPerDay: 1, updatedAt: T - 1 }],
        settings: { ...settings, theme: 'ice', updatedAt: T - 1 },
      },
    })
    expect(older.rev).toBe(2)
    expect(older.changes.stack).toEqual([{ ...stackItem, deletedAt: null }])
    expect(older.changes.settings?.theme).toBe('wild')

    // Same updatedAt, different content: the server's copy stays.
    const tie = await ok(db, alice, {
      since: 2,
      changes: { stack: [{ ...stackItem, dosesPerDay: 3 }] },
    })
    expect(tie.changes.stack).toEqual([{ ...stackItem, deletedAt: null }])

    // Newer: wins (so it isn't echoed), and takes the new revision.
    const newer = await ok(db, alice, {
      since: 3,
      changes: { stack: [{ ...stackItem, dosesPerDay: 1, pins: [], updatedAt: T + 1 }] },
    })
    expect(newer.rev).toBe(4)
    expect(newer.changes.stack).toEqual([])
    expect(query(db, 'SELECT doses_per_day, rev FROM stack_items', [])).toEqual([
      { doses_per_day: 1, rev: 4 },
    ])
    expect((await ok(db, alice, { since: 3 })).changes.stack).toEqual([
      { ...stackItem, dosesPerDay: 1, pins: [], updatedAt: T + 1, deletedAt: null },
    ])
  })

  it('stores tombstones without the data, and they beat older live copies', async () => {
    await ok(db, alice, { since: 0, changes: { products: [product], checks: [check] } })
    await ok(db, alice, {
      since: 1,
      changes: {
        products: [{ id: PRODUCT_ID, updatedAt: T + 5, deletedAt: T + 5 }],
        checks: [{ ...check, updatedAt: T + 5, deletedAt: T + 5 }],
        // A tombstone for a row the server never saw is kept too.
        stack: [{ productId: 'zinc', updatedAt: T + 5, deletedAt: T + 5 }],
      },
    })
    // Another device learns about the deletions.
    const deleted = await ok(db, alice, { since: 1 })
    expect(deleted.changes).toMatchObject({
      products: [{ id: PRODUCT_ID, updatedAt: T + 5, deletedAt: T + 5 }],
      stack: [{ productId: 'zinc', updatedAt: T + 5, deletedAt: T + 5 }],
      checks: [
        {
          day: '2026-10-05',
          productId: 'magnesium',
          doseIndex: 0,
          updatedAt: T + 5,
          deletedAt: T + 5,
        },
      ],
    })
    // Nothing of the product remains but its key and dates.
    expect(query(db, 'SELECT name, brand, notes, ingredients FROM user_products', [])).toEqual([
      { name: '', brand: null, notes: null, ingredients: '[]' },
    ])

    // A device that still has the old live copies pushes them: they lose.
    const stale = await ok(db, alice, {
      since: 0,
      changes: { products: [product], stack: [{ ...stackItem, productId: 'zinc' }] },
    })
    expect(stale.changes.products).toEqual([{ id: PRODUCT_ID, updatedAt: T + 5, deletedAt: T + 5 }])
    expect(stale.changes.stack).toEqual([{ productId: 'zinc', updatedAt: T + 5, deletedAt: T + 5 }])

    // Re-added later (newer updatedAt): live again.
    const back = await ok(db, alice, {
      since: 3,
      changes: { products: [{ ...product, updatedAt: T + 9 }] },
    })
    expect(back.changes.products).toEqual([])
    expect((await ok(db, alice, { since: 3 })).changes.products).toEqual([
      { ...product, updatedAt: T + 9, deletedAt: null },
    ])
  })

  it('keeps accounts apart, even when a product id collides', async () => {
    const bob = await createAccount(db, 'bob')
    await ok(db, alice, { since: 0, changes: { products: [product], stack: [stackItem] } })
    const bobs = await ok(db, bob, {
      since: 0,
      changes: {
        products: [{ ...product, name: 'Overwritten', updatedAt: T + 1 }],
        stack: [{ ...stackItem, dosesPerDay: 1, updatedAt: T + 1 }],
      },
    })
    // Bob's product was not written (the id is Alice's) and Alice's data never shows.
    expect(bobs.changes).toEqual({
      settings: null,
      products: [],
      stack: [],
      shopping: [],
      checks: [],
    })
    expect((await ok(db, bob, { since: 0 })).changes).toMatchObject({
      products: [],
      stack: [{ ...stackItem, dosesPerDay: 1, updatedAt: T + 1, deletedAt: null }],
    })
    const alices = await ok(db, alice, { since: 0 })
    expect(alices.changes.products).toEqual([{ ...product, deletedAt: null }])
    expect(alices.changes.stack).toEqual([{ ...stackItem, deletedAt: null }])
  })

  it('refuses until the account consented to the current version', async () => {
    const carol = await createAccount(db, 'carol', null)
    expect(await sync(db, carol, { since: 0 })).toEqual({
      status: 403,
      json: { error: 'consent_required', detail: ['account'] },
    })
    const dave = await createAccount(db, 'dave', '2026-09')
    expect((await sync(db, dave, { since: 0 })).status).toBe(403)
    expect((await sync(db, { id: 'x', token: 'nope' }, { since: 0 })).status).toBe(401)
  })

  it('refuses the health profile (M8) without writing anything', async () => {
    const res = await sync(db, alice, {
      since: 0,
      changes: {
        stack: [stackItem],
        health: { updatedAt: T, deletedAt: T },
      },
    })
    expect(res).toEqual({ status: 403, json: { error: 'consent_required', detail: ['health'] } })
    expect(query(db, 'SELECT count(*) AS n FROM stack_items', [])).toEqual([{ n: 0 }])
  })

  it('answers 413 above 500 rows or 512 KB, 400 for bad bodies', async () => {
    const checks = Array.from({ length: SYNC_MAX_ROWS + 1 }, (_, i) => ({
      ...check,
      productId: `p${i}`,
    }))
    expect(await sync(db, alice, { since: 0, changes: { checks } })).toEqual({
      status: 413,
      json: { error: 'too_many_rows', detail: ['at most 500 rows'] },
    })
    const big = JSON.stringify({ since: 0, changes: {}, padding: 'x'.repeat(512 * 1024) })
    expect((await sync(db, alice, big)).json.error).toBe('payload_too_large')
    expect((await sync(db, alice, '{"since":')).json.error).toBe('invalid_json')
    const bad = await sync(db, alice, '{"since":0,"changes":{"stack":[{"productId":"x"}]}}')
    expect(bad.status).toBe(400)
    expect(bad.json.error).toBe('invalid_body')
    expect(query(db, 'SELECT rev FROM accounts WHERE id = ?1', ['alice'])).toEqual([{ rev: 0 }])
  })

  it('refuses a push that would exceed 60 stack items, counting live rows', async () => {
    const items = (from: number, n: number, at = T) =>
      Array.from({ length: n }, (_, i) => ({
        ...stackItem,
        productId: `s${from + i}`,
        updatedAt: at,
      }))
    await ok(db, alice, { since: 0, changes: { stack: items(0, 60) } })
    const over = await sync(db, alice, { since: 1, changes: { stack: items(60, 1) } })
    expect(over).toEqual({
      status: 409,
      json: { error: 'limit_reached', detail: ['stack: at most 60 per account'] },
    })
    // Removing one in the same push makes room.
    await ok(db, alice, {
      since: 1,
      changes: {
        stack: [...items(60, 1), { productId: 's0', updatedAt: T + 1, deletedAt: T + 1 }],
      },
    })
    // Editing existing items at the limit is fine.
    await ok(db, alice, { since: 2, changes: { stack: items(1, 5, T + 2) } })
  })

  it('removes synced rows with the account (ON DELETE CASCADE)', async () => {
    await ok(db, alice, {
      since: 0,
      changes: {
        settings,
        products: [product],
        stack: [stackItem],
        shopping: [shoppingItem],
        checks: [check],
      },
    })
    query(db, 'DELETE FROM accounts WHERE id = ?1', ['alice'])
    for (const table of [
      'account_settings',
      'user_products',
      'stack_items',
      'shopping_items',
      'dose_checks',
    ]) {
      expect(query(db, `SELECT count(*) AS n FROM ${table}`, [])).toEqual([{ n: 0 }])
    }
  })
})

describe.skipIf(!sqlite)('cleanup, limits and export statements against SQLite', () => {
  it('deletes old check marks and 30-day-old tombstones only', async () => {
    const db = freshDatabase()
    const alice = await createAccount(db, 'alice')
    const now = Date.UTC(2026, 9, 5, 3, 0)
    const old = now - 31 * 24 * 3600_000
    await ok(db, alice, {
      since: 0,
      changes: {
        checks: ['2026-09-30', '2026-10-01', '2026-10-04'].map((day) => ({ ...check, day })),
        stack: [
          { productId: 'gone-long-ago', updatedAt: old, deletedAt: old },
          { productId: 'gone-recently', updatedAt: now, deletedAt: now },
          { ...stackItem, updatedAt: old }, // live rows stay, however old
        ],
        shopping: [{ productId: 'iron', updatedAt: old, deletedAt: old }],
        products: [{ id: PRODUCT_ID, updatedAt: old, deletedAt: old }],
      },
    })
    runAll(db, syncCleanupStatements(now))
    expect(query(db, 'SELECT day FROM dose_checks ORDER BY day', [])).toEqual([
      { day: '2026-10-01' },
      { day: '2026-10-04' },
    ])
    expect(query(db, 'SELECT product_id FROM stack_items ORDER BY product_id', [])).toEqual([
      { product_id: 'gone-recently' },
      { product_id: 'magnesium' },
    ])
    expect(query(db, 'SELECT count(*) AS n FROM shopping_items', [])).toEqual([{ n: 0 }])
    expect(query(db, 'SELECT count(*) AS n FROM user_products', [])).toEqual([{ n: 0 }])
  })

  it('reads the limit rows and every synced row for the export', async () => {
    const db = freshDatabase()
    const alice = await createAccount(db, 'alice')
    await ok(db, alice, {
      since: 0,
      changes: {
        settings,
        products: [product],
        stack: [stackItem],
        shopping: [shoppingItem],
        checks: [check],
      },
    })
    expect(runAll(db, [limitReadStatement(LIMITED_TABLES[1]!, 'alice')])[0]).toEqual([
      { key: 'magnesium', updated_at: T, deleted_at: null },
    ])
    const [s, products, stack, shopping, checks] = runAll(db, syncExportStatements('alice'))
    expect([s, products, stack, shopping, checks].map((rows) => rows?.length)).toEqual([
      1, 1, 1, 1, 1,
    ])
  })
})
