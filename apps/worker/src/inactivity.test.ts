import { describe, expect, it, vi } from 'vitest'
import type { EmailMessage, EmailResult } from './email'
import {
  ACCOUNT_INACTIVE_MS,
  DEVICE_INACTIVE_MS,
  INACTIVITY_WARNING_LEAD_MS,
  INACTIVITY_WARNINGS_PER_TICK,
  isInactivityTick,
  runInactivityStep,
} from './inactivity'
import { addSubscription, createTestDb, type TestDb } from './test/sqlite-d1'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2029, 9, 1, 3, 0)
const ORIGIN = 'https://schedule.example.com'

function addAccount(
  db: TestDb,
  id: string,
  lastActiveAt: number,
  options: { warnedAt?: number | null; locale?: 'en' | 'fr' } = {},
): void {
  db.sql
    .prepare(
      `INSERT INTO accounts (id, email, locale, created_at, updated_at, last_active_at,
         inactivity_warned_at)
       VALUES (?, ?, ?, 0, 0, ?, ?)`,
    )
    .run(id, `${id}@example.com`, options.locale ?? 'en', lastActiveAt, options.warnedAt ?? null)
}

function addDevice(db: TestDb, id: string, lastSeenAt: number, accountId: string | null = null) {
  db.sql
    .prepare(
      `INSERT INTO users (id, tz, platform, created_at, last_seen_at, account_id)
       VALUES (?, 'America/Toronto', 'android', 0, ?, ?)`,
    )
    .run(id, lastSeenAt, accountId)
}

function ids(db: TestDb, table: 'accounts' | 'users'): string[] {
  return (db.sql.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as { id: string }[]).map(
    (r) => r.id,
  )
}

function warnedAt(db: TestDb, id: string): number | null {
  const row = db.sql.prepare('SELECT inactivity_warned_at AS w FROM accounts WHERE id = ?').get(id)
  return (row as { w: number | null } | undefined)?.w ?? null
}

function sender(result: EmailResult | ((m: EmailMessage) => EmailResult) = 'sent') {
  const sent: EmailMessage[] = []
  const send = vi.fn(async (message: EmailMessage) => {
    sent.push(message)
    return typeof result === 'function' ? result(message) : result
  })
  return { sent, send }
}

/** Unused for 3 years minus 30 days, plus a margin. */
const DUE_FOR_WARNING = NOW - (ACCOUNT_INACTIVE_MS - INACTIVITY_WARNING_LEAD_MS) - DAY

describe('inactivity ticks', () => {
  it('warns from 03:00 to 03:09 UTC', () => {
    expect(isInactivityTick(Date.UTC(2029, 0, 1, 3, 0))).toBe(true)
    expect(isInactivityTick(Date.UTC(2029, 0, 1, 3, 9))).toBe(true)
    expect(isInactivityTick(Date.UTC(2029, 0, 1, 3, 10))).toBe(false)
    expect(isInactivityTick(Date.UTC(2029, 0, 1, 2, 59))).toBe(false)
  })
})

