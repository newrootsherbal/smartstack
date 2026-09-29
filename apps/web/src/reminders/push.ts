/**
 * The device's push subscription, shared by dose reminders and news. Either can be on alone;
 * the subscription stays while at least one of them is on.
 */
import type { Dispatch } from 'react'
import { accountApi } from '../api/account'
import { api } from '../api/client'
import { getSessionToken } from '../auth/store'
import { platformName } from '../platform/detect'
import {
  pushSupported,
  requestPermission,
  subscribe,
  toSubscriptionBody,
  unsubscribe,
} from '../platform/reminders'
import type { Action } from '../state/reducer'
import type { PersistedState } from '../storage'
import { describeError } from './runner'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

export const vapidConfigured = VAPID_PUBLIC_KEY.length > 0

export type PushResult =
  | { ok: true }
  | { ok: false; kind: 'unsupported' | 'denied' | 'dismissed' }
  | { ok: false; kind: 'push' | 'server'; error: string }

/**
 * Make sure this device is subscribed and registered with the Worker. MUST be called
 * synchronously from a click handler: the permission prompt is requested before any await,
 * or iOS ignores it.
 */
export function ensurePush(state: PersistedState, dispatch: Dispatch<Action>): Promise<PushResult> {
  if (state.pushState.status === 'subscribed') return Promise.resolve({ ok: true })
  if (!pushSupported()) {
    dispatch({
      type: 'SET_PUSH_STATE',
      pushState: { status: 'unsupported', endpoint: null, registeredAt: null },
    })
    return Promise.resolve({ ok: false, kind: 'unsupported' })
  }
  const permission = requestPermission()
  return (async (): Promise<PushResult> => {
    const result = await permission
    if (result !== 'granted') {
      dispatch({
        type: 'SET_PUSH_STATE',
        pushState: {
          status: result === 'denied' ? 'denied' : 'off',
          endpoint: null,
          registeredAt: null,
        },
      })
      return { ok: false, kind: result === 'denied' ? 'denied' : 'dismissed' }
    }
    let sub: PushSubscription
    try {
      sub = await subscribe(VAPID_PUBLIC_KEY)
    } catch (err) {
      // Chrome/Safari could not register with their push service: nothing reached our server.
      return { ok: false, kind: 'push', error: describeError(err) }
    }
    try {
      const body = toSubscriptionBody(sub)
      // The app's first network calls: create the device, then its subscription.
      await api.putMe(state.userId, {
        tz: state.tz,
        platform: platformName(),
        locale: state.locale,
      })
      dispatch({ type: 'SET_SERVER_LOCALE', locale: state.locale })
      await api.putPushSubscription(state.userId, body)
      // Signed in: this device's reminders and news belong to the account (best effort).
      const session = state.auth.mode === 'account' ? getSessionToken() : null
      if (session) void accountApi.linkDevice(session, state.userId).catch(() => undefined)
      dispatch({
        type: 'SET_PUSH_STATE',
        pushState: { status: 'subscribed', endpoint: body.endpoint, registeredAt: Date.now() },
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, kind: 'server', error: describeError(err) }
    }
  })()
}

/** Drop the subscription (nothing left that uses it). */
export async function releasePush(
  state: PersistedState,
  dispatch: Dispatch<Action>,
): Promise<void> {
  if (state.pushState.endpoint) {
    await api.deletePushSubscription(state.userId, state.pushState.endpoint).catch(() => undefined)
  }
  await unsubscribe().catch(() => undefined)
  dispatch({
    type: 'SET_PUSH_STATE',
    pushState: { status: 'off', endpoint: null, registeredAt: null },
  })
}
