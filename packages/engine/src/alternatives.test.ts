import type { CuratedAlternative, Product } from '@smartstack/shared'
import { describe, expect, it } from 'vitest'
import alternativesJson from '../data/alternatives.json'
import { servingsPerDose, suggestAlternatives } from './alternatives'
import { catalogue, curatedAlternatives, getProduct } from './catalogue'
import { row, userProduct } from './user-product.fixture'
import { mergeCatalogue } from './user-products'
import { validateAlternatives } from './validate'

// Hypothetical other-brand products ("Example Brand"); the New Roots Herbal facts they are
// compared with are read from data/products.json.
const magnesium = userProduct({
  name: 'Magnesium Bisglycinate 200 mg',
  ingredients: [row('Magnesium (as bisglycinate)', 200, 'mg')],
})
const vitaminD = userProduct({
  name: 'Vitamin D3 1000 IU',
  form: 'softgel',
  doseUnit: 'softgel',
  ingredients: [row('Vitamin D3', 1000, 'IU')],
})
const fishOil = userProduct({
  name: 'Omega-3 EPA DHA',
  form: 'softgel',
  doseUnit: 'softgel',
  unitsPerDose: 2,
  ingredients: [
    row('Fish oil', 1000, 'mg'),
    row('EPA (eicosapentaenoic acid)', 400, 'mg'),
    row('DHA (docosahexaenoic acid)', 200, 'mg'),
  ],
})
const herbalBlend = userProduct({
  name: 'Calm Herbal Blend',
  ingredients: [row('Passionflower herb', 250, 'mg'), row('Proprietary herbal blend', 300, 'mg')],
})

const suggest = (
  up: Parameters<typeof suggestAlternatives>[0],
  curated: CuratedAlternative[] = [],
  stack: string[] = [],
) =>
  suggestAlternatives(
    up,
    catalogue,
    curated,
    stack.map((productId) => ({ productId })),
  )
const ids = (list: { productId: string }[]) => list.map((a) => a.productId)

const reviewed = { reviewStatus: 'unreviewed', lastReviewed: null, reviewedBy: null } as const

describe('suggestAlternatives — computed (§13 fixtures)', () => {
  it('suggests Magnesium Bisglycinate (Capsules) first for another brand’s magnesium bisglycinate 200 mg', () => {
    const result = suggest(magnesium)
    expect(result.length).toBeLessThanOrEqual(2)
    expect(result[0]).toEqual({
      productId: 'magnesium-bisglycinate-capsules',
      source: 'computed',
      score: 1,
      facts: [
        {
          ingredientId: 'magnesium',
          unit: 'mg',
          amount: 200,
          serving: '1 capsule',
          dailyAmount: 200,
          userDailyAmount: 200,
        },
      ],
    })
  })

  it('suggests a New Roots Herbal vitamin D3 for a D3 1000 IU, the same form first', () => {
    const result = suggest(vitaminD)
    expect(ids(result)[0]).toBe('vitamin-d3-1000-iu-per-softgel')
    for (const alternative of result) {
      expect(getProduct(alternative.productId)?.name.en).toMatch(/Vitamin D3/)
      expect(alternative.facts[0]).toMatchObject({ ingredientId: 'vitamin-d', amount: 25 })
    }
  })

  it('suggests Wild Omega-3 for an EPA/DHA fish oil', () => {
    const result = suggest(fishOil)
    expect(result).toHaveLength(2)
    for (const id of ids(result)) expect(id).toMatch(/^wild-omega-3-/)
    expect(result[0]!.facts.map((f) => [f.ingredientId, f.userDailyAmount])).toEqual([
      ['fish-oil', 2000],
      ['epa', 800],
      ['dha', 400],
    ])
  })

  it('suggests nothing for a herbal blend without a canonical ingredient', () => {
    expect(suggest(herbalBlend)).toEqual([])
  })

  it('excludes products already in the stack', () => {
    const result = suggest(magnesium, [], ['magnesium-bisglycinate-capsules'])
    expect(ids(result)).not.toContain('magnesium-bisglycinate-capsules')
    expect(result.length).toBeGreaterThan(0)
  })

  it('never suggests anything for a medication', () => {
    const medication = { ...magnesium, productType: 'medication' as const }
    expect(suggest(medication)).toEqual([])
    const curated: CuratedAlternative = {
      match: { brand: 'Example Brand', name: 'Magnesium' },
      productId: 'magnesium8',
      ...reviewed,
    }
    expect(suggest(medication, [curated])).toEqual([])
  })

  it('keeps only matches scoring 0.5 or more, sharing an ingredient, best first', () => {
    for (const up of [magnesium, vitaminD, fishOil]) {
      const result = suggest(up)
      for (const a of result) {
        expect(a.score).toBeGreaterThanOrEqual(0.5)
        expect(a.facts.length).toBeGreaterThan(0)
      }
      const scores = result.map((a) => a.score!)
      expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    }
  })

  it('only suggests catalogue products of kind nhp or food, never the person’s own', () => {
    const other = userProduct({
      name: 'Magnesium Bisglycinate 200 mg (spare)',
      ingredients: magnesium.ingredients,
    })
    const merged = mergeCatalogue(catalogue, [other])
    const result = suggestAlternatives(magnesium, merged, [], [])
    expect(ids(result)).not.toContain(other.id)
    for (const id of ids(result)) expect(['nhp', 'food']).toContain(getProduct(id, merged)?.kind)
  })
})

