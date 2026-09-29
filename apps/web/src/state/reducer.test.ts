import { describe, expect, it } from 'vitest'
import { defaultState, type PersistedState } from '../storage'
import { reducer, withPins } from './reducer'

const T = 1_759_000_000_000

const base = (): PersistedState => ({
  ...defaultState('00000000-0000-4000-8000-000000000000', T),
  stack: [
    { productId: 'magnesium-bisglycinate', dosesPerDay: 1, addedAt: T, updatedAt: T },
    // Label: 1 capsule per dose.
    { productId: 'iron-bisglycinate', dosesPerDay: 2, addedAt: T, updatedAt: T },
  ],
})

const tracked = (remaining: number, packageSize = 30): PersistedState =>
  reducer(base(), {
    type: 'SET_BOTTLE',
    productId: 'iron-bisglycinate',
    bottle: { remaining, unit: 'unit', packageSize },
    at: T,
  })

const iron = (s: PersistedState) => s.stack.find((x) => x.productId === 'iron-bisglycinate')!
const tick = (s: PersistedState, doseIndex = 0) =>
  reducer(s, {
    type: 'TOGGLE_CHECK',
    date: '2026-09-29',
    productId: 'iron-bisglycinate',
    doseIndex,
    at: T,
  })

describe('pins and suggestions', () => {
  it('adds a product pinned to bedtime from the Add flow', () => {
    const state = reducer(base(), {
      type: 'ADD_PRODUCT',
      productId: 'magnesium8',
      dosesPerDay: 2,
      pins: [null, 'bedtime'],
      at: T,
    })
    expect(state.stack.at(-1)).toEqual({
      productId: 'magnesium8',
      dosesPerDay: 2,
      pins: [null, 'bedtime'],
      addedAt: T,
      updatedAt: T,
    })
  })

  it('pins a slot and moves it back, leaving the item as it was', () => {
    const moved = reducer(base(), {
      type: 'SET_PIN',
      productId: 'magnesium-bisglycinate',
      slot: 0,
      anchor: 'bedtime',
    })
    expect(moved.stack[0]?.pins).toEqual(['bedtime'])
    const back = reducer(moved, {
      type: 'SET_PIN',
      productId: 'magnesium-bisglycinate',
      slot: 0,
      anchor: null,
    })
    expect(back.stack[0]).not.toHaveProperty('pins')
  })

  it('drops pins past the number of doses', () => {
    const pinned = withPins({ productId: 'x', dosesPerDay: 3 }, ['wake', null, 'bedtime'])
    expect(pinned).toEqual({ productId: 'x', dosesPerDay: 3, pins: ['wake', null, 'bedtime'] })
    const state = reducer(
      { ...base(), stack: [{ ...pinned, addedAt: T, updatedAt: T }] },
      { type: 'SET_DOSES', productId: 'x', dosesPerDay: 2 },
    )
    expect(state.stack[0]?.pins).toEqual(['wake'])
  })

  it('records "No thanks" once', () => {
    const action = {
      type: 'DISMISS_SUGGESTION' as const,
      productId: 'magnesium-bisglycinate',
      code: 'SUGGEST_BEDTIME',
    }
    const state = reducer(reducer(base(), action), action)
    expect(state.stack[0]?.dismissed).toEqual(['SUGGEST_BEDTIME'])
  })
})

