import { Fragment, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import { setLocale } from '../i18n'
import { loadState, saveState } from '../storage'
import { AppStateContext } from './context'
import { reducer } from './reducer'

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)

  // t() reads a module-level locale, so it is switched here, before any child renders: an
  // effect would leave the first render after a language change in the old language.
  // Setting the same value again is harmless (Strict Mode renders twice).
  setLocale(state.locale)

  // Persist every change. localStorage is the source of truth.
  useEffect(() => {
    saveState(state)
  }, [state])

  // Screen readers, hyphenation and form controls follow the document language.
  useEffect(() => {
    document.documentElement.lang = state.locale
  }, [state.locale])

  // Ask the browser not to evict this origin's storage under disk pressure. Chrome and
  // Firefox grant it silently for installed apps or sites with notification permission;
  // the data still lives only on this device and is deleted with the app or site data.
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => undefined)
  }, [])

  const value = useMemo(() => ({ state, dispatch }), [state])
  // A language change remounts the tree so every t() call runs again; the router keeps the URL.
  return (
    <AppStateContext.Provider value={value}>
      <Fragment key={state.locale}>{children}</Fragment>
    </AppStateContext.Provider>
  )
}
