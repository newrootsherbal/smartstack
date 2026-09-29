/**
 * Sessions (§5.3): 32 random bytes as base64url, sent as `Authorization: Bearer`. D1 keeps only
 * the hex SHA-256. 90 days of inactivity end a session; `expires_at`, `last_used_at` and the
 * account's `last_active_at` slide at most once a day to save row writes.
 */
import type { Statement } from '../logic'
import { randomToken, tokenHash } from './crypto'
import { PROVIDERS_SQL } from './account'

export const DAY_MS = 24 * 60 * 60 * 1000
export const SESSION_IDLE_MS = 90 * DAY_MS
export const SESSION_SLIDE_MS = DAY_MS

const BEARER = /^Bearer\s+(\S+)\s*$/i

export function bearerToken(header: string | undefined | null): string | null {
  const match = BEARER.exec(header ?? '')
  return match?.[1] ?? null
}

export interface NewSession {
  /** Sent to the client once, never stored. */
  token: string
  /** sessions.id */
  id: string
}

export async function newSession(): Promise<NewSession> {
  const token = randomToken()
  const id = await tokenHash(token)
  if (!id) throw new Error('session token generation failed')
  return { token, id }
}

/** The session id for a bearer token, or null when the header holds no well-formed token. */
export async function sessionIdFromHeader(
  header: string | undefined | null,
): Promise<string | null> {
  const token = bearerToken(header)
  return token ? tokenHash(token) : null
}

export type SessionPlatform = 'ios' | 'android' | 'desktop'

/** Insert the session and stamp the account as logged in (clears the inactivity warning). */
export function createSessionStatements(
  sessionId: string,
  accountId: string,
  platform: SessionPlatform | null,
  now: number,
): Statement[] {
  return [
    {
      sql: `INSERT INTO sessions (id, account_id, platform, created_at, last_used_at, expires_at)
            VALUES (?1, ?2, ?3, ?4, ?4, ?5)`,
      params: [sessionId, accountId, platform, now, now + SESSION_IDLE_MS],
    },
    {
      sql: `UPDATE accounts SET last_login_at = ?2, last_active_at = ?2, inactivity_warned_at = NULL
            WHERE id = ?1`,
      params: [accountId, now],
    },
  ]
}

/** The session's account, with its providers, if the session exists and hasn't expired. */
export function sessionLookupStatement(sessionId: string, now: number): Statement {
  return {
    sql: `SELECT s.id AS session_id, s.last_used_at AS session_last_used_at, a.*, ${PROVIDERS_SQL}
          FROM sessions s JOIN accounts a ON a.id = s.account_id
          WHERE s.id = ?1 AND s.expires_at > ?2`,
    params: [sessionId, now],
  }
}

/** Slide at most once a day: a read never costs more than one write pair per day. */
export function sessionNeedsSlide(lastUsedAt: number, now: number): boolean {
  return now - lastUsedAt >= SESSION_SLIDE_MS
}

export function slideStatements(sessionId: string, accountId: string, now: number): Statement[] {
  return [
    {
      sql: `UPDATE sessions SET last_used_at = ?2, expires_at = ?3 WHERE id = ?1`,
      params: [sessionId, now, now + SESSION_IDLE_MS],
    },
    {
      sql: `UPDATE accounts SET last_active_at = ?2, inactivity_warned_at = NULL
            WHERE id = ?1 AND last_active_at < ?3`,
      params: [accountId, now, now - SESSION_SLIDE_MS],
    },
  ]
}

/** Password reset or change: every session of the account except `keepSessionId` ends. */
export function endOtherSessionsStatement(
  accountId: string,
  keepSessionId: string | null,
): Statement {
  return {
    sql: `DELETE FROM sessions WHERE account_id = ?1 AND id <> ?2`,
    params: [accountId, keepSessionId ?? ''],
  }
}

export function deleteSessionStatement(sessionId: string): Statement {
  return { sql: `DELETE FROM sessions WHERE id = ?1`, params: [sessionId] }
}
