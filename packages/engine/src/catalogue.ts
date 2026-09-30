import type {
  Catalogue,
  CuratedAlternative,
  Ingredient,
  Product,
  TimingRule,
} from '@smartstack/shared'
import alternativesJson from '../data/alternatives.json'
import ingredientsJson from '../data/ingredients.json'
import productsJson from '../data/products.json'
import generatedRulesJson from '../data/rules.generated.json'
import curatedRulesJson from '../data/rules.json'
import { barcodesMatch } from './barcode'
import { fold } from './fold'
import { validateAlternatives, validateCatalogue } from './validate'

function loadCatalogue(): Catalogue {
  const result = validateCatalogue({
    ingredients: ingredientsJson,
    products: productsJson,
    // Curated ingredient-level rules first, then the label-derived product rules.
    rules: [...curatedRulesJson, ...generatedRulesJson],
  })
  if (!result.ok) {
    throw new Error(`Invalid catalogue:\n${result.errors.join('\n')}`)
  }
  return result.catalogue
}

/**
 * The catalogue bundled with the app: New Roots Herbal products imported from
 * newrootsherbal.com (`npm run data:import:website`), never fetched at runtime.
 */
export const catalogue: Catalogue = loadCatalogue()

function loadAlternatives(): CuratedAlternative[] {
  const result = validateAlternatives(alternativesJson, catalogue)
  if (!result.ok) throw new Error(`Invalid alternatives.json:\n${result.errors.join('\n')}`)
  return result.alternatives
}

/**
 * New Roots Herbal alternatives chosen by the product team for other brands' products
 * (`data/alternatives.json`, filled from the other-brand report), for `suggestAlternatives`.
 */
export const curatedAlternatives: CuratedAlternative[] = loadAlternatives()

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function listProducts(cat: Catalogue = catalogue): Product[] {
  return cat.products
}

export function getProduct(id: string, cat: Catalogue = catalogue): Product | undefined {
  return cat.products.find((p) => p.id === id)
}

export function getIngredient(id: string, cat: Catalogue = catalogue): Ingredient | undefined {
  return cat.ingredients.find((i) => i.id === id)
}

export function getRule(id: string, cat: Catalogue = catalogue): TimingRule | undefined {
  return cat.rules.find((r) => r.id === id)
}

/** Every barcode that identifies the product (primary + all variants). */
export function productBarcodes(product: Product): string[] {
  const codes = [product.upc, ...(product.variants ?? []).map((v) => v.upc)]
  return [...new Set(codes)].filter((code): code is string => code !== undefined)
}

export function findProductByBarcode(
  code: string,
  cat: Catalogue = catalogue,
): Product | undefined {
  return cat.products.find((p) => productBarcodes(p).some((upc) => barcodesMatch(upc, code)))
}

/** Case- and accent-insensitive name search (EN and FR), for the browse list. */
export function searchProducts(query: string, cat: Catalogue = catalogue): Product[] {
  const q = fold(query.trim())
  if (!q) return cat.products
  return cat.products.filter(
    (p) =>
      fold(p.name.en).includes(q) ||
      (p.name.fr ? fold(p.name.fr).includes(q) : false) ||
      p.sku === q ||
      productBarcodes(p).includes(q),
  )
}

export function productContainsIngredient(product: Product, ingredientId: string): boolean {
  return product.ingredients.some((pi) => pi.ingredientId === ingredientId)
}

/**
 * Rules that apply to a product: ingredient-level rules for every ingredient it
 * contains, plus product-level rules, minus `ruleOverrides.disable`. When two
 * rules share an attribute, the product-level one wins; otherwise the first in
 * rules order. Result is in rules order. A medication gets none: it stays where the person
 * takes it and carries no reasons (its ingredients still move other products, see the
 * scheduler).
 */
export function rulesForProduct(product: Product, cat: Catalogue = catalogue): TimingRule[] {
  if (product.kind === 'medication') return []
  const disabled = new Set(product.ruleOverrides?.disable ?? [])
  const ingredientIds = new Set(product.ingredients.map((pi) => pi.ingredientId))
  const applicable = cat.rules.filter((r) => {
    if (disabled.has(r.id)) return false
    if ('productId' in r.appliesTo) return r.appliesTo.productId === product.id
    return ingredientIds.has(r.appliesTo.ingredientId)
  })
  const byAttribute = new Map<string, TimingRule>()
  for (const rule of applicable) {
    const existing = byAttribute.get(rule.attribute)
    if (!existing) {
      byAttribute.set(rule.attribute, rule)
      continue
    }
    const existingIsProductLevel = 'productId' in existing.appliesTo
    const ruleIsProductLevel = 'productId' in rule.appliesTo
    if (ruleIsProductLevel && !existingIsProductLevel) byAttribute.set(rule.attribute, rule)
  }
  const chosen = new Set(byAttribute.values())
  return cat.rules.filter((r) => chosen.has(r))
}
