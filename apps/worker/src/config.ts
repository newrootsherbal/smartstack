/** Typed views of the Worker's plain-text vars. */
import { parseAccountsMode, parseEmailDomains, type AccountsMode } from '@smartstack/shared'
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
