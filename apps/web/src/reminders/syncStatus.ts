import { useSyncExternalStore } from 'react'

export interface SyncStatus {
  syncing: boolean
  error: string | null
}

let status: SyncStatus = { syncing: false, error: null }
const listeners = new Set<() => void>()

export function setSyncStatus(next: Partial<SyncStatus>): void {
  status = { ...status, ...next }
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => status,
  )
}
