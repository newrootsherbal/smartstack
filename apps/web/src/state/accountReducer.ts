import { markChanges } from '../account-sync/entities'
import type { PersistedState } from '../storage'
import { reducer, type Action } from './reducer'

/** Actions that carry the Worker's data or replace the state: never queued for a push. */
const NOT_LOCAL_CHANGES = new Set<Action['type']>([
  'SYNC_RESULT',
  'SYNC_ERROR',
  'SYNC_QUEUE_ALL',
  'SYNC_USE_ACCOUNT',
  'SYNC_INITIALIZED',
  'SET_ACCOUNT',
  'RESET',
])

/** The app's reducer: every local change of a signed-in account's data joins the sync outbox. */
export function accountReducer(state: PersistedState, action: Action): PersistedState {
  const next = reducer(state, action)
  return NOT_LOCAL_CHANGES.has(action.type) ? next : markChanges(state, next)
}
