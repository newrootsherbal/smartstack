import { describe, expect, it } from 'vitest'
import { findDuplicateIngredients } from './duplicates'

describe('findDuplicateIngredients', () => {
  it('lists ingredients present in two or more products with daily amounts and the total', () => {
    const dupes = findDuplicateIngredients([
      { productId: 'sample-multi', dosesPerDay: 1 },
      { productId: 'sample-calmag', dosesPerDay: 1 },
      { productId: 'sample-vitamin-d3', dosesPerDay: 2 },
    ])
    expect(dupes).toEqual([
      {
        ingredientId: 'calcium',
        unit: 'mg',
        entries: [
          { productId: 'sample-multi', amountPerDose: 100, dosesPerDay: 1, dailyAmount: 100 },
          { productId: 'sample-calmag', amountPerDose: 300, dosesPerDay: 1, dailyAmount: 300 },
        ],
        total: 400,
      },
      {
        ingredientId: 'vitamin-d',
        unit: 'mcg',
        entries: [
          { productId: 'sample-multi', amountPerDose: 10, dosesPerDay: 1, dailyAmount: 10 },
          { productId: 'sample-vitamin-d3', amountPerDose: 25, dosesPerDay: 2, dailyAmount: 50 },
        ],
        total: 60,
      },
    ])
  })

  it('triggers on product count alone, never on amount', () => {
    expect(findDuplicateIngredients([{ productId: 'sample-vitamin-c', dosesPerDay: 4 }])).toEqual(
      [],
    )
    expect(
      findDuplicateIngredients([
        { productId: 'sample-vitamin-c', dosesPerDay: 1 },
        { productId: 'sample-multi', dosesPerDay: 1 },
      ]).map((d) => d.ingredientId),
    ).toEqual(['vitamin-c'])
  })

  it('returns nothing for an empty stack', () => {
    expect(findDuplicateIngredients([])).toEqual([])
  })
})
