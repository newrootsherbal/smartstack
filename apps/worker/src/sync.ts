/**
 * POST /api/sync (docs/smartstack-phase2-prompt.md §8): statement builders, row mapping, limits
 * and the daily cleanup. Pure: statements are returned, never run.
 *
 * One push = one DB.batch (a single transaction): bump `accounts.rev`, one upsert per table that
 * has changes (the table's rows travel as ONE JSON parameter read with json_each, so a request
 * never nears D1's 100 bound parameters or 50 queries), then the reads. Last write wins by the
 * device's `updatedAt`; on a tie the server's copy wins. A tombstone keeps only the entity's
 * key and timestamps: its other columns are reset to neutral placeholders, so deleted data
 * doesn't linger for the 30 days the tombstone does.
 */
import {
  SYNC_MAX_STACK_ITEMS,
  SYNC_MAX_USER_PRODUCTS,
  isSyncTombstone,
  type SyncChanges,
  type SyncCheck,
  type SyncProduct,
  type SyncResponse,
  type SyncSettings,
  type SyncShoppingItem,
  type SyncStackItem,
} from '@smartstack/shared'
import type { Locale } from './env'
import type { Statement } from './logic'

// ---------------------------------------------------------------------------
// Rows as D1 returns them (migration 0003)
// ---------------------------------------------------------------------------

export interface AccountSettingsRow {
  routine: string | null
  tz: string | null
  locale: Locale | null
  theme: string | null
  updated_at: number
  rev: number
}

export interface UserProductRow {
  id: string
  product_type: 'nhp' | 'medication' | 'food' | 'other'
  brand: string | null
  name: string
  upc: string | null
  npn: string | null
  din: string | null
  strength: string | null
  form: 'capsule' | 'tablet' | 'softgel' | 'powder' | 'liquid' | 'other'
  dose_unit: string
  units_per_dose: number
  doses_per_day: number
  package_quantity: number | null
  package_unit: 'unit' | 'ml' | 'g' | null
  timing: string
  ingredients: string
  directions: string | null
  warnings: string | null
  notes: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
  rev: number
}

export interface StackItemRow {
  product_id: string
  doses_per_day: number
  pins: string
  dismissed: string
  units_per_dose: number | null
  variant_upc: string | null
  inv_remaining: number | null
  inv_unit: 'unit' | 'serving' | null
  inv_package_size: number | null
  low_flagged_at: number | null
  added_at: number
  updated_at: number
  deleted_at: number | null
  rev: number
}

export interface ShoppingItemRow {
  product_id: string
  reason: 'low' | 'manual' | 'alternative'
  replaces_product_id: string | null
  added_at: number
  updated_at: number
  deleted_at: number | null
  rev: number
}

