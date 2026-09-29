import { describe, expect, it } from 'vitest'
import { Product, SHARED_VERSION } from './index'

describe('@smartstack/shared', () => {
  it('exports a version', () => {
    expect(SHARED_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('Product schema', () => {
  const base = {
    id: 'u_00000000-0000-4000-8000-000000000001',
    brand: '',
    name: { en: 'My medication' },
    shortName: { en: 'My medication' },
    form: 'tablet',
    servingSize: '1 tablet',
    dosesPerDayDefault: 1,
    status: 'user',
    ingredients: [],
    reviewStatus: 'unreviewed',
    lastReviewed: null,
    reviewedBy: null,
  }

  it('accepts a user product without sku, upc or label version (validateCatalogue requires them for bundled data)', () => {
    expect(Product.safeParse({ ...base, kind: 'medication' }).success).toBe(true)
    expect(Product.safeParse({ ...base, kind: 'nhp', upc: '96385074' }).success).toBe(true)
  })

  it('still checks the barcode shape when there is one', () => {
    expect(Product.safeParse({ ...base, upc: '1234' }).success).toBe(false)
    expect(Product.safeParse({ ...base, kind: 'pill' }).success).toBe(false)
  })
})
