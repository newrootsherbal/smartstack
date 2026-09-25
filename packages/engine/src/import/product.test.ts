import type { Ingredient, Unit } from '@smartstack/shared'
import { describe, expect, it } from 'vitest'
import { canonicalIngredientId } from './ingredients'
import {
  convertWebsiteProduct,
  mapForm,
  shortName,
  type ImportContext,
  type WebsiteProduct,
} from './product'

const ctx = (): ImportContext => ({
  units: new Map<string, Unit>(),
  ingredients: new Map<string, Ingredient>(),
  curatedRuleIds: new Set(['rule-calcium-evening', 'rule-magnesium-bedtime']),
})

const iron: WebsiteProduct = {
  id: 275,
  urls: { product: 'https://newrootsherbal.com/shop/iron-bisglycinate' },
  identifiers: { recipe_code: 'V0515', revision: 'R2', npn: '80052360' },
  flags: { requires_refrigeration: false },
  languages: {
    en: {
      name: 'Iron Bisglycinate',
      slug: 'iron-bisglycinate',
      subtitle: '35 mg Elemental Iron',
      suggested_use:
        'Adults: Take 1 capsule daily with food or as directed by your health-care practitioner.',
      warnings: 'Keep out of reach of children.',
      recipe:
        'Each vegetable capsule contains: Iron (from iron bisglycinate)35 mg Vitamin C (ascorbic acid)75 mg Other ingredients: cellulose.',
    },
    fr: {
      name: 'Fer (Diglycinate)',
      slug: 'fer-diglycinate',
      suggested_use: 'Adultes : Prendre 1 capsule par jour avec de la nourriture.',
      warnings: 'Garder hors de portée des enfants.',
      recipe: 'Chaque capsule végétale contient : Fer 35 mg',
    },
  },
  variants: [
    {
      sku: '1898',
      upc: '6-28747-11898-9',
      size: { en: '30' },
      format: { en: 'Vegetable Capsules', fr: 'Capsules végétales' },
    },
    {
      sku: '3186',
      upc: '6-28747-13186-5',
      size: { en: '60' },
      format: { en: 'Vegetable Capsules' },
    },
  ],
  updated_at: '2026-09-01',
}

describe('convertWebsiteProduct', () => {
  it('builds a draft product with canonical ingredients, variants and a label rule', () => {
    const c = ctx()
    const { product, rules, skipped, warnings } = convertWebsiteProduct(iron, c)
    expect(skipped).toBeNull()
    expect(warnings).toEqual([])
    expect(product).toMatchObject({
      id: 'iron-bisglycinate',
      sku: '1898',
      upc: '628747118989',
      npn: '80052360',
      brand: 'New Roots Herbal',
      name: { en: 'Iron Bisglycinate', fr: 'Fer (Diglycinate)' },
      shortName: { en: 'Iron Bisglycinate', fr: 'Fer' },
      subtitle: { en: '35 mg Elemental Iron' },
      form: 'capsule',
      servingSize: '1 capsule',
      dosesPerDayDefault: 1,
      unitsPerDose: 1,
      status: 'draft',
      labelVersion: 'R2',
      ingredients: [
        { ingredientId: 'iron', amountPerDose: 35 },
        { ingredientId: 'vitamin-c', amountPerDose: 75 },
      ],
      variants: [
        { sku: '1898', upc: '628747118989' },
        { sku: '3186', upc: '628747131865' },
      ],
      sourceUrl: 'https://newrootsherbal.com/shop/iron-bisglycinate',
      reviewStatus: 'unreviewed',
    })
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({
      id: 'rule-iron-bisglycinate-with-food',
      attribute: 'WITH_FOOD',
      appliesTo: { productId: 'iron-bisglycinate' },
      severity: 'consideration',
      evidenceUrl: 'https://newrootsherbal.com/shop/iron-bisglycinate',
      reviewStatus: 'unreviewed',
    })
    expect(rules[0]?.explanation.fr).toMatch(/Usage suggéré sur l’étiquette/)
    expect(c.ingredients.get('iron')).toEqual({
      id: 'iron',
      name: { en: 'Iron', fr: 'Fer' },
      unit: 'mg',
    })
  })

  it('keeps products without an NPN as foods and disables anchor rules that do not fit', () => {
    const food = convertWebsiteProduct({ ...iron, identifiers: {} }, ctx())
    expect(food.skipped).toBeNull()
    expect(food.product?.kind).toBe('food')
    expect(food.product?.npn).toBeUndefined()
    expect(convertWebsiteProduct(iron, ctx()).product?.kind).toBe('nhp')
    const multi: WebsiteProduct = {
      ...iron,
      identifiers: { npn: '80035202', revision: 'R10' },
      languages: {
        en: {
          name: 'Multi',
          slug: 'multi',
          suggested_use: 'Adults: Take 1 capsule daily.',
          recipe:
            'Each vegetable capsule contains: Calcium (from calcium citrate)100 mg Magnesium (from magnesium citrate)35 mg',
        },
      },
      variants: [{ sku: '1726', upc: '6-28747-11726-5' }],
    }
    const { product } = convertWebsiteProduct(multi, ctx())
    expect(product?.ruleOverrides?.disable).toEqual([
      'rule-calcium-evening',
      'rule-magnesium-bedtime',
    ])
    expect(product?.unitsPerDose).toBe(1)
  })

  it('takes French names for label ingredients when the French facts line up', () => {
    const c = ctx()
    const herbal: WebsiteProduct = {
      ...iron,
      languages: {
        en: {
          name: 'Anti-Inflamma',
          slug: 'anti-inflamma',
          recipe:
            'Each vegetable capsule contains: Quercetin100 mg Bromelain (from pineapple [Ananas comosus] stem), 2400 GDU/g 50 mg Iron (from iron bisglycinate)5 mg Other ingredients: cellulose.',
        },
        fr: {
          name: 'Anti-Inflamma',
          slug: 'anti-inflamma',
          recipe:
            'Chaque capsule végétale contient : Quercétine100 mg Broméline (de tige d’ananas [Ananas comosus]), 2400 UDG/g50 mg Fer (de diglycinate de fer)5 mg Autres ingrédients : cellulose.',
        },
      },
    }
    const { frenchFacts } = convertWebsiteProduct(herbal, c)
    expect(frenchFacts).toBe('aligned')
    expect(c.ingredients.get('quercetin')?.name).toEqual({ en: 'Quercetin', fr: 'Quercétine' })
    expect(c.ingredients.get('bromelain-2400-gdu-g')?.name.fr).toBe('Broméline, 2400 UDG/g')
    // Canonical nutrients keep their fixed names.
    expect(c.ingredients.get('iron')?.name).toEqual({ en: 'Iron', fr: 'Fer' })
    // The iron fixture's French facts list one item for two English ones: no French taken.
    expect(convertWebsiteProduct(iron, ctx()).frenchFacts).toBe('mismatch')
  })

  it('sums repeated nutrients and converts vitamin D IU to mcg', () => {
    const d: WebsiteProduct = {
      ...iron,
      languages: {
        en: {
          name: 'Test D',
          slug: 'test-d',
          recipe:
            'Each softgel contains: Vitamin D3 (cholecalciferol)1000 IU Vitamin B2 (riboflavin)5 mg Vitamin B2 (riboflavin-5-phosphate)5 mg',
        },
      },
      variants: [{ sku: '2586', upc: '6-28747-12586-4', format: { en: 'Softgels' } }],
    }
    const { product } = convertWebsiteProduct(d, ctx())
    expect(product?.form).toBe('softgel')
    expect(product?.ingredients).toEqual([
      { ingredientId: 'vitamin-d', amountPerDose: 25 },
      { ingredientId: 'vitamin-b2', amountPerDose: 10 },
    ])
  })
})

