import { describe, expect, it } from 'vitest'
import { defaultState } from '../storage'
import { reducer, withPins } from './reducer'

const base = () => ({
  ...defaultState('00000000-0000-4000-8000-000000000000'),
  stack: [{ productId: 'magnesium-bisglycinate', dosesPerDay: 1 }],
})

describe('pins and suggestions', () => {
  it('adds a product pinned to bedtime from the Add flow', () => {
    const state = reducer(base(), {
      type: 'ADD_PRODUCT',
      productId: 'magnesium8',
      dosesPerDay: 2,
      pins: [null, 'bedtime'],
    })
    expect(state.stack.at(-1)).toEqual({
      productId: 'magnesium8',
      dosesPerDay: 2,
      pins: [null, 'bedtime'],
    })
  })

  it('pins a slot and moves it back, leaving the item as it was', () => {
    const moved = reducer(base(), {
      type: 'SET_PIN',
      productId: 'magnesium-bisglycinate',
      slot: 0,
      anchor: 'bedtime',
    })
    expect(moved.stack[0]).toEqual({
      productId: 'magnesium-bisglycinate',
      dosesPerDay: 1,
      pins: ['bedtime'],
    })
    const back = reducer(moved, {
      type: 'SET_PIN',
      productId: 'magnesium-bisglycinate',
      slot: 0,
      anchor: null,
    })
    expect(back.stack[0]).toEqual({ productId: 'magnesium-bisglycinate', dosesPerDay: 1 })
  })

  it('drops pins past the number of doses', () => {
    const pinned = withPins({ productId: 'x', dosesPerDay: 3 }, ['wake', null, 'bedtime'])
    const state = reducer(
      { ...base(), stack: [pinned] },
      { type: 'SET_DOSES', productId: 'x', dosesPerDay: 2 },
    )
    expect(state.stack[0]).toEqual({ productId: 'x', dosesPerDay: 2, pins: ['wake'] })
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
