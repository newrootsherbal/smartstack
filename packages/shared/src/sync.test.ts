import { describe, expect, it } from 'vitest'
import { PIN_ANCHORS, Routine, StackEntry } from './index'
import {
  SYNC_MAX_ROWS,
  SYNC_PIN_ANCHORS,
  SyncChanges,
  SyncCheck,
  SyncHealth,
  SyncProduct,
  SyncRequest,
  SyncResponse,
  SyncRoutine,
  SyncSettings,
  SyncStackItem,
  isSyncTombstone,
  syncCheckKey,
  syncRowCount,
} from './sync'

const T = Date.UTC(2026, 9, 1, 12, 0, 0)
const PRODUCT_ID = 'u_0f8fad5b-d9cb-469f-a165-70867728950e'

const routine = {
  wake: '06:30',
  bedtime: '22:30',
  coffee: '07:00',
  breakfast: '07:15',
  lunch: null,
  dinner: '18:00',
  exercise: null,
}

const product = {
  id: PRODUCT_ID,
  productType: 'medication',
  brand: null,
  name: 'Test medication',
  upc: null,
  npn: null,
  din: '12345678',
  strength: '50 mcg',
  form: 'tablet',
  doseUnit: 'tablet',
  unitsPerDose: 1,
  dosesPerDay: 1,
  packageQuantity: 90,
  packageUnit: 'unit',
  timing: ['WITHOUT_FOOD', 'MORNING'],
  ingredients: [{ ingredientId: null, name: 'Test medication', amount: 50, unit: 'mcg' }],
  directions: null,
  warnings: null,
  notes: null,
  createdAt: T,
  updatedAt: T,
}

const stackEntry = {
  productId: 'magnesium-bisglycinate-capsules',
  dosesPerDay: 2,
  pins: ['bedtime', null],
  dismissed: ['SUGGEST_BEDTIME'],
  variantUpc: '000000000000',
  inventory: { remaining: 88, unit: 'unit', packageSize: 90, lowFlaggedAt: null },
  addedAt: T,
  updatedAt: T,
}

describe('copies of index.ts schemas', () => {
  it('keeps the same pin anchors', () => {
    expect([...SYNC_PIN_ANCHORS]).toEqual([...PIN_ANCHORS])
  })

  it('validates routines like Routine', () => {
    const samples = [
      routine,
      { ...routine, breakfast: null, dinner: null }, // no meal
      { ...routine, wake: '6:30' }, // not zero-padded
      { ...routine, bedtime: '24:00' },
      { ...routine, lunch: '12:00', coffee: null },
    ]
    for (const sample of samples) {
      expect(SyncRoutine.safeParse(sample).success).toBe(Routine.safeParse(sample).success)
    }
  })

  it('accepts every StackEntry as a live stack row, and keeps it', () => {
    const minimal = { productId: 'omega-3', dosesPerDay: 1, addedAt: T, updatedAt: T }
    for (const entry of [stackEntry, minimal]) {
      expect(StackEntry.safeParse(entry).success).toBe(true)
      expect(SyncStackItem.parse(entry)).toEqual({ ...entry, deletedAt: null })
    }
  })
})

