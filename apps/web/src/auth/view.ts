/** What the device keeps about the signed-in account (state.auth), from the Worker's view of it. */
import type { AccountView } from '@smartstack/shared'
import type { AuthState } from '../storage'

export function authFromAccount(account: AccountView): AuthState {
  return {
    mode: 'account',
    accountId: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
    emailVerified: account.emailVerified,
    providers: [...(account.hasPassword ? (['password'] as const) : []), ...account.providers],
    consentNeeded: account.consentNeeded,
  }
}
