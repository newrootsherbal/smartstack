/**
 * Build-time flags (apps/web/.env for production, .env.development for `vite`,
 * .env.staging for `vite build --mode staging`).
 */
import { parseAccountsMode, type AccountsMode } from '@smartstack/shared'

/** Accounts launch gate; must match the Worker's ACCOUNTS_MODE. */
export const ACCOUNTS_MODE: AccountsMode = parseAccountsMode(import.meta.env.VITE_ACCOUNTS_MODE)

/** The public UI offers accounts only when they are open to everyone. */
export const ACCOUNTS_PUBLIC = ACCOUNTS_MODE === 'public'

/** Sign in with Apple, once the company is enrolled in the Apple Developer Program. */
export const APPLE_ENABLED = import.meta.env.VITE_APPLE_ENABLED === 'true'