describe('entities: live rows and tombstones', () => {
  it('reads a live row when deletedAt is null or left out', () => {
    const row = SyncProduct.parse(product)
    expect(row.deletedAt).toBeNull()
    expect(isSyncTombstone(row)).toBe(false)
    expect(SyncProduct.parse({ ...product, deletedAt: null })).toEqual(row)
  })

  it('reduces a tombstone to its key and timestamps', () => {
    const row = SyncProduct.parse({ ...product, deletedAt: T + 5 })
    expect(row).toEqual({ id: PRODUCT_ID, updatedAt: T, deletedAt: T + 5 })
    expect(isSyncTombstone(row)).toBe(true)
    expect(
      SyncCheck.parse({
        day: '2026-10-01',
        productId: 'iron',
        doseIndex: 0,
        updatedAt: T,
        deletedAt: T,
      }),
    ).toEqual({ day: '2026-10-01', productId: 'iron', doseIndex: 0, updatedAt: T, deletedAt: T })
  })

  it('refuses a live row with missing fields and a tombstone without a key', () => {
    expect(SyncStackItem.safeParse({ productId: 'iron', updatedAt: T }).success).toBe(false)
    expect(SyncStackItem.safeParse({ updatedAt: T, deletedAt: T }).success).toBe(false)
    expect(SyncProduct.safeParse({ ...product, id: 'iron' }).success).toBe(false)
  })

  it('never takes settings as a tombstone', () => {
    const settings = { routine, tz: 'America/Toronto', locale: 'fr', theme: 'rooted', updatedAt: T }
    expect(SyncSettings.parse(settings)).toEqual({ ...settings, deletedAt: null })
    expect(SyncSettings.parse({ ...settings, routine: null }).routine).toBeNull()
    expect(SyncSettings.safeParse({ ...settings, deletedAt: T }).success).toBe(false)
    expect(SyncSettings.safeParse({ ...settings, locale: 'de' }).success).toBe(false)
  })

  it('checks timestamps, days and dose indexes', () => {
    const check = { day: '2026-10-01', productId: 'iron', doseIndex: 3, units: 1, updatedAt: T }
    expect(SyncCheck.safeParse(check).success).toBe(true)
    expect(SyncCheck.safeParse({ ...check, doseIndex: 4 }).success).toBe(false)
    expect(SyncCheck.safeParse({ ...check, day: '2026-10-1' }).success).toBe(false)
    expect(SyncCheck.safeParse({ ...check, updatedAt: T + 0.5 }).success).toBe(false)
    expect(SyncCheck.safeParse({ ...check, updatedAt: -1 }).success).toBe(false)
    expect(syncCheckKey(check)).toBe('2026-10-01:iron:3')
  })

  it('accepts a health profile (the Worker refuses it until M8)', () => {
    const health = {
      birthYear: 1980,
      gender: 'prefer_not',
      pregnancy: null,
      conditions: ['migraine'],
      goals: ['sleep'],
      diet: [],
      avoids: [],
      activity: 'moderate',
      storageConsentAt: T,
      targetingConsentAt: null,
      updatedAt: T,
    }
    expect(SyncHealth.parse(health).deletedAt).toBeNull()
    expect(SyncHealth.parse({ updatedAt: T, deletedAt: T })).toEqual({ updatedAt: T, deletedAt: T })
  })
})

describe('request', () => {
  it('treats a missing or empty changes object as a pull', () => {
    const empty = { products: [], stack: [], shopping: [], checks: [] }
    expect(SyncRequest.parse({ since: 0 })).toEqual({ since: 0, changes: empty })
    expect(SyncRequest.parse({ since: 7, changes: {} })).toEqual({ since: 7, changes: empty })
    expect(SyncRequest.safeParse({ since: -1 }).success).toBe(false)
    expect(SyncRequest.safeParse({ since: 1.5 }).success).toBe(false)
    expect(SyncRequest.safeParse({}).success).toBe(false)
  })

  it(`allows at most ${SYNC_MAX_ROWS} rows in all`, () => {
    const checks = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        day: '2026-10-01',
        productId: `p${i}`,
        doseIndex: 0,
        units: 1,
        updatedAt: T,
      }))
    expect(SyncChanges.safeParse({ checks: checks(SYNC_MAX_ROWS) }).success).toBe(true)
    expect(SyncChanges.safeParse({ checks: checks(SYNC_MAX_ROWS + 1) }).success).toBe(false)
    const mixed = { checks: checks(SYNC_MAX_ROWS - 1), stack: [stackEntry] }
    expect(syncRowCount(mixed)).toBe(SYNC_MAX_ROWS)
    expect(SyncChanges.safeParse(mixed).success).toBe(true)
    const over = SyncChanges.safeParse({ ...mixed, settings: undefined, products: [product] })
    expect(over.success).toBe(false)
    expect(over.error?.issues[0]?.message).toBe(`at most ${SYNC_MAX_ROWS} rows per request`)
  })

  it('refuses the same key twice in one request', () => {
    const result = SyncChanges.safeParse({
      stack: [stackEntry, { productId: stackEntry.productId, updatedAt: T, deletedAt: T }],
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['stack', 1])
    expect(
      SyncChanges.safeParse({
        checks: [
          { day: '2026-10-01', productId: 'iron', doseIndex: 0, units: 1, updatedAt: T },
          { day: '2026-10-01', productId: 'iron', doseIndex: 1, units: 1, updatedAt: T },
        ],
      }).success,
    ).toBe(true)
  })

  it('counts settings and health as one row each', () => {
    expect(syncRowCount({})).toBe(0)
    expect(syncRowCount({ settings: {}, health: {}, products: [1, 2], checks: [3] })).toBe(5)
  })
})

describe('response', () => {
  it('parses what the Worker answers', () => {
    const response = {
      rev: 12,
      changes: {
        settings: null,
        products: [{ id: PRODUCT_ID, updatedAt: T, deletedAt: T }],
        stack: [{ ...stackEntry, deletedAt: null }],
        shopping: [{ productId: 'iron', reason: 'low', addedAt: T, updatedAt: T, deletedAt: null }],
        checks: [],
      },
    }
    expect(SyncResponse.parse(response)).toEqual(response)
  })
})
