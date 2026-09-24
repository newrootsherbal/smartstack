import { buildSchedule } from '@smartstack/engine'
import type { Routine, Schedule, Stack } from '@smartstack/shared'
import { useMemo } from 'react'
import { localDateKey } from './dates'
import { useAppState } from './state/context'
import type { TodayOverride } from './storage'

/** The routine that applies to a given local day (today may be shifted). */
export function routineForDay(
  routine: Routine,
  override: TodayOverride | null,
  dateKey: string,
): Routine {
  return override && override.date === dateKey ? override.routine : routine
}

export function scheduleForDay(
  routine: Routine | null,
  stack: Stack,
  override: TodayOverride | null,
  dateKey: string,
): Schedule | null {
  if (!routine || stack.length === 0) return null
  return buildSchedule(routineForDay(routine, override, dateKey), stack)
}

/** Today's schedule, recomputed whenever routine, stack or the override change. */
export function useTodaySchedule(): { today: string; schedule: Schedule | null } {
  const { state } = useAppState()
  const today = localDateKey()
  const schedule = useMemo(
    () => scheduleForDay(state.routine, state.stack, state.todayOverride, today),
    [state.routine, state.stack, state.todayOverride, today],
  )
  return { today, schedule }
}
