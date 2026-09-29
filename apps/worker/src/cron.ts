/**
 * The every-minute tick. Budget: 10 ms CPU, 50 subrequests, 6 concurrent
 * connections. One claim statement, one subscription lookup, at most six
 * outbound pushes in flight, then one batch of grouped result writes.
 * News notifications (§4.12) then get whatever is left of MAX_PUSHES_PER_TICK:
 * one batch (promote + pick), one fan-out select, their pushes, one batch of writes.
 */
import { authCleanupStatements } from './auth/cleanup'
import { sendEmail } from './email'
import type { Env, PushSubscriptionRow, ReminderRow } from './env'
import { isInactivityTick, runInactivityStep, type InactivitySummary } from './inactivity'
import {
  claimStatement,
  expireStatement,
  inList,
  isRetentionTick,
  MAX_CONCURRENT_PUSHES,
  parseBatchSize,
  reminderOutcome,
  retentionStatement,
  topicFor,
  type PushOutcome,
  type Statement,
} from './logic'
import { runNewsStep, type NewsStepSummary } from './news/deliver'
import { newsBudget, NEWS_PUSH_OPTIONS } from './news/fanout'
import { sendPush, vapidConfig, withConcurrency } from './push'
import { syncCleanupStatements } from './sync'

interface TickSummary {
  expired: number
  claimed: number
  sent: number
  failed: number
  retry: number
  pushes: number
  gone: number
  authErrors: number
  /** News: what the step did (counts and the campaign id only). */
  news: NewsStepSummary | null
  /** Retention of inactive accounts and devices (03:00–03:09 UTC): counts only. */
  inactivity: InactivitySummary | null
  wallMs: number
}

function bind(db: D1Database, s: Statement): D1PreparedStatement {
  return db.prepare(s.sql).bind(...s.params)
}

