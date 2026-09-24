/**
 * The network side of reminders. Nothing here runs until pushState is
 * 'subscribed' (i.e. after the user tapped "Turn on reminders").
 */
import type { Dispatch } from 'react'
import { api, ApiError } from '../api/client'
import { currentTimeZone } from '../dates'
import { platformName } from '../platform/detect'
import { getExistingSubscription, toSubscriptionBody } from '../platform/reminders'
import type { Action } from '../state/reducer'
import type { PersistedState } from '../storage'
import { computeReminderWindow, hashWindow } from '../sync'
import { setSyncStatus } from './syncStatus'

let inFlight: Promise<void> | null = null

export function describeError(err: unknown): string {
  if (err instanceof ApiError) return `${err.status} ${err.code}`
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * Recompute the 7-day window and send it when its hash changed (or `force`).
 * Failures leave the stored hash untouched, so the next app open retries.
 */
export function syncSchedule(
  state: PersistedState,
  dispatch: Dispatch<Action>,
  opts: { force?: boolean } = {},
): Promise<void> {
  if (state.pushState.status !== 'subscribed' || !state.routine) return Promise.resolve()
  if (inFlight) return inFlight
  const routine = state.routine
  inFlight = (async () => {
    const reminders = computeReminderWindow({
      routine,
      stack: state.stack,
      todayOverride: state.todayOverride,
      now: new Date(),
    })
    const hash = hashWindow(reminders)
    if (!opts.force && hash === state.lastSyncHash) return
    setSyncStatus({ syncing: true })
    try {
      await api.putSchedule(state.userId, { reminders })
      dispatch({ type: 'SET_SYNC', lastSync: Date.now(), lastSyncHash: hash })
      setSyncStatus({ error: null })
    } catch (err) {
      setSyncStatus({ error: describeError(err) })
    } finally {
      setSyncStatus({ syncing: false })
    }
  })().finally(() => {
    inFlight = null
  })
  return inFlight
}

/**
 * On app open: re-register when the time zone or the push subscription changed
 * (iOS never fires `pushsubscriptionchange`), then sync.
 */
export async function reconcileOnOpen(
  state: PersistedState,
  dispatch: Dispatch<Action>,
): Promise<void> {
  if (state.pushState.status !== 'subscribed') return
  let force = false
  try {
    const tz = currentTimeZone()
    if (tz !== state.tz) {
      await api.putMe(state.userId, { tz, platform: platformName() })
      dispatch({ type: 'SET_TZ', tz })
      force = true
    }
    const current = await getExistingSubscription()
    if (current) {
      const body = toSubscriptionBody(current)
      if (body.endpoint !== state.pushState.endpoint) {
        await api.putPushSubscription(state.userId, body)
        if (state.pushState.endpoint) {
          await api.deletePushSubscription(state.userId, state.pushState.endpoint).catch(() => {})
        }
        dispatch({
          type: 'SET_PUSH_STATE',
          pushState: { status: 'subscribed', endpoint: body.endpoint, registeredAt: Date.now() },
        })
      }
    } else if (state.pushState.endpoint) {
      // The subscription vanished (icon deleted and re-added, permission reset…).
      dispatch({
        type: 'SET_PUSH_STATE',
        pushState: { status: 'off', endpoint: null, registeredAt: null },
      })
      return
    }
    setSyncStatus({ error: null })
  } catch (err) {
    setSyncStatus({ error: describeError(err) })
  }
  await syncSchedule(state, dispatch, { force })
}
