/**
 * Health Canada lookups (§4.7): URL builders and the mapping from the public APIs' JSON to the
 * Other brand form's prefill. Pure: no fetch, no bindings (lookup/service.ts does the I/O).
 *
 * NPN, Licensed Natural Health Products Database (LNHPD):
 *   productlicence/?id=<NPN>         → [{ lnhpd_id, licence_number, product_name, dosage_form,
 *                                        company_name, flag_primary_name, … }]
 *   medicinalingredient/?id=<lnhpd_id> → { metadata, data: [{ ingredient_name, quantity,
 *                                        quantity_unit_of_measure, potency_amount,
 *                                        potency_constituent, potency_unit_of_measure,
 *                                        source_material, … }] }  (quantities per dosage unit)
 *   productdose/?id=<lnhpd_id>       → [{ population_type_desc, quantity_dose(_minimum),
 *                                        uom_type_desc_quantity_dose, frequency(_minimum),
 *                                        uom_type_desc_frequency, … }]
 * DIN, Drug Product Database (DPD):
 *   drugproduct/?din=<DIN>           → [{ drug_code, brand_name, company_name, descriptor, … }]
 *   activeingredient/?id=<drug_code> → [{ ingredient_name, strength, strength_unit,
 *                                        dosage_value, dosage_unit }]
 *   form/?id=<drug_code>             → [{ pharmaceutical_form_name }]
 *
 * Mapping (everything else is left for the person to fill):
 *   name ← product_name (the licence's primary name) | brand_name
 *   brand ← company_name
 *   form ← dosage_form | pharmaceutical_form_name (capsule, softgel, tablet, powder, liquid, other)
 *   dose (NPN only; the adults' row) ← quantity_dose + its unit, frequency when per day
 *   ingredients ← each medicinal ingredient with its quantity, plus each potency constituent
 *     (fish oil → EPA, DHA); a row repeated for another source material, or restated in another
 *     unit (1,000 IU = 25 mcg), is kept once. DIN: each active ingredient with its strength.
 *   strength (DIN, one active ingredient) ← "25 mcg" or "125 mg / 5 ml"
 *   Left to the person: barcode, bottle size, times of day, label checkboxes, directions,
 *   warnings, and the dose of a medication.
 */
import {
  LOOKUP_NUMBER_RE,
  MAX_DOSES_PER_DAY,
  type PREFILL_FORMS,
  type DoseUnit,
  type IngredientUnit,
  type LookupLang,
  type PrefillDose,
  type PrefillIngredient,
  type ProductPrefill,
} from '@smartstack/shared'

export const HC_API = 'https://health-products.canada.ca/api'
/** Generic, and nothing about the person: the lookups carry only the number and a language. */
export const HC_USER_AGENT = 'SmartStack/1.0'
export const HC_TIMEOUT_MS = 4000
/** How long an upstream answer is reused (Cache API); "not found" is rechecked sooner. */
export const HC_CACHE_SECONDS = 7 * 24 * 60 * 60
export const HC_EMPTY_CACHE_SECONDS = 24 * 60 * 60

type Form = (typeof PREFILL_FORMS)[number]

export function isLookupNumber(value: string): boolean {
  return LOOKUP_NUMBER_RE.test(value)
}

/** `?lang=fr` → fr; anything else → en. */
export function parseLookupLang(raw: string | undefined): LookupLang {
  return raw?.trim().toLowerCase() === 'fr' ? 'fr' : 'en'
}

function hcUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`${HC_API}/${path}/`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  url.searchParams.set('type', 'json')
  return url.toString()
}

export const hcUrls = {
  npnLicence: (npn: string, lang: LookupLang) =>
    hcUrl('natural-licences/productlicence', { id: npn, lang }),
  npnIngredients: (lnhpdId: number, lang: LookupLang) =>
    hcUrl('natural-licences/medicinalingredient', { id: String(lnhpdId), lang }),
  npnDose: (lnhpdId: number, lang: LookupLang) =>
    hcUrl('natural-licences/productdose', { id: String(lnhpdId), lang }),
  dinProduct: (din: string, lang: LookupLang) => hcUrl('drug/drugproduct', { din, lang }),
  dinIngredients: (drugCode: number, lang: LookupLang) =>
    hcUrl('drug/activeingredient', { id: String(drugCode), lang }),
  dinForm: (drugCode: number, lang: LookupLang) =>
    hcUrl('drug/form', { id: String(drugCode), lang }),
}