export async function runTick(env: Env, now: number): Promise<TickSummary> {
  const started = Date.now()
  const summary: TickSummary = {
    expired: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    retry: 0,
    pushes: 0,
    gone: 0,
    authErrors: 0,
    news: null,
    inactivity: null,
    wallMs: 0,
  }
  const batchSize = parseBatchSize(env.MAX_PUSHES_PER_TICK)
  const vapid = vapidConfig(env)

  const expired = await bind(env.DB, expireStatement(now)).run()
  summary.expired = expired.meta.changes ?? 0

  const claimed = await bind(env.DB, claimStatement(now, batchSize)).all<ReminderRow>()
  const reminders = claimed.results
  summary.claimed = reminders.length

  const writes: D1PreparedStatement[] = []
  if (isRetentionTick(now)) writes.push(bind(env.DB, retentionStatement(now)))

  if (reminders.length > 0) {
    const userIds = [...new Set(reminders.map((r) => r.user_id))]
    const subsByUser = new Map<string, PushSubscriptionRow[]>()
    if (vapid) {
      const subs = await env.DB.prepare(
        `SELECT * FROM push_subscriptions WHERE user_id IN (${inList(userIds.length)})`,
      )
        .bind(...userIds)
        .all<PushSubscriptionRow>()
      for (const sub of subs.results) {
        const list = subsByUser.get(sub.user_id) ?? []
        list.push(sub)
        subsByUser.set(sub.user_id, list)
      }
    } else {
      console.error('VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY missing: reminders cannot be sent')
    }

    // One task per (reminder, device).
    const tasks: { reminder: ReminderRow; sub: PushSubscriptionRow }[] = []
    for (const reminder of reminders) {
      for (const sub of subsByUser.get(reminder.user_id) ?? []) tasks.push({ reminder, sub })
    }
    summary.pushes = tasks.length

    const results = vapid
      ? await withConcurrency(
          tasks.map(
            ({ reminder, sub }) =>
              () =>
                sendPush(
                  sub,
                  {
                    title: reminder.title,
                    body: reminder.body,
                    tag: reminder.slot_key,
                    url: '/today',
                  },
                  topicFor(reminder.id),
                  vapid,
                  now,
                ),
          ),
          MAX_CONCURRENT_PUSHES,
        )
      : []

    const outcomesByReminder = new Map<string, PushOutcome[]>()
    const succeededSubs: number[] = []
    const failedSubs: number[] = []
    const goneSubs: number[] = []
    tasks.forEach(({ reminder, sub }, i) => {
      const result = results[i] ?? { outcome: 'failed' as const, status: null }
      const list = outcomesByReminder.get(reminder.id) ?? []
      list.push(result.outcome)
      outcomesByReminder.set(reminder.id, list)
      switch (result.outcome) {
        case 'sent':
          succeededSubs.push(sub.id)
          break
        case 'gone':
          goneSubs.push(sub.id)
          summary.gone++
          break
        case 'auth_error':
          summary.authErrors++
          console.error(
            `push auth error ${result.status} for subscription ${sub.id}: check VAPID keys/subject`,
          )
          failedSubs.push(sub.id)
          break
        default:
          failedSubs.push(sub.id)
      }
    })

    const sentIds: string[] = []
    const failedIds: string[] = []
    for (const reminder of reminders) {
      // No VAPID or no device → failed outright; nothing to retry.
      const outcomes = vapid ? (outcomesByReminder.get(reminder.id) ?? []) : ['auth_error' as const]
      const outcome = reminderOutcome(outcomes, reminder.attempts)
      if (outcome === 'sent') sentIds.push(reminder.id)
      else if (outcome === 'failed') failedIds.push(reminder.id)
      else summary.retry++ // stays 'sending'; reclaimable after 5 min while attempts < 3
    }
    summary.sent = sentIds.length
    summary.failed = failedIds.length

    if (sentIds.length) {
      writes.push(
        env.DB.prepare(
          `UPDATE reminders SET status = 'sent', sent_at = ?1 WHERE id IN (${inList(sentIds.length, 2)})`,
        ).bind(now, ...sentIds),
      )
    }
    if (failedIds.length) {
      writes.push(
        env.DB.prepare(
          `UPDATE reminders SET status = 'failed' WHERE id IN (${inList(failedIds.length)})`,
        ).bind(...failedIds),
      )
    }
    if (succeededSubs.length) {
      writes.push(
        env.DB.prepare(
          `UPDATE push_subscriptions SET last_success_at = ?1, failures = 0 WHERE id IN (${inList(succeededSubs.length, 2)})`,
        ).bind(now, ...succeededSubs),
      )
    }
    if (failedSubs.length) {
      writes.push(
        env.DB.prepare(
          `UPDATE push_subscriptions SET failures = failures + 1 WHERE id IN (${inList(failedSubs.length)})`,
        ).bind(...failedSubs),
      )
    }
    if (goneSubs.length) {
      writes.push(
        env.DB.prepare(
          `DELETE FROM push_subscriptions WHERE id IN (${inList(goneSubs.length)})`,
        ).bind(...goneSubs),
      )
    }
  }

  if (writes.length) await env.DB.batch(writes)

  // News after the reminders' writes, so a news failure never rolls them back. Pushes share the
  // per-tick budget (and the 50-subrequest limit): news only gets what the reminders left.
  if (vapid) {
    try {
      summary.news = await runNewsStep(
        env.DB,
        now,
        newsBudget(batchSize, summary.pushes),
        (sub, payload, topic) => sendPush(sub, payload, topic, vapid, now, NEWS_PUSH_OPTIONS),
      )
    } catch (err) {
      console.error('news step failed:', err instanceof Error ? err.message : String(err))
    }
  }

  // Accounts cleanup (§8.6) in its own batch, so a failure here never rolls back the reminder
  // writes above.
  if (isRetentionTick(now)) {
    try {
      await env.DB.batch(authCleanupStatements(now).map((s) => bind(env.DB, s)))
    } catch (err) {
      console.error('auth cleanup failed:', err instanceof Error ? err.message : String(err))
    }
    // Synced data (§8.6): check marks older than 3 days, tombstones older than 30. Its own
    // batch again: until migration 0003 runs these tables don't exist, and that must not undo
    // the cleanup above.
    try {
      await env.DB.batch(syncCleanupStatements(now).map((s) => bind(env.DB, s)))
    } catch (err) {
      console.error('sync cleanup failed:', err instanceof Error ? err.message : String(err))
    }
  }

  // Retention (§8.6): accounts unused for 3 years (warned 30 days before) and devices without an
  // account unused for 12 months. Last, so nothing above waits on the emails.
  if (isInactivityTick(now)) {
    try {
      summary.inactivity = await runInactivityStep(env.DB, now, {
        deletions: isRetentionTick(now),
        appOrigin: env.APP_ORIGIN,
        send: (message) => sendEmail(env, message),
      })
    } catch (err) {
      console.error('inactivity cleanup failed:', err instanceof Error ? err.message : String(err))
    }
  }

  summary.wallMs = Date.now() - started
  // Counts and timings only: never a user id together with product names or text.
  console.log(JSON.stringify({ tick: new Date(now).toISOString(), ...summary }))
  return summary
}
