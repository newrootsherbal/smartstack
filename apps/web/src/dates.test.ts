import { afterEach, describe, expect, it } from 'vitest'
import { formatClock, formatLongDate } from './dates'
import { setLocale } from './i18n'

/** Drops every kind of space: ICU builds differ on the space before "AM" and around "h". */
const squash = (text: string) =>
  Array.from(text)
    .filter((c) => c.trim() !== '')
    .join('')

afterEach(() => setLocale('en'))

describe('clock and date formatting', () => {
  it('follows the app language rather than the device', () => {
    expect(squash(formatClock('09:30'))).toBe('9:30AM')
    expect(formatLongDate('2026-09-24')).toBe('Thursday, September 24')
    setLocale('fr')
    expect(squash(formatClock('09:30'))).toBe('9h30')
    expect(squash(formatClock('21:05'))).toBe('21h05')
    expect(squash(formatLongDate('2026-09-24'))).toBe('Jeudi24septembre')
  })

  it('accepts an explicit locale', () => {
    expect(squash(formatClock('09:30', 'fr-CA'))).toBe('9h30')
    expect(squash(formatClock('09:30', 'en-US'))).toBe('9:30AM')
  })
})
