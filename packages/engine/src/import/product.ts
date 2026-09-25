/**
 * newrootsherbal.com catalog record → SmartStack Product (+ label-derived rules).
 * Pure: the script in scripts/import-website.ts does the fetching and writing.
 */
import type { Ingredient, LocalizedText, Product, TimingRule, Unit } from '@smartstack/shared'
import { isValidRetailBarcode } from '../barcode'
import { alignFrenchNames } from './french-facts'
import { CANONICAL, canonicalIngredientId, ingredientNames } from './ingredients'
import { parseRecipe, type RawUnit } from './recipe'
import { frenchSentenceFor, parseSuggestedUse, type TimingAttribute } from './suggested-use'

export interface WebsiteLang {
  name: string
  slug: string
  categories?: (string | { name: string; slug?: string })[]
  subtitle?: string
  subtitle2?: string
  suggested_use?: string
  warnings?: string
  recipe?: string
}

export interface WebsiteVariant {
  sku: string
  upc: string
  size?: { en?: string; fr?: string }
  format?: { en?: string; fr?: string }
  url?: string
}

export interface WebsiteProduct {
  id: number
  urls: { product: string; product_fr?: string; catalog_record?: string }
  identifiers: { recipe_code?: string; revision?: string; npn?: string }
  flags?: { requires_refrigeration?: boolean; softgel?: boolean }
  languages: { en: WebsiteLang; fr?: WebsiteLang }
  variants: WebsiteVariant[]
  updated_at?: string
}

export interface ImportContext {
  /** Canonical unit already chosen for each ingredient id (shared across products). */
  units: Map<string, Unit>
  /** Ingredient registry being built. */
  ingredients: Map<string, Ingredient>
  /** Ids of curated ingredient-level rules that heuristics may disable per product. */
  curatedRuleIds: ReadonlySet<string>
}

export interface ProductText {
  directions?: LocalizedText
  warnings?: LocalizedText
  /** Raw label facts, shipped only when no ingredient could be parsed from them. */
  facts?: LocalizedText
}

export interface ConvertResult {
  product: Product | null
  rules: TimingRule[]
  /** Label text, written to data/product-text.json and loaded on demand by the app. */
  text: ProductText
  skipped: string | null
  warnings: string[]
  /**
   * Whether the French facts lined up with the English items (so French ingredient
   * names could be read), did not, or were not published.
   */
  frenchFacts: 'aligned' | 'mismatch' | 'none'
}

export const BRAND = 'New Roots Herbal'

const TOPICAL_CATEGORY = /essential oils?|exotic skin oils?/i
// Wording that only appears on oils, rubs and liniments; "Skin"/"Beauty" categories are
// not enough (collagen, biotin and silica are swallowed).
const TOPICAL_USE =
  /diffuser|topical application|external use|do not ingest|not for internal use|affected area|inhalation|aromatherapy|drops in your hand|massage (?:the oil|into|desired)/i

/**
 * Essential and skin oils, rubs and liniments are applied or diffused, never scheduled as
 * doses, whether or not they carry an NPN. Everything else is a licensed natural health
 * product when it has an NPN, otherwise a food (protein, MCT oil, sweetener…).
 */
export function classifyKind(npn: string | undefined, en: WebsiteLang): Product['kind'] {
  const categories = (en.categories ?? []).map((c) => (typeof c === 'string' ? c : c.name))
  if (categories.some((c) => TOPICAL_CATEGORY.test(c))) return 'topical'
  if (TOPICAL_USE.test(en.suggested_use ?? '')) return 'topical'
  return npn ? 'nhp' : 'food'
}

export function normalizeUpc(printed: string): string {
  return printed.replace(/\D/g, '')
}

export function mapForm(format: string | undefined): Product['form'] {
  const f = (format ?? '').toLowerCase()
  if (/softgel/.test(f)) return 'softgel'
  if (/capsule/.test(f)) return 'capsule'
  if (/tablet|caplet|lozenge|chewable/.test(f)) return 'tablet'
  if (/powder|crystal|granule|sachet|tea\b/.test(f)) return 'powder'
  if (/liquid|drop|oil|spray|syrup|tincture|emulsion/.test(f)) return 'liquid'
  return 'other'
}

