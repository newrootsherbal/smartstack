/**
 * Daily cleanup (§8.6), run by the 03:00 UTC cron tick: expired sessions, used or expired
 * email tokens, OAuth attempts older than a day, throttle rows older than a day.
 * (Inactive accounts and devices come with M10.)
 */
import type { Statement } from '../logic'

export const AUTH_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000

export function authCleanupStatements(now: number): Statement[] {
  const dayAgo = now - AUTH_CLEANUP_AGE_MS
  return [
    { sql: `DELETE FROM sessions WHERE expires_at <= ?1`, params: [now] },
    {
      sql: `DELETE FROM email_tokens WHERE used_at IS NOT NULL OR expires_at <= ?1`,
      params: [now],
    },
    { sql: `DELETE FROM oauth_attempts WHERE created_at < ?1`, params: [dayAgo] },
    { sql: `DELETE FROM auth_throttle WHERE window_start < ?1`, params: [dayAgo] },
  ]
}