describe('bottles', () => {
  it('ticks a dose off the bottle and gives it back on untick', () => {
    const after = tick(tracked(20))
    expect(iron(after).inventory?.remaining).toBe(19)
    expect(after.checks['2026-09-29:iron-bisglycinate:0']).toEqual({ units: 1, at: T })
    const undone = tick(after)
    expect(iron(undone).inventory?.remaining).toBe(20)
    expect(undone.checks).toEqual({})
  })

  it('never goes below zero, and an untick restores only what was taken', () => {
    const empty = tick(tracked(0))
    expect(iron(empty).inventory?.remaining).toBe(0)
    expect(empty.checks['2026-09-29:iron-bisglycinate:0']?.units).toBe(0)
    expect(iron(tick(empty)).inventory?.remaining).toBe(0)
  })

  it('records a tick without touching anything when the bottle is not tracked', () => {
    const state = tick(base())
    expect(state.checks['2026-09-29:iron-bisglycinate:0']).toEqual({ units: 0, at: T })
    expect(iron(state).inventory).toBeUndefined()
  })

  it('flags a low bottle once: shopping list, sheet, and not again on the next tick', () => {
    // 2 doses a day × 1 capsule: low at 10 left or less.
    const low = tick(tracked(11))
    expect(iron(low).inventory?.lowFlaggedAt).toBe(T)
    expect(low.shopping).toEqual([
      { productId: 'iron-bisglycinate', reason: 'low', addedAt: T, updatedAt: T },
    ])
    expect(low.lowAlerts).toEqual(['iron-bisglycinate'])
    const acked = reducer(low, { type: 'ACK_LOW_ALERT', productId: 'iron-bisglycinate' })
    const again = tick(acked, 1)
    expect(again.lowAlerts).toEqual([])
    expect(again.shopping).toHaveLength(1)
  })

  it('refills 5 + 30 = 35, clears the flag and leaves the shopping list', () => {
    const low = tick(tracked(6))
    const refilled = reducer(low, {
      type: 'REFILL',
      productId: 'iron-bisglycinate',
      added: 30,
      at: T,
    })
    expect(iron(refilled).inventory).toMatchObject({ remaining: 35, lowFlaggedAt: null })
    expect(refilled.shopping).toEqual([])
    expect(refilled.lowAlerts).toEqual([])
  })

  it('keeps the flag when a removed list item is still low, so it does not come back', () => {
    const low = tick(tracked(8))
    const removed = reducer(low, { type: 'REMOVE_FROM_SHOPPING', productId: 'iron-bisglycinate' })
    expect(removed.shopping).toEqual([])
    expect(iron(removed).inventory?.lowFlaggedAt).toBe(T)
    expect(tick(removed, 1).shopping).toEqual([])
  })

  it('clears the flag when the count is edited back above the threshold', () => {
    const low = tick(tracked(8))
    const edited = reducer(low, {
      type: 'SET_BOTTLE',
      productId: 'iron-bisglycinate',
      bottle: { remaining: 60, unit: 'unit', packageSize: 30 },
      at: T,
    })
    expect(iron(edited).inventory?.lowFlaggedAt).toBeNull()
  })

  it('puts the replaced product back when its replacement leaves the list', () => {
    const low = tick(tracked(8))
    const replaced = reducer(
      reducer(low, { type: 'REMOVE_FROM_SHOPPING', productId: 'iron-bisglycinate' }),
      {
        type: 'ADD_TO_SHOPPING',
        productId: 'heme-iron',
        reason: 'alternative',
        replacesProductId: 'iron-bisglycinate',
        at: T,
      },
    )
    const back = reducer(replaced, { type: 'REMOVE_FROM_SHOPPING', productId: 'heme-iron', at: T })
    expect(back.shopping.map((s) => [s.productId, s.reason])).toEqual([
      ['iron-bisglycinate', 'low'],
    ])
  })

  it('undoes a removal exactly', () => {
    const low = tick(tracked(8))
    const item = low.shopping[0]!
    const removed = reducer(low, { type: 'REMOVE_FROM_SHOPPING', productId: item.productId })
    expect(reducer(removed, { type: 'RESTORE_SHOPPING', item }).shopping).toEqual([item])
  })

  it('stops tracking a bottle', () => {
    const state = reducer(tracked(8), { type: 'UNTRACK_BOTTLE', productId: 'iron-bisglycinate' })
    expect(iron(state).inventory).toBeUndefined()
  })
})

describe('replacement bought', () => {
  it('retires the other brand without putting it back on the list', () => {
    let s = tick(tracked(8))
    s = reducer(s, { type: 'REMOVE_FROM_SHOPPING', productId: 'iron-bisglycinate' })
    s = reducer(s, {
      type: 'ADD_TO_SHOPPING',
      productId: 'heme-iron',
      reason: 'alternative',
      replacesProductId: 'iron-bisglycinate',
      at: T,
    })
    // "Replace": the replaced product leaves the stack, then its replacement leaves the list.
    s = reducer(s, { type: 'REMOVE_PRODUCT', productId: 'iron-bisglycinate' })
    s = reducer(s, { type: 'REMOVE_FROM_SHOPPING', productId: 'heme-iron' })
    expect(s.shopping).toEqual([])
    expect(s.stack.some((x) => x.productId === 'iron-bisglycinate')).toBe(false)
  })
})
