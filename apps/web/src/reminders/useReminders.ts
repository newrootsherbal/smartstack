import { useCallback, useState } from 'react'
import { api } from '../api/client'
import { platformName } from '../platform/detect'
import {
  permissionState,
  pushSupported,
  requestPermission,
  subscribe,
  toSubscriptionBody,
  unsubscribe,
} from '../platform/reminders'
import { useAppState } from '../state/context'
import { describeError, syncSchedule } from './runner'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

export function useReminders() {
  const { state, dispatch } = useAppState()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<'push' | 'server' | null>(null)
  const [testStatus, setTestStatus] = useState<'idle' | 'sent' | 'failed'>('idle')
  const [permission, setPermission] = useState(permissionState())

  /**
   * Click handler. `Notification.requestPermission()` is called synchronously,
   * before any await, or iOS ignores it.
   */
  const enable = useCallback(() => {
    if (!pushSupported()) {
      dispatch({
        type: 'SET_PUSH_STATE',
        pushState: { status: 'unsupported', endpoint: null, registeredAt: null },
      })
      return
    }
    const permissionPromise = requestPermission()
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const result = await permissionPromise
        setPermission(result)
        if (result !== 'granted') {
          dispatch({
            type: 'SET_PUSH_STATE',
            pushState: {
              status: result === 'denied' ? 'denied' : 'off',
              endpoint: null,
              registeredAt: null,
            },
          })
          return
        }
        let sub: PushSubscription
        try {
          sub = await subscribe(VAPID_PUBLIC_KEY)
        } catch (err) {
          // Chrome/Safari could not register with their push service: nothing reached our server.
          setErrorKind('push')
          setError(describeError(err))
          return
        }
        const body = toSubscriptionBody(sub)
        // First network calls of the app's life: create the user, then the subscription.
        await api.putMe(state.userId, { tz: state.tz, platform: platformName() })
        await api.putPushSubscription(state.userId, body)
        const next = {
          ...state,
          pushState: {
            status: 'subscribed' as const,
            endpoint: body.endpoint,
            registeredAt: Date.now(),
          },
        }
        dispatch({ type: 'SET_PUSH_STATE', pushState: next.pushState })
        await syncSchedule(next, dispatch, { force: true })
      } catch (err) {
        setErrorKind('server')
        setError(describeError(err))
      } finally {
        setBusy(false)
      }
    })()
  }, [dispatch, state])

  const disable = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      if (state.pushState.endpoint) {
        await api
          .deletePushSubscription(state.userId, state.pushState.endpoint)
          .catch(() => undefined)
      }
      await unsubscribe()
      dispatch({
        type: 'SET_PUSH_STATE',
        pushState: { status: 'off', endpoint: null, registeredAt: null },
      })
      dispatch({ type: 'SET_SYNC', lastSync: null, lastSyncHash: null })
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }, [dispatch, state.pushState.endpoint, state.userId])

  const sendTest = useCallback(async () => {
    setTestStatus('idle')
    setError(null)
    try {
      await api.postTestReminder(state.userId)
      setTestStatus('sent')
    } catch (err) {
      setTestStatus('failed')
      setError(describeError(err))
    }
  }, [state.userId])

  return {
    permission,
    pushState: state.pushState,
    lastSync: state.lastSync,
    busy,
    error,
    errorKind,
    testStatus,
    vapidConfigured: VAPID_PUBLIC_KEY.length > 0,
    enable,
    disable,
    sendTest,
  }
}
