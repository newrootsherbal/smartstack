import { describe, expect, it } from 'vitest'
import ingredients from '../data/sample/ingredients.json'
import products from '../data/sample/products.json'
import rules from '../data/sample/rules.json'
import { rulesForProduct } from './catalogue'
import { validateCatalogue } from './validate'

const seed = { ingredients, products, rules }

describe('sample catalogue fixture', () => {
  it('validates', () => {
    const result = validateCatalogue(seed)
    expect(result.ok ? [] : result.errors).toEqual([])
  })

  it('is sample data only, never reviewed, never label-like', () => {
    for (const p of products) {
      expect(p.status).toBe('sample')
      expect(p.brand).toBe('Sample')
      expect(p.reviewStatus).toBe('unreviewed')
      expect(p.reviewedBy).toBeNull()
      expect(p.lastReviewed).toBeNull()
      expect(p.npn).toMatch(/^SAMPLE-NPN-\d{4}$/)
      expect(p.directions.en).toMatch(/^Sample directions/)
      expect(p.warnings.en).toMatch(/^Sample warnings/)
      expect(p.directions.en).not.toMatch(/New Roots/)
    }
    for (const r of rules) {
      expect(r.reviewStatus).toBe('unreviewed')
      expect(['timing_conflict', 'consideration', 'informational']).toContain(r.severity)
      expect(r.explanation.en).not.toMatch(/New Roots/)
    }
  })

  it('has roughly ten products and the expected rule attributes', () => {
    expect(products.length).toBeGreaterThanOrEqual(10)
    expect(new Set(rules.map((r) => r.attribute))).toEqual(
      new Set([
        'WITH_FOOD',
        'MORNING',
        'TAKE_WITH_WATER',
        'SEPARATE_FROM_CALCIUM',
        'SEPARATE_FROM_COFFEE_TEA',
        'EVENING',
        'BEDTIME',
        'WITH_FAT',
      ]),
    )
  })
})

describe('rulesForProduct', () => {
  it('attaches ingredient rules to every product containing the ingredient', () => {
    const multi = products.find((p) => p.id === 'sample-multi')!
    const result = validateCatalogue(seed)
    if (!result.ok) throw new Error(result.errors.join('\n'))
    const ids = rulesForProduct(
      result.catalogue.products.find((p) => p.id === multi.id)!,
      result.catalogue,
    ).map((r) => r.id)
    // Product-level WITH_FOOD wins over calcium's WITH_FOOD; EVENING disabled by override;
    // vitamin D's WITH_FAT still applies.
    expect(ids).toEqual(['rule-multi-with-food', 'rule-multi-morning', 'rule-vitamin-d-with-fat'])
  })
})

describe('validateCatalogue — rejections', () => {
  const clone = () => JSON.parse(JSON.stringify(seed)) as typeof seed

  it('rejects a bad EAN-13 check digit', () => {
    const bad = clone()
    bad.products[0]!.upc = '2000000000009'
    const result = validateCatalogue(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/check digit/)
  })

  it('rejects unreviewed rules with product_instruction or important severity', () => {
    const bad = clone()
    bad.rules[0]!.severity = 'product_instruction'
    const result = validateCatalogue(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/unreviewed rules may only be/)
  })

  it('rejects a sample product that pretends to be reviewed', () => {
    const bad = clone()
    Object.assign(bad.products[0]!, {
      reviewStatus: 'reviewed',
      reviewedBy: 'Someone',
      lastReviewed: '2026-01-01',
    })
    const result = validateCatalogue(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/must be unreviewed/)
  })

  it('rejects dangling references', () => {
    const bad = clone()
    bad.rules.push({
      ...bad.rules[0]!,
      id: 'rule-x',
      appliesTo: { ingredientId: 'unobtainium' },
    })
    const result = validateCatalogue(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/unknown ingredient unobtainium/)
  })

  // Optional in the Product schema (the person's own products have none), required in bundled data.
  it.each(['sku', 'upc', 'labelVersion'] as const)('requires %s in bundled data', (field) => {
    const bad = clone()
    delete (bad.products[0] as Partial<(typeof bad.products)[number]>)[field]
    const result = validateCatalogue(bad)
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.errors).toContain(`products.${bad.products[0]!.id}: ${field} is required`)
  })

  it('requires a brand in bundled data', () => {
    const bad = clone()
    bad.products[0]!.brand = ''
    const result = validateCatalogue(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/brand is required/)
  })

  it('keeps medications, status "user", u_ ids and user: rule ids out of bundled data', () => {
    for (const change of [{ kind: 'medication' }, { status: 'user' }, { id: 'u_sample' }]) {
      const bad = clone()
      Object.assign(bad.products[0]!, change)
      const result = validateCatalogue(bad)
      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.errors.join('\n')).toMatch(/reserved for the person's own products/)
    }
    const bad = clone()
    bad.rules[0]!.id = 'user:u_x:WITH_FOOD'
    const result = validateCatalogue(bad)
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.errors.join('\n')).toMatch(/reserved for the person's label rules/)
  })

  it('still rejects an 8-digit barcode in bundled data (the schema allows EAN-8 for user products)', () => {
    const bad = clone()
    bad.products[0]!.upc = '96385074'
    const result = validateCatalogue(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/96385074 has a bad check digit/)
  })

  it('requires separationMinutes on SEPARATE_FROM_* rules', () => {
    const bad = clone()
    const sep = bad.rules.find((r) => r.attribute === 'SEPARATE_FROM_CALCIUM')!
    delete (sep as { separationMinutes?: number }).separationMinutes
    const result = validateCatalogue(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/requires separationMinutes/)
  })
})

describe('SUGGEST_BEDTIME rules', () => {
  const suggestion = {
    id: 'rule-test-suggest',
    attribute: 'SUGGEST_BEDTIME',
    appliesTo: { ingredientId: 'magnesium' },
    severity: 'informational',
    explanation: { en: 'Many people prefer the evening.' },
    evidenceUrl: null,
    reviewStatus: 'unreviewed',
    lastReviewed: null,
    reviewedBy: null,
  }
  const withRule = (rule: object) => ({ ...seed, rules: [...seed.rules, rule] })

  it('accepts an informational suggestion', () => {
    expect(validateCatalogue(withRule(suggestion)).ok).toBe(true)
  })

  it('refuses any other severity', () => {
    const result = validateCatalogue(withRule({ ...suggestion, severity: 'consideration' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/SUGGEST_BEDTIME.*informational/)
  })
})
