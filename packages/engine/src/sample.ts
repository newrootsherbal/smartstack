/**
 * The original ten-product sample catalogue (GS1 "200" barcodes, SAMPLE NPNs).
 * Kept as a stable fixture for the engine tests and the pitch's section-5
 * example; the app itself ships the catalogue imported from newrootsherbal.com.
 */
import type { Catalogue } from '@smartstack/shared'
import ingredientsJson from '../data/sample/ingredients.json'
import productsJson from '../data/sample/products.json'
import rulesJson from '../data/sample/rules.json'
import { validateCatalogue } from './validate'

function load(): Catalogue {
  const result = validateCatalogue({
    ingredients: ingredientsJson,
    products: productsJson,
    rules: rulesJson,
  })
  if (!result.ok) throw new Error(`Invalid sample catalogue:\n${result.errors.join('\n')}`)
  return result.catalogue
}

export const sampleCatalogue: Catalogue = load()
