/**
 * Bottle tracking: how much a bottle holds, how much a dose takes, how many days are left.
 * Capsules, softgels and tablets are counted one by one ("units"); liquids and powders in
 * servings, one serving per dose.
 */
import {
  LOW_STOCK_DAYS,
  type InventoryUnit,
  type LocalizedText,
  type Product,
} from '@smartstack/shared'

export { LOW_STOCK_DAYS }

export interface PackageSize {
  quantity: number
  unit: InventoryUnit
}

/** Liquids and powders are counted in servings; everything else unit by unit. */
export function inventoryUnitFor(form: Product['form']): InventoryUnit {
  return form === 'liquid' || form === 'powder' ? 'serving' : 'unit'
}

/** "1,050" → 1050 (a comma between digit groups is a thousands separator on these labels). */
function num(text: string): number {
  return Number(text.replace(/,(?=\d{3}\b)/g, '').replace(',', '.'))
}

const SERVINGS_IN_TEXT = /(\d[\d,]*(?:\.\d+)?)\s*(?:doses|portions|servings)\b/i
const MULTIPACK = /^(\d+)\s*[×x]\s*\d/
const LEADING_COUNT = /^(\d+)(?:\s*s)?\b/
const AMOUNT = /(\d+(?:[.,]\d+)?)\s*(ml|l|litres?|liters?|g|grams?|mg)\b/i

/** An amount in ml or g (mg converted to g, litres to ml), or null. */
function metricAmount(text: string): { value: number; unit: 'ml' | 'g' } | null {
  const m = AMOUNT.exec(text)
  if (!m) return null
  const value = num(m[1]!)
  const unit = m[2]!.toLowerCase()
  if (unit === 'ml') return { value, unit: 'ml' }
  if (unit.startsWith('l')) return { value: value * 1000, unit: 'ml' }
  if (unit === 'mg') return { value: value / 1000, unit: 'g' }
  return { value, unit: 'g' }
}

/**
 * The amount one serving holds, in ml or g, from the label's serving size:
 * "3 rounded tbsp. (30 g)" → 30 g, "1 teaspoon (5 ml)" → 5 ml, "10 g (2 heaping
 * teaspoons) serving" → 10 g. Null when the serving names no metric amount ("1 drop").
 */
function servingAmount(servingSize: string): { value: number; unit: 'ml' | 'g' } | null {
  const inParens = /\(([^)]*)\)/.exec(servingSize)
  return (inParens ? metricAmount(inParens[1]!) : null) ?? metricAmount(servingSize)
}

/**
 * How much a full bottle holds, from a variant's size text:
 * - "120", "90s", "120 (instead of 90)" → 120 units (capsules, softgels, tablets);
 * - "100 g = 32 doses", "150 g / 50 portions", "30 ml · 1,050 Servings" → servings as printed;
 * - "30 × 4.2 g" (sachets) → 30 servings;
 * - "300 g" with a serving of "(30 g)" → 10 servings (both in ml, or both in g);
 * - anything else (a gift pack, drops without a volume) → null: the app asks.
 */
export function parsePackageSize(
  size: string | undefined,
  form: Product['form'],
  servingSize: string,
): PackageSize | null {
  const text = size?.trim()
  if (!text) return null
  const unit = inventoryUnitFor(form)

  if (unit === 'unit') {
    const count = LEADING_COUNT.exec(text)
    if (!count) return null
    const quantity = num(count[1]!)
    return quantity > 0 ? { quantity, unit } : null
  }

  const printed = SERVINGS_IN_TEXT.exec(text)
  if (printed) return positive(num(printed[1]!))
  const pack = MULTIPACK.exec(text)
  if (pack) return positive(num(pack[1]!))

  const bottle = metricAmount(text)
  const serving = servingAmount(servingSize)
  if (!bottle || !serving || bottle.unit !== serving.unit || serving.value <= 0) return null
  // Decimals are fine for servings; one decimal is enough.
  return positive(Math.floor((bottle.value / serving.value) * 10) / 10)
}

function positive(quantity: number): PackageSize | null {
  return Number.isFinite(quantity) && quantity > 0 ? { quantity, unit: 'serving' } : null
}

export interface ProductSize {
  upc: string
  /** The size as printed ("120", "50 ml"), for size chips. */
  label: LocalizedText | null
  size: PackageSize | null
}

/** Every retail size of a product with what a full bottle holds. */
export function productSizes(product: Product): ProductSize[] {
  const variants = product.variants?.length
    ? product.variants
    : [{ upc: product.upc, size: undefined }]
  return variants.map((v) => ({
    upc: v.upc,
    label: v.size ?? null,
    size: parsePackageSize(v.size?.en, product.form, product.servingSize),
  }))
}

/**
 * What one dose takes off the bottle: servings mode takes one serving; units mode takes
 * the person's own figure, else the label's units per dose, else 1.
 */
export function unitsPerDose(
  unit: InventoryUnit,
  product: Pick<Product, 'unitsPerDose'> | undefined,
  entryUnitsPerDose?: number,
): number {
  if (entryUnitsPerDose !== undefined) return entryUnitsPerDose
  if (unit === 'serving') return 1
  return product?.unitsPerDose ?? 1
}

export function dailyUse(dosesPerDay: number, perDose: number): number {
  return dosesPerDay * perDose
}

/** Whole days of use left; 0 means empty (or less than a day). */
export function daysLeft(remaining: number, daily: number): number {
  if (daily <= 0) return Infinity
  return Math.floor(remaining / daily + 1e-9)
}

/** Ticking a dose: never below zero; `taken` is what an untick must give back. */
export function applyTick(remaining: number, units: number): { remaining: number; taken: number } {
  const taken = Math.min(Math.max(units, 0), remaining)
  return { remaining: round(remaining - taken), taken }
}

/** Unticking gives back exactly what the tick took. */
export function undoTick(remaining: number, taken: number): number {
  return round(remaining + taken)
}

/** Running low: 5 days of use or less left. */
export function isLow(remaining: number, daily: number): boolean {
  return daily > 0 && remaining <= LOW_STOCK_DAYS * daily
}

/** Avoid 0.30000000000000004 after decimal servings. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Refill: what was left plus what was added ("5 + 30 = 35"). */
export function refill(remaining: number, added: number): number {
  return round(remaining + Math.max(added, 0))
}
