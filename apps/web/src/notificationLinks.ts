/**
 * Where tapping a notification may go (build prompt §4.12). Reminders open the app; a news
 * notification opens its link only when it is https on an allowlisted host (New Roots Herbal's
 * site) or our own origin. Anything else opens the app. Used by the service worker.
 */
export const NEWS_LINK_HOSTS = ['newrootsherbal.com', 'www.newrootsherbal.com'] as const

/** The path that switches news off (the Android "Turn off news" action opens it). */
export const NEWS_OFF_PATH = '/notifications?news=off'

export function notificationTarget(raw: unknown, origin: string): string {
  const fallback = new URL('/today', origin).href
  if (typeof raw !== 'string' || raw.trim() === '') return fallback
  let url: URL
  try {
    url = new URL(raw, origin)
  } catch {
    return fallback
  }
  const own = new URL(origin)
  if (url.origin === own.origin) return url.href
  if (url.protocol !== 'https:') return fallback
  if (url.username || url.password || url.port) return fallback
  return (NEWS_LINK_HOSTS as readonly string[]).includes(url.hostname) ? url.href : fallback
}

/** "Turn off news" in the device's language (the payload carries it; else the browser's). */
export function newsOffLabel(lang: unknown, browserLanguage: string): string {
  const fr = lang === 'fr' || (lang !== 'en' && /^fr\b/i.test(browserLanguage))
  return fr ? 'Désactiver les nouvelles' : 'Turn off news'
}
