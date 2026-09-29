/**
 * New Roots Herbal alternatives for a person's other-brand product (§4.9, M7): at most two
 * catalogue products, curated first, then computed from shared canonical ingredients. Never
 * for medications. The app words it as a question ("Have you considered…?"), never as "same
 * as", "equivalent" or "better"; the facts returned here are what the optional line shows
 * ("Also magnesium, 200 mg per capsule").
 */
import type {
  Catalogue,
  CuratedAlternative,
  Product,
  StackItem,
  Unit,
  UserProduct,
} from '@smartstack/shared'
import { barcodesMatch } from './barcode'
import { getIngredient, getProduct } from './catalogue'
import { fold } from './fold'
import { canonicalIngredients } from './user-products'

export const MAX_ALTERNATIVES = 2
export const MIN_ALTERNATIVE_SCORE = 0.5
const SAME_FORM_BONUS = 0.15
const NAME_WORD_BONUS = 0.1

/**
 * Words that say what kind of supplement a name is, beyond its nutrients (the form of a
 * mineral, the vitamin's form, the oil). Matched as whole words of both names, folded.
 */
export const DISTINCTIVE_NAME_WORDS: readonly string[] = [
  'bisglycinate',
  'glycinate',
  'citrate',
  'malate',
  'threonate',
  'picolinate',
  'd3',
  'k2',
  'omega',
  'epa',
  'dha',
  'krill',
  'probiotic',
  'probiotique',
  'b12',
  'methylcobalamin',
  'methylcobalamine',
  'methylfolate',
  'ubiquinol',
]

export interface AlternativeFact {
  ingredientId: string
  unit: Unit
  /** The catalogue product's amount per label serving (its `amountPerDose`), e.g. 200. */
  amount: number
  /** The serving that amount is for, as printed, e.g. "1 capsule" → "200 mg per capsule". */
  serving: string
  /** Daily amount of the catalogue product at its label's default doses. */
  dailyAmount: number
  /** Daily amount of the person's product at their doses. */
  userDailyAmount: number
}

export interface Alternative {
  productId: string
  source: 'curated' | 'computed'
  /** Computed matches: 0.5 to 1 (capped). Curated: null (chosen by the product team). */
  score: number | null
  /** Shared canonical ingredients, in the catalogue product's label order (may be empty when curated). */
  facts: AlternativeFact[]
}

/**
 * Label servings taken at once: the label's units per dose over the serving the amounts are
 * given for ("1 capsule", 2 per dose → 2; "6 vegetable capsules", 2 per dose → ⅓), or 1 when
 * the serving is not counted in the same unit ("1 ml (40 drops)" for a dose in drops).
 */
