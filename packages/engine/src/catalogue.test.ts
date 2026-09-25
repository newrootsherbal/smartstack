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
  it('has a few hundred products with valid barcodes; licensed ones carry an 8-digit NPN', () => {
    // Only a real collapse should trip this; the importer already refuses a >10% shrink.
    expect(catalogue.products.length).toBeGreaterThan(300)
    expect(catalogue.products.filter((p) => p.ingredients.length > 0).length).toBeGreaterThan(300)
    for (const p of catalogue.products) {
      expect(p.brand).toBe('New Roots Herbal')
      expect(p.status).toBe('draft')
      if (p.kind === 'nhp' || p.npn !== undefined) expect(p.npn, p.id).toMatch(/^\d{8}$/)
      expect(p.reviewStatus).toBe('unreviewed')
      for (const code of productBarcodes(p)) expect(isValidRetailBarcode(code)).toBe(true)
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
    // Accent-insensitive: French names carry diacritics the user may not type, and vice versa.
    expect(searchProducts('echinacee').map((p) => p.id)).toContain('echinacea')
    expect(searchProducts('Échinacée').map((p) => p.id)).toContain('echinacea')
    expect(searchProducts('fer (dig').map((p) => p.id)).toContain('iron-bisglycinate')
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

describe('magnesium products', () => {
  it('all magnesium products carry the bedtime rule and land at bedtime', () => {
    const mags = catalogue.products.filter((p) => /magnes/i.test(p.name.en))
    expect(mags.length).toBeGreaterThan(4)
    for (const p of mags) {
      expect(
        p.ingredients.map((i) => i.ingredientId),
        p.id,
      ).toContain('magnesium')
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
        [{ productId: p.id, dosesPerDay: 1 }],
      )
      expect(schedule.placements[0]?.anchor, p.id).toBe('bedtime')
    }
  })
})

describe('foods and topicals', () => {
  const byId = (id: string) => catalogue.products.find((p) => p.id === id)
  const ingredientIds = (id: string) => byId(id)?.ingredients.map((i) => i.ingredientId) ?? []

  it('scans a food product that has no NPN', () => {
    const broth = findProductByBarcode('628747022934')
    expect(broth?.id).toBe('beef-bone-broth-protein')
    expect(broth?.kind).toBe('food')
    expect(broth?.npn).toBeUndefined()
    // A Nutrition Facts table lists macronutrients, not medicinal ingredients.
    expect(broth?.ingredients).toEqual([])
    expect(broth?.servingSize).toBe('3 rounded tbsp. (30 g)')
  })

  it('marks essential and skin oils, rubs and liniments as topical, licensed or not', () => {
    const oils = catalogue.products.filter((p) => /essential oil/i.test(p.name.en))
    expect(oils.length).toBeGreaterThan(10)
    for (const p of oils) expect(p.kind, p.id).toBe('topical')
    for (const id of ['argan-oil', 'rosehip-seed-oil', 'body-muscle-massage', 'dmso-liquid']) {
      expect(byId(id)?.kind, id).toBe('topical')
    }
    expect(byId('lavender-essential-oil')?.npn).toMatch(/^\d{8}$/)
  })

  it('does not mistake ingested beauty products for topicals', () => {
    for (const id of ['multi-5-collagen', 'biotin', 'silica', 'pur-collagen-radiant-skin']) {
      expect(byId(id)?.kind, id).not.toBe('topical')
    }
  })

  it('reads standardized extracts, unclosed parentheses and "contains … of" labels', () => {
    expect(ingredientIds('wild-omega-3-epa-900-mg-dha-600-mg-lemon-flavour')).toEqual(
      expect.arrayContaining(['epa', 'dha']),
    )
    for (const id of [
      'reishi',
      'lions-mane',
      'cordyceps-militaris',
      'panax-ginseng',
      'saffron-zen',
    ]) {
      expect(ingredientIds(id).length, id).toBeGreaterThan(0)
    }
    expect(ingredientIds('vitamin-c-crystals')).toEqual(['vitamin-c'])
    expect(ingredientIds('beta-carotene')[0]).toMatch(/^vitamin-a/)
  })
})
