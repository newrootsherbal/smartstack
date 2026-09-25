/**
 * Label text (suggested use, warnings) for the imported catalogue. It is the
 * bulk of the data and only needed on the Add screen and in the Why? sheet, so
 * it lives in its own chunk and is loaded on first use.
 */
import type { LocalizedText, Product } from '@smartstack/shared'

export interface ProductText {
  directions?: LocalizedText
  warnings?: LocalizedText
  /** Raw label facts, present only when no ingredient could be parsed from them. */
  facts?: LocalizedText
}

let cache: Promise<Record<string, ProductText>> | null = null

export function loadProductText(): Promise<Record<string, ProductText>> {
  cache ??= import('../data/product-text.json').then(
    (m) => m.default as Record<string, ProductText>,
  )
  return cache
}

/** Inline text (sample fixtures, CSV imports) wins; otherwise the lazily loaded file. */
export async function productText(product: Product): Promise<ProductText> {
  if (product.directions || product.warnings) {
    return {
      ...(product.directions ? { directions: product.directions } : {}),
      ...(product.warnings ? { warnings: product.warnings } : {}),
    }
  }
  const all = await loadProductText()
  return all[product.id] ?? {}
}
