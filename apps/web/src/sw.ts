/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

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
}

const FALLBACK_TITLE = 'SmartStack reminder'

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
  const options: NotificationOptions = {
    body: payload.body ?? '',
    icon: '/pwa-192x192.png',
    badge: '/pwa-64x64.png',
    data: { url: payload.url ?? '/today' },
  }
  if (payload.tag) options.tag = payload.tag
  event.waitUntil(self.registration.showNotification(title, options))
})

// Focus an existing window or open the app. Every tap refreshes the rolling
// 7-day reminder window (the browser runs the engine, the Worker does not).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data as { url?: string } | undefined
  const target = new URL(data?.url ?? '/today', self.location.origin).href
  event.waitUntil(
    (async () => {
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
