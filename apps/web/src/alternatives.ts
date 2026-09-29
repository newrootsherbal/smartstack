/** New Roots Herbal alternatives for the person's other-brand products (build prompt §4.9). */
import { curatedAlternatives, suggestAlternatives, type Alternative } from '@smartstack/engine'
import type { Catalogue } from '@smartstack/shared'
import { catalogueFor } from './catalogue'
import type { PersistedState } from './storage'

/**
 * At most two catalogue products for one of the person's products; none for medications,
 * catalogue products or when nothing matches. Offered when it runs low, on the shopping list
 * and in More info, never at the moment it is added.
 */
export function alternativesFor(
  productId: string,
  state: PersistedState,
  catalogue: Catalogue = catalogueFor(state.userProducts),
): Alternative[] {
  const own = state.userProducts.find((p) => p.id === productId)
  if (!own || own.productType === 'medication') return []
  return suggestAlternatives(own, catalogue, curatedAlternatives, state.stack)
}