/** "Wild Omega-3 EPA 660 mg DHA 330 mg" → "Wild Omega-3"; "Cal-Mag Citrates, Vitamin D, …" → "Cal-Mag Citrates". */
export function shortName(name: string): string {
  let s = name.replace(/[™®]/g, '').trim()
  s = s.split(/,\s|\s[–—]\s|\s\(|\s\+\s/)[0]!
  s = s.replace(/\s+(EPA|DHA|AEP|ADH)\b.*$/i, '')
  // Cut at a strength ("1000 IU", "50 mg", "15 Billion+"), but keep bare numbers ("Omega 3").
  s = s.replace(/\s+\d[\d,.]*\s*(mg|mcg|g|IU|UI|%|billion|milliards?)\b.*$/i, '')
  s = s.replace(/[\s+·]+$/g, '').trim()
  return s || name
}

function convertUnit(amount: number, from: RawUnit, to: Unit, id: string): number | null {
  if (from === to) return amount
  if (from === 'g' && to === 'mg') return amount * 1000
  if (from === 'mg' && to === 'mcg') return amount * 1000
  if (from === 'mcg' && to === 'mg') return amount / 1000
  if (from === 'IU' && to === 'mcg' && id === 'vitamin-d') return amount / 40
  if (from === 'IU' && to === 'mg' && id === 'vitamin-e') return amount * 0.67 // d-alpha; approximate
  return null
}

const SEVERITY_FOR: Record<TimingAttribute | 'REFRIGERATE', TimingRule['severity']> = {
  WITH_FOOD: 'consideration',
  WITHOUT_FOOD: 'consideration',
  BEDTIME: 'consideration',
  MORNING: 'consideration',
  TAKE_WITH_WATER: 'informational',
  REFRIGERATE: 'informational',
}

export function convertWebsiteProduct(w: WebsiteProduct, ctx: ImportContext): ConvertResult {
  const warnings: string[] = []
  const en = w.languages.en
  const fr = w.languages.fr
  const npn = /^\d{8}$/.test(w.identifiers.npn ?? '') ? w.identifiers.npn : undefined
  const kind = classifyKind(npn, en)
  const variants = (w.variants ?? []).filter((v) => {
    const upc = normalizeUpc(v.upc)
    if (/^\d{12,13}$/.test(upc) && isValidRetailBarcode(upc)) return true
    warnings.push(
      `${en.slug}: variant ${v.sku} barcode "${v.upc}" is invalid (bad check digit); skipped`,
    )
    return false
  })
  if (variants.length === 0) {
    return {
      product: null,
      rules: [],
      text: {},
      skipped: 'no variant with a UPC',
      warnings,
      frenchFacts: 'none',
    }
  }

  const id = en.slug
  const recipe = parseRecipe(en.recipe ?? '')
  if (!en.recipe) warnings.push(`${id}: no supplement facts on the product page`)
  for (const u of recipe.unparsed) warnings.push(`${id}: unparsed "${u.slice(0, 60)}"`)
  // French label names, one per English item, only when the two texts line up.
  const frNames = alignFrenchNames(recipe.items, fr?.recipe)
  const frenchFacts: ConvertResult['frenchFacts'] =
    !fr?.recipe || recipe.items.length === 0
      ? 'none'
      : frNames.some(Boolean)
        ? 'aligned'
        : 'mismatch'

  // Ingredients: canonical ids, unit reconciliation, per-product sums.
  const amounts = new Map<string, number>()
  for (const [index, item] of recipe.items.entries()) {
    const frName = frNames[index]
    let ingId = canonicalIngredientId(item.name)
    const rawUnit: RawUnit = item.unit
    let unit: Unit =
      ctx.units.get(ingId) ?? CANONICAL[ingId]?.unit ?? (rawUnit === 'g' ? 'mg' : rawUnit)
    let amount = convertUnit(item.amount, rawUnit, unit, ingId)
    if (amount === null) {
      // Same nutrient in an incompatible unit: keep it apart rather than mis-sum it.
      ingId = `${ingId}-${rawUnit.toLowerCase()}`
      unit = rawUnit === 'g' ? 'mg' : rawUnit
      amount = rawUnit === 'g' ? item.amount * 1000 : item.amount
      warnings.push(`${id}: ${item.name} given in ${rawUnit}; stored as ${ingId}`)
    }
    if (!ctx.units.has(ingId)) ctx.units.set(ingId, unit)
    const registered = ctx.ingredients.get(ingId)
    if (!registered) {
      const names = ingredientNames(ingId.replace(/-(mg|mcg|iu|cfu)$/, ''), item.name, frName)
      ctx.ingredients.set(ingId, { id: ingId, name: names, unit })
    } else if (frName && !registered.name.fr) {
      // First product whose French facts lined up names it (products are converted in a fixed order).
      registered.name = { ...registered.name, fr: frName }
    }
    amounts.set(ingId, (amounts.get(ingId) ?? 0) + amount)
  }
  const ingredients = [...amounts.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([ingredientId, amountPerDose]) => ({ ingredientId, amountPerDose: round(amountPerDose) }))
  // Still worth importing: the barcode scans and the label text shows; only the
  // duplicate-ingredient check has nothing to work with.
  if (ingredients.length === 0 && kind !== 'topical') {
    warnings.push(
      recipe.nutritionFacts
        ? `${id}: nutrition facts table (food); no medicinal ingredients`
        : `${id}: no medicinal ingredient could be parsed from the facts`,
    )
  }

  const use = parseSuggestedUse(en.suggested_use ?? '')
  const primary = variants[0]!
  const form = mapForm(primary.format?.en)
  const servingSize = recipe.servingSize ?? `1 ${form === 'other' ? 'serving' : form}`

  const rules: TimingRule[] = []
  const productPage = w.urls.product
  const review = { reviewStatus: 'unreviewed' as const, lastReviewed: null, reviewedBy: null }
  for (const { attribute, sentence } of use.timing) {
    const frSentence = frenchSentenceFor(attribute, fr?.suggested_use)
    rules.push({
      id: `rule-${id}-${attribute.toLowerCase().replace(/_/g, '-')}`,
      attribute,
      appliesTo: { productId: id },
      severity: SEVERITY_FOR[attribute],
      explanation: {
        en: `Suggested use on the label: “${sentence}”`,
        ...(frSentence ? { fr: `Usage suggéré sur l’étiquette : « ${frSentence} »` } : {}),
      },
      evidenceUrl: productPage,
      ...review,
    })
  }
  if (w.flags?.requires_refrigeration) {
    rules.push({
      id: `rule-${id}-refrigerate`,
      attribute: 'REFRIGERATE',
      appliesTo: { productId: id },
      severity: SEVERITY_FOR.REFRIGERATE,
      explanation: {
        en: 'This product is kept refrigerated.',
        fr: 'Ce produit se conserve au réfrigérateur.',
      },
      evidenceUrl: productPage,
      ...review,
    })
  }

  // Ingredient-level anchor rules only fit products that are mainly that mineral.
  const disable: string[] = []
  const has = (ingredientId: string) => amounts.has(ingredientId)
  const nameEn = en.name
  if (
    has('calcium') &&
    !/calci|cal[-‑ ]?mag/i.test(nameEn) &&
    ctx.curatedRuleIds.has('rule-calcium-evening')
  ) {
    disable.push('rule-calcium-evening')
  }
  if (
    has('magnesium') &&
    (!/magnes/i.test(nameEn) || /cal[-‑ ]?mag/i.test(nameEn)) &&
    ctx.curatedRuleIds.has('rule-magnesium-bedtime')
  ) {
    disable.push('rule-magnesium-bedtime')
  }

  const product: Product = {
    id,
    sku: primary.sku,
    upc: normalizeUpc(primary.upc),
    ...(npn ? { npn } : {}),
    kind,
    brand: BRAND,
    name: { en: en.name, ...(fr?.name ? { fr: fr.name } : {}) },
    shortName: { en: shortName(en.name), ...(fr?.name ? { fr: shortName(fr.name) } : {}) },
    ...(en.subtitle
      ? { subtitle: { en: en.subtitle, ...(fr?.subtitle ? { fr: fr.subtitle } : {}) } }
      : {}),
    form,
    servingSize,
    dosesPerDayDefault: use.dosesPerDay,
    ...(use.unitsPerDose ? { unitsPerDose: use.unitsPerDose } : {}),
    ...(use.unitLabel ? { unitLabel: use.unitLabel } : {}),
    // Suggested use and warnings go to product-text.json (see ConvertResult.text); the parsed
    // ingredient list stands in for the facts text, which ships only when nothing parsed.
    status: 'draft',
    labelVersion: w.identifiers.revision ?? 'unknown',
    ingredients,
    variants: variants.map((v) => ({
      sku: v.sku,
      upc: normalizeUpc(v.upc),
      ...(v.size?.en ? { size: { en: v.size.en, ...(v.size.fr ? { fr: v.size.fr } : {}) } } : {}),
      ...(v.format?.en
        ? { format: { en: v.format.en, ...(v.format.fr ? { fr: v.format.fr } : {}) } }
        : {}),
    })),
    ...(disable.length ? { ruleOverrides: { disable } } : {}),
    // `updated_at` is rewritten nightly on the website, so it is not copied: the
    // generated files must only change when label data changes.
    sourceUrl: productPage,
    ...review,
  }
  const text: ProductText = {
    directions: {
      en: en.suggested_use?.trim() || 'No suggested use listed on the product page.',
      ...(fr?.suggested_use ? { fr: fr.suggested_use.trim() } : {}),
    },
    warnings: {
      en: en.warnings?.trim() || 'No warnings listed on the product page.',
      ...(fr?.warnings ? { fr: fr.warnings.trim() } : {}),
    },
    ...(ingredients.length === 0 && en.recipe?.trim()
      ? { facts: { en: en.recipe.trim(), ...(fr?.recipe ? { fr: fr.recipe.trim() } : {}) } }
      : {}),
  }
  return { product, rules, text, skipped: null, warnings, frenchFacts }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
