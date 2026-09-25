/**
 * CSV → JSON importer for the product team's spreadsheet (docs/data-template.md).
 *
 *   npx tsx packages/engine/scripts/import-csv.ts path/to/products.csv [--out dir]
 *
 * Writes `products.json` and `rules.json` (product-level rules only) to the
 * output directory (default packages/engine/data/import/) and validates the
 * result together with the existing ingredients and rules. Nothing in
 * packages/engine/data/*.json is modified: a developer reviews the output and
 * merges it by hand.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ANCHORS,
  RULE_ATTRIBUTES,
  SEVERITIES,
  type Ingredient,
  type Product,
  type TimingRule,
} from '@smartstack/shared'
import { validateCatalogue } from '../src/validate'

// ---------------------------------------------------------------------------
// CSV parsing (RFC 4180: quoted fields, doubled quotes, embedded newlines)
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text // strip a UTF-8 BOM
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else field += ch
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

export const CSV_COLUMNS = [
  'id',
  'sku',
  'upc',
  'npn',
  'brand',
  'name_en',
  'name_fr',
  'short_name_en',
  'short_name_fr',
  'form',
  'serving_size',
  'doses_per_day_default',
  'ingredients',
  'directions_en',
  'directions_fr',
  'warnings_en',
  'warnings_fr',
  'timing_rules',
  'interaction_rules',
  'rule_explanations_en',
  'rule_explanations_fr',
  'evidence_sources',
  'disable_rules',
  'label_version',
  'status',
  'review_status',
  'last_reviewed',
  'reviewed_by',
] as const
type Column = (typeof CSV_COLUMNS)[number]
type Row = Record<Column, string>

const splitList = (s: string) =>
  s
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)

/** "KEY=value; KEY2=value2" → Map */
const parsePairs = (s: string): Map<string, string> => {
  const map = new Map<string, string>()
  for (const item of splitList(s)) {
    const eq = item.indexOf('=')
    if (eq === -1) throw new Error(`expected KEY=value, got "${item}"`)
    map.set(item.slice(0, eq).trim(), item.slice(eq + 1).trim())
  }
  return map
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const localized = (en: string, fr: string) => (fr ? { en, fr } : { en })
const nullable = (s: string) => (s.trim() === '' ? null : s.trim())

function checkEnum<T extends string>(value: string, allowed: readonly T[], what: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${what}: "${value}" is not one of ${allowed.join(', ')}`)
  }
  return value as T
}

interface ImportResult {
  products: Product[]
  rules: TimingRule[]
  warnings: string[]
}

export function importRows(rows: Row[], ingredients: Ingredient[]): ImportResult {
  const products: Product[] = []
  const rules: TimingRule[] = []
  const warnings: string[] = []
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]))

  rows.forEach((row, index) => {
    const line = index + 2 // header is line 1
    const where = `row ${line} (${row.sku || row.name_en || '?'})`
    try {
      const id = row.id.trim() || slug(row.sku || row.name_en)
      const review = {
        reviewStatus: checkEnum(
          row.review_status || 'unreviewed',
          ['unreviewed', 'in_review', 'reviewed'] as const,
          `${where} review_status`,
        ),
        lastReviewed: nullable(row.last_reviewed),
        reviewedBy: nullable(row.reviewed_by),
      }

      const productIngredients = splitList(row.ingredients).map((item) => {
        const m = /^([a-z0-9-]+)\s*=\s*([\d.]+)\s*([A-Za-z]+)$/.exec(item)
        if (!m) throw new Error(`${where}: ingredient "${item}" must look like "iron=20 mg"`)
        const [, ingredientId, amount, unit] = m as unknown as [string, string, string, string]
        const ing = ingredientById.get(ingredientId)
        if (!ing)
          throw new Error(
            `${where}: unknown ingredient id "${ingredientId}" (add it to ingredients.json first)`,
          )
        if (ing.unit !== unit)
          throw new Error(`${where}: ${ingredientId} is stored in ${ing.unit}, not ${unit}`)
        return { ingredientId, amountPerDose: Number(amount) }
      })

      const explanationsEn = parsePairs(row.rule_explanations_en)
      const explanationsFr = parsePairs(row.rule_explanations_fr)
      const evidence = parsePairs(row.evidence_sources)

      const makeRule = (spec: string, kind: 'timing' | 'interaction'): TimingRule => {
        const [attrRaw, severityRaw, extra] = spec.split(':').map((x) => x.trim())
        const attribute = checkEnum(attrRaw ?? '', RULE_ATTRIBUTES, `${where} rule`)
        const severity = checkEnum(
          severityRaw || 'consideration',
          SEVERITIES,
          `${where} ${attribute} severity`,
        )
        const en = explanationsEn.get(attribute)
        if (!en) throw new Error(`${where}: ${attribute} needs an entry in rule_explanations_en`)
        const rule: TimingRule = {
          id: `rule-${id}-${attribute.toLowerCase().replace(/_/g, '-')}`,
          attribute,
          appliesTo: { productId: id },
          severity,
          explanation: localized(en, explanationsFr.get(attribute) ?? ''),
          evidenceUrl: evidence.get(attribute) ?? null,
          ...review,
        }
        if (kind === 'interaction') {
          if (!extra)
            throw new Error(
              `${where}: ${attribute} needs minutes, e.g. ${attribute}:${severity}:120`,
            )
          rule.separationMinutes = Number(extra)
        } else if (extra) {
          rule.preferredAnchors = extra
            .split(',')
            .map((a) => checkEnum(a.trim(), ANCHORS, `${where} ${attribute} anchor`))
            .filter((a): a is 'breakfast' | 'lunch' | 'dinner' => a !== 'bedtime')
        }
        if (!rule.evidenceUrl)
          warnings.push(
            `${where}: ${attribute} has no evidence source (will render "Source: to be added")`,
          )
        return rule
      }

      for (const spec of splitList(row.timing_rules)) rules.push(makeRule(spec, 'timing'))
      for (const spec of splitList(row.interaction_rules)) rules.push(makeRule(spec, 'interaction'))

      const disable = splitList(row.disable_rules)
      const product: Product = {
        id,
        sku: row.sku.trim(),
        upc: row.upc.replace(/\s+/g, ''),
        npn: row.npn.trim(),
        // The product-team template only describes licensed products.
        kind: 'nhp',
        brand: row.brand.trim(),
        name: localized(row.name_en.trim(), row.name_fr.trim()),
        shortName: localized(
          row.short_name_en.trim() || row.name_en.trim(),
          row.short_name_fr.trim(),
        ),
        form: checkEnum(
          row.form.trim().toLowerCase(),
          ['capsule', 'tablet', 'softgel', 'powder', 'liquid', 'other'] as const,
          `${where} form`,
        ),
        servingSize: row.serving_size.trim(),
        dosesPerDayDefault: Number(row.doses_per_day_default || 1),
        directions: localized(row.directions_en.trim(), row.directions_fr.trim()),
        warnings: localized(row.warnings_en.trim(), row.warnings_fr.trim()),
        status: checkEnum(
          row.status.trim() || 'draft',
          ['sample', 'draft', 'reviewed'] as const,
          `${where} status`,
        ),
        labelVersion: row.label_version.trim() || 'unknown',
        ingredients: productIngredients,
        ...(disable.length ? { ruleOverrides: { disable } } : {}),
        ...review,
      }
      products.push(product)
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  return { products, rules, warnings }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--'))
  if (!file) {
    console.error('usage: tsx scripts/import-csv.ts <file.csv> [--out <dir>]')
    process.exit(2)
  }
  const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const outIndex = args.indexOf('--out')
  const outDir =
    outIndex === -1 ? resolve(engineRoot, 'data', 'import') : resolve(args[outIndex + 1] ?? '.')

  const readJson = (name: string) =>
    JSON.parse(readFileSync(resolve(engineRoot, 'data', name), 'utf8')) as unknown
  const ingredients = readJson('ingredients.json') as Ingredient[]
  const existingProducts = readJson('products.json') as Product[]
  const existingRules = readJson('rules.json') as TimingRule[]

  const rows = parseCsv(readFileSync(resolve(file), 'utf8'))
  const header = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? []
  const missing = CSV_COLUMNS.filter((c) => !header.includes(c))
  if (missing.length) {
    console.error(`✗ missing columns: ${missing.join(', ')}`)
    process.exit(1)
  }
  const records = rows.map((cells) => {
    const rec = {} as Row
    for (const col of CSV_COLUMNS) rec[col] = cells[header.indexOf(col)] ?? ''
    return rec
  })

  const { products, rules, warnings } = importRows(records, ingredients)

  const importedIds = new Set(products.map((p) => p.id))
  const merged = {
    ingredients,
    products: [...existingProducts.filter((p) => !importedIds.has(p.id)), ...products],
    rules: [
      ...existingRules.filter(
        (r) => !('productId' in r.appliesTo && importedIds.has(r.appliesTo.productId)),
      ),
      ...rules,
    ],
  }
  const result = validateCatalogue(merged)

  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'products.json'), JSON.stringify(products, null, 2) + '\n')
  writeFileSync(resolve(outDir, 'rules.json'), JSON.stringify(rules, null, 2) + '\n')
  console.log(
    `wrote ${products.length} products and ${rules.length} product-level rules to ${outDir}`,
  )
  for (const w of warnings) console.warn(`  ! ${w}`)
  if (!result.ok) {
    console.error(`✗ merged catalogue would be invalid — ${result.errors.length} problem(s):`)
    for (const e of result.errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  console.log(
    '✓ merged catalogue validates; review the output, then merge it into packages/engine/data/',
  )
}

if (process.argv[1] && /import-csv\.(ts|js)$/.test(process.argv[1])) main()