describe('helpers', () => {
  it('shortens names', () => {
    expect(shortName('Wild Omega-3 EPA 660 mg DHA 330 mg')).toBe('Wild Omega-3')
    expect(shortName('Cal-Mag Citrates, Vitamin D, Zinc, Silica, and Boron')).toBe(
      'Cal-Mag Citrates',
    )
    expect(shortName('Vitamin D3 1000 IU per Softgel')).toBe('Vitamin D3')
    expect(shortName('Acidophilus Ultra + 15 Billion+')).toBe('Acidophilus Ultra')
    expect(shortName('Ultra B-Complex 50 mg')).toBe('Ultra B-Complex')
    expect(shortName('Multi')).toBe('Multi')
  })

  it('maps formats and canonical ids', () => {
    expect(mapForm('Vegetable Capsules')).toBe('capsule')
    expect(mapForm('Softgels')).toBe('softgel')
    expect(mapForm('Tablets')).toBe('tablet')
    expect(mapForm('Powder')).toBe('powder')
    expect(mapForm('Liquid')).toBe('liquid')
    expect(mapForm('Vaginal Ovules')).toBe('other')
    expect(canonicalIngredientId('Vitamin D3')).toBe('vitamin-d')
    expect(canonicalIngredientId('Lactobacillus rhamnosus R0011')).toBe('probiotic')
    expect(canonicalIngredientId('Eicosapentaenoic acid')).toBe('epa')
    expect(canonicalIngredientId('Curcumin')).toBe('curcumin')
  })
})

describe('canonical ids for minerals written the long way', () => {
  it('maps elemental / salt / fully-reacted forms to the element', () => {
    expect(canonicalIngredientId('Elemental magnesium from a magnesium bisglycinate blend')).toBe(
      'magnesium',
    )
    expect(canonicalIngredientId('Fully reacted magnesium orotate')).toBe('magnesium')
    expect(canonicalIngredientId('Elemental iron')).toBe('iron')
    expect(canonicalIngredientId('Potassium iodide')).toBe('iodine')
    expect(canonicalIngredientId('Calcium ascorbate')).toBe('vitamin-c')
    expect(canonicalIngredientId('Calcium d-pantothenate')).toBe('vitamin-b5')
    expect(canonicalIngredientId('Calcium citrate')).toBe('calcium')
  })
})
