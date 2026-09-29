import { ProductPrefill } from '@smartstack/shared'
import { describe, expect, it } from 'vitest'
import { THROTTLE, throttleKey } from '../auth/throttle'
import dinSynthroidEn from './fixtures/din-02172062-en.json'
import dinSynthroidFr from './fixtures/din-02172062-fr.json'
import dinIronEn from './fixtures/din-02230276-en.json'
import dinIronFr from './fixtures/din-02230276-fr.json'
import npnFlaxEn from './fixtures/npn-80000001-en.json'
import npnFlaxFr from './fixtures/npn-80000001-fr.json'
import npnOmegaEn from './fixtures/npn-80077104-en.json'
import npnOmegaFr from './fixtures/npn-80077104-fr.json'
import npnMagnesiumEn from './fixtures/npn-80085063-en.json'
import npnMagnesiumFr from './fixtures/npn-80085063-fr.json'
import npnProbioticEn from './fixtures/npn-80086910-en.json'
import npnVitaminDEn from './fixtures/npn-80103409-en.json'
import npnVitaminDFr from './fixtures/npn-80103409-fr.json'
import {
  hcCacheKey,
  hcCacheSeconds,
  hcUrls,
  HC_CACHE_SECONDS,
  HC_EMPTY_CACHE_SECONDS,
  isLookupNumber,
  isPerDay,
  mapAmount,
  mapDinPrefill,
  mapDoseUnit,
  mapForm,
  mapNpnPrefill,
  parseLookupLang,
} from './health-canada'

// Real Health Canada answers saved on 2026-09-29 (see each fixture's _urls).
type NpnFixture = { licence: unknown; ingredients: unknown; dose: unknown }
type DinFixture = { product: unknown; ingredients: unknown; form: unknown }
const npn = (number: string, f: NpnFixture) =>
  mapNpnPrefill(number, f.licence, f.ingredients, f.dose)
const din = (number: string, f: DinFixture) =>
  mapDinPrefill(number, f.product, f.ingredients, f.form)

