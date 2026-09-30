/** Whether the Worker said this device's session is gone (a 401), until the next sign-in. */
import { useSyncExternalStore } from 'react'

let expired = false
const listeners = new Set<() => void>()

export function setSessionExpired(value: boolean): void {
  if (expired === value) return
  expired = value
  for (const l of listeners) l()
}

/** True once the Worker said the session is gone (until the next sign-in). */
export function useSessionExpired(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => expired,
    () => expired,
  )
}
