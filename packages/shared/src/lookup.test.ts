import { describe, expect, it } from 'vitest'
import { CuratedAlternative, LookupNumber, ProductPrefill } from './index'

describe('ProductPrefill', () => {
  const prefill = {
    source: 'lnhpd',
    npn: '80000001',
    din: null,
    name: 'Flax Seed Oil 1000 mg',
    brand: 'Wampole Group L.P.',
    form: 'capsule',
    strength: null,
    dose: { amount: 1, unit: 'capsule', frequency: 1 },
    ingredients: [{ name: 'Linum usitatissimum L. subsp. sativa', amount: 1000, unit: 'mg' }],
    partial: false,
  }

  it('accepts a prefill and its partial forms', () => {
    expect(ProductPrefill.safeParse(prefill).success).toBe(true)
    expect(
      ProductPrefill.safeParse({ ...prefill, dose: null, ingredients: [], partial: true }).success,
    ).toBe(true)
    expect(
      ProductPrefill.safeParse({
        ...prefill,
        dose: { amount: 0.5, unit: 'teaspoon', frequency: null },
      }).success,
    ).toBe(true)
  })

  it('refuses what the form cannot take', () => {
    expect(ProductPrefill.safeParse({ ...prefill, npn: '8000001' }).success).toBe(false)
    expect(
      ProductPrefill.safeParse({ ...prefill, dose: { amount: 1, unit: 'capsule', frequency: 5 } })
        .success,
    ).toBe(false)
    expect(
      ProductPrefill.safeParse({ ...prefill, dose: { amount: 1, unit: 'pill', frequency: 1 } })
        .success,
    ).toBe(false)
    expect(ProductPrefill.safeParse({ ...prefill, name: 'x'.repeat(121) }).success).toBe(false)
  })

  it('checks the NPN / DIN route parameter', () => {
    expect(LookupNumber.safeParse('02172062').success).toBe(true)
    expect(LookupNumber.safeParse('2172062').success).toBe(false)
  })
})

describe('CuratedAlternative', () => {
  const review = { reviewStatus: 'unreviewed', lastReviewed: null, reviewedBy: null }

  it('matches on a barcode or on brand and name, never both or neither', () => {
    const ok = (match: object) =>
      CuratedAlternative.safeParse({ match, productId: 'magnesium8', ...review }).success
    expect(ok({ upc: '96385074' })).toBe(true)
    expect(ok({ brand: 'Example Brand', name: 'Magnesium' })).toBe(true)
    expect(ok({ upc: '96385074', brand: 'Example Brand', name: 'Magnesium' })).toBe(false)
    expect(ok({ brand: 'Example Brand' })).toBe(false)
    expect(ok({ upc: '123' })).toBe(false)
  })
})
