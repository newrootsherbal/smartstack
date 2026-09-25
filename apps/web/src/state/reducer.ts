import type { Routine, Stack } from '@smartstack/shared'
import { checkKey, type PersistedState, type PushState, type TodayOverride } from '../storage'
import type { ThemeId } from '../themes'

export type Action =
  | { type: 'SET_ROUTINE'; routine: Routine }
  | { type: 'ADD_PRODUCT'; productId: string; dosesPerDay: number }
  | { type: 'REMOVE_PRODUCT'; productId: string }
  | { type: 'SET_DOSES'; productId: string; dosesPerDay: number }
  | { type: 'TOGGLE_CHECK'; date: string; productId: string; doseIndex: number }
  | { type: 'SET_TODAY_OVERRIDE'; override: TodayOverride | null }
  | { type: 'SET_PUSH_STATE'; pushState: PushState }
  | { type: 'SET_SYNC'; lastSync: number | null; lastSyncHash: string | null }
  | { type: 'SET_TZ'; tz: string }
  | { type: 'SET_LOCALE'; locale: 'en' | 'fr' }
  | { type: 'SET_THEME'; theme: ThemeId }
  | { type: 'RESET'; state: PersistedState }

export function reducer(state: PersistedState, action: Action): PersistedState {
  switch (action.type) {
    case 'SET_ROUTINE':
      // A new routine invalidates today's "running late" shift.
      return { ...state, routine: action.routine, todayOverride: null }
    case 'ADD_PRODUCT': {
      if (state.stack.some((s) => s.productId === action.productId)) {
        return reducer(state, {
          type: 'SET_DOSES',
          productId: action.productId,
          dosesPerDay: action.dosesPerDay,
        })
      }
      const stack: Stack = [
        ...state.stack,
        { productId: action.productId, dosesPerDay: action.dosesPerDay },
      ]
      return { ...state, stack }
    }
    case 'REMOVE_PRODUCT':
      return { ...state, stack: state.stack.filter((s) => s.productId !== action.productId) }
    case 'SET_DOSES':
      return {
        ...state,
        stack: state.stack.map((s) =>
          s.productId === action.productId ? { ...s, dosesPerDay: action.dosesPerDay } : s,
        ),
      }
    case 'TOGGLE_CHECK': {
      const key = checkKey(action.date, action.productId, action.doseIndex)
      const checks = { ...state.checks }
      if (checks[key]) delete checks[key]
      else checks[key] = true
      return { ...state, checks }
    }
    case 'SET_TODAY_OVERRIDE':
      return { ...state, todayOverride: action.override }
    case 'SET_PUSH_STATE':
      return { ...state, pushState: action.pushState }
    case 'SET_SYNC':
      return { ...state, lastSync: action.lastSync, lastSyncHash: action.lastSyncHash }
    case 'SET_TZ':
      return { ...state, tz: action.tz }
    case 'SET_LOCALE':
      return { ...state, locale: action.locale }
    case 'SET_THEME':
      return { ...state, theme: action.theme }
    case 'RESET':
      return action.state
  }
}
