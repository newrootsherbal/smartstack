/** Bottle status lines and the bottle questions shared by Add, My stack and the shopping list. */
import {
  barcodesMatch,
  daysLeft,
  getProduct,
  inventoryUnitFor,
  productSizes,
} from '@smartstack/engine'
import type { Product, StackEntry } from '@smartstack/shared'
import { formatBottleAmount, formatDaysLeft, parseCount } from './format'
import { t } from './i18n'
import { dailyUseOf, type BottleInput } from './state/reducer'

/** "68 capsules left · about 34 days", or null when the bottle isn't tracked. */
export function bottleStatus(entry: StackEntry | undefined): string | null {
  const inv = entry?.inventory
  if (!entry || !inv) return null
  const product = getProduct(entry.productId)
  const amount = formatBottleAmount(
    inv.remaining,
    inv.unit,
    product?.form ?? 'other',
    product?.unitLabel,
  )
  const days = daysLeft(inv.remaining, dailyUseOf(entry))
  return t('bottle.status', { amount, days: formatDaysLeft(days) })
}

export type BottleMode = 'new' | 'opened' | 'none'

/** What the person typed or picked, before it is a bottle. */
export interface BottleDraft {
  mode: BottleMode
  /** The size (variant UPC) scanned or picked; null when unknown. */
  sizeUpc: string | null
  /** The size came from the scanned barcode (no chips then). */
  scanned: boolean
  /** "How many in a full bottle?" (only asked when the size doesn't say). */
  full: string
  /** "How many are left?" (opened bottles). */
  left: string
}

/** New bottle preselected; the scanned variant (or the only size) says how much it holds. */
export function initialBottleDraft(
  product: Product,
  scannedUpc: string | null,
  mode: BottleMode = 'new',
): BottleDraft {
  const sizes = productSizes(product)
  const scanned = scannedUpc ? sizes.find((s) => barcodesMatch(s.upc, scannedUpc)) : undefined
  const pick = scanned ?? (sizes.length === 1 ? sizes[0] : undefined)
  return {
    mode,
    sizeUpc: pick?.upc ?? null,
    scanned: scanned !== undefined,
    full: pick?.size ? String(pick.size.quantity) : '',
    left: '',
  }
}

export type DraftResult =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'bottle'; bottle: BottleInput; variantUpc: string | null }

/** The bottle a draft describes: a full new one, an opened one, or nothing tracked. */
export function bottleFromDraft(draft: BottleDraft, product: Product): DraftResult {
  if (draft.mode === 'none') return { kind: 'none' }
  const unit = inventoryUnitFor(product.form)
  const size = productSizes(product).find((s) => s.upc === draft.sizeUpc)?.size ?? null
  const full = size?.quantity ?? parseCount(draft.full)
  if (draft.mode === 'new') {
    if (full === null || full <= 0) return { kind: 'invalid' }
    return {
      kind: 'bottle',
      bottle: { remaining: full, unit, packageSize: full },
      variantUpc: draft.sizeUpc,
    }
  }
  const left = parseCount(draft.left)
  if (left === null) return { kind: 'invalid' }
  return {
    kind: 'bottle',
    bottle: { remaining: left, unit, packageSize: full !== null && full > 0 ? full : null },
    variantUpc: draft.sizeUpc,
  }
}
