import { useEffect, useMemo, useReducer, type ReactNode } from 'react'
import { setLocale } from '../i18n'
import { loadState, saveState } from '../storage'
import { AppStateContext } from './context'
import { reducer } from './reducer'

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)

  // Persist every change. localStorage is the source of truth.
  useEffect(() => {
    saveState(state)
  }, [state])

  useEffect(() => {
    setLocale(state.locale)
  }, [state.locale])

  // Ask the browser not to evict this origin's storage under disk pressure. Chrome and
  // Firefox grant it silently for installed apps or sites with notification permission;
  // the data still lives only on this device and is deleted with the app or site data.
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => undefined)
  }, [])

  const value = useMemo(() => ({ state, dispatch }), [state])
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}
