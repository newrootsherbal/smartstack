import { getIngredient, getProduct } from '@smartstack/engine'
import type { Adjustment, Catalogue, Reason, Severity } from '@smartstack/shared'
import { intlLocale, t, tl } from './index'

/** "Iron moved away from calcium", "Fish oil moved to a meal", … */
export function renderAdjustment(adjustment: Adjustment, catalogue?: Catalogue): string {
  const product = getProduct(adjustment.productId, catalogue)
  const productName = product ? tl(product.shortName) : adjustment.productId
  const otherId = adjustment.params.otherIngredientId
  const other = otherId ? getIngredient(otherId, catalogue) : undefined
  const ingredientName = other ? tl(other.name).toLocaleLowerCase(intlLocale()) : (otherId ?? '')
  return t(`adjustment.${adjustment.code}`, { product: productName, ingredient: ingredientName })
}

/** The one-line hint shown under a dose on the Today screen. */
export function renderReasonShort(reason: Reason, catalogue?: Catalogue): string {
  if (reason.params.pinnedConflict) {
    const id = reason.params.otherIngredientId
    const ingredient = id ? getIngredient(id, catalogue) : undefined
    return t('reason.pinnedConflict', {
      ingredient: ingredient ? tl(ingredient.name).toLocaleLowerCase(intlLocale()) : (id ?? ''),
    })
  }
  return t(`reason.short.${reason.attribute}`)
}

/** Reasons that get a line under the dose (the bedtime suggestion gets a card instead). */
export function isShortReason(reason: Reason): boolean {
  return reason.attribute !== 'SUGGEST_BEDTIME'
}

export function severityLabel(severity: Severity): { label: string; sub: string } {
  return { label: t(`severity.${severity}.label`), sub: t(`severity.${severity}.sub`) }
}
