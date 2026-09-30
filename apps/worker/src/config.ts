/** Typed views of the Worker's plain-text vars. */
import {
  accountsOpenTo,
  parseAccountsMode,
  parseEmailDomains,
  type AccountsMode,
} from '@smartstack/shared'
import type { Env } from './env'

export function accountsMode(env: Pick<Env, 'ACCOUNTS_MODE'>): AccountsMode {
  return parseAccountsMode(env.ACCOUNTS_MODE)
}

export function staffEmailDomains(env: Pick<Env, 'STAFF_EMAIL_DOMAINS'>): string[] {
  return parseEmailDomains(env.STAFF_EMAIL_DOMAINS)
}

export function appleEnabled(env: Pick<Env, 'APPLE_ENABLED'>): boolean {
  return env.APPLE_ENABLED === 'true'
}

/**
 * Sign-up and login (password or provider) under the launch gate: "staff" refuses any address
 * outside STAFF_EMAIL_DOMAINS, "off" refuses everyone (the routes already answer 404 then).
 */
export function signInRefusal(
  env: Pick<Env, 'ACCOUNTS_MODE' | 'STAFF_EMAIL_DOMAINS'>,
  email: string,
): 'accounts_not_open' | null {
  return accountsOpenTo(accountsMode(env), email, staffEmailDomains(env))
    ? null
    : 'accounts_not_open'
}

/** The current consent version, or null when CONSENT_VERSION is missing (misconfiguration). */
export function consentVersion(env: Pick<Env, 'CONSENT_VERSION'>): string | null {
  const value = env.CONSENT_VERSION?.trim() ?? ''
  return value || null
}

export type EmailMode = 'log' | 'smtp2go' | 'invalid'

export function emailMode(env: Pick<Env, 'EMAIL_MODE'>): EmailMode {
  const value = (env.EMAIL_MODE ?? '').trim().toLowerCase()
  return value === 'log' || value === 'smtp2go' ? value : 'invalid'
}

/** EMAIL_MODE=log prints tokens: allowed only when the app runs on this machine. */
export function isLocalOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin)
    return (
      protocol === 'http:' &&
      (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]')
    )
  } catch {
    return false
  }
}