/**
 * The Cache API key for an upstream URL: a synthetic GET URL on the app's own origin (never
 * routed, only matched by the lookup code), one per upstream URL. Holds only the public
 * Health Canada path and query: no session, no account.
 */
export function hcCacheKey(upstreamUrl: string, origin: string): string {
  const upstream = new URL(upstreamUrl)
  const path = upstream.pathname.replace(/^\/api\//, '').replace(/\/+$/, '')
  return `${origin}/__cache/health-canada/${path}${upstream.search}`
}

/** An empty answer (unknown number) is cached for a day, anything else for a week. */
export function hcCacheSeconds(data: unknown): number {
  const rows = Array.isArray(data) ? data : (data as { data?: unknown } | null)?.data
  return Array.isArray(rows) && rows.length === 0 ? HC_EMPTY_CACHE_SECONDS : HC_CACHE_SECONDS
}

// ---------------------------------------------------------------------------
// Upstream shapes (only the fields read; everything is treated as untrusted)
// ---------------------------------------------------------------------------

export interface LnhpdLicence {
  lnhpd_id: number
  licence_number: string
  product_name: string
  dosage_form?: string | null
  company_name?: string | null
  flag_primary_name?: number | null
}

export interface LnhpdIngredient {
  ingredient_name?: string | null
  quantity?: number | null
  quantity_unit_of_measure?: string | null
  potency_amount?: number | null
  potency_constituent?: string | null
  potency_unit_of_measure?: string | null
  source_material?: string | null
}

export interface LnhpdDose {
  population_type_desc?: string | null
  quantity_dose?: number | null
  quantity_dose_minimum?: number | null
  uom_type_desc_quantity_dose?: string | null
  frequency?: number | null
  frequency_minimum?: number | null
  uom_type_desc_frequency?: string | null
}

export interface DpdProduct {
  drug_code: number
  drug_identification_number: string
  brand_name: string
  company_name?: string | null
}

export interface DpdIngredient {
  ingredient_name?: string | null
  strength?: string | null
  strength_unit?: string | null
  dosage_value?: string | null
  dosage_unit?: string | null
}

export interface DpdForm {
  pharmaceutical_form_name?: string | null
}

function rows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  const data = (value as { data?: unknown } | null)?.data
  return Array.isArray(data) ? (data as T[]) : []
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, max).trim() : null
}

function positive(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.trim()) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const FORMS: readonly [RegExp, Form][] = [
  [/\bsoft\b|softgel|molle/i, 'softgel'],
  [/capsule|gélule/i, 'capsule'],
  [/tablet|comprim|caplet|lozenge|pastille|chewable|croquer/i, 'tablet'],
  [/powder|poudre|granul/i, 'powder'],
  [
    /liquid|liquide|solution|syrup|sirop|drop|goutte|suspension|emulsion|émulsion|tincture|teinture|\boil\b|huile|spray|elixir|élixir/i,
    'liquid',
  ],
]

/** "Capsule, soft" → softgel, "Tablet (Extended-Release)" → tablet, "Comprimé" → tablet… */
export function mapForm(raw: string | null | undefined): Form | null {
  const value = text(raw, 120)
  if (!value) return null
  return FORMS.find(([re]) => re.test(value))?.[1] ?? 'other'
}

const DOSE_UNIT_WORDS: readonly [RegExp, DoseUnit][] = [
  [/soft ?gel|capsule molle/i, 'softgel'],
  [/capsule|gélule/i, 'capsule'],
  [/tablet|comprim|caplet|lozenge|pastille/i, 'tablet'],
  [/gumm|jujube|gélifi/i, 'gummy'],
  [/drop|goutte/i, 'drop'],
  [/^(?:ml|millilit(?:er|re)s?)$/i, 'ml'],
  [/^(?:g|grams?|grammes?)$/i, 'g'],
  [/scoop|mesure/i, 'scoop'],
  [/tablespoon|tbsp|cuillère à soupe|c\. à soupe/i, 'tablespoon'],
  [/teaspoon|tsp|cuillère à thé|c\. à thé|cuillère à café/i, 'teaspoon'],
]

/**
 * A licensed dose unit in the form's vocabulary. "each" or "dosage unit" mean one of the
 * product's units; a softgel's dose licensed in "capsules" is in softgels.
 */
