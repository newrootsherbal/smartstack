/**
 * `npm run data:validate` — validate packages/engine/data/*.json against the
 * shared zod schemas plus the referential and sample-data rules in src/validate.ts.
 * Exits 1 with a readable list when anything is wrong.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCatalogue } from '../src/validate'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(root, 'data', name), 'utf8')) as unknown

const result = validateCatalogue({
  ingredients: read('ingredients.json'),
  products: read('products.json'),
  rules: read('rules.json'),
})

if (!result.ok) {
  console.error(`✗ catalogue invalid — ${result.errors.length} problem(s):`)
  for (const e of result.errors) console.error(`  - ${e}`)
  process.exit(1)
}

const { ingredients, products, rules } = result.catalogue
console.log(
  `✓ catalogue valid: ${ingredients.length} ingredients, ${products.length} products, ${rules.length} rules`,
)
