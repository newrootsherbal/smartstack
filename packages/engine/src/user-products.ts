/**
 * The person's own products (other brands, medications, foods; accounts only, M6). A
 * `UserProduct` becomes an engine `Product` plus product-level label rules, built on the
 * device and merged with the bundled catalogue, so every lookup, the scheduler and the
 * duplicate check see them like catalogue products.
 *
 * Ingredient amounts on a `UserProduct` are per one unit of `doseUnit`, as a label's "Each
 * capsule contains…" line and Health Canada's licences give them. The engine product mirrors
 * the bundled data: `servingSize` "1 capsule", `amountPerDose` per that serving, and
 * `unitsPerDose` capsules taken each time.
 */
import {
  USER_PRODUCT_TIMINGS,
  USER_RULE_ID_PREFIX,
  type Catalogue,
  type Ingredient,
  type LocalizedText,
  type Product,
  type ProductIngredient,
  type TimingRule,
  type Unit,
  type UserProduct,
  type UserProductIngredient,
  type UserProductTiming,
} from '@smartstack/shared'
import { catalogue as bundledCatalogue } from './catalogue'
import { fold } from './fold'
import { convertUnit, matchCanonical } from './import/ingredients'
import type { RawUnit } from './import/recipe'

// ---------------------------------------------------------------------------
// Ingredient recognition and units
// ---------------------------------------------------------------------------

const UNIT_WORDS: readonly [RegExp, RawUnit][] = [
  [/^(?:mg|milligram(?:me)?s?)$/i, 'mg'],
  [/^(?:mcg|µg|μg|ug|microgram(?:me)?s?)$/i, 'mcg'],
  [/^(?:g|grams?|grammes?)$/i, 'g'],
  [/^(?:iu|ui)$/i, 'IU'],
  [/^(?:cfu|ufc)$/i, 'CFU'],
]

/** "mg", "µg", "UI", "milligrams"… → a unit the converter knows; null for ml, % and the like. */
export function normalizeIngredientUnit(unit: string): RawUnit | null {
  const word = unit.trim().replace(/\.$/, '')
  for (const [re, raw] of UNIT_WORDS) if (re.test(word)) return raw
  return null
}

/**
 * French names (and salt names) of canonical nutrients that the importer's English patterns
 * miss. Tested against the folded name (lowercase, no accents) with qualifiers removed.
 */
const EXTRA_PATTERNS: readonly [RegExp, string][] = [
  [/^fer\b|\bferr(?:ous|ic|eux|ique)\b/, 'iron'],
  [/^cuivre\b/, 'copper'],
  [/^chrome\b/, 'chromium'],
  [/^iode\b|\biodure\b/, 'iodine'],
  [/^bore\b/, 'boron'],
  [/^silicium\b|^silice\b/, 'silicon'],
  [/^molybdene\b/, 'molybdenum'],
  [/^acide folique\b/, 'folate'],
  [/^huile de (?:poisson|krill|foie de morue)\b/, 'fish-oil'],
  [/^aep\b|acide eicosapentaenoique/, 'epa'],
  [/^adh\b|acide docosahexaenoique/, 'dha'],
]