export function mapDoseUnit(raw: string | null | undefined, form: Form | null): DoseUnit {
  const value = text(raw, 60) ?? ''
  const unit = DOSE_UNIT_WORDS.find(([re]) => re.test(value))?.[1]
  if (unit === 'capsule' && form === 'softgel') return 'softgel'
  if (unit) return unit
  return form === 'capsule' || form === 'tablet' || form === 'softgel' ? form : 'other'
}

/** "daily", "Day", "Jour", "Tous les jours"… */
export function isPerDay(raw: string | null | undefined): boolean {
  const value = (text(raw, 40) ?? '').toLowerCase()
  return /^(?:daily|days?|per day|a day|jours?|par jour|tous les jours|quotidien(?:ne)?(?:ment)?)$/.test(
    value,
  )
}

const AMOUNT_UNITS: readonly [RegExp, IngredientUnit, number][] = [
  [/^(?:mg|milligram(?:me)?s?)$/i, 'mg', 1],
  [/^(?:mcg|µg|μg|ug|microgram(?:me)?s?)$/i, 'mcg', 1],
  [/^(?:g|grams?|grammes?)$/i, 'g', 1],
  [/^(?:kg|kilogram(?:me)?s?)$/i, 'g', 1000],
  [/^(?:iu|ui|international units?|unités? internationales?)$/i, 'IU', 1],
  [/^(?:ml|millilit(?:er|re)s?)$/i, 'ml', 1],
  [/^(?:cfu|ufc)$/i, 'CFU', 1],
  [/^millions?\s+(?:cfu|ufc)$/i, 'CFU', 1e6],
  [/^(?:billions?|milliards?)\s+(?:cfu|ufc)$/i, 'CFU', 1e9],
]

/**
 * An amount and Health Canada's unit word → the form's units ("milligramme" → mg, "million cfu"
 * → CFU × 10⁶). An unknown unit keeps Health Canada's word when it fits (≤ 12 characters).
 */
export function mapAmount(
  value: unknown,
  unitText: string | null | undefined,
): Pick<PrefillIngredient, 'amount' | 'unit'> {
  const amount = positive(value)
  const unit = text(unitText, 40)
  if (amount === null) return { amount: null, unit: null }
  if (!unit) return { amount, unit: null }
  const known = AMOUNT_UNITS.find(([re]) => re.test(unit))
  if (known) return { amount: Math.round(amount * known[2] * 1e6) / 1e6, unit: known[1] }
  return { amount, unit: unit.length <= 12 ? unit : null }
}

// ---------------------------------------------------------------------------
// NPN
// ---------------------------------------------------------------------------

/** The licence for this NPN, its primary product name first; null when none. */
export function pickLicence(licences: unknown, npn: string): LnhpdLicence | null {
  const list = rows<LnhpdLicence>(licences).filter(
    (l) => l && typeof l.lnhpd_id === 'number' && l.licence_number === npn,
  )
  return list.find((l) => l.flag_primary_name === 1) ?? list[0] ?? null
}

function npnIngredients(data: unknown): PrefillIngredient[] {
  const result: PrefillIngredient[] = []
  const seen = new Set<string>()
  const stated = new Set<string>()
  const add = (
    name: string,
    amount: Pick<PrefillIngredient, 'amount' | 'unit'>,
    source: string,
  ) => {
    const same = JSON.stringify([name.toLowerCase(), amount.amount, amount.unit])
    const restated = JSON.stringify([name.toLowerCase(), source])
    // The same row for another source material ("anchovies and/or sardines"), or the same
    // ingredient and source restated in another unit (1,000 IU and 25 mcg): kept once.
    if (seen.has(same) || stated.has(restated)) return
    seen.add(same)
    stated.add(restated)
    result.push({ name, ...amount })
  }
  for (const row of rows<LnhpdIngredient>(data)) {
    const name = text(row?.ingredient_name, 120)
    if (!name) continue
    const source = text(row.source_material, 200)?.toLowerCase() ?? ''
    if (positive(row.quantity) !== null) {
      add(name, mapAmount(row.quantity, row.quantity_unit_of_measure), source)
    }
    const constituent = text(row.potency_constituent, 120)
    if (constituent && positive(row.potency_amount) !== null) {
      add(constituent, mapAmount(row.potency_amount, row.potency_unit_of_measure), source)
    }
  }
  return result.slice(0, 40)
}

