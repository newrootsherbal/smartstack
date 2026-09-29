import { Product, type Routine } from '@smartstack/shared'
import { describe, expect, it } from 'vitest'
import { catalogue, findProductByBarcode, getProduct, getRule } from './catalogue'
import { findDuplicateIngredients } from './duplicates'
import { sampleCatalogue } from './sample'
import { buildSchedule } from './scheduler'
import { row, userProduct } from './user-product.fixture'
import {
  canonicalIngredients,
  mergeCatalogue,
  normalizeIngredientUnit,
  recognizeIngredient,
  toEngineProduct,
  userRules,
} from './user-products'

const NBSP = String.fromCharCode(0xa0)

const routine: Routine = {
  wake: '06:30',
  coffee: null,
  breakfast: '07:30',
  lunch: '12:00',
  dinner: '18:00',
  exercise: null,
  bedtime: '22:00',
}

describe('toEngineProduct', () => {
  it('maps a natural health product to a schema-valid engine product', () => {
    const up = userProduct({
      upc: '96385074',
      npn: '80000001',
      unitsPerDose: 2,
      dosesPerDay: 2,
      directions: ' Take 2 capsules twice daily. ',
      warnings: '',
    })
    const product = toEngineProduct(up)
    expect(Product.safeParse(product).success).toBe(true)
    expect(product).toMatchObject({
      id: up.id,
      upc: '96385074',
      npn: '80000001',
      kind: 'nhp',
      brand: 'Example Brand',
      name: { en: 'Magnesium Bisglycinate 200 mg' },
      shortName: { en: 'Magnesium Bisglycinate 200 mg' },
      form: 'capsule',
      servingSize: '1 capsule',
      dosesPerDayDefault: 2,
      unitsPerDose: 2,
      unitLabel: 'capsule',
      directions: { en: 'Take 2 capsules twice daily.' },
      status: 'user',
      reviewStatus: 'unreviewed',
      lastReviewed: null,
      reviewedBy: null,
    })
    expect(product.warnings).toBeUndefined()
    expect(product.sku).toBeUndefined()
    expect(product.labelVersion).toBeUndefined()
  })

  it('maps the product types to engine kinds', () => {
    const kind = (productType: 'nhp' | 'medication' | 'food' | 'other') =>
      toEngineProduct(userProduct({ productType })).kind
    expect([kind('nhp'), kind('medication'), kind('food'), kind('other')]).toEqual([
      'nhp',
      'medication',
      'food',
      'food',
    ])
  })

  it('gives a medication its strength as subtitle and an empty brand without a company', () => {
    const product = toEngineProduct(
      userProduct({
        productType: 'medication',
        brand: null,
        name: 'Synthroid',
        din: '02172062',
        strength: '25 mcg',
        form: 'tablet',
        doseUnit: 'tablet',
      }),
    )
    expect(Product.safeParse(product).success).toBe(true)
    expect(product).toMatchObject({ kind: 'medication', brand: '', subtitle: { en: '25 mcg' } })
  })

  it('reads a dose unit of "other" as a serving', () => {
    const product = toEngineProduct(userProduct({ form: 'other', doseUnit: 'other' }))
    expect(product).toMatchObject({ servingSize: '1 serving', unitLabel: 'serving' })
  })
})

