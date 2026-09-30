import { useEffect, useRef } from 'react'
import { api } from '../api/client'
import { platformName } from '../platform/detect'
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

  // News is sent in the device's language: tell the Worker when it changes (§6, PUT /api/me).
  const { routine, stack, todayOverride, locale, reminderProductNames } = state
  const subscribed = state.pushState.status === 'subscribed'
  const localeSent = state.serverLocale === locale
  useEffect(() => {
    if (!subscribed || localeSent) return
    const current = stateRef.current
    void api
      .putMe(current.userId, { tz: current.tz, platform: platformName(), locale })
      .then(() => dispatch({ type: 'SET_SERVER_LOCALE', locale }))
      .catch(() => undefined) // Tried again on the next app open.
  }, [subscribed, localeSent, locale, dispatch])

  // Notification titles and bodies are composed in the app's language, so a language
  // change re-sends the window like any other change.
  const pushStatus = state.pushState.status
  const remindersOn = state.remindersEnabled
  useEffect(() => {
    void syncSchedule(stateRef.current, dispatch)
  }, [
    routine,
    stack,
    todayOverride,
    locale,
    reminderProductNames,
    pushStatus,
    remindersOn,
    dispatch,
  ])

  return null
}
