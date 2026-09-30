/**
 * News delivery, the part that touches D1 and the push services: one step per cron tick, and the
 * admin's test send. `send` is injected (sendPush with the VAPID keys in production, a fake in
 * tests). Logs: counts, status codes and ids only.
 */
import { inNewsWindow, type NewsPushPayload } from '@smartstack/shared'
import type { CampaignRow } from '../env'
import { prepare, prepareAll } from '../http'
import { chunk, inList, MAX_CONCURRENT_PUSHES, topicFor, type Statement } from '../logic'
import { withConcurrency, type SendResult } from '../push'
import {
  cancelBrokenStatement,
  fanoutPlan,
  fanoutSelectStatement,
  IDS_PER_STATEMENT,
  newsPayload,
  nextSendingStatement,
  parseStoredAudience,
  promoteDueStatement,
  testDevicesStatement,
  type FanoutRow,
} from './fanout'

export type NewsSender = (
  sub: Pick<FanoutRow, 'endpoint' | 'p256dh' | 'auth'>,
  payload: NewsPushPayload,
  topic: string,
) => Promise<SendResult>

export interface NewsStepSummary {
  /** Why nothing was attempted: no budget left, outside 11:00–19:00 Toronto, or no campaign. */
  skipped?: 'no_budget' | 'outside_window' | 'idle'
  campaignId?: string
  pushes: number
  sent: number
  failed: number
  gone: number
  authErrors: number
  done: boolean
}

function emptySummary(skipped?: NewsStepSummary['skipped']): NewsStepSummary {
  return {
    ...(skipped ? { skipped } : {}),
    pushes: 0,
    sent: 0,
    failed: 0,
    gone: 0,
    authErrors: 0,
    done: false,
  }
}

/**
 * One tick of news: promote due campaigns, take the oldest `sending` one, send to the next
 * `budget` subscriptions after its cursor, then one batch of writes. Delivery only happens
 * during the sending window (11:00–19:00 Toronto); a campaign that doesn't finish by 19:00
 * continues at 11:00 the next day.
 */
export async function runNewsStep(
  db: D1Database,
  now: number,
  budget: number,
  send: NewsSender,
): Promise<NewsStepSummary> {
  if (budget <= 0) return emptySummary('no_budget')
  if (!inNewsWindow(now)) return emptySummary('outside_window')

  const [, next] = await db.batch<CampaignRow>(
    prepareAll(db, [promoteDueStatement(now), nextSendingStatement()]),
  )
  const campaign = next?.results[0]
  if (!campaign) return emptySummary('idle')

  const summary: NewsStepSummary = { ...emptySummary(), campaignId: campaign.id }
  const audience = parseStoredAudience(campaign.audience)
  if (!audience) {
    console.error(`news: campaign ${campaign.id} has an unreadable audience; cancelled`)
    await prepare(db, cancelBrokenStatement(campaign.id, now)).run()
    return summary
  }

  const { results: rows } = await prepare(
    db,
    fanoutSelectStatement(campaign, audience, now, budget),
  ).all<FanoutRow>()
  summary.pushes = rows.length
  const results = await withConcurrency(
    rows.map((row) => () => send(row, newsPayload(campaign, row.locale), topicFor(campaign.id))),
    MAX_CONCURRENT_PUSHES,
  )
  const plan = fanoutPlan(
    campaign,
    rows,
    results.map((r) => r.outcome),
    budget,
    now,
  )
  if (plan.authErrors > 0) {
    const statuses = [
      ...new Set(results.filter((r) => r.outcome === 'auth_error').map((r) => r.status)),
    ]
    console.error(
      `news: ${plan.authErrors} push auth errors (${statuses.join(',')}) for campaign ${campaign.id}: check VAPID keys/subject`,
    )
  }
  if (plan.statements.length) await db.batch(prepareAll(db, plan.statements))
  Object.assign(summary, {
    sent: plan.sent,
    failed: plan.failed,
    gone: plan.gone,
    authErrors: plan.authErrors,
    done: plan.done,
  })
  return summary
}

export interface TestSendSummary {
  /** Distinct devices (users rows) reached or tried. */
  devices: number
  sent: number
  failed: number
}

/**
 * POST /api/admin/campaigns/:id/test: the campaign, now, to the admin's own linked devices in
 * each device's language. Ignores opt-in and the 24 h cap; counts nothing; 404/410 still delete
 * the subscription. null when the account has no device with a push subscription.
 */
export async function sendTestToOwnDevices(
  db: D1Database,
  campaign: CampaignRow,
  accountId: string,
  send: NewsSender,
): Promise<TestSendSummary | null> {
  const { results: rows } = await prepare(db, testDevicesStatement(accountId)).all<FanoutRow>()
  if (rows.length === 0) return null
  const results = await withConcurrency(
    rows.map((row) => () => send(row, newsPayload(campaign, row.locale), topicFor(campaign.id))),
    MAX_CONCURRENT_PUSHES,
  )
  const goneIds = rows.filter((_, i) => results[i]?.outcome === 'gone').map((row) => row.id)
  const deletes: Statement[] = chunk(goneIds, IDS_PER_STATEMENT).map((ids) => ({
    sql: `DELETE FROM push_subscriptions WHERE id IN (${inList(ids.length)})`,
    params: ids,
  }))
  if (deletes.length) await db.batch(prepareAll(db, deletes))
  const sent = results.filter((r) => r.outcome === 'sent').length
  return { devices: new Set(rows.map((r) => r.user_id)).size, sent, failed: rows.length - sent }
}