describe('NPN prefill (LNHPD fixtures)', () => {
  it('maps an other-brand licence (NPN 80000001), EN and FR', () => {
    const expected = {
      source: 'lnhpd',
      npn: '80000001',
      din: null,
      name: 'Flax Seed Oil 1000 mg',
      brand: 'Wampole Group L.P.',
      form: 'capsule',
      strength: null,
      // Licensed "1 each, daily": one of the product's own units.
      dose: { amount: 1, unit: 'capsule', frequency: 1 },
      ingredients: [{ name: 'Linum usitatissimum L. subsp. sativa', amount: 1000, unit: 'mg' }],
      partial: false,
    }
    expect(npn('80000001', npnFlaxEn)).toEqual(expected)
    // "milligramme" is mg too.
    expect(npn('80000001', npnFlaxFr)).toEqual(expected)
  })

  it('names ingredients in the requested language', () => {
    expect(npn('80085063', npnMagnesiumEn)).toMatchObject({
      name: 'Magnesium Bisglycinate 200 mg',
      brand: 'New Roots Herbal Inc.',
      form: 'capsule',
      dose: { amount: 1, unit: 'capsule', frequency: 1 },
      ingredients: [{ name: 'Magnesium', amount: 200, unit: 'mg' }],
    })
    expect(npn('80085063', npnMagnesiumFr)).toMatchObject({
      dose: { amount: 1, unit: 'capsule', frequency: 1 }, // "Capsule", "Tous les jours"
      ingredients: [{ name: 'Magnésium', amount: 200, unit: 'mg' }],
    })
  })

  it('adds potency constituents and keeps a row repeated for another source once', () => {
    const ingredients = [
      { name: 'Fish oil', amount: 750, unit: 'mg' },
      { name: 'EPA', amount: 333, unit: 'mg' },
      { name: 'DHA', amount: 165, unit: 'mg' },
    ]
    expect(npn('80077104', npnOmegaEn)).toMatchObject({
      form: 'softgel', // "Capsule, soft"
      dose: { amount: 2, unit: 'softgel', frequency: 2 }, // the adults' row
      ingredients,
    })
    expect(npn('80077104', npnOmegaFr)?.ingredients).toEqual([
      { name: 'Huile de poisson', amount: 750, unit: 'mg' },
      ...ingredients.slice(1),
    ])
  })

  it('keeps an amount restated in another unit once, and reads a softgel dose licensed in capsules', () => {
    expect(npn('80103409', npnVitaminDEn)).toMatchObject({
      name: 'Vitamin D Softgel',
      form: 'softgel',
      dose: { amount: 1, unit: 'softgel', frequency: 1 }, // adults: "capsule", "Day"
      ingredients: [{ name: 'Vitamin D', amount: 1000, unit: 'IU' }],
    })
    expect(npn('80103409', npnVitaminDFr)?.ingredients).toEqual([
      { name: 'Vitamine D', amount: 1000, unit: 'IU' },
    ])
  })

  it('reads CFU counts, the primary product name and the low end of a dose range', () => {
    expect(npn('80086910', npnProbioticEn)).toMatchObject({
      name: 'Acidophilus 15 billion',
      form: 'capsule', // "Capsule (enteric coated)"
      dose: { amount: 1, unit: 'capsule', frequency: 1 }, // 1 to 2 capsules
      ingredients: [
        { name: 'Lactobacillus delbrueckii subsp. bulgaricus', amount: 75_000_000, unit: 'CFU' },
        { name: 'Lactobacillus plantarum', amount: 60_000_000_000, unit: 'CFU' },
        { name: 'Lactobacillus acidophilus', amount: 825_000_000, unit: 'CFU' },
        { name: 'Lactobacillus rhamnosus', amount: 4_500_000_000, unit: 'CFU' },
        { name: 'Lactobacillus rhamnosus', amount: 6_000_000_000, unit: 'CFU' },
      ],
    })
  })

  it('is partial when a follow-up call failed, and null for an unknown NPN', () => {
    const f = npnMagnesiumEn
    expect(mapNpnPrefill('80085063', f.licence, null, f.dose)).toMatchObject({
      ingredients: [],
      dose: { amount: 1 },
      partial: true,
    })
    expect(mapNpnPrefill('80085063', f.licence, f.ingredients, null)).toMatchObject({
      dose: null,
      partial: true,
    })
    expect(mapNpnPrefill('00000000', [], null, null)).toBeNull()
    // A licence row for another number is not this one.
    expect(mapNpnPrefill('80000002', f.licence, f.ingredients, f.dose)).toBeNull()
    expect(mapNpnPrefill('80085063', { unexpected: true }, null, null)).toBeNull()
  })
})

