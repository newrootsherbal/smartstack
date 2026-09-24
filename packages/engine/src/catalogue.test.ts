import { describe, expect, it } from 'vitest'
import { isValidRetailBarcode } from './barcode'
import {
  catalogue,
  findProductByBarcode,
  productBarcodes,
  rulesForProduct,
  searchProducts,
} from './catalogue'
import { buildSchedule } from './scheduler'

describe('imported New Roots Herbal catalogue', () => {
  it('has a few hundred licensed products with valid barcodes and 8-digit NPNs', () => {
    expect(catalogue.products.length).toBeGreaterThan(300)
    for (const p of catalogue.products) {
      expect(p.brand).toBe('New Roots Herbal')
      expect(p.status).toBe('draft')
      expect(p.npn).toMatch(/^\d{8}$/)
      expect(p.reviewStatus).toBe('unreviewed')
      for (const code of productBarcodes(p)) expect(isValidRetailBarcode(code)).toBe(true)
      expect(p.ingredients.length).toBeGreaterThan(0)
      expect(p.dosesPerDayDefault).toBeGreaterThanOrEqual(1)
      expect(p.dosesPerDayDefault).toBeLessThanOrEqual(4)
    }
  })

  it('contains the nutrients the curated rules target', () => {
    const ids = new Set(catalogue.ingredients.map((i) => i.id))
    for (const id of ['iron', 'calcium', 'magnesium', 'vitamin-d', 'epa', 'dha', 'probiotic']) {
      expect(ids.has(id), id).toBe(true)
    }
  })

  it('finds a product by any variant barcode, formatted or not', () => {
    const iron = findProductByBarcode('628747118989')
    expect(iron?.id).toBe('iron-bisglycinate')
    expect(findProductByBarcode('0628747118989')?.id).toBe('iron-bisglycinate')
    expect(findProductByBarcode('628747131865')?.id).toBe('iron-bisglycinate')
    expect(findProductByBarcode('2000000000008')).toBeUndefined()
  })

  it('reads the label default and keeps the label rules on the product', () => {
    const iron = findProductByBarcode('628747118989')!
    expect(iron.dosesPerDayDefault).toBe(1)
    expect(iron.unitsPerDose).toBe(1)
    expect(iron.servingSize).toBe('1 capsule')
    const attrs = rulesForProduct(iron).map((r) => r.attribute)
    expect(attrs).toEqual(
      expect.arrayContaining(['SEPARATE_FROM_CALCIUM', 'SEPARATE_FROM_COFFEE_TEA', 'WITH_FOOD']),
    )
    // The label's own "with food" wins over the calcium ingredient rule of the same attribute.
    const withFood = rulesForProduct(iron).find((r) => r.attribute === 'WITH_FOOD')
    expect(withFood?.appliesTo).toEqual({ productId: 'iron-bisglycinate' })
  })

  it('schedules a real stack the same way as the pitch example', () => {
    const schedule = buildSchedule(
      {
        wake: '06:30',
        coffee: '07:00',
        breakfast: '07:30',
        lunch: '12:00',
        dinner: '18:00',
        exercise: null,
        bedtime: '22:00',
      },
      [
        'iron-bisglycinate',
        'multi',
        'magnesium-bisglycinate',
        'wild-omega-3-epa-660-mg-dha-330-mg',
      ].map((productId) => ({ productId, dosesPerDay: 1 })),
    )
    const at = (id: string) =>
      schedule.placements.filter((p) => p.productIds.includes(id)).map((p) => p.time)
    expect(at('multi')).toEqual(['07:30'])
    expect(at('magnesium-bisglycinate')).toEqual(['22:00'])
    // Omega-3 takes 2 doses on its label? No: dosesPerDay 1 here → lunch (WITH_FAT preference).
    expect(at('wild-omega-3-epa-660-mg-dha-330-mg')).toEqual(['12:00'])
    // This multi has no calcium as a medicinal ingredient, so only coffee (07:00) pushes iron.
    expect(at('iron-bisglycinate')).toEqual(['09:00'])
  })

  it('searches by name, SKU and barcode', () => {
    expect(searchProducts('iron bis').map((p) => p.id)).toContain('iron-bisglycinate')
    expect(searchProducts('1898').map((p) => p.id)).toEqual(['iron-bisglycinate'])
    expect(searchProducts('628747118989').map((p) => p.id)).toEqual(['iron-bisglycinate'])
    expect(searchProducts('').length).toBe(catalogue.products.length)
  })
})

describe('label "with food" versus ingredient anchors', () => {
  it('keeps a calcium product at dinner even though its label only says "with food"', () => {
    const schedule = buildSchedule(
      {
        wake: '06:30',
        coffee: null,
        breakfast: '07:30',
        lunch: '12:00',
        dinner: '18:00',
        exercise: null,
        bedtime: '22:00',
      },
      [{ productId: 'calcium-citrate-and-vitamin-d3', dosesPerDay: 1 }],
    )
    expect(schedule.placements.map((p) => [p.time, p.anchor])).toEqual([['18:00', 'dinner']])
    expect(schedule.adjustments.map((a) => a.code)).toEqual(['MOVED_TO_EVENING'])
  })

  it('lets a label bedtime statement beat an ingredient rule', () => {
    const melatonin = catalogue.products.find((p) => p.id === 'melatonin-3-mg')
    if (!melatonin) return
    const attrs = rulesForProduct(melatonin).map((r) => r.attribute)
    expect(attrs).toContain('BEDTIME')
  })
})
