import { describe, expect, it } from 'vitest'
import { defaultState, loadState, migrateV1, saveState, STORAGE_KEY } from './storage'

/** A Storage that lives in a Map, enough for load/save. */
function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  }
}

/** A real Phase 1 blob, as the production app stored it (2026-09-25 build). */
const today = (() => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})()
const V1_BLOB = {
  version: 1,
  userId: '3f0c2a7e-5b1d-4c8e-9a6f-2d4b8e1c7a90',
  createdAt: 1758800000000,
  routine: {
    wake: '06:30',
    bedtime: '22:00',
    coffee: '07:00',
    breakfast: '07:30',
    lunch: '12:00',
    dinner: '18:00',
    exercise: null,
  },
  stack: [
    { productId: 'iron-bisglycinate', dosesPerDay: 1 },
    { productId: 'magnesium-bisglycinate', dosesPerDay: 2 },
  ],
  todayOverride: null,
  checks: {
    [`${today}:iron-bisglycinate:0`]: true,
    '2026-09-20:iron-bisglycinate:0': true,
  },
  pushState: {
    status: 'subscribed',
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    registeredAt: 1758800100000,
  },
  lastSync: 1758800200000,
  lastSyncHash: '1a2b3c4d',
  tz: 'America/Toronto',
  locale: 'fr',
  theme: 'wild',
}

describe('v1 → v2 migration', () => {
  it('keeps everything and adds the Phase 2 fields', () => {
    const now = 1759000000000
    const v2 = migrateV1(V1_BLOB, now)!
    expect(v2.version).toBe(2)
    expect(v2.userId).toBe(V1_BLOB.userId)
    expect(v2.createdAt).toBe(V1_BLOB.createdAt)
    expect(v2.routine).toEqual(V1_BLOB.routine)
    expect(v2.stack).toEqual([
      { productId: 'iron-bisglycinate', dosesPerDay: 1, addedAt: now, updatedAt: now },
      { productId: 'magnesium-bisglycinate', dosesPerDay: 2, addedAt: now, updatedAt: now },
    ])
    expect(v2.checks[`${today}:iron-bisglycinate:0`]).toEqual({ units: 0, at: now })
    expect(v2.auth.mode).toBe('unset')
    expect(v2.shopping).toEqual([])
    expect(v2.userProducts).toEqual([])
    expect(v2.healthProfile).toBeNull()
    expect(v2.newsOptIn).toBe(false)
    expect(v2.pushState).toEqual(V1_BLOB.pushState)
    expect([v2.tz, v2.locale, v2.theme]).toEqual(['America/Toronto', 'fr', 'wild'])
  })

  it('switches reminders to the new default (no product names) and re-sends them', () => {
    const v2 = migrateV1(V1_BLOB)!
    expect(v2.reminderProductNames).toBe(false)
    expect(v2.lastSyncHash).toBeNull()
    expect(v2.lastSync).toBe(V1_BLOB.lastSync)
  })

  it('migrates on load, drops past check marks and saves as version 2', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(V1_BLOB) })
    const loaded = loadState(storage)
    expect(loaded.version).toBe(2)
    expect(Object.keys(loaded.checks)).toEqual([`${today}:iron-bisglycinate:0`])
    saveState(loaded, storage)
    expect(loadState(storage)).toEqual(loaded)
  })

  it('refuses a broken v1 blob but keeps its device id', () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({ ...V1_BLOB, stack: 'nope' }),
    })
    const loaded = loadState(storage)
    expect(loaded.userId).toBe(V1_BLOB.userId)
    expect(loaded.stack).toEqual([])
  })
})

describe('persisted theme', () => {
  const saved = {
    ...defaultState(),
    stack: [{ productId: 'sample-iron', dosesPerDay: 1, addedAt: 1, updatedAt: 1 }],
    theme: 'bold' as const,
  }

  it('round-trips the chosen theme', () => {
    const storage = memoryStorage()
    saveState(saved, storage)
    expect(loadState(storage).theme).toBe('bold')
  })

  it('gives a state saved without a theme the default, keeping everything else', () => {
    const { theme: _theme, ...legacy } = saved
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(legacy) })
    const loaded = loadState(storage)
    expect(loaded.theme).toBe('rooted')
    expect(loaded.userId).toBe(saved.userId)
    expect(loaded.stack).toEqual(saved.stack)
  })

  it('falls back to the default for an unknown theme instead of resetting the user', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ ...saved, theme: 'neon' }) })
    const loaded = loadState(storage)
    expect(loaded.theme).toBe('rooted')
    expect(loaded.userId).toBe(saved.userId)
    expect(loaded.stack).toEqual(saved.stack)
  })
})

describe('reminders and news are separate', () => {
  it('keeps reminders on for a Phase 1 device that was subscribed', () => {
    expect(migrateV1(V1_BLOB)!.remindersEnabled).toBe(true)
    const off = { ...V1_BLOB, pushState: { status: 'off', endpoint: null, registeredAt: null } }
    expect(migrateV1(off)!.remindersEnabled).toBe(false)
  })

  it('derives the flag for a version 2 blob saved before it existed', () => {
    const { remindersEnabled: _r, ...older } = {
      ...defaultState(),
      pushState: {
        status: 'subscribed' as const,
        endpoint: 'https://push.example/x',
        registeredAt: 1,
      },
    }
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(older) })
    expect(loadState(storage).remindersEnabled).toBe(true)
    expect(loadState(storage).newsOptIn).toBe(false)
  })
})
