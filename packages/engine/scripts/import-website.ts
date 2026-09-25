/**
 * Website importer — builds packages/engine/data/{products,ingredients,rules.generated,
 * product-text}.json and import-report.md from newrootsherbal.com's public, price-free AI
 * catalog (see https://newrootsherbal.com/llms.txt).
 *
 *   npm run data:import:website                  # uses data/.cache/website, fetches what is missing
 *   npm run data:import:website -- --refresh     # re-downloads every product record
 *   npm run data:import:website -- --allow-shrink  # accept a catalogue >10% smaller than committed
 *
 * Every product with a valid barcode is imported: licensed products (kind "nhp", 8-digit
 * NPN), foods ("food": protein, MCT oil, sweeteners) and topicals ("topical": essential
 * and skin oils, never scheduled). Curated ingredient-level rules stay in data/rules.json.
 * Built for unattended runs: any download failure aborts, output is deterministic for
 * identical input, and only the allow-listed origin is ever fetched.
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

const ORIGIN = 'https://newrootsherbal.com'
const INDEX_URL = `${ORIGIN}/ai-catalog/products-index-en.json`
const USER_AGENT = 'Mozilla/5.0 SmartStack-importer (+https://newrootsherbal.com)'
const CONCURRENCY = 4
const ATTEMPTS = 4
const TIMEOUT_MS = 20_000
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i

const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = resolve(engineRoot, 'data')
const cacheDir = resolve(dataDir, '.cache', 'website')
const refresh = process.argv.includes('--refresh')
const allowShrink = process.argv.includes('--allow-shrink')

interface IndexEntry {
  name: string
  slug: string
  catalog_url: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** GET a JSON document from the catalogue origin, with retries; returns the raw text. */
async function fetchJson(url: string): Promise<string> {
  if (new URL(url).origin !== ORIGIN) throw new Error(`refusing to fetch ${url}: not ${ORIGIN}`)
  let lastError: unknown
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'follow',
      })
      if (new URL(res.url || url).origin !== ORIGIN) {
        throw new Error(`redirected off ${ORIGIN}: ${res.url}`)
      }
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true })
      const type = res.headers.get('content-type') ?? ''
      if (!/json/i.test(type)) throw Object.assign(new Error(`not JSON: ${type}`), { fatal: true })
      const text = await res.text()
      JSON.parse(text) // never cache something that does not parse
      return text
    } catch (err) {
      lastError = err
      if ((err as { fatal?: boolean }).fatal || attempt === ATTEMPTS) break
      await sleep(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250))
    }
  }
  throw new Error(`${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function loadIndex(): Promise<IndexEntry[]> {
  const file = resolve(cacheDir, 'index-en.json')
  if (refresh || !existsSync(file)) writeFileSync(file, await fetchJson(INDEX_URL))
  const entries = (JSON.parse(readFileSync(file, 'utf8')) as { data: IndexEntry[] }).data
  for (const e of entries) {
    if (typeof e.slug !== 'string' || !SLUG_RE.test(e.slug)) {
      throw new Error(`index entry with an unusable slug: ${JSON.stringify(e).slice(0, 120)}`)
    }
    if (new URL(e.catalog_url).origin !== ORIGIN) {
      throw new Error(`index entry ${e.slug} points off ${ORIGIN}: ${e.catalog_url}`)
    }
  }
  return entries
}

function checkRecord(entry: IndexEntry, record: unknown): WebsiteProduct {
  const r = record as WebsiteProduct
  const en = r?.languages?.en
  if (!en || typeof en.name !== 'string' || typeof en.slug !== 'string' || !SLUG_RE.test(en.slug)) {
    throw new Error(`${entry.slug}: record is missing languages.en.name/slug (shape changed?)`)
  }
  if (!r.identifiers || !Array.isArray(r.variants)) {
    throw new Error(`${entry.slug}: record is missing identifiers/variants (shape changed?)`)
  }
  return r
}

async function loadDetails(entries: IndexEntry[]): Promise<WebsiteProduct[]> {
  const out: (WebsiteProduct | undefined)[] = new Array<WebsiteProduct | undefined>(entries.length)
  const failures: string[] = []
  let next = 0
  let fetched = 0
  const worker = async () => {
    while (next < entries.length) {
      const index = next++
      const entry = entries[index]!
      const file = resolve(cacheDir, `${entry.slug}.json`)
      try {
        if (refresh || !existsSync(file)) {
          writeFileSync(file, await fetchJson(entry.catalog_url))
          fetched++
        }
        out[index] = checkRecord(entry, JSON.parse(readFileSync(file, 'utf8')))
      } catch (err) {
        failures.push(`${entry.slug}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  const records = out.filter((r): r is WebsiteProduct => r !== undefined)
  console.log(
    `records: ${records.length} (${fetched} downloaded, ${records.length - fetched} from cache)`,
  )
  if (failures.length) {
    for (const f of failures) console.error(`  ! ${f}`)
    // Unattended runs must not turn a flaky download into a PR that deletes products.
    throw new Error(
      `${failures.length} product record(s) could not be downloaded or read; aborting so nothing is dropped by mistake`,
    )
  }
  return records
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
  // Deterministic order regardless of download order: name, then the unique slug.
  records.sort(
    (a, b) =>
      a.languages.en.name.localeCompare(b.languages.en.name, 'en') ||
      (a.languages.en.slug < b.languages.en.slug
        ? -1
        : a.languages.en.slug > b.languages.en.slug
          ? 1
          : 0),
  )

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

  // A website hiccup or a changed JSON shape must not shrink the catalogue unnoticed.
  const previousFile = resolve(dataDir, 'products.json')
  if (existsSync(previousFile) && !allowShrink) {
    const previous = (JSON.parse(readFileSync(previousFile, 'utf8')) as unknown[]).length
    if (products.length < Math.floor(previous * 0.9)) {
      throw new Error(
        `only ${products.length} products imported versus ${previous} committed (more than 10% fewer); aborting. Re-run with --allow-shrink if this is expected.`,
      )
    }
  }

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
  // Deterministic report (no dates, nothing that changes without a data change) so an
  // unchanged catalogue leaves the tree clean; the weekly workflow posts it as the PR body.
  // Lists are fenced so website text cannot render as links or mentions there.
  const fence = (lines: string[]) => (lines.length ? ['```', ...lines, '```'] : ['(none)'])
  const report = [
    '# Catalogue import report',
    '',
    `Source: ${ORIGIN}/ai-catalog`,
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
    ...fence(skipped),
    '',
    '## Warnings',
    '',
    ...fence(warnings),
    '',
  ].join('\n')
  writeFileSync(resolve(dataDir, 'import-report.md'), report)
  console.log(
    '✓ wrote data/products.json, data/ingredients.json, data/rules.generated.json, data/product-text.json, data/import-report.md',
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
