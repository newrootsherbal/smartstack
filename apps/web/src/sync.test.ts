import type { Routine } from '@smartstack/shared'
import { describe, expect, it } from 'vitest'
import { addDays, localDateKey, localDateTimeToEpoch } from './dates'
import { composeNotification, computeReminderWindow, hashWindow, WINDOW_DAYS } from './sync'

const routine: Routine = {
  wake: '07:00',
  coffee: '07:30',
  breakfast: '08:00',
  lunch: '12:00',
  dinner: '18:00',
  exercise: null,
  bedtime: '22:30',
}

describe('computeReminderWindow', () => {
  const now = new Date(2026, 8, 24, 11, 0) // 2026-09-24 11:00 local
  const stack = [
    { productId: 'multi', dosesPerDay: 1 },
    { productId: 'magnesium-bisglycinate', dosesPerDay: 1 },
  ]

  it('covers seven local calendar days and omits what is already past', () => {
    const reminders = computeReminderWindow({ routine, stack, todayOverride: null, now })
    const days = new Set(reminders.map((r) => r.slotKey.slice(0, 10)))
    expect(days.size).toBe(WINDOW_DAYS)
    // Today's 08:00 breakfast is in the past; 22:30 bedtime is not.
    const today = localDateKey(now)
    expect(reminders.filter((r) => r.slotKey.startsWith(today)).map((r) => r.slotKey)).toEqual([
      `${today}:22:30`,
    ])
    expect(reminders).toHaveLength(WINDOW_DAYS * 2 - 1)
  })

  it('converts through calendar components, so the DST change keeps wall-clock times', () => {
    // DST ends in Quebec on 2026-11-01. Wall-clock 08:00 must stay 08:00 on both sides.
    const before = localDateTimeToEpoch('2026-10-31', '08:00')
    const after = localDateTimeToEpoch('2026-11-01', '08:00')
    expect(new Date(before).getHours()).toBe(8)
    expect(new Date(after).getHours()).toBe(8)
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('omits anything within the two-minute lead time', () => {
    const justBefore = new Date(2026, 8, 24, 22, 29)
    const reminders = computeReminderWindow({
      routine,
      stack,
      todayOverride: null,
      now: justBefore,
    })
    expect(reminders.some((r) => r.slotKey === '2026-09-24:22:30')).toBe(false)
  })

  it('uses the shifted routine only for the override day', () => {
    const override = {
      date: localDateKey(now),
      routine: { ...routine, bedtime: '23:30' as const },
      shiftMinutes: 60,
    }
    const reminders = computeReminderWindow({ routine, stack, todayOverride: override, now })
    expect(reminders.some((r) => r.slotKey === `${localDateKey(now)}:23:30`)).toBe(true)
    expect(reminders.some((r) => r.slotKey === `${addDays(localDateKey(now), 1)}:22:30`)).toBe(true)
  })

  it('keeps slot keys within 32 characters and titles/bodies within limits', () => {
    const reminders = computeReminderWindow({ routine, stack, todayOverride: null, now })
    for (const r of reminders) {
      expect(r.slotKey.length).toBeLessThanOrEqual(32)
      expect(r.title.length).toBeLessThanOrEqual(60)
      expect(r.body.length).toBeLessThanOrEqual(100)
    }
  })

  it('hashes deterministically', () => {
    const a = computeReminderWindow({ routine, stack, todayOverride: null, now })
    const b = computeReminderWindow({ routine, stack, todayOverride: null, now })
    expect(hashWindow(a)).toBe(hashWindow(b))
    expect(hashWindow(a)).not.toBe(hashWindow(a.slice(1)))
  })
})

describe('composeNotification', () => {
  it('builds a short title and body', () => {
    const { title, body } = composeNotification({
      time: '09:30',
      minutes: 570,
      anchor: null,
      productIds: ['iron-bisglycinate'],
      doses: [{ productId: 'iron-bisglycinate', doseIndex: 0 }],
      reasons: [
        {
          ruleId: 'rule-iron-separate-calcium',
          attribute: 'SEPARATE_FROM_CALCIUM',
          severity: 'timing_conflict',
          productId: 'iron-bisglycinate',
          doseIndex: 0,
          params: {},
        },
      ],
    })
    expect(title).toMatch(/^Iron Bisglycinate — 9:30/)
    expect(body).toBe('Iron Bisglycinate · Take separately from calcium')
  })
})