describe('suggestAlternatives — curated first', () => {
  it('matches brand and name case- and accent-insensitively, the name as "contains"', () => {
    const up = userProduct({
      brand: 'Éxample  brand',
      name: 'Magnésium Bisglycinate 200 mg, extra',
      ingredients: magnesium.ingredients,
    })
    const curated: CuratedAlternative = {
      match: { brand: 'example brand', name: 'MAGNESIUM bisglycinate' },
      productId: 'magnesium8',
      ...reviewed,
    }
    const result = suggest(up, [curated])
    expect(result[0]).toMatchObject({ productId: 'magnesium8', source: 'curated', score: null })
    expect(result[0]!.facts[0]).toMatchObject({ ingredientId: 'magnesium', amount: 105 })
    // The computed best match fills the second place.
    expect(result[1]).toMatchObject({
      productId: 'magnesium-bisglycinate-capsules',
      source: 'computed',
    })
  })

  it('matches a barcode, skips entries for other products, the stack and duplicates', () => {
    const up = userProduct({ upc: '96385074', ingredients: magnesium.ingredients })
    const entry = (match: CuratedAlternative['match'], productId: string): CuratedAlternative => ({
      match,
      productId,
      ...reviewed,
    })
    const result = suggest(
      up,
      [
        entry({ upc: '12345670' }, 'magnesium8'),
        entry({ upc: '96385074' }, 'magnesium-bisglycinate-capsules'),
        entry({ upc: '96385074' }, 'magnesium-bisglycinate-capsules'),
        entry({ upc: '96385074' }, 'argan-oil'),
        entry({ brand: 'Example Brand', name: 'Magnesium' }, 'magnesium8'),
      ],
      ['magnesium8'],
    )
    expect(result.map((a) => [a.productId, a.source])).toEqual([
      ['magnesium-bisglycinate-capsules', 'curated'],
      ['pure-magnesium-bisglycinate-130-mg-elemental-magnesium', 'computed'],
    ])
  })

  it('offers a curated product even when no ingredient could be compared', () => {
    const curated: CuratedAlternative = {
      match: { brand: 'Example Brand', name: 'Calm' },
      productId: 'magnesium8',
      ...reviewed,
    }
    expect(suggest(herbalBlend, [curated])).toEqual([
      { productId: 'magnesium8', source: 'curated', score: null, facts: [] },
    ])
  })
})

describe('servingsPerDose', () => {
  const product = (servingSize: string, unitsPerDose?: number, unitLabel?: string) =>
    ({ servingSize, unitsPerDose, unitLabel }) as Product

  it('reads how many label servings one dose takes', () => {
    expect(servingsPerDose(product('1 capsule', 2, 'capsule'))).toBe(2)
    expect(servingsPerDose(product('6 vegetable capsules', 2, 'capsule'))).toBeCloseTo(1 / 3)
    expect(servingsPerDose(product('½ teaspoon', 0.5, 'teaspoon'))).toBe(1)
    expect(servingsPerDose(product('1-scoop serving', 1, 'scoop'))).toBe(1)
  })

  it('counts one serving per dose when the units differ or are unknown', () => {
    expect(servingsPerDose(product('1 ml (40 drops)', 20, 'drop'))).toBe(1)
    expect(servingsPerDose(product('3 rounded tbsp. (30 g)'))).toBe(1)
  })
})

describe('validateAlternatives', () => {
  const entry = (overrides: object = {}) => ({
    match: { brand: 'Example Brand', name: 'Magnesium' },
    productId: 'magnesium-bisglycinate-capsules',
    ...reviewed,
    ...overrides,
  })
  const errors = (raw: unknown) => {
    const result = validateAlternatives(raw, catalogue)
    return result.ok ? [] : result.errors
  }

  it('accepts the bundled file (empty until the product team fills it) and good entries', () => {
    expect(errors(alternativesJson)).toEqual([])
    expect(curatedAlternatives).toEqual(alternativesJson)
    expect(
      errors([
        entry(),
        entry({ match: { upc: '96385074' } }),
        entry({
          match: { upc: '012345678905' },
          reviewStatus: 'reviewed',
          lastReviewed: '2026-10-01',
          reviewedBy: 'Product team',
        }),
      ]),
    ).toEqual([])
  })

  it('refuses unknown or topical products', () => {
    expect(errors([entry({ productId: 'nope' })])).toEqual([
      'alternatives[0]: unknown product nope',
    ])
    expect(errors([entry({ productId: 'argan-oil' })])).toEqual([
      'alternatives[0]: argan-oil is topical and cannot be suggested',
    ])
  })

  it('refuses inconsistent review fields, bad barcodes, blanks and repeats', () => {
    expect(errors([entry({ reviewedBy: 'Someone' })])).toEqual([
      'alternatives[0]: unreviewed items must have reviewedBy null',
    ])
    expect(errors([entry({ reviewStatus: 'reviewed' })])).toEqual([
      'alternatives[0]: reviewed items need lastReviewed',
      'alternatives[0]: reviewed items need reviewedBy',
    ])
    expect(errors([entry({ match: { upc: '96385075' } })])).toEqual([
      'alternatives[0]: barcode 96385075 has a bad check digit',
    ])
    expect(errors([entry({ match: { brand: ' ', name: 'x' } })])).toEqual([
      'alternatives[0]: brand and name must not be blank',
    ])
    expect(errors([entry(), entry()])).toEqual(['alternatives[1]: listed twice'])
  })

  it('refuses a malformed file', () => {
    expect(errors({})[0]).toMatch(/^alternatives\.<root>:/)
    expect(errors([{ match: { upc: '1' }, productId: 'x', ...reviewed }])[0]).toMatch(
      /^alternatives\.0\.match/,
    )
  })
})
