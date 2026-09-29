/** Where the auth screens send people. */
import type { AccountView } from '@smartstack/shared'
import type { PersistedState } from '../../storage'

/** Only paths inside the app (never another origin, never protocol-relative). */
export function safeReturnTo(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null
  return raw
}

/**
 * After signing in: the consent step first when the account still needs it (accounts made
 * through Google, or a new policy version), then where the person came from, else onboarding
 * or Today.
 */
export function afterSignInPath(
  account: AccountView,
  state: PersistedState,
  returnTo: string | null,
  isNew = false,
): string {
  if (account.consentNeeded) {
    const params = new URLSearchParams()
    if (isNew) params.set('new', '1')
    if (returnTo) params.set('from', returnTo)
    const query = params.toString()
    return `/auth/consent${query ? `?${query}` : ''}`
  }
  if (returnTo) return returnTo
  return state.routine ? '/today' : '/onboarding'
}