export function servingsPerDose(product: Product): number {
  if (!product.unitsPerDose || !product.unitLabel) return 1
  const m = /^\s*(\d+(?:[.,]\d+)?|\d+\/\d+|[½¼¾])[\s-]+([^(]*)/.exec(product.servingSize)
  if (!m) return 1
  const count = quantity(m[1]!)
  if (!(count > 0) || !fold(m[2]!).includes(product.unitLabel.toLowerCase())) return 1
  return product.unitsPerDose / count
}

function quantity(text: string): number {
  if (text === '½') return 0.5
  if (text === '¼') return 0.25
  if (text === '¾') return 0.75
  const fraction = /^(\d+)\/(\d+)$/.exec(text)
  if (fraction) return Number(fraction[1]) / Number(fraction[2])
  return Number(text.replace(',', '.'))
}

/** Daily amount per ingredient of a catalogue product at its label's default doses. */
function labelDailyAmounts(product: Product): Map<string, number> {
  const perDose = servingsPerDose(product) * product.dosesPerDayDefault
  return new Map(product.ingredients.map((pi) => [pi.ingredientId, pi.amountPerDose * perDose]))
}

function nameWords(...names: (string | undefined)[]): Set<string> {
  const words = new Set<string>()
  for (const name of names) {
    if (!name) continue
    for (const word of fold(name).split(/[^a-z0-9]+/)) {
      if (DISTINCTIVE_NAME_WORDS.includes(word)) words.add(word)
    }
  }
  return words
}

function normalized(text: string): string {
  return fold(text).replace(/\s+/g, ' ').trim()
}

function curatedMatch(entry: CuratedAlternative, up: UserProduct): boolean {
  if ('upc' in entry.match) return up.upc !== null && barcodesMatch(entry.match.upc, up.upc)
  return (
    up.brand !== null &&
    normalized(up.brand) === normalized(entry.match.brand) &&
    normalized(up.name).includes(normalized(entry.match.name))
  )
}

function isCandidate(product: Product | undefined): product is Product {
  return (
    product !== undefined &&
    (product.kind === 'nhp' || product.kind === 'food') &&
    product.status !== 'user'
  )
}

interface Scored {
  alternative: Alternative
  raw: number
  distance: number
  name: string
}

/**
 * At most two catalogue products for a person's own product, each with the facts that
 * explain it. Never for a medication, never a product already in the stack.
 *
 * 1. Curated entries that match the product (barcode, or brand + name), in file order.
 * 2. Computed: catalogue products of kind nhp or food sharing at least one canonical
 *    ingredient. Score = Σ over shared ingredients of min(daily a, daily b) ÷ max(daily a,
 *    daily b), divided by the number of ingredients in either product; + 0.15 for the same
 *    form; + 0.1 per shared distinctive name word; capped at 1; kept from 0.5. Daily amounts:
 *    amount per dose × doses per day (the person's doses for theirs; the label's units per
 *    dose and default doses for the catalogue product, see `servingsPerDose`). Ties: closer
 *    amounts (Σ |a − b| ÷ max(a, b) over shared ingredients), then the uncapped score (so a
 *    perfect match in the same form comes first), then the English name.
 */
export function suggestAlternatives(
  userProduct: UserProduct,
  catalogue: Catalogue,
  curated: readonly CuratedAlternative[],
  stack: readonly Pick<StackItem, 'productId'>[],
): Alternative[] {
  if (userProduct.productType === 'medication') return []
  const inStack = new Set(stack.map((item) => item.productId))
  const perDose = userProduct.unitsPerDose * userProduct.dosesPerDay
  const userDaily = new Map(
    canonicalIngredients(userProduct.ingredients, catalogue.ingredients).map((pi) => [
      pi.ingredientId,
      pi.amountPerDose * perDose,
    ]),
  )

  const factsFor = (product: Product, daily: Map<string, number>): AlternativeFact[] =>
    product.ingredients.flatMap((pi) => {
      const userDailyAmount = userDaily.get(pi.ingredientId)
      const unit = getIngredient(pi.ingredientId, catalogue)?.unit
      if (userDailyAmount === undefined || !unit) return []
      return [
        {
          ingredientId: pi.ingredientId,
          unit,
          amount: pi.amountPerDose,
          serving: product.servingSize,
          dailyAmount: round(daily.get(pi.ingredientId)!),
          userDailyAmount: round(userDailyAmount),
        },
      ]
    })

  const results: Alternative[] = []
  const taken = new Set<string>()
  for (const entry of curated) {
    if (results.length >= MAX_ALTERNATIVES) return results
    const product = getProduct(entry.productId, catalogue)
    if (!curatedMatch(entry, userProduct) || !isCandidate(product)) continue
    if (inStack.has(product.id) || taken.has(product.id)) continue
    taken.add(product.id)
    results.push({
      productId: product.id,
      source: 'curated',
      score: null,
      facts: factsFor(product, labelDailyAmounts(product)),
    })
  }
  if (results.length >= MAX_ALTERNATIVES || userDaily.size === 0) return results

  const userWords = nameWords(userProduct.name)
  const scored: Scored[] = []
  for (const product of catalogue.products) {
    if (!isCandidate(product) || inStack.has(product.id) || taken.has(product.id)) continue
    const daily = labelDailyAmounts(product)
    let overlap = 0
    let distance = 0
    let shared = 0
    for (const [id, a] of userDaily) {
      const b = daily.get(id)
      if (b === undefined) continue
      shared += 1
      overlap += Math.min(a, b) / Math.max(a, b)
      distance += Math.abs(a - b) / Math.max(a, b)
    }
    if (shared === 0) continue
    const union = new Set([...userDaily.keys(), ...daily.keys()]).size
    const productWords = nameWords(product.name.en, product.name.fr)
    const sharedWords = [...userWords].filter((w) => productWords.has(w)).length
    const raw =
      overlap / union +
      (product.form === userProduct.form ? SAME_FORM_BONUS : 0) +
      NAME_WORD_BONUS * sharedWords
    const score = round(Math.min(1, raw))
    if (score < MIN_ALTERNATIVE_SCORE) continue
    scored.push({
      alternative: {
        productId: product.id,
        source: 'computed',
        score,
        facts: factsFor(product, daily),
      },
      raw: round(raw),
      distance: round(distance),
      name: fold(product.name.en),
    })
  }
  scored.sort(
    (a, b) =>
      b.alternative.score! - a.alternative.score! ||
      a.distance - b.distance ||
      b.raw - a.raw ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  )
  for (const s of scored) {
    if (results.length >= MAX_ALTERNATIVES) break
    results.push(s.alternative)
  }
  return results
}

/** Six decimals: keeps float noise out of thresholds and ties. */
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6
}
