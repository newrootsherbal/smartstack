/**
 * Reminder delivery behind a small interface. Web now: Web Push through the
 * service worker, synced to the Worker. Later native: @capacitor/local-notifications
 * with `on: { hour, minute }` repeats (Android 13 POST_NOTIFICATIONS, Android 14
 * exact-alarm permission) behind the same functions.
 */
import type { PushSubscriptionBody } from '@smartstack/shared'

export type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported'

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function permissionState(): PermissionState {
  if (!pushSupported()) return 'unsupported'
  return Notification.permission
}

/**
 * MUST be called synchronously inside the click handler, before any `await`:
 * iOS only grants permission prompted directly by a user gesture.
 */
export function requestPermission(): Promise<NotificationPermission> {
  return Notification.requestPermission()
}

/** Safari is strict: applicationServerKey must be a Uint8Array of the raw P-256 key. */
export function vapidKeyToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4)
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function toSubscriptionBody(sub: PushSubscription): PushSubscriptionBody {
  const json = sub.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!json.endpoint || !p256dh || !auth) throw new Error('push subscription is missing keys')
  return { endpoint: json.endpoint, keys: { p256dh, auth } }
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

export async function subscribe(vapidPublicKey: string): Promise<PushSubscription> {
  if (!vapidPublicKey) throw new Error('VITE_VAPID_PUBLIC_KEY is not set')
  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  if (existing) return existing
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidKeyToUint8Array(vapidPublicKey),
  })
}

export async function unsubscribe(): Promise<void> {
  const existing = await getExistingSubscription()
  if (existing) await existing.unsubscribe()
}