function npnDose(data: unknown, form: Form | null): PrefillDose | null {
  const list = rows<LnhpdDose>(data).filter(Boolean)
  const dose = list.find((d) => /adult/i.test(d.population_type_desc ?? '')) ?? list[0]
  if (!dose) return null
  const amount = positive(dose.quantity_dose) ?? positive(dose.quantity_dose_minimum)
  if (amount === null) return null
  const times = positive(dose.frequency) ?? positive(dose.frequency_minimum)
  const frequency =
    isPerDay(dose.uom_type_desc_frequency) &&
    times !== null &&
    Number.isInteger(times) &&
    times <= MAX_DOSES_PER_DAY
      ? times
      : null
  return { amount, unit: mapDoseUnit(dose.uom_type_desc_quantity_dose, form), frequency }
}

/**
 * NPN prefill from the three LNHPD answers; null when the licence is unknown. A follow-up
 * answer that failed (null) leaves its part empty and marks the prefill partial.
 */
export function mapNpnPrefill(
  npn: string,
  licences: unknown,
  ingredients: unknown | null,
  doses: unknown | null,
): ProductPrefill | null {
  const licence = pickLicence(licences, npn)
  const name = text(licence?.product_name, 120)
  if (!licence || !name) return null
  const form = mapForm(licence.dosage_form)
  return {
    source: 'lnhpd',
    npn,
    din: null,
    name,
    brand: text(licence.company_name, 80),
    form,
    strength: null,
    dose: doses === null ? null : npnDose(doses, form),
    ingredients: ingredients === null ? [] : npnIngredients(ingredients),
    partial: ingredients === null || doses === null,
  }
}

// ---------------------------------------------------------------------------
// DIN
// ---------------------------------------------------------------------------

export function pickDrugProduct(products: unknown, din: string): DpdProduct | null {
  const list = rows<DpdProduct>(products).filter((p) => p && typeof p.drug_code === 'number')
  return list.find((p) => p.drug_identification_number === din) ?? list[0] ?? null
}

function dinIngredient(row: DpdIngredient): PrefillIngredient | null {
  const name = text(row.ingredient_name, 120)
  if (!name) return null
  const { amount, unit } = mapAmount(row.strength, row.strength_unit)
  const per = positive(row.dosage_value)
  const perUnit = text(row.dosage_unit, 20)
  if (per === null) return { name, amount, unit }
  // A strength per 5 ml is given per ml; per anything else, the amount is left to the person.
  if (amount !== null && perUnit && /^(?:ml|millilit(?:er|re)s?)$/i.test(perUnit)) {
    return { name, amount: Math.round((amount / per) * 1e6) / 1e6, unit }
  }
  return { name, amount: null, unit }
}

function strengthText(row: DpdIngredient): string | null {
  const strength = text(row.strength, 20)
  if (!strength || positive(strength) === null) return null
  const { unit } = mapAmount(strength, row.strength_unit)
  const main = unit ? `${strength} ${unit}` : strength
  const per = text(row.dosage_value, 10)
  const perUnit = text(row.dosage_unit, 12)
  const perText =
    per && perUnit ? ` / ${per} ${mapAmount(per, perUnit).unit ?? perUnit.toLowerCase()}` : ''
  return `${main}${perText}`.slice(0, 40)
}

/**
 * DIN prefill from the DPD answers; null when the DIN is unknown. The DPD has no dosing
 * instructions: the dose and times are left to the person.
 */
export function mapDinPrefill(
  din: string,
  products: unknown,
  ingredients: unknown | null,
  forms: unknown | null,
): ProductPrefill | null {
  const product = pickDrugProduct(products, din)
  const name = text(product?.brand_name, 120)
  if (!product || !name) return null
  const active = ingredients === null ? [] : rows<DpdIngredient>(ingredients).filter(Boolean)
  const form = forms === null ? null : mapForm(rows<DpdForm>(forms)[0]?.pharmaceutical_form_name)
  return {
    source: 'dpd',
    npn: null,
    din,
    name,
    brand: text(product.company_name, 80),
    form,
    strength: active.length === 1 ? strengthText(active[0]!) : null,
    dose: null,
    ingredients: active
      .map(dinIngredient)
      .filter((i): i is PrefillIngredient => i !== null)
      .slice(0, 40),
    partial: ingredients === null || forms === null,
  }
}