describe('inactive-account warnings (N8/N9)', () => {
  it('warns accounts unused for almost 3 years, in their language, and marks them', async () => {
    const db = createTestDb()
    addAccount(db, 'old-en', DUE_FOR_WARNING)
    addAccount(db, 'old-fr', DUE_FOR_WARNING - DAY, { locale: 'fr' })
    addAccount(db, 'recent', NOW - 30 * DAY)
    addAccount(db, 'already', DUE_FOR_WARNING, { warnedAt: NOW - 5 * DAY })
    const { sent, send } = sender()

    const summary = await runInactivityStep(db.d1, NOW, {
      deletions: false,
      appOrigin: ORIGIN,
      send,
    })

    expect(summary).toEqual({ deletedAccounts: 0, deletedDevices: 0, warned: 2, unsent: 0 })
    // Oldest first.
    expect(sent.map((m) => m.to)).toEqual(['old-fr@example.com', 'old-en@example.com'])
    expect(sent[0]?.subject).toBe('Votre compte SmartStack sera supprimé dans 30 jours')
    expect(sent[1]?.subject).toBe('Your SmartStack account will be deleted in 30 days')
    // The deletion date in the email: 30 days from now (Toronto calendar day).
    expect(sent[1]?.text).toContain('October 30, 2029')
    expect(warnedAt(db, 'old-en')).toBe(NOW)
    expect(warnedAt(db, 'old-fr')).toBe(NOW)
    expect(warnedAt(db, 'recent')).toBeNull()
    expect(warnedAt(db, 'already')).toBe(NOW - 5 * DAY)
  })

  it('sends a few per tick', async () => {
    const db = createTestDb()
    for (let i = 0; i < INACTIVITY_WARNINGS_PER_TICK + 2; i++) {
      addAccount(db, `a${i}`, DUE_FOR_WARNING - i)
    }
    const { send } = sender()
    const summary = await runInactivityStep(db.d1, NOW, {
      deletions: false,
      appOrigin: ORIGIN,
      send,
    })
    expect(summary.warned).toBe(INACTIVITY_WARNINGS_PER_TICK)
  })

  it('marks nobody when email is not set up (no deletion without notice)', async () => {
    const db = createTestDb()
    addAccount(db, 'a', DUE_FOR_WARNING)
    addAccount(db, 'b', DUE_FOR_WARNING)
    const { send } = sender('not_configured')
    const summary = await runInactivityStep(db.d1, NOW, {
      deletions: false,
      appOrigin: ORIGIN,
      send,
    })
    expect(summary).toMatchObject({ warned: 0, unsent: 1 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(warnedAt(db, 'a')).toBeNull()
    expect(warnedAt(db, 'b')).toBeNull()
  })

  it('tries the next account after a failed send', async () => {
    const db = createTestDb()
    addAccount(db, 'a', DUE_FOR_WARNING - DAY)
    addAccount(db, 'b', DUE_FOR_WARNING)
    const { send } = sender((m) => (m.to.startsWith('a@') ? 'failed' : 'sent'))
    const summary = await runInactivityStep(db.d1, NOW, {
      deletions: false,
      appOrigin: ORIGIN,
      send,
    })
    expect(summary).toMatchObject({ warned: 1, unsent: 1 })
    expect(warnedAt(db, 'a')).toBeNull()
    expect(warnedAt(db, 'b')).toBe(NOW)
  })

  it("doesn't mark an account that came back while the email was going out", async () => {
    const db = createTestDb()
    addAccount(db, 'a', DUE_FOR_WARNING)
    const send = vi.fn(async (): Promise<EmailResult> => {
      db.sql.prepare('UPDATE accounts SET last_active_at = ? WHERE id = ?').run(NOW, 'a')
      return 'sent'
    })
    await runInactivityStep(db.d1, NOW, { deletions: false, appOrigin: ORIGIN, send })
    expect(warnedAt(db, 'a')).toBeNull()
  })
})

describe('inactive-account deletion', () => {
  it('deletes accounts warned 30 days ago and still unused, with everything in them', async () => {
    const db = createTestDb()
    const inactive = NOW - ACCOUNT_INACTIVE_MS - DAY
    addAccount(db, 'gone', inactive, { warnedAt: NOW - INACTIVITY_WARNING_LEAD_MS })
    addAccount(db, 'soon', inactive, { warnedAt: NOW - INACTIVITY_WARNING_LEAD_MS + DAY })
    addAccount(db, 'unwarned', inactive)
    db.sql
      .prepare(
        `INSERT INTO sessions (id, account_id, created_at, last_used_at, expires_at)
         VALUES ('s1', 'gone', 0, 0, ?)`,
      )
      .run(NOW + DAY)
    addDevice(db, 'dev-gone', NOW, 'gone')
    addSubscription(db, 'dev-gone')
    const { send } = sender()

    const summary = await runInactivityStep(db.d1, NOW, {
      deletions: true,
      appOrigin: ORIGIN,
      send,
    })

    expect(summary.deletedAccounts).toBe(1)
    expect(ids(db, 'accounts')).toEqual(['soon', 'unwarned'])
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 })
    expect(ids(db, 'users')).toEqual([])
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 })
    // The unwarned one gets its warning first.
    expect(summary.warned).toBe(1)
  })

  it('never deletes at the ticks without deletions', async () => {
    const db = createTestDb()
    addAccount(db, 'gone', NOW - ACCOUNT_INACTIVE_MS - DAY, {
      warnedAt: NOW - INACTIVITY_WARNING_LEAD_MS - DAY,
    })
    addDevice(db, 'old-guest', NOW - DEVICE_INACTIVE_MS - DAY)
    const { send } = sender()
    await runInactivityStep(db.d1, NOW, { deletions: false, appOrigin: ORIGIN, send })
    expect(ids(db, 'accounts')).toEqual(['gone'])
    expect(ids(db, 'users')).toEqual(['old-guest'])
  })
})

describe('inactive devices without an account', () => {
  it('deletes guest devices unused for 12 months, with their subscriptions', async () => {
    const db = createTestDb()
    addAccount(db, 'acc', NOW)
    addDevice(db, 'old-guest', NOW - DEVICE_INACTIVE_MS - DAY)
    addDevice(db, 'recent-guest', NOW - DEVICE_INACTIVE_MS + DAY)
    addDevice(db, 'old-linked', NOW - DEVICE_INACTIVE_MS - DAY, 'acc')
    addSubscription(db, 'old-guest')
    const { send } = sender()

    const summary = await runInactivityStep(db.d1, NOW, {
      deletions: true,
      appOrigin: ORIGIN,
      send,
    })

    expect(summary.deletedDevices).toBe(1)
    expect(ids(db, 'users')).toEqual(['old-linked', 'recent-guest'])
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 })
  })
})
