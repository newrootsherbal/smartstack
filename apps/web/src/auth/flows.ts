/**
 * Account flows shared by the auth screens and the Profile tab: signing in (any provider),
 * the OAuth start → claim dance (build prompt §5.4), logging out and deleting the account.
 */
import type { AccountView, OAuthIntent, OAuthProviderId } from '@smartstack/shared'
import type { Dispatch } from 'react'
import { accountApi } from '../api/account'
import { api, ApiError } from '../api/client'
import { ACCOUNTS_PUBLIC } from '../config'
import { t } from '../i18n'
import { platformName } from '../platform/detect'
import { unsubscribe } from '../platform/reminders'
import type { Action } from '../state/reducer'
import { clearState, defaultState, type PersistedState } from '../storage'
import { base64urlEncode, randomBytes, sha256Hex } from './bytes'
import { setSessionExpired } from './sessionStatus'
import { getPendingOAuth, setPendingOAuth, setSessionToken, type PendingOAuth } from './store'

/** The device row exists on the server only once reminders were turned on. */
function deviceRegistered(state: PersistedState): boolean {
  return state.pushState.status === 'subscribed' || state.lastSync !== null
}

/** Store the session, switch the app to the account, and link this device if it has a row. */
export function completeSignIn(
  token: string,
  account: AccountView,
  state: PersistedState,
  dispatch: Dispatch<Action>,
): void {
  setSessionToken(token)
  setSessionExpired(false)
  dispatch({ type: 'SET_ACCOUNT', account })
  if (deviceRegistered(state)) {
    // Best effort: reminders and news stay per device either way.
    void accountApi.linkDevice(token, state.userId).catch(() => undefined)
  }
}

/** What a device keeps when the person leaves their account: the device, not their data. */
function clearedState(state: PersistedState, keepDevice: boolean): PersistedState {
  const fresh = defaultState(keepDevice ? state.userId : undefined)
  return {
    ...fresh,
    theme: state.theme,
    locale: state.locale,
    tz: state.tz,
    ...(keepDevice ? { pushState: state.pushState } : {}),
    auth: { ...fresh.auth, mode: ACCOUNTS_PUBLIC ? 'unset' : 'guest' },
  }
}

/**
 * Log out: end the session, empty this device's reminder window (it named the account's
 * products), unlink the device, clear local state but keep theme and language.
 */
export async function signOut(
  session: string | null,
  state: PersistedState,
  dispatch: Dispatch<Action>,
): Promise<void> {
  if (session) {
    await accountApi.logout(session).catch(() => undefined)
    if (deviceRegistered(state)) {
      await api.putSchedule(state.userId, { reminders: [] }).catch(() => undefined)
      await accountApi.unlinkDevice(session, state.userId).catch(() => undefined)
    }
  }
  setSessionToken(null)
  setPendingOAuth(null)
  clearState()
  dispatch({ type: 'RESET', state: clearedState(state, true) })
}

/**
 * Delete the account everywhere. The Worker's cascade also removes the linked devices and
 * their subscriptions, so this device starts over as a new one.
 */
export async function deleteAccount(
  session: string,
  state: PersistedState,
  dispatch: Dispatch<Action>,
): Promise<void> {
  await accountApi.deleteAccount(session)
  await unsubscribe().catch(() => undefined)
  setSessionToken(null)
  setPendingOAuth(null)
  clearState()
  dispatch({ type: 'RESET', state: clearedState(state, false) })
}

/**
 * Start Google (or, later, Apple): a claim secret only this browsing context knows, its hash
 * to the Worker, then a plain redirect to the provider. No provider script ever loads.
 */
export async function startOAuth(
  provider: OAuthProviderId,
  intent: OAuthIntent,
  locale: 'en' | 'fr',
  returnTo: string | null,
  session: string | null = null,
): Promise<void> {
  const secretBytes = randomBytes(32)
  const claimSecret = base64urlEncode(secretBytes)
  const claimHash = await sha256Hex(secretBytes)
  const { url, state } = await accountApi.oauthStart(
    { provider, intent, claimHash, locale },
    intent === 'link' ? session : null,
  )
  setPendingOAuth({ provider, intent, state, claimSecret, createdAt: Date.now(), returnTo })
  window.location.assign(url)
}

export type ClaimOutcome =
  | { kind: 'signed_in'; account: AccountView; isNew: boolean; returnTo: string | null }
  /** Not ready yet (the provider round trip is still going on elsewhere). */
  | { kind: 'waiting' }
  /** Another context (Android's custom tab) claimed it and stored the session. */
  | { kind: 'already_claimed' }
  | { kind: 'failed'; code: string }

/** Turn a ready attempt into a session. Single use: the pending attempt is cleared on any end. */
export async function claimPending(pending: PendingOAuth): Promise<ClaimOutcome> {
  try {
    const result = await accountApi.oauthClaim({
      state: pending.state,
      claimSecret: pending.claimSecret,
      platform: platformName(),
    })
    setPendingOAuth(null)
    setSessionToken(result.token)
    setSessionExpired(false)
    return {
      kind: 'signed_in',
      account: result.account,
      isNew: result.isNew,
      returnTo: pending.returnTo,
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.code === 'not_ready') {
      return { kind: 'waiting' }
    }
    setPendingOAuth(null)
    if (err instanceof ApiError && err.status === 409 && err.code === 'already_claimed') {
      return { kind: 'already_claimed' }
    }
    return { kind: 'failed', code: err instanceof ApiError ? err.code : 'network' }
  }
}

/** A pending attempt for this state, if this browsing context started it. */
export function pendingFor(state: string | null): PendingOAuth | null {
  const pending = getPendingOAuth()
  return pending && state && pending.state === state ? pending : null
}

/** One friendly sentence for any account error. */
export function authErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return t('auth.error.network')
  switch (err.code) {
    case 'invalid_credentials':
      return t('auth.error.invalidCredentials')
    case 'email_in_use':
      return t('auth.error.emailInUse')
    case 'accounts_not_open':
      return t('auth.error.notOpen')
    case 'email_in_use_unverified':
      return t('auth.error.emailInUseUnverified')
    case 'identity_in_use':
      return t('auth.error.identityInUse')
    case 'invalid_token':
      return t('auth.error.invalidToken')
    case 'email_mismatch':
      return t('auth.error.emailMismatch')
    case 'last_sign_in_method':
      return t('auth.error.lastMethod')
    case 'cancelled':
      return t('auth.error.cancelled')
    default:
      if (err.status === 429) {
        const minutes = Math.max(1, Math.ceil((err.retryAfter ?? 60) / 60))
        return t('auth.error.tooMany', { minutes })
      }
      return t('auth.error.generic')
  }
}
