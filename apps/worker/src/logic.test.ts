import { describe, expect, it } from 'vitest'
import {
  chunk,
  claimStatement,
  classifyPushStatus,
  expireStatement,
  isRetentionTick,
  parseBatchSize,
  reminderOutcome,
  scheduleStatements,
  testReminderAllowed,
  topicFor,
} from './logic'

const NOW = Date.UTC(2026, 8, 24, 13, 30, 0)

describe('claim / expiry statements', () => {
  it('claims pending and stale-sending rows within the 30-minute window, at most 3 attempts', () => {
    const s = claimStatement(NOW, 20)
    expect(s.sql).toMatch(/status = 'sending'/)
    expect(s.sql).toMatch(/attempts = attempts \+ 1/)
    expect(s.sql).toMatch(/RETURNING \*/)
    expect(s.params).toEqual([NOW, NOW - 5 * 60_000, NOW - 30 * 60_000, 3, 20])
  })

  it('expires anything more than 30 minutes past due', () => {
    const s = expireStatement(NOW)
    expect(s.sql).toMatch(/status = 'expired'/)
    expect(s.params).toEqual([NOW - 30 * 60_000])
  })

  it('runs retention only on the 03:00 UTC tick', () => {
    expect(isRetentionTick(Date.UTC(2026, 8, 24, 3, 0, 12))).toBe(true)
    expect(isRetentionTick(Date.UTC(2026, 8, 24, 3, 1, 0))).toBe(false)
    expect(isRetentionTick(Date.UTC(2026, 8, 24, 15, 0, 0))).toBe(false)
  })

  it('parses the batch size with a default of 20 and a ceiling of 45', () => {
    expect(parseBatchSize(undefined)).toBe(20)
    expect(parseBatchSize('abc')).toBe(20)
    expect(parseBatchSize('0')).toBe(20)
    expect(parseBatchSize('30')).toBe(30)
    expect(parseBatchSize('500')).toBe(45)
  })
})

describe('schedule statements', () => {
  const reminder = (i: number) => ({
    scheduledAt: NOW + i * 60_000,
    slotKey: `2026-09-24:${String(i).padStart(2, '0')}:00`,
    productIds: ['sample-iron'],
    title: 'Iron — 9:30 AM',
    body: 'Iron · Take with water',
  })

  it('deletes only pending future schedule rows, then inserts in chunks of 11', () => {
    let n = 0
    const statements = scheduleStatements(
      'user-1',
      Array.from({ length: 25 }, (_, i) => reminder(i)),
      NOW,
      () => `id-${n++}`,
    )
    expect(statements[0]?.sql).toMatch(
      /kind = 'schedule' AND status = 'pending' AND scheduled_at > \?2/,
    )
    expect(statements[0]?.params).toEqual(['user-1', NOW])
    // 25 rows → 11 + 11 + 3
    const inserts = statements.filter((s) => s.sql.includes('INSERT OR IGNORE'))
    expect(inserts).toHaveLength(3)
    expect(inserts[0]?.params).toHaveLength(11 * 9)
    expect(inserts[2]?.params).toHaveLength(3 * 9)
    // Every insert stays under D1's 100 bound-parameter limit.
    for (const s of inserts) expect(s.params.length).toBeLessThanOrEqual(100)
    expect(statements.at(-1)?.sql).toMatch(/last_seen_at/)
    // 200 reminders → 1 + 19 + 1 = 21 statements, well under the 50-subrequest limit.
    expect(
      scheduleStatements(
        'u',
        Array.from({ length: 200 }, (_, i) => reminder(i)),
        NOW,
        () => 'x',
      ),
    ).toHaveLength(21)
  })

  it('serializes product ids as JSON', () => {
    const [, insert] = scheduleStatements('u', [reminder(1)], NOW, () => 'id')
    expect(insert?.params[5]).toBe('["sample-iron"]')
  })
})

describe('push response handling', () => {
  it('classifies push-service responses', () => {
    expect(classifyPushStatus(201)).toBe('sent')
    expect(classifyPushStatus(200)).toBe('sent')
    expect(classifyPushStatus(404)).toBe('gone')
    expect(classifyPushStatus(410)).toBe('gone')
    expect(classifyPushStatus(401)).toBe('auth_error')
    expect(classifyPushStatus(403)).toBe('auth_error')
    expect(classifyPushStatus(429)).toBe('retry')
    expect(classifyPushStatus(503)).toBe('retry')
    expect(classifyPushStatus(413)).toBe('failed')
  })

  it('marks a reminder sent when any device got it, retries while attempts remain', () => {
    expect(reminderOutcome(['gone', 'sent'], 1)).toBe('sent')
    expect(reminderOutcome(['retry'], 1)).toBe('retry')
    expect(reminderOutcome(['retry'], 3)).toBe('failed')
    expect(reminderOutcome(['auth_error'], 1)).toBe('failed')
    expect(reminderOutcome([], 1)).toBe('failed')
  })

  it('derives a topic of at most 32 URL-safe characters from the row id', () => {
    const topic = topicFor('3f2b9d4e-1c7a-4b8e-9a2d-6f1e2c3b4a5d')
    expect(topic).toHaveLength(32)
    expect(topic).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('helpers', () => {
  it('rate-limits test reminders to one per lead time', () => {
    expect(testReminderAllowed(null, NOW)).toBe(true)
    expect(testReminderAllowed(NOW - 1, NOW)).toBe(true)
    expect(testReminderAllowed(NOW + 60_000, NOW)).toBe(false)
  })

  it('chunks', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
  })
})
