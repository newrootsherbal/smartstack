import type { HHMM } from '@smartstack/shared'

export const MINUTES_PER_DAY = 24 * 60

/** Parse "HH:MM" into minutes since local midnight. Throws on malformed input. */
export function parseHHMM(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error(`invalid HH:MM: ${value}`)
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) throw new Error(`invalid HH:MM: ${value}`)
  return hours * 60 + minutes
}

/** Format minutes since midnight as zero-padded "HH:MM". Clamped to 00:00–23:59. */
export function formatHHMM(minutes: number): HHMM {
  const clamped = Math.min(Math.max(Math.round(minutes), 0), MINUTES_PER_DAY - 1)
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` as HHMM
}

/** Round up to the next multiple of `step` minutes (15 by default). */
export function roundUpTo(minutes: number, step = 15): number {
  return Math.ceil(minutes / step) * step
}
