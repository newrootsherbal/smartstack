/**
 * Test fixture: a person's own product. The defaults describe a hypothetical other-brand
 * magnesium capsule ("Example Brand" is not a real company); tests override what they need.
 */
import { UserProduct } from '@smartstack/shared'

let counter = 0

/** A schema-valid UserProduct (parsed, so a bad override fails loudly). */
export function userProduct(overrides: Partial<UserProduct> = {}): UserProduct {
  counter += 1
  const id = `u_00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`
  return UserProduct.parse({
    id,
    productType: 'nhp',
    brand: 'Example Brand',
    name: 'Magnesium Bisglycinate 200 mg',
    upc: null,
    npn: null,
    din: null,
    strength: null,
    form: 'capsule',
    doseUnit: 'capsule',
    unitsPerDose: 1,
    dosesPerDay: 1,
    packageQuantity: 60,
    packageUnit: 'unit',
    timing: [],
    ingredients: [],
    directions: null,
    warnings: null,
    notes: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  })
}

/** One ingredient row as the Other brand form stores it. */
export function row(
  name: string,
  amount: number | null,
  unit: string | null,
  ingredientId: string | null = null,
) {
  return { ingredientId, name, amount, unit }
}
