import { createContext, useContext, type Dispatch } from 'react'
import type { PersistedState } from '../storage'
import type { Action } from './reducer'

export interface AppStateValue {
  state: PersistedState
  dispatch: Dispatch<Action>
}

export const AppStateContext = createContext<AppStateValue | null>(null)

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext)
  if (!value) throw new Error('useAppState must be used inside <AppStateProvider>')
  return value
}
