/**
 * Emailed tokens (§5.6): 32 random bytes, stored as the hex SHA-256, single use. Verify-email
 * links live 48 hours, reset links 1 hour. The token travels in the URL fragment so it never
 * reaches a server log: `${APP_ORIGIN}/verify-email#token=…`.
 */
import type { Statement } from '../logic'
import { randomToken, tokenHash } from './crypto'

export type EmailTokenPurpose = 'verify_email' | 'reset_password'

const HOUR_MS = 60 * 60 * 1000

export const EMAIL_TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
  verify_email: 48 * HOUR_MS,
  reset_password: 1 * HOUR_MS,
}

const LINK_PATHS: Record<EmailTokenPurpose, string> = {
  verify_email: '/verify-email',
  reset_password: '/reset-password',
}

export interface NewEmailToken {
  token: string
  id: string
}

export async function newEmailToken(): Promise<NewEmailToken> {
  const token = randomToken()
  const id = await tokenHash(token)
  if (!id) throw new Error('email token generation failed')
  return { token, id }
}

/**
 * The emailed link. A reset link also carries the address: the browser needs it to derive the
 * new password key (the email is the PBKDF2 salt). Both stay in the fragment, never sent to a
 * server.
 */
export function emailTokenLink(
  appOrigin: string,
  purpose: EmailTokenPurpose,
  token: string,
  email?: string,
): string {
  const base = `${appOrigin.replace(/\/+$/, '')}${LINK_PATHS[purpose]}#token=${token}`
  return email && purpose === 'reset_password' ? `${base}&email=${encodeURIComponent(email)}` : base
}

export function insertEmailTokenStatement(
  id: string,
  accountId: string,
  purpose: EmailTokenPurpose,
  email: string,
  now: number,
): Statement {
  return {
    sql: `INSERT INTO email_tokens (id, account_id, purpose, email, created_at, expires_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    params: [id, accountId, purpose, email, now, now + EMAIL_TOKEN_TTL_MS[purpose]],
  }
}

/**
 * Marks the token used and returns its account in one statement, so two concurrent uses can't
 * both succeed. No row back = unknown, expired, already used or the wrong purpose.
 */
export function consumeEmailTokenStatement(
  id: string,
  purpose: EmailTokenPurpose,
  now: number,
  /** When given, only a token sent to this address is consumed (password reset). */
  email?: string,
): Statement {
  return email === undefined
    ? {
        sql: `UPDATE email_tokens SET used_at = ?3
              WHERE id = ?1 AND purpose = ?2 AND used_at IS NULL AND expires_at > ?3
              RETURNING account_id, email`,
        params: [id, purpose, now],
      }
    : {
        sql: `UPDATE email_tokens SET used_at = ?3
              WHERE id = ?1 AND purpose = ?2 AND used_at IS NULL AND expires_at > ?3
                AND email = ?4
              RETURNING account_id, email`,
        params: [id, purpose, now, email],
      }
}

/** Why a reset didn't consume its token: a live token sent to another address → email_mismatch. */
export function liveEmailTokenStatement(
  id: string,
  purpose: EmailTokenPurpose,
  now: number,
): Statement {
  return {
    sql: `SELECT email FROM email_tokens
          WHERE id = ?1 AND purpose = ?2 AND used_at IS NULL AND expires_at > ?3`,
    params: [id, purpose, now],
  }
}

/** Sets email_verified_at once, only if the token was sent to the account's current address. */
export function markEmailVerifiedStatement(
  accountId: string,
  email: string,
  now: number,
): Statement {
  return {
    sql: `UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, ?3), updated_at = ?3
          WHERE id = ?1 AND email = ?2`,
    params: [accountId, email, now],
  }
}

/** Retires the account's other outstanding tokens (all purposes, or just one). */
export function retireEmailTokensStatement(
  accountId: string,
  now: number,
  purpose: EmailTokenPurpose | null = null,
): Statement {
  return purpose
    ? {
        sql: `UPDATE email_tokens SET used_at = ?2
              WHERE account_id = ?1 AND purpose = ?3 AND used_at IS NULL`,
        params: [accountId, now, purpose],
      }
    : {
        sql: `UPDATE email_tokens SET used_at = ?2 WHERE account_id = ?1 AND used_at IS NULL`,
        params: [accountId, now],
      }
}
