import { ROUTINE_KEYS, type Routine } from '@smartstack/shared'
import { formatHHMM, MINUTES_PER_DAY, parseHHMM } from './time'

/**
 * "I'm running late": shift every routine anchor still in the future by
 * `deltaMinutes`, for today only. `nowMinutes` is minutes since local midnight;
 * the caller (browser) decides what "now" is. Anchors already in the past are
 * left alone; shifted anchors are capped at 23:59.
 */
export function shiftRoutine(routine: Routine, nowMinutes: number, deltaMinutes: number): Routine {
  const shifted = { ...routine }
  for (const key of ROUTINE_KEYS) {
    const value = routine[key]
    if (value === null) continue
    const minutes = parseHHMM(value)
    if (minutes < nowMinutes) continue
    shifted[key] = formatHHMM(Math.min(minutes + deltaMinutes, MINUTES_PER_DAY - 1))
  }
  return shifted
}
