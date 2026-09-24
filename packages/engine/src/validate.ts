import { Catalogue as CatalogueSchema, SEED_SEVERITIES, type Catalogue } from '@smartstack/shared'
import { isValidRetailBarcode, SAMPLE_EAN13_PREFIX } from './barcode'

export type ValidationResult = { ok: true; catalogue: Catalogue } | { ok: false; errors: string[] }

export const SEPARATION_ATTRIBUTES: ReadonlySet<string> = new Set([
  'SEPARATE_FROM_CALCIUM',
  'SEPARATE_FROM_IRON',
  'SEPARATE_FROM_COFFEE_TEA',
])
const ANCHOR_PREFERENCE_ATTRIBUTES: ReadonlySet<string> = new Set(['WITH_FOOD', 'WITH_FAT'])

/**
 * Validate raw catalogue data: zod shape first, then referential integrity, the
 * sample-data rules and the real-product rules. Used by tests, the importers and
 * when a catalogue is loaded.
 */
export function validateCatalogue(raw: unknown): ValidationResult {
  const parsed = CatalogueSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`),
    }
  }
  const cat = parsed.data
  const errors: string[] = []

  const ingredientIds = new Set<string>()
  for (const ing of cat.ingredients) {
    if (ingredientIds.has(ing.id)) errors.push(`ingredients: duplicate id ${ing.id}`)
    ingredientIds.add(ing.id)
  }

  const ruleIds = new Set<string>()
  for (const r of cat.rules) {
    if (ruleIds.has(r.id)) errors.push(`rules: duplicate id ${r.id}`)
    ruleIds.add(r.id)
  }

  const productIds = new Set<string>()
  const barcodes = new Map<string, string>()
  for (const p of cat.products) {
    const where = `products.${p.id}`
    if (productIds.has(p.id)) errors.push(`${where}: duplicate id`)
    productIds.add(p.id)

    const codes = [p.upc, ...(p.variants ?? []).map((v) => v.upc)]
    for (const code of codes) {
      if (!isValidRetailBarcode(code))
        errors.push(`${where}: barcode ${code} has a bad check digit`)
      const owner = barcodes.get(code)
      if (owner && owner !== p.id) errors.push(`${where}: barcode ${code} also belongs to ${owner}`)
      barcodes.set(code, p.id)
    }
    if (p.variants && !p.variants.some((v) => v.upc === p.upc)) {
      errors.push(`${where}: primary upc ${p.upc} is not one of the variants`)
    }

    const seen = new Set<string>()
    for (const pi of p.ingredients) {
      if (!ingredientIds.has(pi.ingredientId)) {
        errors.push(`${where}: unknown ingredient ${pi.ingredientId}`)
      }
      if (seen.has(pi.ingredientId)) {
        errors.push(`${where}: ingredient ${pi.ingredientId} listed twice`)
      }
      seen.add(pi.ingredientId)
    }
    for (const ruleId of p.ruleOverrides?.disable ?? []) {
      if (!ruleIds.has(ruleId)) {
        errors.push(`${where}: ruleOverrides.disable references unknown rule ${ruleId}`)
      }
    }
    errors.push(...reviewConsistency(where, p))
    if (p.status === 'sample') {
      if (p.brand !== 'Sample') errors.push(`${where}: sample products must have brand "Sample"`)
      if (!/\(sample\)/i.test(p.name.en)) {
        errors.push(`${where}: sample product names must contain "(sample)"`)
      }
      if (!p.npn.startsWith('SAMPLE-'))
        errors.push(`${where}: sample NPN must start with "SAMPLE-"`)
      if (!p.upc.startsWith(SAMPLE_EAN13_PREFIX) || p.upc.length !== 13) {
        errors.push(`${where}: sample UPC must be an EAN-13 with prefix ${SAMPLE_EAN13_PREFIX}`)
      }
      if (p.reviewStatus !== 'unreviewed')
        errors.push(`${where}: sample products must be unreviewed`)
    } else {
      if (p.npn.startsWith('SAMPLE-') || p.brand === 'Sample') {
        errors.push(`${where}: only status "sample" products may use the sample brand / NPN`)
      }
      if (!/^\d{8}$/.test(p.npn)) errors.push(`${where}: NPN must be 8 digits (got ${p.npn})`)
      if (p.upc.startsWith(SAMPLE_EAN13_PREFIX) && p.upc.length === 13) {
        errors.push(`${where}: real products cannot use the GS1 200 sample range`)
      }
    }
  }

  for (const r of cat.rules) {
    const where = `rules.${r.id}`
    if ('ingredientId' in r.appliesTo && !ingredientIds.has(r.appliesTo.ingredientId)) {
      errors.push(`${where}: unknown ingredient ${r.appliesTo.ingredientId}`)
    }
    if ('productId' in r.appliesTo && !productIds.has(r.appliesTo.productId)) {
      errors.push(`${where}: unknown product ${r.appliesTo.productId}`)
    }
    if (SEPARATION_ATTRIBUTES.has(r.attribute) && !r.separationMinutes) {
      errors.push(`${where}: ${r.attribute} requires separationMinutes`)
    }
    if (!SEPARATION_ATTRIBUTES.has(r.attribute) && r.separationMinutes !== undefined) {
      errors.push(`${where}: separationMinutes only applies to SEPARATE_FROM_* rules`)
    }
    if (r.preferredAnchors && !ANCHOR_PREFERENCE_ATTRIBUTES.has(r.attribute)) {
      errors.push(`${where}: preferredAnchors only applies to WITH_FOOD / WITH_FAT`)
    }
    errors.push(...reviewConsistency(where, r))
    if (
      r.reviewStatus !== 'reviewed' &&
      !(SEED_SEVERITIES as readonly string[]).includes(r.severity)
    ) {
      errors.push(
        `${where}: unreviewed rules may only be ${SEED_SEVERITIES.join(', ')} (got ${r.severity})`,
      )
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, catalogue: cat }
}

function reviewConsistency(
  where: string,
  x: { reviewStatus: string; lastReviewed: string | null; reviewedBy: string | null },
): string[] {
  const errors: string[] = []
  if (x.reviewStatus === 'unreviewed') {
    if (x.lastReviewed !== null)
      errors.push(`${where}: unreviewed items must have lastReviewed null`)
    if (x.reviewedBy !== null) errors.push(`${where}: unreviewed items must have reviewedBy null`)
  }
  if (x.reviewStatus === 'reviewed') {
    if (x.lastReviewed === null) errors.push(`${where}: reviewed items need lastReviewed`)
    if (x.reviewedBy === null) errors.push(`${where}: reviewed items need reviewedBy`)
  }
  return errors
}
