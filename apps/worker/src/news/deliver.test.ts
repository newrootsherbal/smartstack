import { NEWS_CAP_MS, type NewsPushPayload } from '@smartstack/shared'
import { describe, expect, it } from 'vitest'
import type { CampaignRow } from '../env'
import type { SendResult } from '../push'
import {
  addAccount,
  addCampaign,
  addDevice,
  addProfile,
  addSubscription,
  createTestDb,
  type TestDb,
} from '../test/sqlite-d1'
import { runNewsStep, sendTestToOwnDevices, type NewsSender } from './deliver'

const NOW = Date.UTC(2026, 9, 1, 15, 0) // 11:00 in Toronto
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

interface Sent {
  endpoint: string
  payload: NewsPushPayload
  topic: string
}

/** A fake push service: records every push; `status(endpoint)` decides the answer. */
function fakeSender(status: (endpoint: string) => number | 'network' = () => 201) {
  const sent: Sent[] = []
  const send: NewsSender = async (sub, payload, topic) => {
    sent.push({ endpoint: sub.endpoint, payload, topic })
    const code = status(sub.endpoint)
    if (code === 'network') return { outcome: 'retry', status: null }
    const outcome: SendResult['outcome'] =
      code < 300
        ? 'sent'
        : code === 404 || code === 410
          ? 'gone'
          : code === 401
            ? 'auth_error'
            : code >= 500
              ? 'retry'
              : 'failed'
    return { outcome, status: code }
  }
  return { sent, send }
}

function campaign(db: TestDb, id: string): CampaignRow {
  return db.sql.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as unknown as CampaignRow
}

function lastNewsAt(db: TestDb, userId: string): number | null {
  return (
    db.sql.prepare('SELECT last_news_at AS t FROM users WHERE id = ?').get(userId) as {
      t: number | null
    }
  ).t
}

/** n opted-in guest devices with one subscription each; returns their ids. */
function devices(db: TestDb, n: number, prefix = 'd'): string[] {
  return Array.from({ length: n }, (_, i) => {
    const id = `${prefix}${i + 1}`
    addDevice(db, id)
    addSubscription(db, id, `https://push.invalid/${id}`)
    return id
  })
}

