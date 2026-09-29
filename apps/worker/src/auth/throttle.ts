/**
 * Throttling (§5.7): fixed windows in the D1 table `auth_throttle`, keyed by
 * `<scope>:<sha256(value)>` so no email or IP is stored in clear. A window starts at the first
 * hit and lasts `windowMs`; the next hit after that starts a new one.
 */
import type { ThrottleRow } from '../env'
import type { Statement } from '../logic'
import { inList } from '../logic'
import { sha256Hex } from './crypto'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

export interface ThrottleRule {
  scope: string
  limit: number
  windowMs: number
}

export const THROTTLE = {
  /** Failed logins (and failed current-password checks) per email. */
  loginEmail: { scope: 'login:email', limit: 5, windowMs: 15 * MINUTE_MS },
  /** Failed logins per IP. */
  loginIp: { scope: 'login:ip', limit: 30, windowMs: 15 * MINUTE_MS },
  signupIp: { scope: 'signup:ip', limit: 5, windowMs: HOUR_MS },
  forgotEmail: { scope: 'forgot:email', limit: 3, windowMs: HOUR_MS },
  resendEmail: { scope: 'resend:email', limit: 3, windowMs: HOUR_MS },
  oauthStartIp: { scope: 'oauth:ip', limit: 20, windowMs: 15 * MINUTE_MS },
  claimIp: { scope: 'claim:ip', limit: 10, windowMs: 15 * MINUTE_MS },
  /** Health Canada lookups (M6). */
  lookupAccount: { scope: 'lookup:account', limit: 30, windowMs: HOUR_MS },
} as const satisfies Record<string, ThrottleRule>

export async function throttleKey(rule: ThrottleRule, value: string): Promise<string> {
  return `${rule.scope}:${await sha256Hex(value.trim().toLowerCase())}`
}

/**
 * Counts one hit and returns the row: a new window when there is none or the current one is
 * over, otherwise count + 1 (SQLite evaluates both CASEs against the old row).
 */
export function throttleHitStatement(key: string, rule: ThrottleRule, now: number): Statement {
  return {
    sql: `INSERT INTO auth_throttle (key, count, window_start) VALUES (?1, 1, ?2)
          ON CONFLICT (key) DO UPDATE SET
            count = CASE WHEN auth_throttle.window_start <= ?3 THEN 1 ELSE auth_throttle.count + 1 END,
            window_start = CASE WHEN auth_throttle.window_start <= ?3 THEN ?2 ELSE auth_throttle.window_start END
          RETURNING key, count, window_start`,
    params: [key, now, now - rule.windowMs],
  }
}

/** Read without counting (failed logins are only counted when they fail). */
export function throttleReadStatement(keys: readonly string[]): Statement {
  return {
    sql: `SELECT key, count, window_start FROM auth_throttle WHERE key IN (${inList(keys.length)})`,
    params: [...keys],
  }
}

export type ThrottleVerdict = { allowed: true } | { allowed: false; retryAfter: number }

function windowActive(row: ThrottleRow, rule: ThrottleRule, now: number): boolean {
  return row.window_start > now - rule.windowMs
}

function retryAfterSeconds(row: ThrottleRow, rule: ThrottleRule, now: number): number {
  return Math.max(1, Math.ceil((row.window_start + rule.windowMs - now) / 1000))
}

/** After throttleHitStatement: the hit that made the count exceed the limit is refused. */
export function verdictAfterHit(
  row: ThrottleRow | null,
  rule: ThrottleRule,
  now: number,
): ThrottleVerdict {
  if (!row || !windowActive(row, rule, now) || row.count <= rule.limit) return { allowed: true }
  return { allowed: false, retryAfter: retryAfterSeconds(row, rule, now) }
}

/** Before an attempt that only counts on failure: refused once `limit` failures are recorded. */
export function verdictBeforeAttempt(
  row: ThrottleRow | null,
  rule: ThrottleRule,
  now: number,
): ThrottleVerdict {
  if (!row || !windowActive(row, rule, now) || row.count < rule.limit) return { allowed: true }
  return { allowed: false, retryAfter: retryAfterSeconds(row, rule, now) }
}

/** The strictest of several verdicts (the longest wait wins). */
export function combineVerdicts(verdicts: readonly ThrottleVerdict[]): ThrottleVerdict {
  let worst: ThrottleVerdict = { allowed: true }
  for (const v of verdicts) {
    if (!v.allowed && (worst.allowed || v.retryAfter > worst.retryAfter)) worst = v
  }
  return worst
}

/** "Too many attempts. Try again in 12 minutes." (the app shows its own translated text). */
export function throttleMessage(retryAfter: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60))
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
}
