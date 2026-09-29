/**
 * OAuth providers (§5.4): plain redirects, never a provider script. The provider layer is an
 * interface; Google is the only implementation (arctic 3, which runs on workerd's fetch and
 * WebCrypto, builds the PKCE URL and exchanges the code). Sign in with Apple plugs in here
 * later; until then `/api/auth/oauth/start` refuses it.
 *
 * The ID token comes straight from Google's token endpoint over TLS, so OIDC allows skipping
 * the signature check; iss, aud, exp and nonce are still checked and email_verified is read.
 */
import { decodeIdToken, Google } from 'arctic'
import { normalizeEmail, type Locale, type OAuthProviderId } from '@smartstack/shared'
import type { Env, OAuthAttemptRow } from '../env'
import { appleEnabled } from '../config'
import type { Statement } from '../logic'

export const OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000
export const GOOGLE_SCOPES = ['openid', 'email', 'profile']
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
const MAX_NAME_LENGTH = 60

export interface OAuthProfile {
  subject: string
  email: string
  emailVerified: boolean
  name: string | null
}

export interface AuthorizationRequest {
  state: string
  codeVerifier: string
  nonce: string
  locale: Locale
}

export interface CodeExchange {
  code: string
  codeVerifier: string
  nonce: string
  now: number
}

export interface OAuthProvider {
  readonly id: OAuthProviderId
  authorizationUrl(request: AuthorizationRequest): URL
  exchangeCode(exchange: CodeExchange): Promise<OAuthProfile>
  /** Apple requires revoking its tokens at account deletion (later). */
  revoke?(token: string): Promise<void>
}

export type OAuthFailure = 'exchange_failed' | 'invalid_id_token' | 'email_missing'

export class OAuthError extends Error {
  constructor(readonly code: OAuthFailure) {
    super(`oauth: ${code}`)
  }
}

/** The redirect URI registered with the provider for this origin. */
export function callbackUrl(appOrigin: string, provider: OAuthProviderId): string {
  return `${appOrigin.replace(/\/+$/, '')}/api/auth/oauth/${provider}/callback`
}

function audienceMatches(claims: Record<string, unknown>, clientId: string): boolean {
  const { aud, azp } = claims
  if (typeof aud === 'string') return aud === clientId
  if (Array.isArray(aud) && aud.includes(clientId)) return aud.length === 1 || azp === clientId
  return false
}

/** Checks a Google ID token's claims and maps them to a profile; throws OAuthError. */
export function checkGoogleIdTokenClaims(
  claims: unknown,
  expected: { clientId: string; nonce: string; now: number },
): OAuthProfile {
  if (typeof claims !== 'object' || claims === null) throw new OAuthError('invalid_id_token')
  const c = claims as Record<string, unknown>
  if (typeof c.iss !== 'string' || !GOOGLE_ISSUERS.includes(c.iss)) {
    throw new OAuthError('invalid_id_token')
  }
  if (!audienceMatches(c, expected.clientId)) throw new OAuthError('invalid_id_token')
  if (typeof c.exp !== 'number' || c.exp * 1000 <= expected.now) {
    throw new OAuthError('invalid_id_token')
  }
  if (typeof c.nonce !== 'string' || c.nonce !== expected.nonce) {
    throw new OAuthError('invalid_id_token')
  }
  if (typeof c.sub !== 'string' || c.sub.length === 0 || c.sub.length > 255) {
    throw new OAuthError('invalid_id_token')
  }
  if (typeof c.email !== 'string' || !c.email.includes('@')) throw new OAuthError('email_missing')
  const name = typeof c.name === 'string' ? c.name.trim().slice(0, MAX_NAME_LENGTH) : ''
  return {
    subject: c.sub,
    email: normalizeEmail(c.email),
    // Google sends a boolean; its tokeninfo endpoint uses the string "true".
    emailVerified: c.email_verified === true || c.email_verified === 'true',
    name: name || null,
  }
}

export interface GoogleConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function createGoogleProvider(config: GoogleConfig): OAuthProvider {
  const google = new Google(config.clientId, config.clientSecret, config.redirectUri)
  return {
    id: 'google',
    authorizationUrl({ state, codeVerifier, nonce }) {
      // response_type=code, client_id, redirect_uri, state, PKCE S256 and scope come from arctic.
      const url = google.createAuthorizationURL(state, codeVerifier, GOOGLE_SCOPES)
      url.searchParams.set('nonce', nonce)
      url.searchParams.set('prompt', 'select_account')
      return url
    },
    async exchangeCode({ code, codeVerifier, nonce, now }) {
      let idToken: string
      try {
        const tokens = await google.validateAuthorizationCode(code, codeVerifier)
        idToken = tokens.idToken()
      } catch {
        // OAuth2RequestError (bad code, secret or redirect URI), network error, no id_token.
        throw new OAuthError('exchange_failed')
      }
      let claims: object
      try {
        claims = decodeIdToken(idToken)
      } catch {
        throw new OAuthError('invalid_id_token')
      }
      return checkGoogleIdTokenClaims(claims, { clientId: config.clientId, nonce, now })
    },
  }
}