describe('runNewsStep', () => {
  it('does nothing without budget, outside 11:00–19:00 Toronto, or without a campaign', async () => {
    const db = createTestDb()
    devices(db, 2)
    const { send, sent } = fakeSender()
    expect((await runNewsStep(db.d1, NOW, 20, send)).skipped).toBe('idle')
    addCampaign(db, 'c1', { now: NOW })
    expect((await runNewsStep(db.d1, NOW, 0, send)).skipped).toBe('no_budget')
    const night = Date.UTC(2026, 9, 1, 7, 0) // 03:00 in Toronto
    expect((await runNewsStep(db.d1, night, 20, send)).skipped).toBe('outside_window')
    const evening = Date.UTC(2026, 9, 1, 23, 1) // 19:01
    expect((await runNewsStep(db.d1, evening, 20, send)).skipped).toBe('outside_window')
    expect(sent).toHaveLength(0)
    expect(campaign(db, 'c1').cursor).toBe(0)
  })

  it('walks the subscriptions with the cursor, budget by budget, then marks the campaign sent', async () => {
    const db = createTestDb()
    devices(db, 5)
    addCampaign(db, 'c1', { now: NOW })
    const { send, sent } = fakeSender()

    const first = await runNewsStep(db.d1, NOW, 2, send)
    expect(first).toMatchObject({ campaignId: 'c1', pushes: 2, sent: 2, done: false })
    expect(campaign(db, 'c1')).toMatchObject({ cursor: 2, sent_count: 2, status: 'sending' })

    await runNewsStep(db.d1, NOW + MINUTE, 2, send)
    expect(campaign(db, 'c1')).toMatchObject({ cursor: 4, sent_count: 4, status: 'sending' })

    const last = await runNewsStep(db.d1, NOW + 2 * MINUTE, 2, send)
    expect(last).toMatchObject({ pushes: 1, done: true })
    expect(campaign(db, 'c1')).toMatchObject({
      cursor: 5,
      sent_count: 5,
      failed_count: 0,
      status: 'sent',
      finished_at: NOW + 2 * MINUTE,
    })
    expect(sent.map((s) => s.endpoint)).toEqual(
      [1, 2, 3, 4, 5].map((i) => `https://push.invalid/d${i}`),
    )
    expect(lastNewsAt(db, 'd1')).toBe(NOW)
    expect(lastNewsAt(db, 'd5')).toBe(NOW + 2 * MINUTE)
    expect((await runNewsStep(db.d1, NOW + 3 * MINUTE, 2, send)).skipped).toBe('idle')
  })

  it('never sends a device more than one news notification in 24 h', async () => {
    const db = createTestDb()
    addDevice(db, 'recent', { lastNewsAt: NOW - 23 * HOUR })
    addSubscription(db, 'recent')
    addDevice(db, 'yesterday', { lastNewsAt: NOW - NEWS_CAP_MS })
    addSubscription(db, 'yesterday', 'https://push.invalid/yesterday')
    addDevice(db, 'never')
    addSubscription(db, 'never', 'https://push.invalid/never')
    addCampaign(db, 'c1', { now: NOW })
    const { send, sent } = fakeSender()
    await runNewsStep(db.d1, NOW, 20, send)
    expect(sent.map((s) => s.endpoint).sort()).toEqual([
      'https://push.invalid/never',
      'https://push.invalid/yesterday',
    ])
    expect(campaign(db, 'c1').status).toBe('sent')

    // A second campaign right after: everyone is capped, it finishes with nothing sent.
    addCampaign(db, 'c2', { now: NOW })
    const second = await runNewsStep(db.d1, NOW + MINUTE, 20, send)
    expect(second).toMatchObject({ campaignId: 'c2', pushes: 0, done: true })
    expect(campaign(db, 'c2')).toMatchObject({ status: 'sent', sent_count: 0 })
  })

  it("sends the text in each device's language", async () => {
    const db = createTestDb()
    addDevice(db, 'en-phone', { locale: 'en' })
    addSubscription(db, 'en-phone', 'https://push.invalid/en')
    addDevice(db, 'fr-phone', { locale: 'fr' })
    addSubscription(db, 'fr-phone', 'https://push.invalid/fr')
    addCampaign(db, 'c1', { now: NOW })
    const { send, sent } = fakeSender()
    await runNewsStep(db.d1, NOW, 20, send)
    const byEndpoint = Object.fromEntries(sent.map((s) => [s.endpoint, s]))
    expect(byEndpoint['https://push.invalid/en']?.payload).toMatchObject({
      title: 'New Roots Herbal: c1',
      body: 'Body',
      lang: 'en',
      kind: 'news',
      tag: 'news:c1',
      campaignId: 'c1',
    })
    expect(byEndpoint['https://push.invalid/fr']?.payload).toMatchObject({
      title: 'New Roots Herbal : c1 FR',
      body: 'Corps',
      lang: 'fr',
    })
    expect(sent[0]?.topic).toBe('c1')
  })

  it('deletes 404/410 subscriptions, counts other failures, never retries', async () => {
    const db = createTestDb()
    const ids = devices(db, 4)
    addCampaign(db, 'c1', { now: NOW })
    const answers: Record<string, number | 'network'> = {
      'https://push.invalid/d1': 410,
      'https://push.invalid/d2': 500,
      'https://push.invalid/d3': 'network',
      'https://push.invalid/d4': 201,
    }
    const { send } = fakeSender((endpoint) => answers[endpoint] ?? 201)
    const step = await runNewsStep(db.d1, NOW, 20, send)
    expect(step).toMatchObject({ sent: 1, failed: 3, gone: 1, done: true })
    expect(campaign(db, 'c1')).toMatchObject({ sent_count: 1, failed_count: 3, status: 'sent' })
    const left = db.sql.prepare('SELECT user_id FROM push_subscriptions ORDER BY id').all() as {
      user_id: string
    }[]
    expect(left.map((r) => r.user_id)).toEqual(['d2', 'd3', 'd4'])
    expect(ids.map((id) => lastNewsAt(db, id))).toEqual([null, null, null, NOW])
  })

  it('reaches only the segment', async () => {
    const db = createTestDb()
    addAccount(db, 'ana')
    addProfile(db, 'ana', { goals: ['sleep'] })
    addDevice(db, 'ana-phone', { accountId: 'ana' })
    addSubscription(db, 'ana-phone', 'https://push.invalid/ana')
    addAccount(db, 'bob')
    addProfile(db, 'bob', { goals: ['energy'] })
    addDevice(db, 'bob-phone', { accountId: 'bob' })
    addSubscription(db, 'bob-phone', 'https://push.invalid/bob')
    devices(db, 2, 'guest')
    addCampaign(db, 'c1', { now: NOW, audience: { type: 'segment', goals: ['sleep'] } })
    const { send, sent } = fakeSender()
    await runNewsStep(db.d1, NOW, 20, send)
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.invalid/ana'])
    expect(campaign(db, 'c1')).toMatchObject({ status: 'sent', sent_count: 1 })
  })

  it('starts due scheduled campaigns and serves the oldest sending one first', async () => {
    const db = createTestDb()
    devices(db, 3)
    addCampaign(db, 'later', { now: NOW, status: 'scheduled', sendAt: NOW + HOUR })
    addCampaign(db, 'due', { now: NOW, status: 'scheduled', sendAt: NOW - 2 * MINUTE })
    addCampaign(db, 'older', { now: NOW, status: 'sending', sendAt: NOW - 30 * MINUTE })
    const { send } = fakeSender()
    const step = await runNewsStep(db.d1, NOW, 2, send)
    expect(step.campaignId).toBe('older')
    expect(campaign(db, 'due').status).toBe('sending')
    expect(campaign(db, 'later').status).toBe('scheduled')
  })

  it('keeps a campaign cancelled during a step cancelled, with its progress recorded', async () => {
    const db = createTestDb()
    devices(db, 2)
    addCampaign(db, 'c1', { now: NOW })
    const send: NewsSender = async () => {
      db.sql.prepare(`UPDATE campaigns SET status = 'cancelled' WHERE id = 'c1'`).run()
      return { outcome: 'sent', status: 201 }
    }
    await runNewsStep(db.d1, NOW, 20, send)
    expect(campaign(db, 'c1')).toMatchObject({ status: 'cancelled', sent_count: 2, cursor: 2 })
  })

  it('cancels a campaign whose stored audience is unreadable instead of blocking the queue', async () => {
    const db = createTestDb()
    devices(db, 1)
    addCampaign(db, 'broken', { now: NOW, audience: '{"type":"segment"}' })
    const { send, sent } = fakeSender()
    await runNewsStep(db.d1, NOW, 20, send)
    expect(sent).toHaveLength(0)
    expect(campaign(db, 'broken').status).toBe('cancelled')
  })
})

