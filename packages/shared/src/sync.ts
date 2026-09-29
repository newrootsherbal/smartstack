// Sync (Phase 2, M5): the wire format of POST /api/sync (docs/smartstack-phase2-prompt.md §8).
// Validated by the Worker, reused by the web client.
//
// Kept free of imports from './index' (index.ts re-exports this file, so importing back would
// create a cycle): the few index.ts schemas needed here (HH:MM, Routine, the pin anchors and the
// StackEntry fields) are copied below, and sync.test.ts checks the copies still agree.
import { z } from 'zod'
import { Locale } from './auth'
import { MAX_DOSES_PER_DAY } from './limits'
import { HealthProfile, Inventory, ShoppingReason, UserProduct } from './user-data'

// ---------------------------------------------------------------------------
// Limits (§8.2)
// ---------------------------------------------------------------------------

/** Rows per request, every entity counted (settings and health count one each). */
export const SYNC_MAX_ROWS = 500
/** Request body size in bytes. */
export const SYNC_MAX_BYTES = 512 * 1024
/** Live (not deleted) rows per account. */
export const SYNC_MAX_USER_PRODUCTS = 200
export const SYNC_MAX_STACK_ITEMS = 60

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Device epoch milliseconds (`Date.now()`); before 2100. */
export const SyncTimestamp = z.number().int().min(0).max(4_102_444_800_000)

/** Catalogue id (slug) or user product id ('u_' + UUID). */
export const SyncProductId = z.string().min(1).max(120)

/** A local calendar date, YYYY-MM-DD. */
export const SyncDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

/** Live rows: `deletedAt` is null (and may be left out). */
const NotDeleted = z.null().default(null)

// Copies of index.ts schemas (see the note at the top).
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM (24-hour)')
/** Same values as PIN_ANCHORS in index.ts. */
export const SYNC_PIN_ANCHORS = ['wake', 'breakfast', 'lunch', 'dinner', 'bedtime'] as const

/** Same rules as `Routine` in index.ts. */
export const SyncRoutine = z
  .object({
    wake: HHMM,
    bedtime: HHMM,
    coffee: HHMM.nullable(),
    breakfast: HHMM.nullable(),
    lunch: HHMM.nullable(),
    dinner: HHMM.nullable(),
    exercise: HHMM.nullable(),
  })
  .refine((r) => r.breakfast !== null || r.lunch !== null || r.dinner !== null, {
    message: 'at least one meal is required',
    path: ['breakfast'],
  })

// ---------------------------------------------------------------------------
// Entities (§8.1). Each is a live row (`deletedAt: null`) or a tombstone: the entity's key,
// `updatedAt` and `deletedAt` only. Last write wins by `updatedAt`; on a tie the server's copy
// wins.
// ---------------------------------------------------------------------------

/** The account's settings. Never a tombstone (deleting the account removes them). */
export const SyncSettings = z.object({
  routine: SyncRoutine.nullable(),
  /** IANA time zone. */
  tz: z.string().min(1).max(64),
  locale: Locale,
  /** A theme id of the web app (themes.ts); the client falls back on unknown values. */
  theme: z.string().min(1).max(32),
  updatedAt: SyncTimestamp,
  deletedAt: NotDeleted,
})
export type SyncSettings = z.infer<typeof SyncSettings>

export const SyncProductLive = UserProduct.extend({
  createdAt: SyncTimestamp,
  updatedAt: SyncTimestamp,
  deletedAt: NotDeleted,
})
export const SyncProductTombstone = z.object({
  id: UserProduct.shape.id,
  updatedAt: SyncTimestamp,
  deletedAt: SyncTimestamp,
})
/** A product the person added by hand (`UserProduct`). */
export const SyncProduct = z.union([SyncProductLive, SyncProductTombstone])
export type SyncProduct = z.infer<typeof SyncProduct>

/** The `StackEntry` fields (index.ts), with `deletedAt`. */
export const SyncStackLive = z.object({
  productId: SyncProductId,
  dosesPerDay: z.number().int().min(1).max(MAX_DOSES_PER_DAY),
  pins: z.array(z.enum(SYNC_PIN_ANCHORS).nullable()).max(MAX_DOSES_PER_DAY).optional(),
  dismissed: z.array(z.string().min(1).max(40)).max(20).optional(),
  unitsPerDose: z.number().positive().optional(),
  variantUpc: z
    .string()
    .regex(/^\d{8,14}$/)
    .optional(),
  inventory: Inventory.optional(),
  addedAt: SyncTimestamp,
  updatedAt: SyncTimestamp,
  deletedAt: NotDeleted,
})
export const SyncStackTombstone = z.object({
  productId: SyncProductId,
  updatedAt: SyncTimestamp,
  deletedAt: SyncTimestamp,
})
export const SyncStackItem = z.union([SyncStackLive, SyncStackTombstone])
export type SyncStackItem = z.infer<typeof SyncStackItem>

/** The `ShoppingItem` fields, with `deletedAt` (removed or refilled). */
export const SyncShoppingLive = z.object({
  productId: SyncProductId,
  reason: ShoppingReason,
  replacesProductId: SyncProductId.optional(),
  addedAt: SyncTimestamp,
  updatedAt: SyncTimestamp,
  deletedAt: NotDeleted,
})
export const SyncShoppingTombstone = z.object({
  productId: SyncProductId,
  updatedAt: SyncTimestamp,
  deletedAt: SyncTimestamp,
})
export const SyncShoppingItem = z.union([SyncShoppingLive, SyncShoppingTombstone])
export type SyncShoppingItem = z.infer<typeof SyncShoppingItem>

