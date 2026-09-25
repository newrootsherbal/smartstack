import { useEffect, useRef } from 'react'
import { useAppState } from '../state/context'
import { reconcileOnOpen, syncSchedule } from './runner'

/**
 * Keeps the server's reminder window in step with local state: once on app
 * open (reconcile), again when the app returns to the foreground, and on every
 * change to routine, stack or today's override. Renders nothing. Does nothing
 * until reminders are turned on.
 */
export function SyncManager() {
  const { state, dispatch } = useAppState()
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    void reconcileOnOpen(stateRef.current, dispatch)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reconcileOnOpen(stateRef.current, dispatch)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [dispatch])

  // Notification titles and bodies are composed in the app's language, so a language
  // change re-sends the window like any other change.
  const { routine, stack, todayOverride, locale } = state
  const pushStatus = state.pushState.status
  useEffect(() => {
    void syncSchedule(stateRef.current, dispatch)
  }, [routine, stack, todayOverride, locale, pushStatus, dispatch])

  return null
}
