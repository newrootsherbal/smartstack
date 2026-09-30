export interface Env {
  ASSETS: Fetcher
  DB: D1Database
  VAPID_PUBLIC_KEY: string
  /** Secret (wrangler secret / .dev.vars). Undefined until configured. */
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT: string
  MAX_PUSHES_PER_TICK: string
  BETA_KEY: string
  /** https origin the app is served from (OAuth redirects, email links). */
  APP_ORIGIN: string
  /** Accounts launch gate: off | staff | public (config.ts). */
  ACCOUNTS_MODE: string
  /** Comma-separated domains allowed to sign up or log in while ACCOUNTS_MODE is "staff". */
  STAFF_EMAIL_DOMAINS: string
  /** "true" once Sign in with Apple is set up. */
  APPLE_ENABLED: string
  /** Google OAuth web client id (public); empty until configured. */
  GOOGLE_CLIENT_ID: string
  /** "smtp2go" (staging, production) or "log" (local only: prints links to the console). */
  EMAIL_MODE: string
  /** Verified SMTP2GO sender, e.g. "New Roots SmartStack <no-reply@…>"; empty until configured. */
  EMAIL_FROM: string
  /** Reply-To for account emails; optional. */
  EMAIL_REPLY_TO: string
  /** Current consent texts version (§5.8); a change asks everyone again. */
  CONSENT_VERSION: string
  /** Secret: HMAC key for stored password hashes. Password routes answer 500 without it. */
  AUTH_PEPPER?: string
  /** Secret: Google OAuth client secret. */
  GOOGLE_CLIENT_SECRET?: string
  /** Secret: SMTP2GO API key (sending only). */
  SMTP2GO_API_KEY?: string
}

export interface UserRow {
  id: string
  tz: string
  platform: 'ios' | 'android' | 'desktop'
  created_at: number
  last_seen_at: number
  /** Migration 0002: the account this device is linked to (POST /api/account/device). */
  account_id: string | null
}

export interface PushSubscriptionRow {
  id: number
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: number
  last_success_at: number | null
  failures: number
}

export type ReminderStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'expired'

export interface ReminderRow {
  id: string
  user_id: string
  kind: 'schedule' | 'test'
  scheduled_at: number
  slot_key: string
  product_ids: string
  title: string
  body: string
  status: ReminderStatus
  attempts: number
  claimed_at: number | null
  sent_at: number | null
}

export type Locale = 'en' | 'fr'

export interface AccountRow {
  id: string
  email: string
  email_verified_at: number | null
  password_hash: string | null
  password_salt: string | null
  kdf_version: number | null
  display_name: string | null
  locale: Locale
  role: 'user' | 'admin'
  consent_version: string | null
  consent_at: number | null
  age_confirmed_at: number | null
  rev: number
  created_at: number
  updated_at: number
  last_login_at: number | null
  last_active_at: number
  inactivity_warned_at: number | null
}

/** An account plus its sign-in providers (group_concat, e.g. "google" or null). */
export interface AccountWithProviders extends AccountRow {
  providers: string | null
}

export interface AuthIdentityRow {
  provider: 'google' | 'apple'
  subject: string
  account_id: string
  email: string | null
  apple_refresh_token: string | null
  created_at: number
  last_used_at: number
}

export interface SessionRow {
  id: string
  account_id: string
  platform: 'ios' | 'android' | 'desktop' | null
  created_at: number
  last_used_at: number
  expires_at: number
}

export interface OAuthAttemptRow {
  state: string
  provider: 'google' | 'apple'
  intent: 'login' | 'link'
  link_account_id: string | null
  code_verifier: string
  nonce: string
  claim_hash: string
  status: 'pending' | 'ready' | 'claimed' | 'failed'
  account_id: string | null
  is_new_account: number
  error: string | null
  locale: string
  created_at: number
  expires_at: number
}

export interface ThrottleRow {
  key: string
  count: number
  window_start: number
}
