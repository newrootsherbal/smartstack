/**
 * Rolling 7-day reminder window. Computed per local calendar day in the
 * browser (the only place the engine runs), hashed, and sent to the Worker
 * only when it changed.
 */
import { getProduct } from '@smartstack/engine'
import {
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  type Placement,
  type ReminderInput,
  type Routine,
  type Stack,
} from '@smartstack/shared'
import { addDays, formatClock, localDateKey, localDateTimeToEpoch } from './dates'
import { t, tl } from './i18n'
import { renderReasonShort } from './i18n/render'
import { scheduleForDay } from './schedule'
import type { TodayOverride } from './storage'

export const WINDOW_DAYS = 7
/** Reminders earlier than now + this are not sent to the server. */
export const MIN_LEAD_MS = 2 * 60 * 1000

export interface WindowInput {
  routine: Routine
  stack: Stack
  todayOverride: TodayOverride | null
  now: Date
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/** Title "Iron — 9:30 AM"; body: product names and the first hint, ≤ 100 chars. */
export function composeNotification(placement: Placement): { title: string; body: string } {
  const names = placement.productIds.map((id) => {
    const product = getProduct(id)
    return product ? tl(product.shortName) : id
  })
  const clock = formatClock(placement.time)
  const subject =
    names.length === 1
      ? names[0]!
      : names.length === 2
        ? `${names[0]} + ${names[1]}`
        : t('push.several', { count: names.length })
  const title = truncate(`${subject} — ${clock}`, MAX_TITLE_LENGTH)
  const hint = placement.reasons[0] ? renderReasonShort(placement.reasons[0]) : ''
  const body = truncate(hint ? `${names.join(', ')} · ${hint}` : names.join(', '), MAX_BODY_LENGTH)
  return { title, body }
}

export function computeReminderWindow(input: WindowInput): ReminderInput[] {
  const reminders: ReminderInput[] = []
  const today = localDateKey(input.now)
  const cutoff = input.now.getTime() + MIN_LEAD_MS
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const day = addDays(today, i)
    const schedule = scheduleForDay(input.routine, input.stack, input.todayOverride, day)
    if (!schedule) continue
    for (const placement of schedule.placements) {
      const scheduledAt = localDateTimeToEpoch(day, placement.time)
      if (scheduledAt < cutoff) continue
      const { title, body } = composeNotification(placement)
      reminders.push({
        scheduledAt,
        slotKey: `${day}:${placement.time}`,
        productIds: placement.productIds,
        title,
        body,
      })
    }
  }
  return reminders
}

/** Small, stable content hash (FNV-1a 32-bit) of the computed window. */
export function hashWindow(reminders: ReminderInput[]): string {
  const text = JSON.stringify(reminders)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