describe('canonical ingredients of a user product', () => {
  it('converts amounts to canonical units as the importer does', () => {
    expect(
      canonicalIngredients([
        row('Vitamin D3', 1000, 'IU'),
        row('Vitamin C', 1, 'g'),
        row('Folate', 1, 'mg'),
        row('Magnésium', 200, 'mg'),
        row('Vitamin A', 2500, 'IU'),
      ]),
    ).toEqual([
      { ingredientId: 'vitamin-d', amountPerDose: 25 },
      { ingredientId: 'vitamin-c', amountPerDose: 1000 },
      { ingredientId: 'folate', amountPerDose: 1000 },
      { ingredientId: 'magnesium', amountPerDose: 200 },
      // The importer keeps vitamin A in IU apart; so does a user product.
      { ingredientId: 'vitamin-a-iu', amountPerDose: 2500 },
    ])
  })

  it('keeps unconvertible rows out (free text stays on the UserProduct)', () => {
    expect(
      canonicalIngredients([
        row('Valerian root extract', 300, 'mg'),
        row('Magnesium', null, 'mg'),
        row('Magnesium', 200, null),
        row('Vitamin D3', 5, 'ml'),
        row('Vitamin A', 900, 'mcg'),
      ]),
    ).toEqual([])
  })

  it('honours the chosen ingredient id, falls back to the name when the id is unknown, and sums repeats', () => {
    expect(
      canonicalIngredients([
        row('L-Taurine', 500, 'mg', 'taurine'),
        row('Magnesium (as bisglycinate)', 100, 'mg', 'no-such-id'),
        row('Magnesium citrate', 50, 'mg'),
      ]),
    ).toEqual([
      { ingredientId: 'taurine', amountPerDose: 500 },
      { ingredientId: 'magnesium', amountPerDose: 150 },
    ])
  })

  it('normalizes unit words', () => {
    expect(
      ['mg', 'MG', 'milligrams', 'µg', 'mcg', 'UI', 'IU', 'ufc', 'g', 'ml', '%'].map(
        normalizeIngredientUnit,
      ),
    ).toEqual(['mg', 'mg', 'mg', 'mcg', 'mcg', 'IU', 'IU', 'CFU', 'g', null, null])
  })
})

describe('recognizeIngredient', () => {
  it.each([
    ['Magnesium', 'magnesium'],
    ['Bisglycinate de magnésium', 'magnesium'],
    ['Vitamine D3', 'vitamin-d'],
    ['Cholécalciférol', 'vitamin-d'],
    ['EPA (eicosapentaenoic acid)', 'epa'],
    ['Huile de poisson', 'fish-oil'],
    ['IRON (FERROUS FUMARATE)', 'iron'],
    ['Fer (Fumarate ferreux)', 'iron'],
    ['FERROUS SULFATE', 'iron'],
    ['Acide folique', 'folate'],
    ['Lactobacillus plantarum', 'probiotic'],
    ['Taurine', 'taurine'],
  ])('recognizes %s as %s', (name, id) => {
    expect(recognizeIngredient(name)).toBe(id)
  })

  it.each(['LEVOTHYROXINE SODIUM', 'Passionflower', 'Proprietary herbal blend', ''])(
    'leaves %j unrecognized',
    (name) => {
      expect(recognizeIngredient(name)).toBeNull()
    },
  )

  it('only answers ids present in the given ingredient list', () => {
    // The sample fixture has no taurine and no fish oil named in French.
    expect(recognizeIngredient('Taurine', sampleCatalogue.ingredients)).toBeNull()
    expect(recognizeIngredient('Iron', sampleCatalogue.ingredients)).toBe('iron')
  })
})

describe('userRules', () => {
  it('turns label checkboxes into product-level rules in both languages', () => {
    const up = userProduct({ timing: ['BEDTIME', 'WITH_FOOD', 'WITHOUT_FOOD'] })
    const rules = userRules(up)
    expect(rules.map((r) => r.id)).toEqual([
      `user:${up.id}:WITH_FOOD`,
      `user:${up.id}:WITHOUT_FOOD`,
      `user:${up.id}:BEDTIME`,
    ])
    for (const rule of rules) {
      expect(rule).toMatchObject({
        appliesTo: { productId: up.id },
        severity: 'product_instruction',
        evidenceUrl: null,
        reviewStatus: 'unreviewed',
        lastReviewed: null,
        reviewedBy: null,
      })
      expect(rule.explanation.en).toMatch(/^From your label: take /)
      expect(rule.explanation.fr).toMatch(new RegExp(`^Selon votre étiquette${NBSP}: prendre `))
    }
    expect(rules[0]!.explanation).toEqual({
      en: 'From your label: take with food.',
      fr: `Selon votre étiquette${NBSP}: prendre avec de la nourriture.`,
    })
  })

  it('gives medications no label rules', () => {
    expect(userRules(userProduct({ productType: 'medication', timing: ['WITH_FOOD'] }))).toEqual([])
  })
})

