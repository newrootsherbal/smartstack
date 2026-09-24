/**
 * Pure functions behind the API and the cron. No bindings, no fetch: this is
 * what the unit tests cover.
 */
import type { ReminderInput } from '@smartstack/shared'

export const CLAIM_WINDOW_MS = 30 * 60 * 1000 // a reminder older than this is never sent late
export const STALE_CLAIM_MS = 5 * 60 * 1000 // a 'sending' row this old is reclaimable
export const MAX_ATTEMPTS = 3
export const TEST_LEAD_MS = 2 * 60 * 1000
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const PUSH_TTL_SECONDS = 1800
export const DEFAULT_BATCH = 20
export const MAX_BATCH = 45
/** D1 allows at most 100 bound parameters per statement; a reminder row binds 9. */
export const ROWS_PER_INSERT = 11
export const MAX_CONCURRENT_PUSHES = 6

export interface Statement {
  sql: string
  params: (string | number | null)[]
}

export function parseBatchSize(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_BATCH
  return Math.min(n, MAX_BATCH)
}

/** Pending rows more than 30 minutes past due are expired, never sent late. */
export function expireStatement(now: number): Statement {
  return {
    sql: `UPDATE reminders SET status = 'expired'
          WHERE status IN ('pending', 'sending') AND scheduled_at <= ?1`,
    params: [now - CLAIM_WINDOW_MS],
  }
}

/** One statement claims the batch and returns the rows (README §Worker). */
export function claimStatement(now: number, batch: number): Statement {
  return {
    sql: `UPDATE reminders
          SET status = 'sending', claimed_at = ?1, attempts = attempts + 1
          WHERE id IN (
            SELECT id FROM reminders
            WHERE (status = 'pending' OR (status = 'sending' AND claimed_at < ?2))
              AND scheduled_at <= ?1
              AND scheduled_at > ?3
              AND attempts < ?4
            ORDER BY scheduled_at
            LIMIT ?5
          )
          RETURNING *`,
    params: [now, now - STALE_CLAIM_MS, now - CLAIM_WINDOW_MS, MAX_ATTEMPTS, batch],
  }
}

export function retentionStatement(now: number): Statement {
  return {
    sql: `DELETE FROM reminders
          WHERE status IN ('sent', 'failed', 'expired') AND scheduled_at < ?1`,
    params: [now - RETENTION_MS],
  }
}

/** The 03:00 UTC tick runs retention. */
export function isRetentionTick(now: number): boolean {
  const d = new Date(now)
  return d.getUTCHours() === 3 && d.getUTCMinutes() === 0
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * PUT /api/me/schedule: drop this user's pending future schedule rows, then
 * INSERT OR IGNORE the new window. 'sending', 'sent' and 'test' rows are never touched.
 */
export function scheduleStatements(
  userId: string,
  reminders: readonly ReminderInput[],
  now: number,
  newId: () => string,
): Statement[] {
  const statements: Statement[] = [
    {
      sql: `DELETE FROM reminders
            WHERE user_id = ?1 AND kind = 'schedule' AND status = 'pending' AND scheduled_at > ?2`,
      params: [userId, now],
    },
  ]
  for (const rows of chunk(reminders, ROWS_PER_INSERT)) {
    const placeholders = rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
    const params = rows.flatMap((r) => [
      newId(),
      userId,
      'schedule',
      r.scheduledAt,
      r.slotKey,
      JSON.stringify(r.productIds),
      r.title,
      r.body,
      'pending',
    ])
    statements.push({
      sql: `INSERT OR IGNORE INTO reminders
            (id, user_id, kind, scheduled_at, slot_key, product_ids, title, body, status)
            VALUES ${placeholders}`,
      params,
    })
  }
  statements.push({
    sql: `UPDATE users SET last_seen_at = ?1 WHERE id = ?2`,
    params: [now, userId],
  })
  return statements
}

/** At most one test reminder per 2 minutes: the previous one must already be due. */
export function testReminderAllowed(lastTestScheduledAt: number | null, now: number): boolean {
  return lastTestScheduledAt === null || lastTestScheduledAt <= now
}

/** ≤ 32 URL-safe chars so a retry replaces rather than duplicates. */
export function topicFor(reminderId: string): string {
  return reminderId.replace(/-/g, '').slice(0, 32)
}

export type PushOutcome = 'sent' | 'gone' | 'auth_error' | 'retry' | 'failed'

/**
 * 404/410 → subscription gone (delete it). 401/403 → VAPID / key problem: keep
 * the subscription, fail the row, log loudly. 429/5xx → try again next tick.
 */
export function classifyPushStatus(status: number): PushOutcome {
  if (status === 200 || status === 201 || status === 202) return 'sent'
  if (status === 404 || status === 410) return 'gone'
  if (status === 401 || status === 403) return 'auth_error'
  if (status === 429 || status >= 500) return 'retry'
  return 'failed'
}

export type ReminderOutcome = 'sent' | 'failed' | 'retry'

/** A reminder is sent when any device got it; retried while attempts remain. */
export function reminderOutcome(
  outcomes: readonly PushOutcome[],
  attempts: number,
): ReminderOutcome {
  if (outcomes.includes('sent')) return 'sent'
  if (outcomes.includes('retry') && attempts < MAX_ATTEMPTS) return 'retry'
  return 'failed'
}

export function inList(count: number, offset = 1): string {
  return Array.from({ length: count }, (_, i) => `?${i + offset}`).join(', ')
}
