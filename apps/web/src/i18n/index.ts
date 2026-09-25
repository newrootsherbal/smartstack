import type { LocalizedText } from '@smartstack/shared'
import en from './en.json'
import fr from './fr.json'

export type Locale = 'en' | 'fr'
export const LOCALES: readonly Locale[] = ['en', 'fr']

/**
 * BCP 47 tags handed to Intl. English keeps the pitch's "9:30 AM" clock; French is
 * Quebec French ("9 h 30", "637,5 mg", "jeudi 24 septembre").
 */
export const INTL_LOCALE: Record<Locale, string> = { en: 'en-US', fr: 'fr-CA' }

type Messages = typeof en

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never
type Leaves<T> = T extends string
  ? never
  : { [K in keyof T & string]: T[K] extends string ? K : Join<K, Leaves<T[K]>> }[keyof T & string]

/** Every dotted key path in en.json that resolves to a string. */
export type MessageKey = Leaves<Messages>

let current: Locale = 'en'

export function setLocale(locale: Locale): void {
  current = locale
}

export function getLocale(): Locale {
  return current
}

/** The Intl tag for the current locale. */
export function intlLocale(): string {
  return INTL_LOCALE[current]
}

/**
 * The language a new user starts in: the first of the browser's preferred languages
 * that the app speaks, English when none does. Stored afterwards, so a change made in
 * Settings sticks.
 */
export function detectLocale(preferred: readonly string[] = browserLanguages()): Locale {
  for (const tag of preferred) {
    const language = tag.toLowerCase().split('-')[0]
    if (language === 'fr') return 'fr'
    if (language === 'en') return 'en'
  }
  return 'en'
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  const list =
    navigator.languages && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language]
  return list.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)
}

function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

/**
 * The message for a key in the current locale: English when the French value is missing
 * or empty, undefined when neither dictionary has the key. For vocabulary looked up by
 * data-driven keys (unit words, serving phrases), where absence is expected.
 */
export function lookupMessage(key: string): string | undefined {
  const localized = current === 'fr' ? lookup(fr, key) : undefined
  return localized ? localized : lookup(en, key)
}

/**
 * Translate a key, interpolating `{name}` placeholders. Falls back to English when the
 * French value is missing or empty, and to the key itself as a last resort.
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  // An empty string is a real value (e.g. a severity with no sub-label) when English is
  // empty too; the key itself only ever shows for a key missing from both dictionaries.
  const raw = lookupMessage(key) ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

/** Localized text from data files ({ en, fr? }). */
export function tl(text: LocalizedText): string {
  if (current === 'fr' && text.fr) return text.fr
  return text.en
}

/** For tests and tooling: every leaf key path of a dictionary. */
export function leafKeys(dict: unknown, prefix = ''): string[] {
  if (dict === null || typeof dict !== 'object') return []
  return Object.entries(dict as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === 'string' ? [prefix + k] : leafKeys(v, `${prefix}${k}.`),
  )
}

export { en, fr }
