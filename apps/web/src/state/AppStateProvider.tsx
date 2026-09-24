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

  const value = useMemo(() => ({ state, dispatch }), [state])
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}
