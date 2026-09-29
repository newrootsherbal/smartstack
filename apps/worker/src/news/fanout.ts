/**
 * News delivery, the pure parts (§4.12). Reminders keep priority: news gets whatever is left of
 * MAX_PUSHES_PER_TICK after the reminders' pushes. The fan-out walks push_subscriptions by id
 * with a cursor on the campaign (no per-delivery rows: D1 writes are the scarce resource), skips
 * devices that got news in the last 24 h, and sends each device the text in its language. One
 * batch then moves the cursor, adds to the counts and stamps users.last_news_at.
 */
import { NEWS_CAP_MS, NewsAudience, torontoYear, type NewsPushPayload } from '@smartstack/shared'
import type { CampaignRow, PushSubscriptionRow } from '../env'
import { chunk, inList, type PushOutcome, type Statement } from '../logic'
import type { PushOptions } from '../push'
import { audienceFilter } from './segment'

/** Two hours: a push accepted at 19:00 Toronto is shown by 21:00 at the latest, or never. */
export const NEWS_PUSH_OPTIONS: PushOptions = { ttlSeconds: 2 * 60 * 60, urgency: 'normal' }

/** Ids per `IN (…)` list: under D1's 100 bound parameters with room for the others. */
export const IDS_PER_STATEMENT = 90

export type FanoutRow = Pick<
  PushSubscriptionRow,
  'id' | 'user_id' | 'endpoint' | 'p256dh' | 'auth'
> & {
  /** users.locale of the device. */
  locale: string
}

/** Pushes news may use this tick: the budget left after the reminders' pushes. */
export function newsBudget(maxPushesPerTick: number, reminderPushes: number): number {
  return Math.max(0, maxPushesPerTick - reminderPushes)
}

