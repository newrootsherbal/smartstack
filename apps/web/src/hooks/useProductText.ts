import { productText, type ProductText } from '@smartstack/engine'
import type { Product } from '@smartstack/shared'
import { useEffect, useState } from 'react'

/** Suggested use and warnings for a product, loaded on demand. */
export function useProductText(product: Product | null | undefined): ProductText | null {
  const [text, setText] = useState<{ id: string; value: ProductText } | null>(null)

  useEffect(() => {
    if (!product) return
    let cancelled = false
    void productText(product).then((value) => {
      if (!cancelled) setText({ id: product.id, value })
    })
    return () => {
      cancelled = true
    }
  }, [product])

  return product && text?.id === product.id ? text.value : null
}
