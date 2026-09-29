/**
 * Retention promised in the privacy policy (§8.6; §10 of docs/privacy/privacy-policy.en.md):
 * - an account unused for 3 years is deleted, after a warning email (N8/N9) 30 days before;
 *   any login or sync clears the warning (auth/session.ts);
 * - a device without an account (a guest's reminders or news) is deleted after 12 months unused
 *   (its subscriptions and reminders cascade).
 * Deletions run at the 03:00 UTC tick; warnings on every tick from 03:00 to 03:09 UTC, a few at
 * a time (the email and subrequest budget). Statement builders are pure and tested; logs are
 * counts only, never an address.
 */
import { inactiveWarningMessage, type EmailMessage, type EmailResult } from './email'
import type { AccountRow } from './env'
import { prepare, prepareAll } from './http'
import type { Statement } from './logic'

const DAY_MS = 24 * 60 * 60 * 1000
/** Unused this long, an account is deleted. */
export const ACCOUNT_INACTIVE_MS = 3 * 365 * DAY_MS
/** The warning comes this long before the deletion. */
export const INACTIVITY_WARNING_LEAD_MS = 30 * DAY_MS
/** Unused this long, a device without an account is deleted. */
export const DEVICE_INACTIVE_MS = 365 * DAY_MS
/** Warning emails per tick, over 10 ticks: at most 30 a day. */
export const INACTIVITY_WARNINGS_PER_TICK = 3
export const INACTIVITY_WARNING_MINUTES = 10
/** Rows deleted per table and per day (the rest waits for the next day). */
export const INACTIVE_DELETES_PER_TICK = 100

/** 03:00–03:09 UTC: warnings. */
export function isInactivityTick(now: number): boolean {
  const d = new Date(now)
  return d.getUTCHours() === 3 && d.getUTCMinutes() < INACTIVITY_WARNING_MINUTES
}

/** Accounts unused for 3 years minus 30 days that haven't been warned, oldest first. */
export function warningCandidatesStatement(now: number, limit: number): Statement {
  return {
    sql: `SELECT id, email, locale FROM accounts
WHERE inactivity_warned_at IS NULL AND last_active_at < ?1
ORDER BY last_active_at, id LIMIT ?2`,
    params: [now - (ACCOUNT_INACTIVE_MS - INACTIVITY_WARNING_LEAD_MS), limit],
  }
}

/** After the email went out; still unused (a login in between clears nothing to mark). */
export function markWarnedStatement(accountId: string, now: number): Statement {
  return {
    sql: `UPDATE accounts SET inactivity_warned_at = ?2
WHERE id = ?1 AND inactivity_warned_at IS NULL AND last_active_at < ?3`,
    params: [accountId, now, now - (ACCOUNT_INACTIVE_MS - INACTIVITY_WARNING_LEAD_MS)],
  }
}

/**
 * Warned at least 30 days ago and still unused for 3 years: deleted as DELETE /api/account does
 * (ON DELETE CASCADE removes sign-in methods, sessions, linked devices with their subscriptions
 * and reminders, synced data and the health profile).
 */
export function deleteInactiveAccountsStatement(now: number, limit: number): Statement {
  return {
    sql: `DELETE FROM accounts WHERE id IN (
  SELECT id FROM accounts
  WHERE inactivity_warned_at IS NOT NULL AND inactivity_warned_at <= ?1 AND last_active_at < ?2
  LIMIT ?3
)`,
    params: [now - INACTIVITY_WARNING_LEAD_MS, now - ACCOUNT_INACTIVE_MS, limit],
  }
}

/** Devices without an account, unused for 12 months (subscriptions and reminders cascade). */
export function deleteInactiveDevicesStatement(now: number, limit: number): Statement {
  return {
    sql: `DELETE FROM users WHERE id IN (
  SELECT id FROM users WHERE account_id IS NULL AND last_seen_at < ?1 LIMIT ?2
)`,
    params: [now - DEVICE_INACTIVE_MS, limit],
  }
}

export interface InactivitySummary {
  deletedAccounts: number
  deletedDevices: number
  warned: number
  /** Warnings not sent this tick (email not configured or failed): tried again later. */
  unsent: number
}

type Candidate = Pick<AccountRow, 'id' | 'email' | 'locale'>

/**
 * One tick of the inactivity cleanup: deletions first (at 03:00 only), then up to
 * INACTIVITY_WARNINGS_PER_TICK warnings. An account is marked warned only once its email was
 * sent (or logged locally), so a missing email setup never leads to a deletion without notice.
 */
export async function runInactivityStep(
  db: D1Database,
  now: number,
  options: {
    deletions: boolean
    appOrigin: string
    send: (message: EmailMessage) => Promise<EmailResult>
  },
): Promise<InactivitySummary> {
  const summary: InactivitySummary = { deletedAccounts: 0, deletedDevices: 0, warned: 0, unsent: 0 }
  if (options.deletions) {
    const [accounts, devices] = await db.batch(
      prepareAll(db, [
        deleteInactiveAccountsStatement(now, INACTIVE_DELETES_PER_TICK),
        deleteInactiveDevicesStatement(now, INACTIVE_DELETES_PER_TICK),
      ]),
    )
    summary.deletedAccounts = accounts?.meta.changes ?? 0
    summary.deletedDevices = devices?.meta.changes ?? 0
  }

  const { results: candidates } = await prepare(
    db,
    warningCandidatesStatement(now, INACTIVITY_WARNINGS_PER_TICK),
  ).all<Candidate>()
  const marks: Statement[] = []
  for (const account of candidates) {
    const locale = account.locale === 'fr' ? 'fr' : 'en'
    const message = inactiveWarningMessage(
      locale,
      account.email,
      now + INACTIVITY_WARNING_LEAD_MS,
      options.appOrigin,
    )
    const result = await options.send(message)
    if (result === 'sent' || result === 'logged') {
      marks.push(markWarnedStatement(account.id, now))
    } else {
      summary.unsent++
      // Not configured: the next ones would fail the same way.
      if (result === 'not_configured') break
    }
  }
  if (marks.length) await db.batch(prepareAll(db, marks))
  summary.warned = marks.length
  return summary
}
