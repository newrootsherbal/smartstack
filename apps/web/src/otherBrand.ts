/**
 * The Other brand form's logic (build prompt §4.7), pure: the draft the screen edits, its
 * validation, the UserProduct it becomes, the Health Canada prefill, and the bottle it starts.
 */
import {
  inventoryUnitFor,
  isValidEan8,
  isValidRetailBarcode,
  recognizeIngredient,
  type PackageSize,
} from '@smartstack/engine'
import {
  MAX_DOSES_PER_DAY,
  type Catalogue,
  type DoseUnit,
  type IngredientUnit,
  type PinAnchor,
  type Product,
  type ProductPrefill,
  type UserProduct,
  type UserProductTiming,
} from '@smartstack/shared'

export type OtherBrandType = 'nhp' | 'medication' | 'other'

export interface IngredientRow {
  name: string
  amount: string
  unit: IngredientUnit | ''
}

export interface OtherBrandDraft {
  type: OtherBrandType
  brand: string
  name: string
  upc: string
  npn: string
  din: string
  strength: string
  form: Product['form'] | ''
  packageQuantity: string
  packageUnit: 'unit' | 'ml' | 'g'
  amountPerDose: string
  doseUnit: DoseUnit | ''
  dosesPerDay: number
  timing: UserProductTiming[]
  ingredients: IngredientRow[]
  directions: string
  warnings: string
  notes: string
  /** Medications: when each dose is taken (the engine never moves them). */
  times: (PinAnchor | '')[]
}

export function emptyDraft(type: OtherBrandType, upc = ''): OtherBrandDraft {
  return {
    type,
    brand: '',
    name: '',
    upc,
    npn: '',
    din: '',
    strength: '',
    form: '',
    packageQuantity: '',
    packageUnit: 'unit',
    amountPerDose: '1',
    doseUnit: '',
    dosesPerDay: 1,
    timing: [],
    ingredients: [],
    directions: '',
    warnings: '',
    notes: '',
    times: [''],
  }
}

const digits = (text: string) => text.replace(/\D/g, '')

/** "12,5" and "12.5" → 12.5; null for anything that isn't a positive number. */
export function positive(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'))
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
}

export function isBarcode(text: string): boolean {
  const code = digits(text)
  return code.length === 8 ? isValidEan8(code) : isValidRetailBarcode(code)
}

export type DraftField =
  | 'brand'
  | 'name'
  | 'upc'
  | 'npn'
  | 'din'
  | 'form'
  | 'packageQuantity'
  | 'amountPerDose'
  | 'doseUnit'
  | 'times'

/** The fields that stop saving: required ones missing, or a number that can't be right. */
export function validateDraft(d: OtherBrandDraft): DraftField[] {
  const errors: DraftField[] = []
  const medication = d.type === 'medication'
  if (!medication && !d.brand.trim()) errors.push('brand')
  if (!d.name.trim()) errors.push('name')
  if (d.upc.trim() && !isBarcode(d.upc)) errors.push('upc')
  if (d.type === 'nhp' && d.npn.trim() && !/^\d{8}$/.test(digits(d.npn))) errors.push('npn')
  if (medication && d.din.trim() && !/^\d{8}$/.test(digits(d.din))) errors.push('din')
  if (!d.form) errors.push('form')
  if (!medication && positive(d.packageQuantity) === null) errors.push('packageQuantity')
  if (medication && d.packageQuantity.trim() && positive(d.packageQuantity) === null) {
    errors.push('packageQuantity')
  }
  if (positive(d.amountPerDose) === null) errors.push('amountPerDose')
  if (!d.doseUnit) errors.push('doseUnit')
  if (medication && d.times.slice(0, d.dosesPerDay).some((t) => !t)) errors.push('times')
  return errors
}

const text = (value: string) => value.trim() || null

