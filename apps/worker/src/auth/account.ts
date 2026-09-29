/**
 * Account rows → API shapes, the consent gate, sign-in method rules and the Law 25 export.
 * Pure: statements are returned, never run.
 */
import { OAUTH_PROVIDERS, type AccountView, type OAuthProviderId } from '@smartstack/shared'
import type {
  AccountRow,
  AccountWithProviders,
  AuthIdentityRow,
  Locale,
  SessionRow,
  UserRow,
} from '../env'
import type { Statement } from '../logic'
import {
  checkFromRow,
  productFromRow,
  settingsFromRow,
  shoppingFromRow,
  stackFromRow,
  syncExportStatements,
  type SyncReadRows,
} from '../sync'
import { healthFromRow } from '../sync-health'

/** Correlated subquery giving an account's distinct providers ("google", "apple,google"…). */
export const PROVIDERS_SQL = `(SELECT group_concat(DISTINCT provider) FROM auth_identities
  WHERE account_id = a.id) AS providers`

export function accountByEmailStatement(email: string): Statement {
  return { sql: `SELECT a.*, ${PROVIDERS_SQL} FROM accounts a WHERE a.email = ?1`, params: [email] }
}

export function accountByIdStatement(id: string): Statement {
  return { sql: `SELECT a.*, ${PROVIDERS_SQL} FROM accounts a WHERE a.id = ?1`, params: [id] }
}

export function parseProviders(raw: string | null): OAuthProviderId[] {
  const known = OAUTH_PROVIDERS as readonly string[]
  const list = (raw ?? '').split(',').filter((p): p is OAuthProviderId => known.includes(p))
  return [...new Set(list)].sort()
}

/**
 * The consent gate (§5.8): true until the account has consented to the CURRENT version. A
 * missing CONSENT_VERSION (misconfiguration) keeps everyone gated. `/api/sync` uses this later.
 */
export function consentNeeded(
  account: Pick<AccountRow, 'consent_version' | 'consent_at'>,
  currentVersion: string | null,
): boolean {
  if (!currentVersion) return true
  return account.consent_at === null || account.consent_version !== currentVersion
}

export function accountView(
  account: AccountWithProviders,
  currentConsentVersion: string | null,
): AccountView {
  return {
    id: account.id,
    email: account.email,
    emailVerified: account.email_verified_at !== null,
    name: account.display_name,
    locale: account.locale,
    role: account.role,
    providers: parseProviders(account.providers),
    hasPassword: account.password_hash !== null,
    consentNeeded: consentNeeded(account, currentConsentVersion),
  }
}

export interface NewAccountInput {
  id: string
  email: string
  locale: Locale
  displayName: string | null
  now: number
  emailVerified: boolean
  /** Email sign-up records consent with the account; OAuth accounts consent afterwards. */
  consentVersion: string | null
  password: { hash: string; salt: string; kdfVersion: number } | null
}

/** The row as inserted (so a response can be built without reading it back). */
export function newAccountRow(input: NewAccountInput): AccountWithProviders {
  const { now } = input
  return {
    id: input.id,
    email: input.email,
    email_verified_at: input.emailVerified ? now : null,
    password_hash: input.password?.hash ?? null,
    password_salt: input.password?.salt ?? null,
    kdf_version: input.password?.kdfVersion ?? null,
    display_name: input.displayName,
    locale: input.locale,
    role: 'user',
    consent_version: input.consentVersion,
    consent_at: input.consentVersion ? now : null,
    age_confirmed_at: input.consentVersion ? now : null,
    rev: 0,
    created_at: now,
    updated_at: now,
    last_login_at: null,
    last_active_at: now,
    inactivity_warned_at: null,
    providers: null,
  }
}

export function insertAccountStatement(row: AccountRow): Statement {
  return {
    sql: `INSERT INTO accounts (id, email, email_verified_at, password_hash, password_salt,
            kdf_version, display_name, locale, consent_version, consent_at, age_confirmed_at,
            created_at, updated_at, last_active_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?13)`,
    params: [
      row.id,
      row.email,
      row.email_verified_at,
      row.password_hash,
      row.password_salt,
      row.kdf_version,
      row.display_name,
      row.locale,
      row.consent_version,
      row.consent_at,
      row.age_confirmed_at,
      row.created_at,
      row.last_active_at,
    ],
  }
}

export function recordConsentStatement(accountId: string, version: string, now: number): Statement {
  return {
    sql: `UPDATE accounts SET consent_version = ?2, consent_at = ?3, age_confirmed_at = ?3,
            updated_at = ?3
          WHERE id = ?1`,
    params: [accountId, version, now],
  }
}

export function setPasswordStatement(
  accountId: string,
  password: { hash: string; salt: string; kdfVersion: number },
  now: number,
  options: { verifyEmail: boolean },
): Statement {
  return {
    sql: `UPDATE accounts SET password_hash = ?2, password_salt = ?3, kdf_version = ?4,
            updated_at = ?5${options.verifyEmail ? ', email_verified_at = COALESCE(email_verified_at, ?5)' : ''}
          WHERE id = ?1
          RETURNING email, locale`,
    params: [accountId, password.hash, password.salt, password.kdfVersion, now],
  }
}

export function deleteAccountStatement(accountId: string): Statement {
  // ON DELETE CASCADE (D1 enforces foreign keys) removes identities, sessions, email tokens,
  // OAuth attempts and linked devices, and through the devices their subscriptions and reminders.
  return { sql: `DELETE FROM accounts WHERE id = ?1`, params: [accountId] }
}

