import type { PinAnchor, Routine, Stack, StackItem } from '@smartstack/shared'
import { checkKey, type PersistedState, type PushState, type TodayOverride } from '../storage'
import type { ThemeId } from '../themes'

export type Action =
  | { type: 'SET_ROUTINE'; routine: Routine }
  | { type: 'ADD_PRODUCT'; productId: string; dosesPerDay: number; pins?: (PinAnchor | null)[] }
  | { type: 'REMOVE_PRODUCT'; productId: string }
  | { type: 'SET_DOSES'; productId: string; dosesPerDay: number }
  /** Pin one dose slot to an anchor, or give it back to the engine (null). */
  | { type: 'SET_PIN'; productId: string; slot: number; anchor: PinAnchor | null }
  /** The person turned a suggestion down (e.g. SUGGEST_BEDTIME). */
  | { type: 'DISMISS_SUGGESTION'; productId: string; code: string }
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
        const next = reducer(state, {
          type: 'SET_DOSES',
          productId: action.productId,
          dosesPerDay: action.dosesPerDay,
        })
        if (!action.pins) return next
        return {
          ...next,
          stack: next.stack.map((s) =>
            s.productId === action.productId ? withPins(s, action.pins!) : s,
          ),
        }
      }
      const item: StackItem = { productId: action.productId, dosesPerDay: action.dosesPerDay }
      const stack: Stack = [...state.stack, action.pins ? withPins(item, action.pins) : item]
      return { ...state, stack }
    }
    case 'REMOVE_PRODUCT':
      return { ...state, stack: state.stack.filter((s) => s.productId !== action.productId) }
    case 'SET_DOSES':
      return {
        ...state,
        stack: state.stack.map((s) =>
          s.productId === action.productId
            ? // Pins past the new number of doses no longer mean anything.
              withPins({ ...s, dosesPerDay: action.dosesPerDay }, s.pins ?? [])
            : s,
        ),
      }
    case 'SET_PIN':
      return {
        ...state,
        stack: state.stack.map((s) => {
          if (s.productId !== action.productId) return s
          const pins = [...(s.pins ?? [])]
          while (pins.length <= action.slot) pins.push(null)
          pins[action.slot] = action.anchor
          return withPins(s, pins)
        }),
      }
    case 'DISMISS_SUGGESTION':
      return {
        ...state,
        stack: state.stack.map((s) =>
          s.productId === action.productId && !s.dismissed?.includes(action.code)
            ? { ...s, dismissed: [...(s.dismissed ?? []), action.code] }
            : s,
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

/**
 * Store pins trimmed to the number of doses, without trailing nulls, and drop the field
 * when nothing is pinned (so an untouched item stays `{ productId, dosesPerDay }`).
 */
export function withPins(item: StackItem, pins: readonly (PinAnchor | null)[]): StackItem {
  const trimmed = pins.slice(0, item.dosesPerDay)
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === null) trimmed.pop()
  const { pins: _old, ...rest } = item
  return trimmed.length > 0 ? { ...rest, pins: trimmed } : rest
}