/**
 * A ticked dose: the device's `checks[`${day}:${productId}:${doseIndex}`] = { units, at }`,
 * with `updatedAt` = `at`. Unticking is a tombstone.
 */
export const SyncCheckLive = z.object({
  day: SyncDay,
  productId: SyncProductId,
  doseIndex: z
    .number()
    .int()
    .min(0)
    .max(MAX_DOSES_PER_DAY - 1),
  /** Taken off the bottle; given back when unticked. */
  units: z.number().min(0).max(1000),
  updatedAt: SyncTimestamp,
  deletedAt: NotDeleted,
})
export const SyncCheckTombstone = z.object({
  day: SyncDay,
  productId: SyncProductId,
  doseIndex: SyncCheckLive.shape.doseIndex,
  updatedAt: SyncTimestamp,
  deletedAt: SyncTimestamp,
})
export const SyncCheck = z.union([SyncCheckLive, SyncCheckTombstone])
export type SyncCheck = z.infer<typeof SyncCheck>

/**
 * The health profile. Accepted by the schema, but the Worker answers `403 consent_required`
 * for it until M8 creates its table (never send it before then).
 */
export const SyncHealth = z.union([
  HealthProfile.extend({ deletedAt: NotDeleted }),
  z.object({ updatedAt: SyncTimestamp, deletedAt: SyncTimestamp }),
])
export type SyncHealth = z.infer<typeof SyncHealth>

/** True for a tombstone (a deleted entity: only its key, `updatedAt` and `deletedAt`). */
export function isSyncTombstone<T extends { deletedAt: number | null }>(
  row: T,
): row is T & { deletedAt: number } {
  return row.deletedAt !== null
}

/** The key of a check, as the device stores it in `checks`. */
export function syncCheckKey(check: { day: string; productId: string; doseIndex: number }): string {
  return `${check.day}:${check.productId}:${check.doseIndex}`
}

// ---------------------------------------------------------------------------
// POST /api/sync
// ---------------------------------------------------------------------------

interface CountableChanges {
  settings?: unknown
  health?: unknown
  products?: readonly unknown[]
  stack?: readonly unknown[]
  shopping?: readonly unknown[]
  checks?: readonly unknown[]
}

/** Rows in a request's `changes` (settings and health count one each). */
export function syncRowCount(changes: CountableChanges): number {
  return (
    (changes.settings === undefined ? 0 : 1) +
    (changes.health === undefined ? 0 : 1) +
    (changes.products?.length ?? 0) +
    (changes.stack?.length ?? 0) +
    (changes.shopping?.length ?? 0) +
    (changes.checks?.length ?? 0)
  )
}

function rejectDuplicates<T>(
  rows: readonly T[],
  key: (row: T) => string,
  path: string,
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>()
  rows.forEach((row, i) => {
    const k = key(row)
    if (seen.has(k)) {
      ctx.addIssue({ code: 'custom', message: 'duplicate key in this request', path: [path, i] })
    }
    seen.add(k)
  })
}

/** What changed on the device since its last push. Empty (the default) = a pull. */
export const SyncChanges = z
  .object({
    settings: SyncSettings.optional(),
    health: SyncHealth.optional(),
    products: z.array(SyncProduct).max(SYNC_MAX_ROWS).default([]),
    stack: z.array(SyncStackItem).max(SYNC_MAX_ROWS).default([]),
    shopping: z.array(SyncShoppingItem).max(SYNC_MAX_ROWS).default([]),
    checks: z.array(SyncCheck).max(SYNC_MAX_ROWS).default([]),
  })
  .superRefine((changes, ctx) => {
    if (syncRowCount(changes) > SYNC_MAX_ROWS) {
      ctx.addIssue({ code: 'custom', message: `at most ${SYNC_MAX_ROWS} rows per request` })
    }
    // Each entity at most once: the server applies one version per key.
    rejectDuplicates(changes.products, (p) => p.id, 'products', ctx)
    rejectDuplicates(changes.stack, (s) => s.productId, 'stack', ctx)
    rejectDuplicates(changes.shopping, (s) => s.productId, 'shopping', ctx)
    rejectDuplicates(changes.checks, syncCheckKey, 'checks', ctx)
  })
export type SyncChanges = z.infer<typeof SyncChanges>

/**
 * POST /api/sync (session + consent). `since`: the last `rev` this device applied (0 = never).
 * Answers every row whose revision is newer than `since`, tombstones included, plus the
 * server's copy of every row the request pushed (whether the push won or lost).
 */
export const SyncRequest = z.object({
  since: z.number().int().min(0),
  changes: SyncChanges.prefault({}),
})
/** The body as the client builds it (arrays and `deletedAt: null` may be left out). */
export type SyncRequestBody = z.input<typeof SyncRequest>
export type SyncRequest = z.infer<typeof SyncRequest>

export const SyncResponse = z.object({
  /** The account's revision after this request: the next request's `since`. */
  rev: z.number().int().min(0),
  changes: z.object({
    settings: SyncSettings.nullable(),
    products: z.array(SyncProduct),
    stack: z.array(SyncStackItem),
    shopping: z.array(SyncShoppingItem),
    checks: z.array(SyncCheck),
  }),
})
export type SyncResponse = z.infer<typeof SyncResponse>