/** The draft as the product the device stores and syncs (call after validateDraft). */
export function draftToUserProduct(
  d: OtherBrandDraft,
  id: string,
  now: number,
  catalogue: Pick<Catalogue, 'ingredients'>,
  createdAt: number = now,
): UserProduct {
  const medication = d.type === 'medication'
  const quantity = positive(d.packageQuantity)
  return {
    id,
    productType: d.type,
    brand: text(d.brand),
    name: d.name.trim(),
    upc: d.upc.trim() ? digits(d.upc) : null,
    npn: d.type === 'nhp' && d.npn.trim() ? digits(d.npn) : null,
    din: medication && d.din.trim() ? digits(d.din) : null,
    strength: medication ? text(d.strength) : null,
    form: d.form || 'other',
    doseUnit: d.doseUnit || 'other',
    unitsPerDose: positive(d.amountPerDose) ?? 1,
    dosesPerDay: Math.min(Math.max(d.dosesPerDay, 1), MAX_DOSES_PER_DAY),
    packageQuantity: quantity,
    packageUnit: quantity === null ? null : d.packageUnit,
    // Medications never get label rules.
    timing: medication ? [] : d.timing,
    ingredients: d.ingredients
      .filter((row) => row.name.trim())
      .map((row) => ({
        ingredientId: recognizeIngredient(row.name.trim(), catalogue.ingredients),
        name: row.name.trim(),
        amount: positive(row.amount),
        unit: row.unit || null,
      })),
    directions: text(d.directions),
    warnings: text(d.warnings),
    notes: text(d.notes),
    createdAt,
    updatedAt: now,
  }
}

/** Back to a draft, to edit a saved product. */
export function userProductToDraft(
  up: UserProduct,
  pins: readonly (PinAnchor | null)[] = [],
): OtherBrandDraft {
  return {
    type: up.productType === 'food' ? 'other' : up.productType,
    brand: up.brand ?? '',
    name: up.name,
    upc: up.upc ?? '',
    npn: up.npn ?? '',
    din: up.din ?? '',
    strength: up.strength ?? '',
    form: up.form,
    packageQuantity: up.packageQuantity === null ? '' : String(up.packageQuantity),
    packageUnit: up.packageUnit ?? 'unit',
    amountPerDose: String(up.unitsPerDose),
    doseUnit: up.doseUnit as DoseUnit,
    dosesPerDay: up.dosesPerDay,
    timing: [...up.timing],
    ingredients: up.ingredients.map((i) => ({
      name: i.name,
      amount: i.amount === null ? '' : String(i.amount),
      unit: (i.unit ?? '') as IngredientUnit | '',
    })),
    directions: up.directions ?? '',
    warnings: up.warnings ?? '',
    notes: up.notes ?? '',
    times: Array.from({ length: up.dosesPerDay }, (_, i) => pins[i] ?? ''),
  }
}

/** "SYNTHROID" → "Synthroid"; mixed case stays as licensed. */
function tidyName(name: string): string {
  if (name !== name.toUpperCase()) return name
  return name
    .toLowerCase()
    .replace(/(^|[\s(/-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase())
}

/** Health Canada's answer over the draft: it fills, the person reviews (nothing is saved). */
export function applyPrefill(d: OtherBrandDraft, p: ProductPrefill): OtherBrandDraft {
  const next: OtherBrandDraft = { ...d, name: tidyName(p.name) }
  // The company as licensed ("BGP PHARMA ULC"): title case would mangle its abbreviations.
  if (p.brand) next.brand = p.brand
  if (p.form) next.form = p.form
  if (p.strength) next.strength = p.strength
  if (p.dose) {
    next.amountPerDose = String(p.dose.amount)
    next.doseUnit = p.dose.unit
    if (p.dose.frequency) {
      next.dosesPerDay = p.dose.frequency
      next.times = Array.from({ length: p.dose.frequency }, (_, i) => d.times[i] ?? '')
    }
  }
  // No licensed dose (the drug database has none): a tablet is taken by the tablet.
  if (!next.doseUnit && next.form && ['capsule', 'tablet', 'softgel'].includes(next.form)) {
    next.doseUnit = next.form as DoseUnit
  }
  if (p.ingredients.length > 0) {
    next.ingredients = p.ingredients.map((i) => ({
      name: tidyName(i.name),
      amount: i.amount === null ? '' : String(i.amount),
      unit: (['mg', 'mcg', 'IU', 'CFU', 'g', 'ml'] as const).includes(i.unit as IngredientUnit)
        ? (i.unit as IngredientUnit)
        : '',
    }))
  }
  return next
}

/**
 * What a full bottle of this product holds, in the unit its bottle is counted in: capsules,
 * tablets and softgels one by one; liquids and powders in servings (the bottle ÷ the dose
 * when both are in ml or in g). Null when the app must ask.
 */
export function userPackageSize(up: UserProduct): PackageSize | null {
  const unit = inventoryUnitFor(up.form)
  const quantity = up.packageQuantity
  if (quantity === null || up.packageUnit === null) return null
  if (unit === 'unit') return up.packageUnit === 'unit' ? { quantity, unit } : null
  if (up.packageUnit !== up.doseUnit || up.unitsPerDose <= 0) return null
  const servings = Math.floor((quantity / up.unitsPerDose) * 10) / 10
  return servings > 0 ? { quantity: servings, unit } : null
}