/** The stored audience JSON, or null when it doesn't parse (never written by the API). */
export function parseStoredAudience(raw: string): NewsAudience | null {
  try {
    const parsed = NewsAudience.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** A scheduled campaign whose time has come starts sending. */
export function promoteDueStatement(now: number): Statement {
  return {
    sql: `UPDATE campaigns SET status = 'sending' WHERE status = 'scheduled' AND send_at <= ?1`,
    params: [now],
  }
}

/** The oldest campaign in `sending` gets this tick's news budget. */
export function nextSendingStatement(): Statement {
  return {
    sql: `SELECT * FROM campaigns WHERE status = 'sending' ORDER BY send_at, created_at LIMIT 1`,
    params: [],
  }
}

/**
 * The next subscriptions after the cursor whose device opted in (and matches the segment) and
 * got no news in the last 24 h, in id order.
 */
export function fanoutSelectStatement(
  campaign: Pick<CampaignRow, 'cursor'>,
  audience: NewsAudience,
  now: number,
  limit: number,
): Statement {
  const filter = audienceFilter(audience, torontoYear(now))
  return {
    sql: `SELECT ps.id, ps.user_id, ps.endpoint, ps.p256dh, ps.auth, u.locale
          FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id
          WHERE ps.id > ? AND (u.last_news_at IS NULL OR u.last_news_at <= ?) AND ${filter.sql}
          ORDER BY ps.id
          LIMIT ?`,
    params: [campaign.cursor, now - NEWS_CAP_MS, ...filter.params, limit],
  }
}

/** Devices (with at least one subscription) in the audience: the admin's estimate. */
export function audienceCountStatement(audience: NewsAudience, now: number): Statement {
  const filter = audienceFilter(audience, torontoYear(now))
  return {
    sql: `SELECT COUNT(*) AS devices FROM users u
          WHERE ${filter.sql}
            AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = u.id)`,
    params: filter.params,
  }
}

/** A test send reaches at most this many subscriptions (subrequests are limited). */
export const MAX_TEST_PUSHES = 10

/** The admin's own linked devices, whatever their opt-in or cap. */
export function testDevicesStatement(accountId: string): Statement {
  return {
    sql: `SELECT ps.id, ps.user_id, ps.endpoint, ps.p256dh, ps.auth, u.locale
          FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id
          WHERE u.account_id = ?1
          ORDER BY ps.id
          LIMIT ?2`,
    params: [accountId, MAX_TEST_PUSHES],
  }
}

export function deviceLocale(raw: string | null | undefined): 'en' | 'fr' {
  return raw === 'fr' ? 'fr' : 'en'
}

/** What the service worker receives: the text in the device's language. */
export function newsPayload(
  campaign: Pick<CampaignRow, 'id' | 'title_en' | 'title_fr' | 'body_en' | 'body_fr' | 'url'>,
  locale: string | null | undefined,
): NewsPushPayload {
  const lang = deviceLocale(locale)
  return {
    title: lang === 'fr' ? campaign.title_fr : campaign.title_en,
    body: lang === 'fr' ? campaign.body_fr : campaign.body_en,
    tag: `news:${campaign.id}`,
    url: campaign.url,
    kind: 'news',
    campaignId: campaign.id,
    lang,
  }
}

export interface FanoutPlan {
  statements: Statement[]
  /** Subscriptions that accepted the push. */
  sent: number
  /** Everything else, gone subscriptions included; never retried. */
  failed: number
  gone: number
  authErrors: number
  /** The new cursor (unchanged when nothing was selected). */
  cursor: number
  /** Fewer rows than the budget: nothing left to send, the campaign is `sent`. */
  done: boolean
}

/**
 * The writes after a fan-out step. `results[i]` is the outcome for `rows[i]`. 404/410 delete the
 * subscription (as for reminders); every other failure (401/403, 429, 5xx, network) counts as
 * failed and the cursor moves on. Devices with at least one accepted push get last_news_at.
 */
export function fanoutPlan(
  campaign: Pick<CampaignRow, 'id' | 'cursor'>,
  rows: readonly FanoutRow[],
  results: readonly PushOutcome[],
  budget: number,
  now: number,
): FanoutPlan {
  let sent = 0
  let gone = 0
  let authErrors = 0
  const reached = new Set<string>()
  const goneIds: number[] = []
  rows.forEach((row, i) => {
    const outcome = results[i] ?? 'failed'
    if (outcome === 'sent') {
      sent++
      reached.add(row.user_id)
    } else if (outcome === 'gone') {
      gone++
      goneIds.push(row.id)
    } else if (outcome === 'auth_error') {
      authErrors++
    }
  })
  const failed = rows.length - sent
  const cursor = rows.reduce((max, row) => Math.max(max, row.id), campaign.cursor)
  const done = rows.length < budget

  const statements: Statement[] = []
  if (rows.length > 0) {
    statements.push({
      sql: `UPDATE campaigns SET cursor = MAX(cursor, ?1), sent_count = sent_count + ?2,
              failed_count = failed_count + ?3
            WHERE id = ?4`,
      params: [cursor, sent, failed, campaign.id],
    })
  }
  for (const ids of chunk([...reached], IDS_PER_STATEMENT)) {
    statements.push({
      sql: `UPDATE users SET last_news_at = ?1 WHERE id IN (${inList(ids.length, 2)})`,
      params: [now, ...ids],
    })
  }
  for (const ids of chunk(goneIds, IDS_PER_STATEMENT)) {
    statements.push({
      sql: `DELETE FROM push_subscriptions WHERE id IN (${inList(ids.length)})`,
      params: ids,
    })
  }
  if (done) statements.push(finishStatement(campaign.id, now))
  return { statements, sent, failed, gone, authErrors, cursor, done }
}

/** `sending` → `sent` (a campaign cancelled meanwhile stays cancelled). */
export function finishStatement(campaignId: string, now: number): Statement {
  return {
    sql: `UPDATE campaigns SET status = 'sent', finished_at = ?1
          WHERE id = ?2 AND status = 'sending'`,
    params: [now, campaignId],
  }
}

/** A campaign whose stored audience can't be read is cancelled rather than blocking the queue. */
export function cancelBrokenStatement(campaignId: string, now: number): Statement {
  return {
    sql: `UPDATE campaigns SET status = 'cancelled', finished_at = ?1
          WHERE id = ?2 AND status = 'sending'`,
    params: [now, campaignId],
  }
}
