import type { Catalogue, DuplicateIngredient, Stack } from '@smartstack/shared'
import { catalogue as seedCatalogue, getProduct } from './catalogue'

/**
 * Ingredients present in two or more stack products, with each product's daily
 * amount (amount per dose × doses per day) and the sum. Triggered by product
 * count alone, never by amount; never compared to any reference intake.
 */
export function findDuplicateIngredients(
  stack: Stack,
  cat: Catalogue = seedCatalogue,
): DuplicateIngredient[] {
  const result: DuplicateIngredient[] = []
  for (const ingredient of cat.ingredients) {
    const entries: DuplicateIngredient['entries'] = []
    for (const item of stack) {
      const product = getProduct(item.productId, cat)
      if (!product) continue
      const pi = product.ingredients.find((x) => x.ingredientId === ingredient.id)
      if (!pi) continue
      entries.push({
        productId: product.id,
        amountPerDose: pi.amountPerDose,
        dosesPerDay: item.dosesPerDay,
        dailyAmount: pi.amountPerDose * item.dosesPerDay,
      })
    }
    if (entries.length < 2) continue
    result.push({
      ingredientId: ingredient.id,
      unit: ingredient.unit,
      entries,
      total: entries.reduce((sum, e) => sum + e.dailyAmount, 0),
    })
  }
  return result
}
