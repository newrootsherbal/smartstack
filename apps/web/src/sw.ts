/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NEWS_OFF_PATH, newsOffLabel, notificationTarget } from './notificationLinks'

declare let self: ServiceWorkerGlobalScope

// Take over immediately so a fresh deploy is live on the next open.
self.skipWaiting()
clientsClaim()

cleanupOutdatedCaches()
// The app shell, icons and the ZXing WASM. Required by injectManifest.
precacheAndRoute(self.__WB_MANIFEST)

// SPA navigation → index.html. Never the API: /api/* is never cached, never intercepted.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//],
  }),
)

interface PushPayload {
  title?: string
  body?: string
  tag?: string
  url?: string
  /** 'news' for staff news (reminders have no kind). */
  kind?: string
  /** The device's app language, for the action label. */
  lang?: string
}

/** Notification actions (Chrome on Android shows them; not in every lib.dom version). */
type WithActions = NotificationOptions & { actions?: { action: string; title: string }[] }

// Payloads are composed in the app's language; this only covers a malformed one, and the
// worker cannot read the app's setting, so the browser's language is the best guess.
const FALLBACK_TITLE = /^fr\b/i.test(self.navigator.language)
  ? 'Rappel SmartStack'
  : 'SmartStack reminder'

// Every push MUST show a visible notification. Three silent pushes and Safari
// revokes permission, so we notify even when the payload is missing or malformed.
self.addEventListener('push', (event) => {
  let payload: PushPayload = {}
  try {
    payload = (event.data?.json() as PushPayload | null) ?? {}
  } catch {
    payload = { body: event.data?.text() ?? '' }
  }
  const title = payload.title?.trim() || FALLBACK_TITLE
  const options: WithActions = {
    body: payload.body ?? '',
    icon: '/pwa-192x192.png',
    badge: '/pwa-64x64.png',
    data: { url: payload.url ?? '/today', kind: payload.kind ?? null },
  }
  if (payload.tag) options.tag = payload.tag
  // News can always be switched off right from the notification (where actions exist).
  if (payload.kind === 'news') {
    options.actions = [
      { action: 'news-off', title: newsOffLabel(payload.lang, self.navigator.language) },
    ]
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

// Focus an existing window or open the app. Every tap refreshes the rolling
// 7-day reminder window (the browser runs the engine, the Worker does not). A news link opens
// only when it is https on New Roots Herbal's site (or ours); anything else opens the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data as { url?: string } | undefined
  const target =
    event.action === 'news-off'
      ? new URL(NEWS_OFF_PATH, self.location.origin).href
      : notificationTarget(data?.url, self.location.origin)
  event.waitUntil(
    (async () => {
      // Another site opens in the browser, not in the app window.
      if (new URL(target).origin !== self.location.origin) {
        await self.clients.openWindow(target)
        return
      }
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client && client.url !== target) {
            try {
              await client.navigate(target)
            } catch {
              // Some browsers refuse navigate(); focusing is enough.
            }
          }
          return
        }
      }
      await self.clients.openWindow(target)
    })(),
  )
})