export interface DoseCheckRow {
  day: string
  product_id: string
  dose_index: number
  units: number
  updated_at: number
  deleted_at: number | null
  rev: number
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export interface SyncTable {
  name: 'user_products' | 'stack_items' | 'shopping_items' | 'dose_checks'
  /** The entity's key columns (account_id aside). */
  key: readonly string[]
  /** Every other column the device writes (updated_at and deleted_at included; rev aside). */
  data: readonly string[]
  /**
   * user_products' primary key is `id` alone (ids are UUIDs made on the device), so its upsert
   * must also check the row belongs to this account: another account can't overwrite it by
   * pushing the same id.
   */
  keyHasAccount: boolean
}

export const PRODUCTS_TABLE: SyncTable = {
  name: 'user_products',
  key: ['id'],
  data: [
    'product_type',
    'brand',
    'name',
    'upc',
    'npn',
    'din',
    'strength',
    'form',
    'dose_unit',
    'units_per_dose',
    'doses_per_day',
    'package_quantity',
    'package_unit',
    'timing',
    'ingredients',
    'directions',
    'warnings',
    'notes',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  keyHasAccount: false,
}

export const STACK_TABLE: SyncTable = {
  name: 'stack_items',
  key: ['product_id'],
  data: [
    'doses_per_day',
    'pins',
    'dismissed',
    'units_per_dose',
    'variant_upc',
    'inv_remaining',
    'inv_unit',
    'inv_package_size',
    'low_flagged_at',
    'added_at',
    'updated_at',
    'deleted_at',
  ],
  keyHasAccount: true,
}

export const SHOPPING_TABLE: SyncTable = {
  name: 'shopping_items',
  key: ['product_id'],
  data: ['reason', 'replaces_product_id', 'added_at', 'updated_at', 'deleted_at'],
  keyHasAccount: true,
}

export const CHECKS_TABLE: SyncTable = {
  name: 'dose_checks',
  key: ['day', 'product_id', 'dose_index'],
  data: ['units', 'updated_at', 'deleted_at'],
  keyHasAccount: true,
}

/** In the order the reads come back (after settings). */
export const SYNC_TABLES = [PRODUCTS_TABLE, STACK_TABLE, SHOPPING_TABLE, CHECKS_TABLE] as const

// ---------------------------------------------------------------------------
// Entities → the JSON rows bound to the upserts (keys are column names)
// ---------------------------------------------------------------------------

export type ParamRow = Record<string, string | number | null | readonly unknown[]>

export function productParam(p: SyncProduct): ParamRow {
  if (isSyncTombstone(p)) {
    return {
      id: p.id,
      product_type: 'other',
      brand: null,
      name: '',
      upc: null,
      npn: null,
      din: null,
      strength: null,
      form: 'other',
      dose_unit: '',
      units_per_dose: 1,
      doses_per_day: 1,
      package_quantity: null,
      package_unit: null,
      timing: [],
      ingredients: [],
      directions: null,
      warnings: null,
      notes: null,
      created_at: 0,
      updated_at: p.updatedAt,
      deleted_at: p.deletedAt,
    }
  }
  return {
    id: p.id,
    product_type: p.productType,
    brand: p.brand,
    name: p.name,
    upc: p.upc,
    npn: p.npn,
    din: p.din,
    strength: p.strength,
    form: p.form,
    dose_unit: p.doseUnit,
    units_per_dose: p.unitsPerDose,
    doses_per_day: p.dosesPerDay,
    package_quantity: p.packageQuantity,
    package_unit: p.packageUnit,
    timing: p.timing,
    ingredients: p.ingredients,
    directions: p.directions,
    warnings: p.warnings,
    notes: p.notes,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    deleted_at: null,
  }
}

export function stackParam(s: SyncStackItem): ParamRow {
  if (isSyncTombstone(s)) {
    return {
      product_id: s.productId,
      doses_per_day: 1,
      pins: [],
      dismissed: [],
      units_per_dose: null,
      variant_upc: null,
      inv_remaining: null,
      inv_unit: null,
      inv_package_size: null,
      low_flagged_at: null,
      added_at: 0,
      updated_at: s.updatedAt,
      deleted_at: s.deletedAt,
    }
  }
  return {
    product_id: s.productId,
    doses_per_day: s.dosesPerDay,
    pins: s.pins ?? [],
    dismissed: s.dismissed ?? [],
    units_per_dose: s.unitsPerDose ?? null,
    variant_upc: s.variantUpc ?? null,
    inv_remaining: s.inventory?.remaining ?? null,
    inv_unit: s.inventory?.unit ?? null,
    inv_package_size: s.inventory?.packageSize ?? null,
    low_flagged_at: s.inventory?.lowFlaggedAt ?? null,
    added_at: s.addedAt,
    updated_at: s.updatedAt,
    deleted_at: null,
  }
}

export function shoppingParam(s: SyncShoppingItem): ParamRow {
  if (isSyncTombstone(s)) {
    return {
      product_id: s.productId,
      reason: 'manual',
      replaces_product_id: null,
      added_at: 0,
      updated_at: s.updatedAt,
      deleted_at: s.deletedAt,
    }
  }
  return {
    product_id: s.productId,
    reason: s.reason,
    replaces_product_id: s.replacesProductId ?? null,
    added_at: s.addedAt,
    updated_at: s.updatedAt,
    deleted_at: null,
  }
}

export function checkParam(c: SyncCheck): ParamRow {
  return {
    day: c.day,
    product_id: c.productId,
    dose_index: c.doseIndex,
    units: isSyncTombstone(c) ? 0 : c.units,
    updated_at: c.updatedAt,
    deleted_at: c.deletedAt,
  }
}

/** Every changed row of a request, per table, as bound to the upserts. */
export interface SyncParams {
  settings: SyncSettings | null
  user_products: ParamRow[]
  stack_items: ParamRow[]
  shopping_items: ParamRow[]
  dose_checks: ParamRow[]
}

export function syncParams(changes: SyncChanges): SyncParams {
  return {
    settings: changes.settings ?? null,
    user_products: changes.products.map(productParam),
    stack_items: changes.stack.map(stackParam),
    shopping_items: changes.shopping.map(shoppingParam),
    dose_checks: changes.checks.map(checkParam),
  }
}

export function hasChanges(params: SyncParams): boolean {
  return params.settings !== null || SYNC_TABLES.some((t) => params[t.name].length > 0)
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

/** The revision every row of this push gets: the account's, already bumped in the batch. */
const NEW_REV = '(SELECT rev FROM accounts WHERE id = ?1)'

/** Push: the batch's first statement. Returns the new revision. */
export function bumpRevStatement(accountId: string): Statement {
  return {
    sql: `UPDATE accounts SET rev = rev + 1 WHERE id = ?1 RETURNING rev`,
    params: [accountId],
  }
}

/** Pull: the account's current revision (first statement of the read batch). */
export function readRevStatement(accountId: string): Statement {
  return { sql: `SELECT rev FROM accounts WHERE id = ?1`, params: [accountId] }
}

export function settingsUpsertStatement(accountId: string, s: SyncSettings): Statement {
  return {
    sql: `INSERT INTO account_settings (account_id, routine, tz, locale, theme, updated_at, rev)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ${NEW_REV})
ON CONFLICT (account_id) DO UPDATE SET routine = excluded.routine, tz = excluded.tz,
  locale = excluded.locale, theme = excluded.theme, updated_at = excluded.updated_at,
  rev = excluded.rev
WHERE excluded.updated_at > account_settings.updated_at`,
    params: [
      accountId,
      s.routine === null ? null : JSON.stringify(s.routine),
      s.tz,
      s.locale,
      s.theme,
      s.updatedAt,
    ],
  }
}

/**
 * One upsert for all of a table's rows: `?2` is a JSON array of objects keyed by column name
 * ("WHERE true" lets SQLite parse the ON CONFLICT after a SELECT). The DO UPDATE only happens
 * when the pushed row is strictly newer: on a tie the server's copy stays.
 */
export function upsertStatement(
  table: SyncTable,
  accountId: string,
  rows: readonly ParamRow[],
): Statement {
  const columns = [...table.key, ...table.data]
  const guard = [`excluded.updated_at > ${table.name}.updated_at`]
  if (!table.keyHasAccount) guard.push(`${table.name}.account_id = excluded.account_id`)
  const conflict = table.keyHasAccount ? ['account_id', ...table.key] : table.key
  return {
    sql: `INSERT INTO ${table.name} (account_id, ${columns.join(', ')}, rev)
SELECT ?1, ${columns.map((c) => `json_extract(value, '$.${c}')`).join(', ')}, ${NEW_REV}
FROM json_each(?2) WHERE true
ON CONFLICT (${conflict.join(', ')}) DO UPDATE SET
  ${[...table.data, 'rev'].map((c) => `${c} = excluded.${c}`).join(', ')}
WHERE ${guard.join(' AND ')}`,
    params: [accountId, JSON.stringify(rows)],
  }
}

/*
 * What a request reads back. Pull: every row with `rev > since`, tombstones included. Push: the
 * same, except that a key this request pushed comes back only when the push LOST (the row
 * doesn't carry the new revision), with the server's copy; a pushed row that won is exactly
 * what the device sent, so it isn't echoed (a first backup doesn't get its 500 rows back).
 * Rows with the new revision are only ever this request's winners: the bump and the upserts
 * are one transaction.
 */

export function settingsReadStatement(
  accountId: string,
  since: number,
  pushed: boolean,
): Statement {
  return {
    sql: `SELECT routine, tz, locale, theme, updated_at, rev FROM account_settings
WHERE account_id = ?1 AND ${pushed ? `rev <> ${NEW_REV}` : 'rev > ?2'}`,
    params: pushed ? [accountId] : [accountId, since],
  }
}

/** See above; for a push, `?3` is a JSON array of the pushed key tuples. */
export function readStatement(
  table: SyncTable,
  accountId: string,
  since: number,
  pushed: readonly ParamRow[],
): Statement {
  const columns = [...table.key, ...table.data, 'rev'].join(', ')
  if (pushed.length === 0) {
    return {
      sql: `SELECT ${columns} FROM ${table.name} WHERE account_id = ?1 AND rev > ?2 ORDER BY rev`,
      params: [accountId, since],
    }
  }
  const keys = pushed.map((row) => table.key.map((k) => row[k] ?? null))
  const tuple = table.key.map((_, i) => `json_extract(value, '$[${i}]')`).join(', ')
  return {
    sql: `SELECT ${columns} FROM ${table.name}
WHERE account_id = ?1
  AND CASE WHEN (${table.key.join(', ')}) IN (SELECT ${tuple} FROM json_each(?3))
    THEN rev <> ${NEW_REV} ELSE rev > ?2 END
ORDER BY rev`,
    params: [accountId, since, JSON.stringify(keys)],
  }
}

export interface SyncPlan {
  statements: Statement[]
  /** Index of the settings read; the four table reads follow in SYNC_TABLES order. */
  firstRead: number
}

/**
 * The whole request as one batch. Statement 0 answers the account's revision (bumped when
 * something is pushed); at most 1 + 5 upserts + 5 reads = 11 queries.
 */
export function syncPlan(accountId: string, since: number, params: SyncParams): SyncPlan {
  const push = hasChanges(params)
  const statements: Statement[] = [push ? bumpRevStatement(accountId) : readRevStatement(accountId)]
  if (params.settings) statements.push(settingsUpsertStatement(accountId, params.settings))
  for (const table of SYNC_TABLES) {
    const rows = params[table.name]
    if (rows.length > 0) statements.push(upsertStatement(table, accountId, rows))
  }
  const firstRead = statements.length
  statements.push(settingsReadStatement(accountId, since, params.settings !== null))
  for (const table of SYNC_TABLES) {
    statements.push(readStatement(table, accountId, since, params[table.name]))
  }
  return { statements, firstRead }
}

// ---------------------------------------------------------------------------
// Rows → entities
// ---------------------------------------------------------------------------

function parseJson(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function parseJsonArray<T>(text: string | null): T[] {
  const value = parseJson(text)
  return Array.isArray(value) ? (value as T[]) : []
}

export function settingsFromRow(row: AccountSettingsRow): SyncSettings | null {
  // Only /api/sync writes this table, always with all three; null means a row made elsewhere.
  if (row.tz === null || row.locale === null || row.theme === null) return null
  return {
    routine: parseJson(row.routine) as SyncSettings['routine'],
    tz: row.tz,
    locale: row.locale,
    theme: row.theme,
    updatedAt: row.updated_at,
    deletedAt: null,
  }
}

export function productFromRow(r: UserProductRow): SyncProduct {
  if (r.deleted_at !== null) return { id: r.id, updatedAt: r.updated_at, deletedAt: r.deleted_at }
  return {
    id: r.id,
    productType: r.product_type,
    brand: r.brand,
    name: r.name,
    upc: r.upc,
    npn: r.npn,
    din: r.din,
    strength: r.strength,
    form: r.form,
    doseUnit: r.dose_unit,
    unitsPerDose: r.units_per_dose,
    dosesPerDay: r.doses_per_day,
    packageQuantity: r.package_quantity,
    packageUnit: r.package_unit,
    timing: parseJsonArray(r.timing),
    ingredients: parseJsonArray(r.ingredients),
    directions: r.directions,
    warnings: r.warnings,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: null,
  }
}

/** A StackEntry again: optional fields are left out (never null) when the column is NULL. */
export function stackFromRow(r: StackItemRow): SyncStackItem {
  if (r.deleted_at !== null) {
    return { productId: r.product_id, updatedAt: r.updated_at, deletedAt: r.deleted_at }
  }
  return {
    productId: r.product_id,
    dosesPerDay: r.doses_per_day,
    pins: parseJsonArray(r.pins),
    dismissed: parseJsonArray(r.dismissed),
    ...(r.units_per_dose !== null ? { unitsPerDose: r.units_per_dose } : {}),
    ...(r.variant_upc !== null ? { variantUpc: r.variant_upc } : {}),
    ...(r.inv_remaining !== null && r.inv_unit !== null
      ? {
          inventory: {
            remaining: r.inv_remaining,
            unit: r.inv_unit,
            packageSize: r.inv_package_size,
            lowFlaggedAt: r.low_flagged_at,
          },
        }
      : {}),
    addedAt: r.added_at,
    updatedAt: r.updated_at,
    deletedAt: null,
  }
}

export function shoppingFromRow(r: ShoppingItemRow): SyncShoppingItem {
  if (r.deleted_at !== null) {
    return { productId: r.product_id, updatedAt: r.updated_at, deletedAt: r.deleted_at }
  }
  return {
    productId: r.product_id,
    reason: r.reason,
    ...(r.replaces_product_id !== null ? { replacesProductId: r.replaces_product_id } : {}),
    addedAt: r.added_at,
    updatedAt: r.updated_at,
    deletedAt: null,
  }
}

export function checkFromRow(r: DoseCheckRow): SyncCheck {
  const key = { day: r.day, productId: r.product_id, doseIndex: r.dose_index }
  if (r.deleted_at !== null) return { ...key, updatedAt: r.updated_at, deletedAt: r.deleted_at }
  return { ...key, units: r.units, updatedAt: r.updated_at, deletedAt: null }
}

export interface SyncReadRows {
  settings: AccountSettingsRow[]
  products: UserProductRow[]
  stack: StackItemRow[]
  shopping: ShoppingItemRow[]
  checks: DoseCheckRow[]
}

export function syncResponse(rev: number, rows: SyncReadRows): SyncResponse {
  const settings = rows.settings[0]
  return {
    rev,
    changes: {
      settings: settings ? settingsFromRow(settings) : null,
      products: rows.products.map(productFromRow),
      stack: rows.stack.map(stackFromRow),
      shopping: rows.shopping.map(shoppingFromRow),
      checks: rows.checks.map(checkFromRow),
    },
  }
}

// ---------------------------------------------------------------------------
// Request limits
// ---------------------------------------------------------------------------

/** Rows in a raw (not yet validated) body, to answer 413 before validating a huge request. */
export function rawRowCount(body: unknown): number {
  if (typeof body !== 'object' || body === null) return 0
  const changes = (body as { changes?: unknown }).changes
  if (typeof changes !== 'object' || changes === null) return 0
  const c = changes as Record<string, unknown>
  const length = (value: unknown) => (Array.isArray(value) ? value.length : 0)
  return (
    (c.settings === undefined ? 0 : 1) +
    (c.health === undefined ? 0 : 1) +
    length(c.products) +
    length(c.stack) +
    length(c.shopping) +
    length(c.checks)
  )
}

/** A Content-Length above the limit (or unreadable) is refused before the body is read. */
export function declaredTooLarge(contentLength: string | undefined, maxBytes: number): boolean {
  if (contentLength === undefined) return false
  const n = Number(contentLength)
  return !Number.isFinite(n) || n > maxBytes
}

// ---------------------------------------------------------------------------
// Per-account limits (200 user products, 60 stack items, counting live rows)
//
// Checked BEFORE the batch, against the state the push would leave: the account's rows are
// read (key, updated_at, deleted_at; tombstones included) and the pushed rows applied to them
// with the same last-write-wins rule as the upsert. That is exact, and it refuses the whole
// request up front instead of writing part of it. The read and the batch aren't one
// transaction, so two simultaneous pushes could each pass and overshoot by one push's worth;
// the limits guard against abuse, not an invariant, so that's accepted. The read runs only
// when the push brings live (not deleted) rows for that table: deletions alone never refuse.
// ---------------------------------------------------------------------------

export interface LimitRow {
  key: string
  updated_at: number
  deleted_at: number | null
}

export interface LimitedTable {
  entity: 'products' | 'stack'
  table: 'user_products' | 'stack_items'
  keyColumn: string
  max: number
}

export const LIMITED_TABLES: readonly LimitedTable[] = [
  { entity: 'products', table: 'user_products', keyColumn: 'id', max: SYNC_MAX_USER_PRODUCTS },
  { entity: 'stack', table: 'stack_items', keyColumn: 'product_id', max: SYNC_MAX_STACK_ITEMS },
]

export function limitReadStatement(limited: LimitedTable, accountId: string): Statement {
  return {
    sql: `SELECT ${limited.keyColumn} AS key, updated_at, deleted_at FROM ${limited.table}
WHERE account_id = ?1`,
    params: [accountId],
  }
}

interface Versioned {
  key: string
  updatedAt: number
  deletedAt: number | null
}

function incoming(changes: SyncChanges, entity: LimitedTable['entity']): Versioned[] {
  return entity === 'products'
    ? changes.products.map((p) => ({ key: p.id, updatedAt: p.updatedAt, deletedAt: p.deletedAt }))
    : changes.stack.map((s) => ({
        key: s.productId,
        updatedAt: s.updatedAt,
        deletedAt: s.deletedAt,
      }))
}

/** The limited tables this push must be checked against (it adds or edits live rows). */
export function tablesToCheck(changes: SyncChanges): LimitedTable[] {
  return LIMITED_TABLES.filter((t) => incoming(changes, t.entity).some((r) => r.deletedAt === null))
}

/** Live rows once the pushed rows are applied by last-write-wins (a tie keeps the server's). */
export function liveCountAfter(server: readonly LimitRow[], pushed: readonly Versioned[]): number {
  const state = new Map<string, { updatedAt: number; live: boolean }>()
  for (const row of server) {
    state.set(row.key, { updatedAt: row.updated_at, live: row.deleted_at === null })
  }
  for (const row of pushed) {
    const current = state.get(row.key)
    if (!current || row.updatedAt > current.updatedAt) {
      state.set(row.key, { updatedAt: row.updatedAt, live: row.deletedAt === null })
    }
  }
  let live = 0
  for (const entry of state.values()) if (entry.live) live++
  return live
}

/** `detail` lines for a 409 limit_reached, or [] when the push fits. */
export function limitViolations(
  changes: SyncChanges,
  serverRows: ReadonlyMap<LimitedTable['entity'], readonly LimitRow[]>,
): string[] {
  const out: string[] = []
  for (const limited of LIMITED_TABLES) {
    const server = serverRows.get(limited.entity)
    if (!server) continue
    if (liveCountAfter(server, incoming(changes, limited.entity)) > limited.max) {
      out.push(`${limited.entity}: at most ${limited.max} per account`)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Validation messages
// ---------------------------------------------------------------------------

interface IssueLike {
  code?: string
  path: readonly PropertyKey[]
  message: string
  errors?: readonly (readonly IssueLike[])[]
}

const UNION_BRANCHES = ['live', 'tombstone']
export const MAX_ISSUES = 20

/**
 * zod's issues as `path: message` lines. An entity is a union (live row | tombstone), whose
 * own message is only "Invalid input", so each branch's issues are listed, labelled.
 */
export function describeIssues(
  issues: readonly IssueLike[],
  prefix: readonly PropertyKey[] = [],
): string[] {
  const out: string[] = []
  for (const issue of issues) {
    const path = [...prefix, ...issue.path]
    if (issue.code === 'invalid_union' && issue.errors?.length) {
      issue.errors.forEach((branch, i) => {
        const label = UNION_BRANCHES[i] ?? `option ${i + 1}`
        for (const line of describeIssues(branch, path)) out.push(`(${label}) ${line}`)
      })
    } else {
      out.push(`${path.map(String).join('.')}: ${issue.message}`)
    }
  }
  return out.slice(0, MAX_ISSUES)
}

// ---------------------------------------------------------------------------
// Daily cleanup (§8.6), run by the 03:00 UTC tick
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000
export const CHECK_RETENTION_DAYS = 3
export const TOMBSTONE_RETENTION_MS = 30 * DAY_MS
/** The westernmost time zone (UTC−12): no local date on Earth is earlier than now − 12 h's. */
const WESTMOST_OFFSET_MS = 12 * 60 * 60 * 1000

/**
 * `dose_checks.day` is the person's local date. The earliest local date anywhere at `now` is
 * the UTC date of `now − 12 h`; keeping that day and the 3 before it keeps 3 days of history
 * (plus today) in every time zone, and one more day in the zones ahead of UTC−12. Rows are
 * compared as text: 'YYYY-MM-DD' sorts like the date.
 */
export function checksCutoffDay(now: number): string {
  return new Date(now - WESTMOST_OFFSET_MS - CHECK_RETENTION_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10)
}

/**
 * Check marks older than the cutoff, and tombstones deleted more than 30 days ago (by the
 * device's `deleted_at`) in the other synced tables. `dose_checks` tombstones go with the
 * 3-day rule; `account_settings` has none. A device offline for longer than 30 days misses
 * those deletions (see the README).
 */
export function syncCleanupStatements(now: number): Statement[] {
  const tombstoneCutoff = now - TOMBSTONE_RETENTION_MS
  return [
    { sql: `DELETE FROM dose_checks WHERE day < ?1`, params: [checksCutoffDay(now)] },
    ...(['user_products', 'stack_items', 'shopping_items'] as const).map((table) => ({
      sql: `DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ?1`,
      params: [tombstoneCutoff],
    })),
  ]
}

// ---------------------------------------------------------------------------
// Export (GET /api/account/export): every row of the new tables, tombstones included
// ---------------------------------------------------------------------------

const EXPORT_ORDER: Record<SyncTable['name'], string> = {
  user_products: 'created_at, id',
  stack_items: 'added_at, product_id',
  shopping_items: 'added_at, product_id',
  dose_checks: 'day, product_id, dose_index',
}

/** Settings, then SYNC_TABLES in order. */
export function syncExportStatements(accountId: string): Statement[] {
  return [
    {
      sql: `SELECT routine, tz, locale, theme, updated_at, rev FROM account_settings
WHERE account_id = ?1`,
      params: [accountId],
    },
    ...SYNC_TABLES.map((table) => ({
      sql: `SELECT ${[...table.key, ...table.data, 'rev'].join(', ')} FROM ${table.name}
WHERE account_id = ?1 ORDER BY ${EXPORT_ORDER[table.name]}`,
      params: [accountId],
    })),
  ]
}