export function linkDeviceStatement(accountId: string, deviceId: string): Statement {
  return { sql: `UPDATE users SET account_id = ?1 WHERE id = ?2`, params: [accountId, deviceId] }
}

export function unlinkDeviceStatement(accountId: string, deviceId: string): Statement {
  return {
    sql: `UPDATE users SET account_id = NULL WHERE id = ?2 AND account_id = ?1`,
    params: [accountId, deviceId],
  }
}

export type DisconnectCheck = 'ok' | 'not_connected' | 'last_sign_in_method'

/** A provider can be disconnected only if a password or another provider remains. */
export function canDisconnect(
  account: Pick<AccountWithProviders, 'password_hash' | 'providers'>,
  provider: OAuthProviderId,
): DisconnectCheck {
  const providers = parseProviders(account.providers)
  if (!providers.includes(provider)) return 'not_connected'
  const remaining = providers.filter((p) => p !== provider).length
  return account.password_hash !== null || remaining > 0 ? 'ok' : 'last_sign_in_method'
}

export function disconnectIdentityStatement(
  accountId: string,
  provider: OAuthProviderId,
): Statement {
  return {
    sql: `DELETE FROM auth_identities WHERE account_id = ?1 AND provider = ?2`,
    params: [accountId, provider],
  }
}

/**
 * The reads behind GET /api/account/export, in one DB.batch: the account, sign-in methods,
 * sessions, devices, then the synced data (settings, products, stack, shopping list, checks).
 */
export function exportStatements(accountId: string): Statement[] {
  return [
    { sql: `SELECT * FROM accounts WHERE id = ?1`, params: [accountId] },
    {
      sql: `SELECT provider, subject, email, created_at, last_used_at FROM auth_identities
            WHERE account_id = ?1 ORDER BY created_at`,
      params: [accountId],
    },
    {
      sql: `SELECT platform, created_at, last_used_at, expires_at FROM sessions
            WHERE account_id = ?1 ORDER BY created_at`,
      params: [accountId],
    },
    {
      sql: `SELECT id, tz, platform, created_at, last_seen_at FROM users
            WHERE account_id = ?1 ORDER BY created_at`,
      params: [accountId],
    },
    ...syncExportStatements(accountId),
  ]
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString()
}

export interface ExportRows {
  account: AccountRow
  identities: Pick<
    AuthIdentityRow,
    'provider' | 'subject' | 'email' | 'created_at' | 'last_used_at'
  >[]
  sessions: Pick<SessionRow, 'platform' | 'created_at' | 'last_used_at' | 'expires_at'>[]
  devices: Pick<UserRow, 'id' | 'tz' | 'platform' | 'created_at' | 'last_seen_at'>[]
  /** Every synced row, tombstones (deleted items, kept 30 days) included. */
  synced: SyncReadRows
}

/** Deep copy with every number under a key ending in "At" as an ISO date. */
export function withIsoDates<T>(value: T): unknown {
  if (Array.isArray(value)) return value.map(withIsoDates)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      key.endsWith('At') && typeof v === 'number' ? iso(v) : withIsoDates(v),
    ]),
  )
}

/**
 * Law 25 portability: every row of the account, readable. Never the password hash or salt,
 * provider tokens, or session ids (they are token hashes).
 */
export function buildAccountExport(rows: ExportRows, now: number) {
  const a = rows.account
  const synced = rows.synced
  return {
    format: 'smartstack-account-export',
    version: 1,
    exportedAt: iso(now),
    account: {
      id: a.id,
      email: a.email,
      emailVerifiedAt: iso(a.email_verified_at),
      hasPassword: a.password_hash !== null,
      passwordKdfVersion: a.kdf_version,
      name: a.display_name,
      locale: a.locale,
      role: a.role,
      consentVersion: a.consent_version,
      consentAt: iso(a.consent_at),
      ageConfirmedAt: iso(a.age_confirmed_at),
      createdAt: iso(a.created_at),
      updatedAt: iso(a.updated_at),
      lastLoginAt: iso(a.last_login_at),
      lastActiveAt: iso(a.last_active_at),
      inactivityWarnedAt: iso(a.inactivity_warned_at),
    },
    signInMethods: rows.identities.map((i) => ({
      provider: i.provider,
      subject: i.subject,
      email: i.email,
      connectedAt: iso(i.created_at),
      lastUsedAt: iso(i.last_used_at),
    })),
    sessions: rows.sessions.map((s) => ({
      platform: s.platform,
      createdAt: iso(s.created_at),
      lastUsedAt: iso(s.last_used_at),
      expiresAt: iso(s.expires_at),
    })),
    devices: rows.devices.map((d) => ({
      id: d.id,
      timeZone: d.tz,
      platform: d.platform,
      createdAt: iso(d.created_at),
      lastSeenAt: iso(d.last_seen_at),
    })),
    // As the app syncs them (docs/smartstack-phase2-prompt.md §8), dates in ISO form. A deleted
    // item stays 30 days as a tombstone: its key and dates only.
    settings: withIsoDates(synced.settings[0] ? settingsFromRow(synced.settings[0]) : null),
    healthProfile: withIsoDates(synced.health[0] ? healthFromRow(synced.health[0]) : null),
    products: withIsoDates(synced.products.map(productFromRow)),
    stack: withIsoDates(synced.stack.map(stackFromRow)),
    shoppingList: withIsoDates(synced.shopping.map(shoppingFromRow)),
    doseChecks: withIsoDates(synced.checks.map(checkFromRow)),
  }
}

export function exportFileName(now: number): string {
  return `smartstack-account-${new Date(now).toISOString().slice(0, 10)}.json`
}