/** "Iron (ferrous fumarate)" → "Iron"; "Vitamin D3 [cholecalciferol]" → "Vitamin D3". */
function withoutQualifiers(name: string): string {
  return name
    .replace(/\([^()]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[™®*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

interface IngredientIndex {
  units: ReadonlyMap<string, Unit>
  /** Folded EN and FR names (with and without qualifiers) → id; the first ingredient wins. */
  names: ReadonlyMap<string, string>
}

// One index per ingredient list: mergeCatalogue runs on every render in the app.
const indexes = new WeakMap<readonly Ingredient[], IngredientIndex>()

function indexFor(ingredients: readonly Ingredient[]): IngredientIndex {
  const cached = indexes.get(ingredients)
  if (cached) return cached
  const units = new Map<string, Unit>()
  const names = new Map<string, string>()
  for (const ingredient of ingredients) {
    units.set(ingredient.id, ingredient.unit)
    for (const name of [ingredient.name.en, ingredient.name.fr]) {
      if (!name) continue
      for (const key of [fold(name).trim(), fold(withoutQualifiers(name))]) {
        if (key && !names.has(key)) names.set(key, ingredient.id)
      }
    }
  }
  const index = { units, names }
  indexes.set(ingredients, index)
  return index
}

/**
 * The catalogue ingredient a free-text name stands for, or null: an exact (case- and
 * accent-insensitive) match on an ingredient's English or French name first, then the
 * importer's canonical patterns ("Magnesium bisglycinate" → magnesium, "Cholecalciferol" →
 * vitamin-d), then French and salt names ("Fer", "Fumarate ferreux", "Huile de poisson").
 * Only ids present in `ingredients` are returned. Used by `toEngineProduct` for rows without
 * an `ingredientId`, and by the form to prefill `ingredientId` (e.g. after a Health Canada
 * lookup).
 */
export function recognizeIngredient(
  name: string,
  ingredients: readonly Ingredient[] = bundledCatalogue.ingredients,
): string | null {
  const index = indexFor(ingredients)
  const base = withoutQualifiers(name) || name.trim()
  const folded = fold(base)
  const candidates = [
    index.names.get(fold(name).trim()),
    index.names.get(folded),
    matchCanonical(base),
    matchCanonical(folded),
    matchCanonical(folded.replace(/^vitamine\b/, 'vitamin')),
    EXTRA_PATTERNS.find(([re]) => re.test(folded))?.[1],
  ]
  return candidates.find((id): id is string => !!id && index.units.has(id)) ?? null
}

/**
 * The rows that can take part in rules and duplicates: a known ingredient (its own id, else
 * recognized from its name) with an amount in a unit that converts to the ingredient's
 * canonical unit (as the importer does: g → mg → mcg, vitamin D IU → mcg ÷ 40; a vitamin in
 * IU the importer keeps apart, like `vitamin-a-iu`, goes there). Same ingredient twice →
 * summed. Everything else stays free text on the `UserProduct`.
 */
export function canonicalIngredients(
  rows: readonly UserProductIngredient[],
  ingredients: readonly Ingredient[] = bundledCatalogue.ingredients,
): ProductIngredient[] {
  const index = indexFor(ingredients)
  const amounts = new Map<string, number>()
  for (const row of rows) {
    if (row.amount === null || row.unit === null || !(row.amount > 0)) continue
    const unit = normalizeIngredientUnit(row.unit)
    if (!unit) continue
    const id =
      row.ingredientId && index.units.has(row.ingredientId)
        ? row.ingredientId
        : recognizeIngredient(row.name, ingredients)
    if (!id) continue
    let target = id
    let amount = convertUnit(row.amount, unit, index.units.get(id)!, id)
    if (amount === null) {
      // The importer's fallback for a unit that does not convert: "<id>-<unit>" (vitamin-a-iu).
      const apart = `${id}-${unit.toLowerCase()}`
      const apartUnit = index.units.get(apart)
      if (!apartUnit) continue
      target = apart
      amount = convertUnit(row.amount, unit, apartUnit, apart)
      if (amount === null) continue
    }
    amounts.set(target, (amounts.get(target) ?? 0) + amount)
  }
  return [...amounts.entries()].map(([ingredientId, amountPerDose]) => ({
    ingredientId,
    amountPerDose: Math.round(amountPerDose * 1000) / 1000,
  }))
}

// ---------------------------------------------------------------------------
// Product and label rules
// ---------------------------------------------------------------------------

/** nhp → nhp, medication → medication, food and other → food (scheduled, no NPN). */
export function engineKind(type: UserProduct['productType']): Product['kind'] {
  if (type === 'nhp') return 'nhp'
  if (type === 'medication') return 'medication'
  return 'food'
}

/** The dose unit as the engine's `unitLabel` ("other" reads "serving"). */
function unitLabelFor(doseUnit: string): string {
  const unit = doseUnit.trim().toLowerCase()
  return unit && unit !== 'other' ? unit : 'serving'
}

function freeText(text: string | null): LocalizedText | undefined {
  const trimmed = text?.trim()
  return trimmed ? { en: trimmed } : undefined
}

/**
 * A `UserProduct` as an engine `Product`: id `u_…`, status `user`, unreviewed, the person's
 * doses as the label defaults, and only the ingredients `canonicalIngredients` accepts.
 * Directions and warnings ride along inline (their language is whatever the person typed,
 * stored under `en`). A medication's strength becomes its subtitle.
 */
export function toEngineProduct(
  userProduct: UserProduct,
  ingredients: readonly Ingredient[] = bundledCatalogue.ingredients,
): Product {
  const up = userProduct
  const unitLabel = unitLabelFor(up.doseUnit)
  const directions = freeText(up.directions)
  const warnings = freeText(up.warnings)
  const strength = up.productType === 'medication' ? freeText(up.strength) : undefined
  return {
    id: up.id,
    ...(up.upc ? { upc: up.upc } : {}),
    ...(up.npn ? { npn: up.npn } : {}),
    kind: engineKind(up.productType),
    brand: up.brand?.trim() ?? '',
    name: { en: up.name },
    shortName: { en: up.name },
    ...(strength ? { subtitle: strength } : {}),
    form: up.form,
    servingSize: `1 ${unitLabel}`,
    dosesPerDayDefault: up.dosesPerDay,
    unitsPerDose: up.unitsPerDose,
    unitLabel,
    ...(directions ? { directions } : {}),
    ...(warnings ? { warnings } : {}),
    status: 'user',
    ingredients: canonicalIngredients(up.ingredients, ingredients),
    reviewStatus: 'unreviewed',
    lastReviewed: null,
    reviewedBy: null,
  }
}

/** Quebec French: a no-break space before the colon. */
const NBSP = String.fromCharCode(0xa0)

const LABEL_EXPLANATIONS: Record<UserProductTiming, LocalizedText> = {
  WITH_FOOD: {
    en: 'From your label: take with food.',
    fr: `Selon votre étiquette${NBSP}: prendre avec de la nourriture.`,
  },
  WITHOUT_FOOD: {
    en: 'From your label: take on an empty stomach.',
    fr: `Selon votre étiquette${NBSP}: prendre à jeun.`,
  },
  MORNING: {
    en: 'From your label: take in the morning.',
    fr: `Selon votre étiquette${NBSP}: prendre le matin.`,
  },
  EVENING: {
    en: 'From your label: take in the evening.',
    fr: `Selon votre étiquette${NBSP}: prendre le soir.`,
  },
  BEDTIME: {
    en: 'From your label: take at bedtime.',
    fr: `Selon votre étiquette${NBSP}: prendre au coucher.`,
  },
}

/** `user:{productId}:{attribute}` */
export function userRuleId(productId: string, attribute: UserProductTiming): string {
  return `${USER_RULE_ID_PREFIX}${productId}:${attribute}`
}

/**
 * The label checkboxes as product-level rules: severity `product_instruction` (copied from
 * the person's label), no source, unreviewed, in a fixed attribute order. With food, morning,
 * evening and bedtime place the dose like a label rule does; on an empty stomach is shown,
 * never used for placement. Medications get none.
 */
export function userRules(userProduct: UserProduct): TimingRule[] {
  if (userProduct.productType === 'medication') return []
  return USER_PRODUCT_TIMINGS.filter((t) => userProduct.timing.includes(t)).map((attribute) => ({
    id: userRuleId(userProduct.id, attribute),
    attribute,
    appliesTo: { productId: userProduct.id },
    severity: 'product_instruction',
    explanation: LABEL_EXPLANATIONS[attribute],
    evidenceUrl: null,
    reviewStatus: 'unreviewed',
    lastReviewed: null,
    reviewedBy: null,
  }))
}

/**
 * The bundled catalogue plus the person's products and label rules (appended, so bundled
 * products keep their positions). Runs on every render in the app, so it stays cheap: no
 * validation (the `UserProduct` schema already holds), a cached ingredient index, and `base`
 * itself when there is nothing to add. The web hook `useCatalogue()` memoizes the result on
 * (base, userProducts) so the scheduler and the lookups get a stable object. A repeated
 * user-product id keeps its first occurrence.
 */
export function mergeCatalogue(base: Catalogue, userProducts: readonly UserProduct[]): Catalogue {
  if (userProducts.length === 0) return base
  const seen = new Set<string>()
  const unique = userProducts.filter((up) => !seen.has(up.id) && seen.add(up.id))
  return {
    ingredients: base.ingredients,
    products: [...base.products, ...unique.map((up) => toEngineProduct(up, base.ingredients))],
    rules: [...base.rules, ...unique.flatMap(userRules)],
  }
}
