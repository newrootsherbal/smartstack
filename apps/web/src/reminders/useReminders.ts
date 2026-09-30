import { useCallback, useState } from 'react'
import { api } from '../api/client'
import { t } from '../i18n'
import { permissionState } from '../platform/reminders'
import { useAppState } from '../state/context'
import { ensurePush, releasePush, vapidConfigured, type PushResult } from './push'
import { describeError, syncSchedule } from './runner'

/** Dose reminders on this device (news is separate: see useNews). */
export function useReminders() {
  const { state, dispatch } = useAppState()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<'push' | 'server' | null>(null)
  const [testStatus, setTestStatus] = useState<'idle' | 'sent' | 'failed'>('idle')
  const [permission, setPermission] = useState(permissionState())

  /**
   * Click handler. The permission prompt is requested synchronously inside ensurePush, before
   * any await, or iOS ignores it. Resolves true when reminders were turned on.
   */
  const enable = useCallback((): Promise<boolean> => {
    const pushing = ensurePush(state, dispatch)
    setBusy(true)
    setError(null)
    return (async () => {
      try {
        const result: PushResult = await pushing
        setPermission(permissionState())
        if (!result.ok) {
          if (result.kind === 'push' || result.kind === 'server') {
            setErrorKind(result.kind)
            setError(result.error)
          }
          return false
        }
        dispatch({ type: 'SET_REMINDERS_ENABLED', on: true })
        await syncSchedule(
          {
            ...state,
            remindersEnabled: true,
            pushState:
              state.pushState.status === 'subscribed'
                ? state.pushState
                : { status: 'subscribed', endpoint: null, registeredAt: Date.now() },
          },
          dispatch,
          { force: true },
        )
        return true
      } finally {
        setBusy(false)
      }
    })()
  }, [dispatch, state])

  const disable = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      dispatch({ type: 'SET_REMINDERS_ENABLED', on: false })
      dispatch({ type: 'SET_SYNC', lastSync: null, lastSyncHash: null })
      if (state.newsOptIn) {
        // News still uses the subscription: only the reminder window goes.
        await api.putSchedule(state.userId, { reminders: [] }).catch(() => undefined)
      } else {
        await releasePush(state, dispatch)
      }
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }, [dispatch, state])

  const sendTest = useCallback(async () => {
    setTestStatus('idle')
    setError(null)
    try {
      // Composed here, like every other notification, so it arrives in the app's language.
      await api.postTestReminder(state.userId, {
        title: t('reminders.testTitle'),
        body: t('reminders.testBody'),
      })
      setTestStatus('sent')
    } catch (err) {
      setTestStatus('failed')
      setError(describeError(err))
    }
  }, [state.userId])

  return {
    permission,
    pushState: state.pushState,
    on: state.remindersEnabled && state.pushState.status === 'subscribed',
    lastSync: state.lastSync,
    busy,
    error,
    errorKind,
    testStatus,
    vapidConfigured,
    enable,
    disable,
    sendTest,
  }
}
