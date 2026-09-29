// Accounts (Phase 2, M3): request/response contracts for /api/auth/* and /api/account/*.
// Validated by the Worker, reused by the web client. Kept free of imports from './index'
// (index.ts re-exports this file, so importing back would create a cycle).
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Password stretching parameters (docs/smartstack-phase2-prompt.md §5.2)
// ---------------------------------------------------------------------------

/**
 * The browser derives `key = PBKDF2-HMAC-SHA256(password NFC, kdfSalt(email), 600 000, 32 bytes)`
 * and sends base64url(key); the password never leaves the device. `kdf_version` records these
 * parameters so they can be raised later (login then answers `rehash: true`).
 */
export const KDF_VERSION = 1
export const KDF_ITERATIONS = 600_000
export const KDF_KEY_BYTES = 32
export const KDF_SALT_PREFIX = 'smartstack/v1/'
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

/** Trimmed and lowercased: the form stored in `accounts.email` and used in the KDF salt. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/** The PBKDF2 salt string for an address (UTF-8 encode it before use). */
export function kdfSalt(email: string): string {
  return KDF_SALT_PREFIX + normalizeEmail(email)
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const LOCALES = ['en', 'fr'] as const
export const Locale = z.enum(LOCALES)
export type Locale = z.infer<typeof Locale>

/** Trimmed + lowercased before the format check. */
export const Email = z.string().trim().toLowerCase().max(254).pipe(z.email())

/**
 * Exactly 32 bytes as unpadded base64url (43 characters; the last one carries 4 bits, so only
 * canonical encodings pass). Used for password keys, emailed tokens, session tokens, OAuth
 * state and claim secrets.
 */
export const BASE64URL_32_RE = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
export const Base64Url32 = z.string().regex(BASE64URL_32_RE, 'expected 32 bytes, base64url')

/** base64url(PBKDF2 output), see KDF_* above. */
export const PasswordKey = Base64Url32

/** Lowercase hex SHA-256 of the 32 raw bytes of the claim secret (not of its base64url text). */
export const ClaimHash = z.string().regex(/^[0-9a-f]{64}$/, 'expected hex SHA-256')

export const DisplayName = z.string().trim().max(60)

/** Session platform (same values as the device `Platform`). */
export const SessionPlatform = z.enum(['ios', 'android', 'desktop'])

export const OAUTH_PROVIDERS = ['google', 'apple'] as const
export const OAuthProviderId = z.enum(OAUTH_PROVIDERS)
export type OAuthProviderId = z.infer<typeof OAuthProviderId>

export const OAuthIntent = z.enum(['login', 'link'])
export type OAuthIntent = z.infer<typeof OAuthIntent>

export const AccountRole = z.enum(['user', 'admin'])
export type AccountRole = z.infer<typeof AccountRole>

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** POST /api/auth/signup (X-Beta-Key). Both consents are required checkboxes (C1, C2). */
export const SignupBody = z.object({
  email: Email,
  key: PasswordKey,
  name: DisplayName.optional(),
  locale: Locale,
  consent: z.literal(true),
  age14: z.literal(true),
  platform: SessionPlatform.optional(),
})
export type SignupBody = z.infer<typeof SignupBody>

/** POST /api/auth/login */
export const LoginBody = z.object({
  email: Email,
  key: PasswordKey,
  platform: SessionPlatform.optional(),
})
export type LoginBody = z.infer<typeof LoginBody>

/** POST /api/auth/verify-email: the token from the link's fragment. */
export const VerifyEmailBody = z.object({ token: Base64Url32 })
export type VerifyEmailBody = z.infer<typeof VerifyEmailBody>

/** POST /api/auth/password/forgot: always answers 200. */
export const ForgotPasswordBody = z.object({ email: Email })
export type ForgotPasswordBody = z.infer<typeof ForgotPasswordBody>

/**
 * POST /api/auth/password/reset: the key is derived from the new password with the email as
 * salt, so the client needs the address (the reset link carries it in its fragment) and the
 * Worker checks it is the one the link was sent to.
 */
export const ResetPasswordBody = z.object({ token: Base64Url32, key: PasswordKey, email: Email })
export type ResetPasswordBody = z.infer<typeof ResetPasswordBody>

/** POST /api/auth/password/change (session). */
export const ChangePasswordBody = z.object({ currentKey: PasswordKey, newKey: PasswordKey })
export type ChangePasswordBody = z.infer<typeof ChangePasswordBody>

/** POST /api/auth/oauth/start (X-Beta-Key; plus the session bearer when intent is "link"). */
export const OAuthStartBody = z.object({
  provider: OAuthProviderId,
  intent: OAuthIntent,
  claimHash: ClaimHash,
  locale: Locale,
})
export type OAuthStartBody = z.infer<typeof OAuthStartBody>

/** POST /api/auth/oauth/claim: single use. */
export const OAuthClaimBody = z.object({
  state: Base64Url32,
  claimSecret: Base64Url32,
  platform: SessionPlatform.optional(),
})
export type OAuthClaimBody = z.infer<typeof OAuthClaimBody>

/** POST /api/account/consent: records the current CONSENT_VERSION (C1 + C2). */
export const ConsentBody = z.object({ age14: z.literal(true) })
export type ConsentBody = z.infer<typeof ConsentBody>

/** POST and DELETE /api/account/device: the Phase 1 device UUID. */
export const DeviceLinkBody = z.object({ deviceId: z.uuid() })
export type DeviceLinkBody = z.infer<typeof DeviceLinkBody>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** GET /api/account, and the `account` of every sign-in response. */
export const AccountView = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  name: z.string().nullable(),
  locale: Locale,
  role: AccountRole,
  providers: z.array(OAuthProviderId),
  hasPassword: z.boolean(),
  /** True until POST /api/account/consent records the current CONSENT_VERSION. */
  consentNeeded: z.boolean(),
})
export type AccountView = z.infer<typeof AccountView>

/** Signup and login. `rehash`: derive a new key with the current KDF and change the password. */
export const AuthResponse = z.object({
  token: Base64Url32,
  account: AccountView,
  rehash: z.boolean().optional(),
})
export type AuthResponse = z.infer<typeof AuthResponse>

export const OAuthStartResponse = z.object({ url: z.url(), state: Base64Url32 })
export type OAuthStartResponse = z.infer<typeof OAuthStartResponse>

export const OAuthClaimResponse = z.object({
  token: Base64Url32,
  account: AccountView,
  isNew: z.boolean(),
})
export type OAuthClaimResponse = z.infer<typeof OAuthClaimResponse>

/**
 * Codes the OAuth callback puts in `/auth/done?state=…&error=<code>` (and a claim of a failed
 * attempt answers as `{ error: <code> }`).
 */
export const OAUTH_ERROR_CODES = [
  'cancelled',
  'provider_error',
  'invalid_state',
  'exchange_failed',
  'invalid_id_token',
  'email_missing',
  'identity_in_use',
  'email_in_use_unverified',
  'accounts_not_open',
  'link_session_missing',
  'provider_unavailable',
  'internal',
] as const
export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number]