describe('DIN prefill (DPD fixtures)', () => {
  it('maps a prescription drug (DIN 02172062), EN and FR', () => {
    const expected = {
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
    expect(din('02172062', dinSynthroidEn)).toEqual(expected)
    expect(din('02172062', dinSynthroidFr)).toEqual({
      ...expected,
      ingredients: [{ name: 'Lévothyroxine sodique', amount: 25, unit: 'mcg' }],
    })
  })

  it('maps an iron product whose ingredient names its salt', () => {
    expect(din('02230276', dinIronEn)).toMatchObject({
      name: 'SCHEINPHARM FERROUS FUMARATE - 300MG',
      form: 'capsule',
      strength: '100 mg',
      ingredients: [{ name: 'IRON (FERROUS FUMARATE)', amount: 100, unit: 'mg' }],
    })
    expect(din('02230276', dinIronFr)?.ingredients).toEqual([
      { name: 'Fer (Fumarate ferreux)', amount: 100, unit: 'mg' },
    ])
  })

  it('gives a liquid strength per ml, and no single strength for combinations', () => {
    const product = [{ drug_code: 1, drug_identification_number: '00000001', brand_name: 'X' }]
    const liquid = [
      {
        ingredient_name: 'A',
        strength: '125',
        strength_unit: 'MG',
        dosage_value: '5',
        dosage_unit: 'ML',
      },
    ]
    expect(mapDinPrefill('00000001', product, liquid, [])).toMatchObject({
      strength: '125 mg / 5 ml',
      ingredients: [{ name: 'A', amount: 25, unit: 'mg' }],
      form: null,
    })
    const combo = [
      { ingredient_name: 'A', strength: '10', strength_unit: 'MG' },
      { ingredient_name: 'B', strength: '5', strength_unit: 'MG' },
    ]
    expect(mapDinPrefill('00000001', product, combo, null)).toMatchObject({
      strength: null,
      partial: true,
    })
    expect(mapDinPrefill('00000001', [], null, null)).toBeNull()
  })
})

describe('every mapped fixture fits the shared ProductPrefill schema', () => {
  it.each([
    ['80000001', npnFlaxEn],
    ['80000001', npnFlaxFr],
    ['80077104', npnOmegaEn],
    ['80077104', npnOmegaFr],
    ['80085063', npnMagnesiumEn],
    ['80085063', npnMagnesiumFr],
    ['80086910', npnProbioticEn],
    ['80103409', npnVitaminDEn],
    ['80103409', npnVitaminDFr],
  ])('NPN %s', (number, fixture) => {
    expect(ProductPrefill.safeParse(npn(number, fixture)).success).toBe(true)
  })

  it.each([
    ['02172062', dinSynthroidEn],
    ['02172062', dinSynthroidFr],
    ['02230276', dinIronEn],
    ['02230276', dinIronFr],
  ])('DIN %s', (number, fixture) => {
    expect(ProductPrefill.safeParse(din(number, fixture)).success).toBe(true)
  })
})

describe('lookup inputs', () => {
  it('accepts exactly 8 ASCII digits as an NPN or a DIN', () => {
    expect(isLookupNumber('80000001')).toBe(true)
    expect(isLookupNumber('02172062')).toBe(true)
    for (const bad of [
      '8000001',
      '800000011',
      'abcdefgh',
      ' 80000001',
      '8000-001',
      '',
      '٨٠٠٠٠٠٠١',
    ]) {
      expect(isLookupNumber(bad)).toBe(false)
    }
  })

  it('reads ?lang=, English by default', () => {
    expect(parseLookupLang('fr')).toBe('fr')
    expect(parseLookupLang(' FR ')).toBe('fr')
    expect(parseLookupLang('en')).toBe('en')
    expect(parseLookupLang('de')).toBe('en')
    expect(parseLookupLang(undefined)).toBe('en')
  })

  it('builds the documented Health Canada URLs', () => {
    const base = 'https://health-products.canada.ca/api'
    expect(hcUrls.npnLicence('80000001', 'en')).toBe(
      `${base}/natural-licences/productlicence/?id=80000001&lang=en&type=json`,
    )
    expect(hcUrls.npnIngredients(3898401, 'fr')).toBe(
      `${base}/natural-licences/medicinalingredient/?id=3898401&lang=fr&type=json`,
    )
    expect(hcUrls.npnDose(3898401, 'en')).toBe(
      `${base}/natural-licences/productdose/?id=3898401&lang=en&type=json`,
    )
    expect(hcUrls.dinProduct('02172062', 'en')).toBe(
      `${base}/drug/drugproduct/?din=02172062&lang=en&type=json`,
    )
    expect(hcUrls.dinIngredients(19588, 'fr')).toBe(
      `${base}/drug/activeingredient/?id=19588&lang=fr&type=json`,
    )
    expect(hcUrls.dinForm(19588, 'en')).toBe(`${base}/drug/form/?id=19588&lang=en&type=json`)
  })

  it('throttles per account, 30 per hour, under a hashed key', async () => {
    expect(THROTTLE.lookupAccount).toEqual({
      scope: 'lookup:account',
      limit: 30,
      windowMs: 3_600_000,
    })
    const accountId = '0b8f0c1e-7d7a-4c1e-9d55-3f3c2a1b0c9d'
    const key = await throttleKey(THROTTLE.lookupAccount, accountId)
    expect(key).toMatch(/^lookup:account:[0-9a-f]{64}$/)
    expect(key).not.toContain(accountId)
    expect(await throttleKey(THROTTLE.lookupAccount, 'another-account')).not.toBe(key)
  })
})

describe('upstream cache', () => {
  const origin = 'https://schedule.example.com'

  it('keys each upstream URL on the app origin, and only on the URL', () => {
    const en = hcUrls.npnLicence('80000001', 'en')
    expect(hcCacheKey(en, origin)).toBe(
      `${origin}/__cache/health-canada/natural-licences/productlicence?id=80000001&lang=en&type=json`,
    )
    expect(hcCacheKey(en, origin)).toBe(hcCacheKey(en, origin))
    expect(hcCacheKey(hcUrls.npnLicence('80000001', 'fr'), origin)).not.toBe(hcCacheKey(en, origin))
    expect(hcCacheKey(hcUrls.dinProduct('80000001', 'en'), origin)).not.toBe(hcCacheKey(en, origin))
  })

  it('keeps answers a week, "not found" a day', () => {
    expect(hcCacheSeconds(npnFlaxEn.licence)).toBe(HC_CACHE_SECONDS)
    expect(hcCacheSeconds(npnFlaxEn.ingredients)).toBe(HC_CACHE_SECONDS)
    expect(hcCacheSeconds([])).toBe(HC_EMPTY_CACHE_SECONDS)
    expect(hcCacheSeconds({ metadata: {}, data: [] })).toBe(HC_EMPTY_CACHE_SECONDS)
    expect(HC_CACHE_SECONDS).toBe(604_800)
  })
})

describe('vocabulary', () => {
  it('maps amounts and Health Canada unit words', () => {
    expect(mapAmount(200, 'milligrams')).toEqual({ amount: 200, unit: 'mg' })
    expect(mapAmount(200, 'milligramme')).toEqual({ amount: 200, unit: 'mg' })
    expect(mapAmount(25, 'Microgram')).toEqual({ amount: 25, unit: 'mcg' })
    expect(mapAmount(1000, 'UI')).toEqual({ amount: 1000, unit: 'IU' })
    expect(mapAmount(75, 'million cfu')).toEqual({ amount: 75_000_000, unit: 'CFU' })
    expect(mapAmount(15, 'milliards UFC')).toEqual({ amount: 15_000_000_000, unit: 'CFU' })
    expect(mapAmount('0.125', 'MG')).toEqual({ amount: 0.125, unit: 'mg' })
    expect(mapAmount(5, '%')).toEqual({ amount: 5, unit: '%' })
    expect(mapAmount(5, 'a very long unit name')).toEqual({ amount: 5, unit: null })
    expect(mapAmount(0, 'mg')).toEqual({ amount: null, unit: null })
  })

  it('maps dosage forms', () => {
    expect(
      [
        'Capsule',
        'Capsule, soft',
        'Capsule (enteric coated)',
        'Tablet (Extended-Release)',
        'Comprimé',
        'Powder For Solution',
        'Solution',
        'Drops',
        'Kit',
        '',
      ].map(mapForm),
    ).toEqual([
      'capsule',
      'softgel',
      'capsule',
      'tablet',
      'tablet',
      'powder',
      'liquid',
      'liquid',
      'other',
      null,
    ])
  })

  it('maps dose units and daily frequencies', () => {
    expect(mapDoseUnit('capsule', 'capsule')).toBe('capsule')
    expect(mapDoseUnit('Capsule', 'softgel')).toBe('softgel')
    expect(mapDoseUnit('each', 'tablet')).toBe('tablet')
    expect(mapDoseUnit('each', 'liquid')).toBe('other')
    expect(mapDoseUnit('Drop', 'liquid')).toBe('drop')
    expect(mapDoseUnit('mL', 'liquid')).toBe('ml')
    expect(mapDoseUnit('Scoop', 'powder')).toBe('scoop')
    expect(mapDoseUnit('teaspoon', 'liquid')).toBe('teaspoon')
    expect(['daily', 'Day', 'Jour', 'Tous les jours', 'weekly', 'hour', ''].map(isPerDay)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ])
  })
})