export interface NewAttempt {
  state: string
  provider: OAuthProviderId
  intent: 'login' | 'link'
  linkAccountId: string | null
  codeVerifier: string
  nonce: string
  claimHash: string
  locale: Locale
  now: number
}

export function insertAttemptStatement(a: NewAttempt): Statement {
  return {
    sql: `INSERT INTO oauth_attempts (state, provider, intent, link_account_id, code_verifier, nonce,
            claim_hash, locale, created_at, expires_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    params: [
      a.state,
      a.provider,
      a.intent,
      a.linkAccountId,
      a.codeVerifier,
      a.nonce,
      a.claimHash,
      a.locale,
      a.now,
      a.now + OAUTH_ATTEMPT_TTL_MS,
    ],
  }
}

export function attemptByStateStatement(state: string, provider: OAuthProviderId): Statement {
  return {
    sql: `SELECT * FROM oauth_attempts WHERE state = ?1 AND provider = ?2`,
    params: [state, provider],
  }
}

/**
 * Single use: only a ready, unexpired attempt whose claim hash matches moves to "claimed", and
 * the statement returns its account. No row → see claimFailure.
 */
export function claimAttemptStatement(state: string, claimHash: string, now: number): Statement {
  return {
    sql: `UPDATE oauth_attempts SET status = 'claimed'
          WHERE state = ?1 AND claim_hash = ?2 AND status = 'ready' AND expires_at > ?3
          RETURNING account_id, is_new_account`,
    params: [state, claimHash, now],
  }
}

export type ClaimFailure =
  | { status: 404; error: 'unknown_state' }
  | { status: 403; error: 'invalid_claim' }
  | { status: 409; error: 'already_claimed' | 'not_ready' }
  | { status: 410; error: 'expired' }
  | { status: 400; error: string }

/** Why a claim didn't go through, from the attempt row (read after the failed update). */
export function claimFailure(
  attempt: Pick<OAuthAttemptRow, 'status' | 'claim_hash' | 'error' | 'expires_at'> | null,
  claimHash: string,
  now: number,
): ClaimFailure {
  if (!attempt) return { status: 404, error: 'unknown_state' }
  if (attempt.claim_hash !== claimHash) return { status: 403, error: 'invalid_claim' }
  if (attempt.status === 'claimed') return { status: 409, error: 'already_claimed' }
  if (attempt.status === 'failed') return { status: 400, error: attempt.error ?? 'internal' }
  if (attempt.expires_at <= now) return { status: 410, error: 'expired' }
  return { status: 409, error: 'not_ready' }
}

/** `/auth/done?state=…` (relative: the browser stays on whichever origin served the callback). */
export function authDoneLocation(state: string | null, error: string | null): string {
  const params = new URLSearchParams()
  if (state) params.set('state', state)
  if (error) params.set('error', error)
  return `/auth/done?${params.toString()}`
}

/** Provider error on the callback (the person cancelled, or the provider refused). */
export function providerErrorCode(error: string): 'cancelled' | 'provider_error' {
  return error === 'access_denied' ? 'cancelled' : 'provider_error'
}

export type ProviderLookup =
  | { ok: true; provider: OAuthProvider }
  | {
      ok: false
      status: 404 | 501 | 503
      error: 'provider_disabled' | 'provider_not_implemented' | 'provider_not_configured'
    }

type ProviderEnv = Pick<
  Env,
  'APP_ORIGIN' | 'APPLE_ENABLED' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'
>

/** Which provider serves a request, or why none does. Logs configuration problems. */
export function oauthProviderFor(env: ProviderEnv, id: OAuthProviderId): ProviderLookup {
  if (id === 'apple') {
    if (!appleEnabled(env)) return { ok: false, status: 404, error: 'provider_disabled' }
    console.error('APPLE_ENABLED is "true" but Sign in with Apple is not implemented yet')
    return { ok: false, status: 501, error: 'provider_not_implemented' }
  }
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? ''
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? ''
  if (!clientId || !clientSecret) {
    console.error(
      `Google sign-in not configured: ${[!clientId && 'GOOGLE_CLIENT_ID', !clientSecret && 'GOOGLE_CLIENT_SECRET'].filter(Boolean).join(' and ')} missing`,
    )
    return { ok: false, status: 503, error: 'provider_not_configured' }
  }
  return {
    ok: true,
    provider: createGoogleProvider({
      clientId,
      clientSecret,
      redirectUri: callbackUrl(env.APP_ORIGIN, 'google'),
    }),
  }
}
