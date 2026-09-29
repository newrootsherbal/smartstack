import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runTick } from './cron'
import type { Env } from './env'
import type * as PushModule from './push'
import { sendPush } from './push'
import {
  addCampaign,
  addDevice,
  addSubscription,
  createTestDb,
  type TestDb,
} from './test/sqlite-d1'

// No push service is contacted: every push "succeeds".
vi.mock('./push', async (importOriginal) => {
  const actual = await importOriginal<typeof PushModule>()
  return { ...actual, sendPush: vi.fn(async () => ({ outcome: 'sent', status: 201 })) }
})

const NOW = Date.UTC(2026, 9, 1, 15, 0) // 11:00 in Toronto

function env(db: TestDb, overrides: Partial<Env> = {}): Env {
  return {
    DB: db.d1,
    VAPID_PUBLIC_KEY: 'public',
    VAPID_PRIVATE_KEY: 'private',
    VAPID_SUBJECT: 'mailto:test@example.com',
    MAX_PUSHES_PER_TICK: '5',
    ...overrides,
  } as Env
}

/** A due reminder for a new device with one subscription. */
function addDueReminder(db: TestDb, id: string): void {
  addDevice(db, id, { optIn: false })
  addSubscription(db, id, `https://push.invalid/${id}`)
  db.sql
    .prepare(
      `INSERT INTO reminders (id, user_id, kind, scheduled_at, slot_key, product_ids, title, body)
       VALUES (?, ?, 'schedule', ?, 'slot', '[]', 'Time for 2 products', 'Now')`,
    )
    .run(`r-${id}`, id, NOW - 60_000)
}

function newsDevices(db: TestDb, n: number): void {
  for (let i = 1; i <= n; i++) {
    addDevice(db, `news${i}`)
    addSubscription(db, `news${i}`, `https://push.invalid/news${i}`)
  }
}

function campaignCounts(db: TestDb) {
  return db.sql.prepare(`SELECT status, sent_count, cursor FROM campaigns WHERE id = 'c1'`).get()
}

describe('runTick with news', () => {
  beforeEach(() => {
    vi.mocked(sendPush).mockClear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('gives news only what the reminders left of MAX_PUSHES_PER_TICK', async () => {
    const db = createTestDb()
    addDueReminder(db, 'a')
    addDueReminder(db, 'b')
    addDueReminder(db, 'c')
    newsDevices(db, 6)
    addCampaign(db, 'c1', { now: NOW })

    const summary = await runTick(env(db), NOW)
    expect(summary).toMatchObject({ claimed: 3, sent: 3, pushes: 3 })
    expect(summary.news).toMatchObject({ campaignId: 'c1', pushes: 2, sent: 2, done: false })
    expect(vi.mocked(sendPush)).toHaveBeenCalledTimes(5)
    const reminderStatuses = db.sql.prepare(`SELECT DISTINCT status FROM reminders`).all()
    expect(reminderStatuses).toEqual([{ status: 'sent' }])
    // Reminder devices (ids 1–3) didn't opt in; news went to subscriptions 4 and 5.
    expect(campaignCounts(db)).toEqual({ status: 'sending', sent_count: 2, cursor: 5 })

    // Next minute, no reminders: the whole budget goes to news.
    const next = await runTick(env(db), NOW + 60_000)
    expect(next.news).toMatchObject({ pushes: 4, sent: 4, done: true })
    expect(campaignCounts(db)).toEqual({ status: 'sent', sent_count: 6, cursor: 9 })
  })

  it('sends no news when the reminders use the whole budget', async () => {
    const db = createTestDb()
    for (const id of ['a', 'b', 'c', 'd', 'e']) addDueReminder(db, id)
    newsDevices(db, 2)
    addCampaign(db, 'c1', { now: NOW })
    const summary = await runTick(env(db), NOW)
    expect(summary.news).toMatchObject({ skipped: 'no_budget' })
    expect(campaignCounts(db)).toEqual({ status: 'sending', sent_count: 0, cursor: 0 })
  })

  it('skips news without VAPID keys', async () => {
    const db = createTestDb()
    newsDevices(db, 2)
    addCampaign(db, 'c1', { now: NOW })
    const summary = await runTick(env(db, { VAPID_PRIVATE_KEY: '' }), NOW)
    expect(summary.news).toBeNull()
    expect(vi.mocked(sendPush)).not.toHaveBeenCalled()
  })
})
