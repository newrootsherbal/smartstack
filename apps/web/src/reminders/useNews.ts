import { useCallback, useState } from 'react'
import { api } from '../api/client'
import { useAppState } from '../state/context'
import { ensurePush, releasePush, vapidConfigured } from './push'
import { describeError } from './runner'

/**
 * News notifications on this device (C6, off by default). Turning them on subscribes to push
 * when needed (same permission flow as reminders); the Worker records when news was turned on
 * and off (proof of consent).
 */
export function useNews() {
  const { state, dispatch } = useAppState()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Click handler: the permission prompt (if any) is requested synchronously in ensurePush. */
  const enable = useCallback((): Promise<boolean> => {
    const pushing = ensurePush(state, dispatch)
    setBusy(true)
    setError(null)
    return (async () => {
      try {
        const result = await pushing
        if (!result.ok) {
          if (result.kind === 'push' || result.kind === 'server') setError(result.error)
          return false
        }
        await api.putNews(state.userId, { optIn: true })
        dispatch({ type: 'SET_NEWS_OPT_IN', on: true })
        return true
      } catch (err) {
        setError(describeError(err))
        return false
      } finally {
        setBusy(false)
      }
    })()
  }, [dispatch, state])

  const disable = useCallback(async (): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      if (state.pushState.status === 'subscribed') {
        await api.putNews(state.userId, { optIn: false })
      }
      dispatch({ type: 'SET_NEWS_OPT_IN', on: false })
      // Nothing else uses the subscription: let it go.
      if (!state.remindersEnabled && state.pushState.status === 'subscribed') {
        await releasePush(state, dispatch)
      }
      return true
    } catch (err) {
      setError(describeError(err))
      return false
    } finally {
      setBusy(false)
    }
  }, [dispatch, state])

  // Like reminders: without a push subscription (permission reset, icon removed) nothing can
  // arrive, so the switch shows off and turning it on subscribes again.
  const on = state.newsOptIn && state.pushState.status === 'subscribed'
  return { on, busy, error, vapidConfigured, enable, disable }
}
