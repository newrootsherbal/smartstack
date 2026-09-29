/**
 * The catalogue the app works with: the bundled New Roots Herbal products plus the person's
 * own products and their label rules (other brands, medications, foods). Every lookup, the
 * scheduler and the duplicates go through it, so a `u_…` product behaves like any other.
 */
import { catalogue as bundled, mergeCatalogue } from '@smartstack/engine'
import type { Catalogue, UserProduct } from '@smartstack/shared'
import { useAppState } from './state/context'

let lastProducts: readonly UserProduct[] | null = null
let lastCatalogue: Catalogue = bundled

/** Memoized on the array: the state keeps the same array until a product changes. */
export function catalogueFor(userProducts: readonly UserProduct[]): Catalogue {
  if (userProducts === lastProducts) return lastCatalogue
  lastProducts = userProducts
  lastCatalogue = mergeCatalogue(bundled, userProducts)
  return lastCatalogue
}

/** The merged catalogue for components. */
export function useCatalogue(): Catalogue {
  const { state } = useAppState()
  return catalogueFor(state.userProducts)
}