describe('sendTestToOwnDevices', () => {
  it("reaches the admin's linked devices whatever their opt-in or cap, and counts nothing", async () => {
    const db = createTestDb()
    addAccount(db, 'admin', { role: 'admin' })
    addDevice(db, 'phone', { accountId: 'admin', locale: 'fr', optIn: false })
    addSubscription(db, 'phone', 'https://push.invalid/phone')
    addDevice(db, 'laptop', { accountId: 'admin', lastNewsAt: NOW - HOUR })
    addSubscription(db, 'laptop', 'https://push.invalid/laptop')
    addSubscription(db, 'laptop', 'https://push.invalid/laptop-old')
    devices(db, 2, 'someone')
    addCampaign(db, 'c1', { now: NOW, status: 'draft' })
    const { send, sent } = fakeSender((e) => (e.endsWith('-old') ? 410 : 201))
    const result = await sendTestToOwnDevices(db.d1, campaign(db, 'c1'), 'admin', send)
    expect(result).toEqual({ devices: 2, sent: 2, failed: 1 })
    expect(sent.map((s) => [s.endpoint, s.payload.lang])).toEqual([
      ['https://push.invalid/phone', 'fr'],
      ['https://push.invalid/laptop', 'en'],
      ['https://push.invalid/laptop-old', 'en'],
    ])
    expect(campaign(db, 'c1')).toMatchObject({ sent_count: 0, failed_count: 0, status: 'draft' })
    expect(lastNewsAt(db, 'laptop')).toBe(NOW - HOUR)
    const count = db.sql.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as {
      n: number
    }
    expect(count.n).toBe(4) // the 410 one is gone
  })

  it('answers null when the admin has no device with notifications', async () => {
    const db = createTestDb()
    addAccount(db, 'admin', { role: 'admin' })
    addDevice(db, 'phone', { accountId: 'admin' })
    addCampaign(db, 'c1', { now: NOW, status: 'draft' })
    const { send } = fakeSender()
    expect(await sendTestToOwnDevices(db.d1, campaign(db, 'c1'), 'admin', send)).toBeNull()
  })
})
