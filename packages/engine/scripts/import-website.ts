/**
 * Website importer — builds packages/engine/data/{products,ingredients,rules.generated}.json
 * from newrootsherbal.com's public, price-free AI catalog (see https://newrootsherbal.com/llms.txt).
 *
 *   npm run data:import:website            # uses data/.cache/website, fetches what is missing
 *   npm run data:import:website -- --refresh   # re-downloads every product record
 *
 * Only licensed natural health products (8-digit NPN) with a barcode and parsable
 * supplement facts are imported. Curated ingredient-level rules stay in data/rules.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Ingredient, Product, TimingRule, Unit } from '@smartstack/shared'
import {
  convertWebsiteProduct,
  type ImportContext,
  type ProductText,
  type WebsiteProduct,
} from '../src/import/product'
import { validateCatalogue } from '../src/validate'

const INDEX_URL = 'https://newrootsherbal.com/ai-catalog/products-index-en.json'
const USER_AGENT = 'Mozilla/5.0 SmartStack-importer (+https://newrootsherbal.com)'
const CONCURRENCY = 6

const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = resolve(engineRoot, 'data')
const cacheDir = resolve(dataDir, '.cache', 'website')
const refresh = process.argv.includes('--refresh')

interface IndexEntry {
  name: string
  slug: string
  catalog_url: string
}

async function fetchJson(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

async function loadIndex(): Promise<IndexEntry[]> {
  const file = resolve(cacheDir, 'index-en.json')
  if (refresh || !existsSync(file)) writeFileSync(file, await fetchJson(INDEX_URL))
  return (JSON.parse(readFileSync(file, 'utf8')) as { data: IndexEntry[] }).data
}

async function loadDetails(entries: IndexEntry[]): Promise<WebsiteProduct[]> {
  const queue = [...entries]
  const out: WebsiteProduct[] = []
  const failures: string[] = []
  let fetched = 0
  const worker = async () => {
    while (queue.length) {
      const entry = queue.shift()!
      const file = resolve(cacheDir, `${entry.slug}.json`)
      try {
        if (refresh || !existsSync(file)) {
          writeFileSync(file, await fetchJson(entry.catalog_url))
          fetched++
        }
        out.push(JSON.parse(readFileSync(file, 'utf8')) as WebsiteProduct)
      } catch (err) {
        failures.push(`${entry.slug}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  console.log(`records: ${out.length} (${fetched} downloaded, ${out.length - fetched} from cache)`)
  for (const f of failures) console.warn(`  ! ${f}`)
  return out
}

async function main() {
  mkdirSync(cacheDir, { recursive: true })
  const curatedRules = JSON.parse(
    readFileSync(resolve(dataDir, 'rules.json'), 'utf8'),
  ) as TimingRule[]
  const ctx: ImportContext = {
    units: new Map<string, Unit>(),
    ingredients: new Map<string, Ingredient>(),
    curatedRuleIds: new Set(curatedRules.map((r) => r.id)),
  }

  const records = await loadDetails(await loadIndex())
  records.sort((a, b) => a.languages.en.name.localeCompare(b.languages.en.name, 'en'))

  const products: Product[] = []
  const generatedRules: TimingRule[] = []
  const text: Record<string, ProductText> = {}
  const skipped: string[] = []
  const warnings: string[] = []
  for (const record of records) {
    const result = convertWebsiteProduct(record, ctx)
    warnings.push(...result.warnings)
    if (!result.product) {
      skipped.push(`${record.languages.en.name}: ${result.skipped}`)
      continue
    }
    products.push(result.product)
    generatedRules.push(...result.rules)
    text[result.product.id] = result.text
  }

  const ingredients = [...ctx.ingredients.values()].sort((a, b) => a.id.localeCompare(b.id))

  // Curated rules must point at ingredients that exist after this import.
  for (const rule of curatedRules) {
    if ('ingredientId' in rule.appliesTo && !ctx.ingredients.has(rule.appliesTo.ingredientId)) {
      warnings.push(
        `curated rule ${rule.id} targets ingredient "${rule.appliesTo.ingredientId}", which no imported product contains`,
      )
    }
  }

  const result = validateCatalogue({
    ingredients,
    products,
    rules: [...curatedRules, ...generatedRules],
  })

  console.log(`products: ${products.length} imported, ${skipped.length} skipped`)
  console.log(
    `ingredients: ${ingredients.length} · label rules: ${generatedRules.length} · curated rules: ${curatedRules.length}`,
  )
  if (skipped.length) {
    console.log('skipped:')
    for (const s of skipped) console.log(`  - ${s}`)
  }
  if (warnings.length) {
    console.log(`warnings (${warnings.length}, first 40):`)
    for (const w of warnings.slice(0, 40)) console.log(`  ! ${w}`)
  }
  if (!result.ok) {
    console.error(`✗ catalogue invalid — ${result.errors.length} problem(s):`)
    for (const e of result.errors.slice(0, 60)) console.error(`  - ${e}`)
    process.exit(1)
  }

  const write = (name: string, value: unknown) =>
    writeFileSync(resolve(dataDir, name), JSON.stringify(value, null, 2) + '\n')
  write('products.json', products)
  write('ingredients.json', ingredients)
  write('rules.generated.json', generatedRules)
  write('product-text.json', text)
  // Deterministic report (no timestamp) so an unchanged catalogue leaves the tree clean;
  // the weekly refresh workflow uses it as the pull-request body.
  const newest = records
    .map((r) => r.updated_at ?? '')
    .sort()
    .at(-1)
  const report = [
    '# Catalogue import report',
    '',
    `Source: https://newrootsherbal.com/ai-catalog (newest record updated ${newest || 'unknown'})`,
    '',
    `- Records: ${records.length}`,
    `- Products imported: ${products.length}`,
    `- Skipped: ${skipped.length}`,
    `- Ingredients: ${ingredients.length}`,
    `- Label-derived rules: ${generatedRules.length} (curated: ${curatedRules.length})`,
    `- Parser warnings: ${warnings.length}`,
    '',
    '## Skipped',
    '',
    ...skipped.map((s) => `- ${s}`),
    '',
    '## Warnings',
    '',
    ...warnings.map((w) => `- ${w}`),
    '',
  ].join('\n')
  writeFileSync(resolve(dataDir, 'import-report.md'), report)
  console.log(
    '✓ wrote data/products.json, data/ingredients.json, data/rules.generated.json, data/product-text.json, data/import-report.md',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
