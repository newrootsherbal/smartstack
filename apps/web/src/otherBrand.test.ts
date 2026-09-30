import { catalogue } from '@smartstack/engine'
import type { ProductPrefill } from '@smartstack/shared'
import { describe, expect, it } from 'vitest'
import {
  applyPrefill,
  draftToUserProduct,
  emptyDraft,
  userPackageSize,
  userProductToDraft,
  validateDraft,
} from './otherBrand'

const T = 1_759_000_000_000
const ID = 'u_0f8fad5b-d9cb-469f-a165-70867728950e'

const magnesium = {
  ...emptyDraft('nhp'),
  brand: 'Other Brand',
  name: 'Magnesium Bisglycinate 200 mg',
  form: 'capsule' as const,
  packageQuantity: '120',
  doseUnit: 'capsule' as const,
  amountPerDose: '2',
  dosesPerDay: 1,
  timing: ['WITH_FOOD' as const],
  ingredients: [
    { name: 'Magnesium', amount: '100', unit: 'mg' as const },
    { name: 'Secret herbal blend', amount: '', unit: '' as const },
  ],
}

describe('validateDraft', () => {
  it('requires brand, name, form, bottle size and dose', () => {
    expect(validateDraft(emptyDraft('nhp'))).toEqual([
      'brand',
      'name',
      'form',
      'packageQuantity',
      'doseUnit',
    ])
    expect(validateDraft(magnesium)).toEqual([])
  })

  it('checks barcodes, NPNs and DINs when given', () => {
    expect(validateDraft({ ...magnesium, upc: '628747118989' })).toEqual([])
    expect(validateDraft({ ...magnesium, upc: '628747118988' })).toEqual(['upc'])
    expect(validateDraft({ ...magnesium, npn: '1234' })).toEqual(['npn'])
    expect(validateDraft({ ...magnesium, npn: '80000001' })).toEqual([])
  })

  it('asks a medication when each dose is taken, not its brand or bottle', () => {
    const med = {
      ...emptyDraft('medication'),
      name: 'Levothyroxine',
      form: 'tablet' as const,
      doseUnit: 'tablet' as const,
      din: '02172062',
    }
    expect(validateDraft(med)).toEqual(['times'])
    expect(validateDraft({ ...med, times: ['wake'] })).toEqual([])
  })
})

describe('draftToUserProduct', () => {
  it('stores what the form says, recognizing canonical ingredients', () => {
    const up = draftToUserProduct(magnesium, ID, T, catalogue)
    expect(up).toMatchObject({
      id: ID,
      productType: 'nhp',
      brand: 'Other Brand',
      form: 'capsule',
      doseUnit: 'capsule',
      unitsPerDose: 2,
      dosesPerDay: 1,
      packageQuantity: 120,
      packageUnit: 'unit',
      timing: ['WITH_FOOD'],
      createdAt: T,
      updatedAt: T,
    })
    expect(up.ingredients[0]).toEqual({
      ingredientId: 'magnesium',
      name: 'Magnesium',
      amount: 100,
      unit: 'mg',
    })
    expect(up.ingredients[1]).toEqual({
      ingredientId: null,
      name: 'Secret herbal blend',
      amount: null,
      unit: null,
    })
  })

  it('round-trips through the edit form', () => {
    const up = draftToUserProduct(magnesium, ID, T, catalogue)
    const again = draftToUserProduct(userProductToDraft(up), ID, T + 1, catalogue, up.createdAt)
    expect(again).toEqual({ ...up, updatedAt: T + 1 })
  })

  it('never gives a medication label rules', () => {
    const up = draftToUserProduct(
      { ...magnesium, type: 'medication', times: ['bedtime'] },
      ID,
      T,
      catalogue,
    )
    expect(up.timing).toEqual([])
    expect(up.npn).toBeNull()
  })
})

describe('applyPrefill', () => {
  const din: ProductPrefill = {
    source: 'dpd',
    npn: null,
    din: '02172062',
    name: 'SYNTHROID',
    brand: 'BGP PHARMA ULC',
    form: 'tablet',
    strength: '25 mcg',
    dose: null,
    ingredients: [{ name: 'LEVOTHYROXINE SODIUM', amount: 25, unit: 'mcg' }],
    partial: false,
  }

  it('fills what Health Canada knows and leaves the rest', () => {
    const d = applyPrefill({ ...emptyDraft('medication'), din: '02172062' }, din)
    expect(d).toMatchObject({
      name: 'Synthroid',
      brand: 'BGP PHARMA ULC',
      doseUnit: 'tablet',
      form: 'tablet',
      strength: '25 mcg',
      amountPerDose: '1',
      ingredients: [{ name: 'Levothyroxine Sodium', amount: '25', unit: 'mcg' }],
    })
  })

  it('takes the licensed dose of a natural health product', () => {
    const d = applyPrefill(emptyDraft('nhp'), {
      ...din,
      source: 'lnhpd',
      din: null,
      npn: '80000001',
      name: 'Flax Oil',
      dose: { amount: 2, unit: 'softgel', frequency: 3 },
      strength: null,
    })
    expect([d.amountPerDose, d.doseUnit, d.dosesPerDay, d.times.length]).toEqual([
      '2',
      'softgel',
      3,
      3,
    ])
  })
})

describe('userPackageSize', () => {
  const base = draftToUserProduct(magnesium, ID, T, catalogue)

  it('counts capsules one by one', () => {
    expect(userPackageSize(base)).toEqual({ quantity: 120, unit: 'unit' })
  })

  it('counts a liquid in servings when the dose is in the same unit', () => {
    const liquid = {
      ...base,
      form: 'liquid' as const,
      packageQuantity: 250,
      packageUnit: 'ml' as const,
      doseUnit: 'ml',
      unitsPerDose: 15,
    }
    expect(userPackageSize(liquid)).toEqual({ quantity: 16.6, unit: 'serving' })
    expect(userPackageSize({ ...liquid, doseUnit: 'drop' })).toBeNull()
  })
})
