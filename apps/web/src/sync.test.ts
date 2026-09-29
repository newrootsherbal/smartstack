import type { Routine } from '@smartstack/shared'
import { describe, expect, it } from 'vitest'
import { addDays, localDateKey, localDateTimeToEpoch } from './dates'
import { setLocale } from './i18n'
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
  // Magnesium is only suggested for bedtime now; the person pinned it there.
  const stack = [
    { productId: 'multi', dosesPerDay: 1 },
    { productId: 'magnesium-bisglycinate', dosesPerDay: 1, pins: ['bedtime' as const] },
  ]

  it('covers seven local calendar days and omits what is already past', () => {
    const reminders = computeReminderWindow({
      routine,
      stack,
      todayOverride: null,
      now,
      productNames: true,
    })
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
      productNames: true,
    })
    expect(reminders.some((r) => r.slotKey === '2026-09-24:22:30')).toBe(false)
  })

  it('uses the shifted routine only for the override day', () => {
    const override = {
      date: localDateKey(now),
      routine: { ...routine, bedtime: '23:30' as const },
      shiftMinutes: 60,
    }
    const reminders = computeReminderWindow({
      routine,
      stack,
      todayOverride: override,
      now,
      productNames: true,
    })
    expect(reminders.some((r) => r.slotKey === `${localDateKey(now)}:23:30`)).toBe(true)
    expect(reminders.some((r) => r.slotKey === `${addDays(localDateKey(now), 1)}:22:30`)).toBe(true)
  })

  it('keeps slot keys within 32 characters and titles/bodies within limits', () => {
    const reminders = computeReminderWindow({
      routine,
      stack,
      todayOverride: null,
      now,
      productNames: true,
    })
    for (const r of reminders) {
      expect(r.slotKey.length).toBeLessThanOrEqual(32)
      expect(r.title.length).toBeLessThanOrEqual(60)
      expect(r.body.length).toBeLessThanOrEqual(100)
    }
  })

  it('hashes deterministically', () => {
    const a = computeReminderWindow({
      routine,
      stack,
      todayOverride: null,
      now,
      productNames: true,
    })
    const b = computeReminderWindow({
      routine,
      stack,
      todayOverride: null,
      now,
      productNames: true,
    })
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
      doses: [{ productId: 'iron-bisglycinate', doseIndex: 0, slot: 0 }],
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

  it('composes in French when the app language is French', () => {
    setLocale('fr')
    try {
      const { title, body } = composeNotification({
        time: '09:30',
        minutes: 570,
        anchor: null,
        productIds: ['iron-bisglycinate'],
        doses: [{ productId: 'iron-bisglycinate', doseIndex: 0, slot: 0 }],
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
      // The French short name is "Fer"; the clock reads "9 h 30" (spacing is up to ICU).
      expect(title.replace(/\s/g, '')).toMatch(/^Fer—9h30/)
      expect(body).toBe('Fer · Prendre à distance du calcium')
    } finally {
      setLocale('en')
    }
  })
})

describe('composeNotification and the bedtime suggestion', () => {
  it('never uses the evening suggestion as the notification hint', () => {
    const { body } = composeNotification({
      time: '07:30',
      minutes: 450,
      anchor: 'breakfast',
      productIds: ['magnesium-bisglycinate'],
      doses: [{ productId: 'magnesium-bisglycinate', doseIndex: 0, slot: 0 }],
      reasons: [
        {
          ruleId: 'rule-magnesium-bedtime',
          attribute: 'SUGGEST_BEDTIME',
          severity: 'informational',
          productId: 'magnesium-bisglycinate',
          doseIndex: 0,
          params: {},
        },
      ],
    })
    expect(body).toBe('Magnesium Bisglycinate')
  })
})

describe('reminders without product names (the default)', () => {
  const now = new Date(2026, 8, 24, 11, 0)
  const stack = [
    { productId: 'multi', dosesPerDay: 1 },
    { productId: 'iron-bisglycinate', dosesPerDay: 1, pins: ['dinner' as const] },
  ]

  it('only says how many products, and sends no product id', () => {
    const reminders = computeReminderWindow({
      routine,
      stack,
      todayOverride: null,
      now,
      productNames: false,
    })
    expect(reminders.length).toBeGreaterThan(0)
    for (const r of reminders) {
      expect(r.productIds).toEqual([])
      expect(r.title).not.toMatch(/Iron|Multi/)
      expect(r.body).toBe('Open SmartStack to see what to take.')
    }
    expect(reminders.find((r) => r.slotKey.endsWith(':18:00'))?.title).toMatch(
      /^Time for 1 product — 6:00/,
    )
  })

  it('counts in French too', () => {
    setLocale('fr')
    try {
      const { title, body } = composeNotification(
        {
          time: '09:30',
          minutes: 570,
          anchor: null,
          productIds: ['a', 'b', 'c'],
          doses: [],
          reasons: [],
        },
        false,
      )
      expect(title.replace(/\s/g, ' ')).toBe('3 produits à prendre — 9 h 30')
      expect(body).toBe('Ouvrez SmartStack pour voir quoi prendre.')
    } finally {
      setLocale('en')
    }
  })
})
