/**
 * Local calendar helpers. This is the ONLY layer that converts between the
 * engine's zone-free "HH:MM" and real instants. Every conversion goes through
 * `new Date(y, m, d, hh, mm)` for a specific calendar day, never by adding
 * 86,400,000 ms to "today" (DST ends in Quebec on 2026-11-01, mid-beta).
 */
import type { HHMM } from '@smartstack/shared'
import { intlLocale } from './i18n'

/** "YYYY-MM-DD" in local time. */
export type DateKey = string

const pad = (n: number) => String(n).padStart(2, '0')

export function localDateKey(date: Date = new Date()): DateKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function parseDateKey(key: DateKey): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return { y, m, d }
}

/** Calendar arithmetic through date components (DST-safe). */
export function addDays(key: DateKey, days: number): DateKey {
  const { y, m, d } = parseDateKey(key)
  return localDateKey(new Date(y, m - 1, d + days))
}

/** Epoch ms for a local wall-clock time on a given local calendar day. */
export function localDateTimeToEpoch(key: DateKey, time: HHMM): number {
  const { y, m, d } = parseDateKey(key)
  const [hh, mm] = time.split(':').map(Number) as [number, number]
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime()
}

/** Minutes since local midnight for an instant. */
export function minutesOfDay(date: Date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes()
}

export function currentTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

let timeFormatter: Intl.DateTimeFormat | null = null
let timeFormatterLocale = ''

/**
 * "09:30" → "9:30 AM" in English, "9 h 30" in French. Push titles use this form too, so
 * the language follows the app's setting rather than the device's.
 */
export function formatClock(time: HHMM, locale = intlLocale()): string {
  if (!timeFormatter || timeFormatterLocale !== locale) {
    timeFormatter = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
    timeFormatterLocale = locale
  }
  const [hh, mm] = time.split(':').map(Number) as [number, number]
  return timeFormatter.format(new Date(2000, 0, 1, hh, mm))
}

/** "2026-09-24" → "Thursday, September 24" / "Jeudi 24 septembre" (a heading, so capitalized). */
export function formatLongDate(key: DateKey, locale = intlLocale()): string {
  const { y, m, d } = parseDateKey(key)
  const text = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(y, m - 1, d))
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1)
}