describe('mergeCatalogue', () => {
  it('returns the base catalogue itself when there is nothing to add', () => {
    expect(mergeCatalogue(catalogue, [])).toBe(catalogue)
  })

  it('appends products and rules, keeps the first of a repeated id', () => {
    const up = userProduct({ upc: '96385074', timing: ['BEDTIME'] })
    const merged = mergeCatalogue(sampleCatalogue, [up, { ...up, name: 'Duplicate' }])
    expect(merged.products).toHaveLength(sampleCatalogue.products.length + 1)
    expect(merged.products.slice(0, -1)).toEqual(sampleCatalogue.products)
    expect(merged.ingredients).toBe(sampleCatalogue.ingredients)
    expect(getProduct(up.id, merged)?.name.en).toBe('Magnesium Bisglycinate 200 mg')
    expect(getRule(`user:${up.id}:BEDTIME`, merged)?.attribute).toBe('BEDTIME')
    // A scanned barcode that matches the person's product selects it like a catalogue product.
    expect(findProductByBarcode('96385074', merged)?.id).toBe(up.id)
  })

  it('lets the scheduler place a user product by its label and its ingredients', () => {
    const bedtime = userProduct({
      name: 'Sleep formula',
      timing: ['BEDTIME', 'WITHOUT_FOOD'],
    })
    const withFood = userProduct({
      name: 'Vitamin D3 1000 IU',
      form: 'softgel',
      doseUnit: 'softgel',
      ingredients: [row('Vitamin D3', 1000, 'IU')],
    })
    const merged = mergeCatalogue(sampleCatalogue, [bedtime, withFood])
    const schedule = buildSchedule(
      routine,
      [
        { productId: bedtime.id, dosesPerDay: 1 },
        { productId: withFood.id, dosesPerDay: 1 },
        { productId: 'sample-vitamin-d3', dosesPerDay: 1 },
      ],
      { catalogue: merged },
    )
    const at = (id: string) => schedule.placements.find((p) => p.productIds.includes(id))
    expect(at(bedtime.id)?.anchor).toBe('bedtime')
    expect(at(bedtime.id)?.reasons.map((r) => [r.attribute, r.severity])).toEqual([
      ['WITHOUT_FOOD', 'product_instruction'],
      ['BEDTIME', 'product_instruction'],
    ])
    // Vitamin D's ingredient rule (WITH_FAT, lunch or dinner in the sample data) applies.
    expect(at(withFood.id)?.time).toBe(at('sample-vitamin-d3')?.time)
    expect(schedule.duplicates.map((d) => [d.ingredientId, d.total])).toEqual([['vitamin-d', 50]])
  })

  it('never counts a medication in the duplicate-ingredient check', () => {
    const med = userProduct({
      productType: 'medication',
      name: 'Vitamin D 50,000 IU',
      ingredients: [row('Vitamin D', 50000, 'IU')],
    })
    const supplement = userProduct({ ingredients: [row('Vitamin D3', 1000, 'IU')] })
    const merged = mergeCatalogue(sampleCatalogue, [med, supplement])
    const stack = (ids: string[]) => ids.map((productId) => ({ productId, dosesPerDay: 1 }))
    expect(findDuplicateIngredients(stack([med.id, 'sample-vitamin-d3']), merged)).toEqual([])
    expect(
      findDuplicateIngredients(stack([med.id, supplement.id, 'sample-vitamin-d3']), merged).map(
        (d) => d.entries.map((e) => e.productId),
      ),
    ).toEqual([[supplement.id, 'sample-vitamin-d3']])
  })
})
