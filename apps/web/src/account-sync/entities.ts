/**
 * The device side of sync (build prompt §8.3), as pure functions over the persisted state:
 * - markChanges: after every local change of an account's data, the changed entities join
 *   `sync.outbox` (deleted ones leave a tombstone until pushed);
 * - buildPush: the outbox as wire rows, chunked under the Worker's limits;
 * - applyRemote: rows from the Worker, merged by last write wins;
 * - afterSync: clear what was stored as sent, keep what changed during the request.
 */
import {
  SYNC_MAX_BYTES,
  SYNC_MAX_ROWS,
  syncCheckKey,
  type SyncChanges,
  type SyncCheck,
  type SyncProduct,
  type SyncRequestBody,
  type SyncResponse,
  type SyncSettings,
  type SyncShoppingItem,
  type SyncStackItem,
} from '@smartstack/shared'
import type { PersistedState } from '../storage'
import { THEME_IDS, type ThemeId } from '../themes'

/** The health profile joins sync in M8 (the Worker refuses it until its table exists). */
export const HEALTH_SYNC_ENABLED = false

export const SETTINGS_KEY = 'settings'
export const HEALTH_KEY = 'health'
export const productKey = (id: string) => `product:${id}`
export const stackKey = (productId: string) => `stack:${productId}`
export const shoppingKey = (productId: string) => `shopping:${productId}`
export const checkKeyOf = (key: string) => `check:${key}`

type Keyed<T> = ReadonlyMap<string, T>

function byKey<T>(items: readonly T[], key: (item: T) => string): Map<string, T> {
  return new Map(items.map((item) => [key(item), item]))
}

/** Every synced entity of the device, keyed as in the outbox, with its updatedAt. */
function entityVersions(state: PersistedState): Map<string, number> {
  const out = new Map<string, number>()
  out.set(SETTINGS_KEY, state.settingsUpdatedAt)
  for (const p of state.userProducts) out.set(productKey(p.id), p.updatedAt)
  for (const s of state.stack) out.set(stackKey(s.productId), s.updatedAt)
  for (const s of state.shopping) out.set(shoppingKey(s.productId), s.updatedAt)
  for (const [key, check] of Object.entries(state.checks)) out.set(checkKeyOf(key), check.at)
  if (HEALTH_SYNC_ENABLED && state.healthProfile) {
    out.set(HEALTH_KEY, state.healthProfile.updatedAt)
  }
  return out
}

function settingsChanged(prev: PersistedState, next: PersistedState): boolean {
  return (
    prev.routine !== next.routine ||
    prev.locale !== next.locale ||
    prev.theme !== next.theme ||
    prev.tz !== next.tz
  )
}

/** Later than `before` even when this device's clock is behind the one that wrote it. */
function after(before: number, now: number): number {
  return Math.max(now, before + 1)
}

function changedKeys<T>(prev: Keyed<T>, next: Keyed<T>): { changed: string[]; removed: string[] } {
  const changed: string[] = []
  const removed: string[] = []
  for (const [key, item] of next) if (prev.get(key) !== item) changed.push(key)
  for (const key of prev.keys()) if (!next.has(key)) removed.push(key)
  return { changed, removed }
}

/**
 * After a local change: when an account is signed in, stamp and queue what changed. Rows the
 * Worker sent (SYNC_* actions) are not passed through here. Guests queue nothing.
 */
export function markChanges(
  prev: PersistedState,
  next: PersistedState,
  now: number = Date.now(),
): PersistedState {
  if (
    next === prev ||
    next.auth.mode !== 'account' ||
    prev.auth.accountId !== next.auth.accountId
  ) {
    return next
  }
  const outbox = new Set(next.sync.outbox)
  const tombstones = { ...next.tombstones }
  let result = next

  if (settingsChanged(prev, next)) {
    result = { ...result, settingsUpdatedAt: after(prev.settingsUpdatedAt, now) }
    outbox.add(SETTINGS_KEY)
  }

  const collections = [
    {
      prev: byKey(prev.userProducts, (p) => productKey(p.id)),
      next: byKey(next.userProducts, (p) => productKey(p.id)),
    },
    {
      prev: byKey(prev.stack, (s) => stackKey(s.productId)),
      next: byKey(next.stack, (s) => stackKey(s.productId)),
    },
    {
      prev: byKey(prev.shopping, (s) => shoppingKey(s.productId)),
      next: byKey(next.shopping, (s) => shoppingKey(s.productId)),
    },
    {
      prev: new Map(Object.entries(prev.checks).map(([k, v]) => [checkKeyOf(k), v])),
      next: new Map(Object.entries(next.checks).map(([k, v]) => [checkKeyOf(k), v])),
    },
  ]
  for (const { prev: p, next: n } of collections) {
    const { changed, removed } = changedKeys<unknown>(p, n)
    for (const key of changed) {
      outbox.add(key)
      delete tombstones[key]
    }
    // Within the reducer an entity only disappears by the person's action (an untick, a
    // removal); past days' check marks are pruned at load, outside it, and never synced away.
    for (const key of removed) {
      outbox.add(key)
      tombstones[key] = now
    }
  }
  // Entities carry their own updatedAt from the reducer; make sure an edit is newer than the
  // copy it was made from.
  result = { ...result, ...restamp(prev, result, now) }

  if (HEALTH_SYNC_ENABLED && prev.healthProfile !== next.healthProfile) {
    outbox.add(HEALTH_KEY)
    if (next.healthProfile) delete tombstones[HEALTH_KEY]
  }
  if (!HEALTH_SYNC_ENABLED) delete tombstones[HEALTH_KEY]

  return { ...result, tombstones, sync: { ...result.sync, outbox: [...outbox] } }
}

function restamp(prev: PersistedState, next: PersistedState, now: number): Partial<PersistedState> {
  const prevStack = byKey(prev.stack, (s) => s.productId)
  const prevProducts = byKey(prev.userProducts, (p) => p.id)
  const prevShopping = byKey(prev.shopping, (s) => s.productId)
  const fix = <T extends { updatedAt: number }>(item: T, before: T | undefined): T =>
    before && before !== item && item.updatedAt <= before.updatedAt
      ? { ...item, updatedAt: after(before.updatedAt, now) }
      : item
  return {
    stack: next.stack.map((s) => fix(s, prevStack.get(s.productId))),
    userProducts: next.userProducts.map((p) => fix(p, prevProducts.get(p.id))),
    shopping: next.shopping.map((s) => fix(s, prevShopping.get(s.productId))),
  }
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/** What was sent, to tell afterwards whether the entity changed during the request. */
export type PushSnapshot = Map<string, number>

function settingsRow(state: PersistedState): SyncSettings {
  return {
    routine: state.routine,
    tz: state.tz,
    locale: state.locale,
    theme: state.theme,
    updatedAt: state.settingsUpdatedAt,
    deletedAt: null,
  }
}

function parseCheckKey(key: string): { day: string; productId: string; doseIndex: number } {
  const day = key.slice(0, 10)
  const last = key.lastIndexOf(':')
  return { day, productId: key.slice(11, last), doseIndex: Number(key.slice(last + 1)) }
}

/** The wire rows for these outbox keys (live rows, or tombstones for deleted entities). */
export function buildChanges(
  state: PersistedState,
  keys: readonly string[],
): { changes: SyncChanges; snapshot: PushSnapshot } {
  const products: SyncProduct[] = []
  const stack: SyncStackItem[] = []
  const shopping: SyncShoppingItem[] = []
  const checks: SyncCheck[] = []
  const snapshot: PushSnapshot = new Map()
  let settings: SyncSettings | undefined

  for (const key of keys) {
    const deletedAt = state.tombstones[key]
    if (key === SETTINGS_KEY) {
      settings = settingsRow(state)
      snapshot.set(key, state.settingsUpdatedAt)
    } else if (key.startsWith('product:')) {
      const id = key.slice('product:'.length)
      const live = state.userProducts.find((p) => p.id === id)
      if (live) products.push({ ...live, deletedAt: null })
      else if (deletedAt !== undefined) {
        products.push({ id, updatedAt: deletedAt, deletedAt } as SyncProduct)
      } else continue
      snapshot.set(key, live?.updatedAt ?? deletedAt!)
    } else if (key.startsWith('stack:')) {
      const productId = key.slice('stack:'.length)
      const live = state.stack.find((s) => s.productId === productId)
      if (live) stack.push({ ...live, deletedAt: null })
      else if (deletedAt !== undefined) stack.push({ productId, updatedAt: deletedAt, deletedAt })
      else continue
      snapshot.set(key, live?.updatedAt ?? deletedAt!)
    } else if (key.startsWith('shopping:')) {
      const productId = key.slice('shopping:'.length)
      const live = state.shopping.find((s) => s.productId === productId)
      if (live) shopping.push({ ...live, deletedAt: null })
      else if (deletedAt !== undefined) {
        shopping.push({ productId, updatedAt: deletedAt, deletedAt })
      } else continue
      snapshot.set(key, live?.updatedAt ?? deletedAt!)
    } else if (key.startsWith('check:')) {
      const checkKey = key.slice('check:'.length)
      const fields = parseCheckKey(checkKey)
      const live = state.checks[checkKey]
      if (live) checks.push({ ...fields, units: live.units, updatedAt: live.at, deletedAt: null })
      else if (deletedAt !== undefined) checks.push({ ...fields, updatedAt: deletedAt, deletedAt })
      else continue
      snapshot.set(key, live?.at ?? deletedAt!)
    }
  }
  return {
    changes: {
      ...(settings ? { settings } : {}),
      products,
      stack,
      shopping,
      checks,
    },
    snapshot,
  }
}

/**
 * The outbox in requests under the Worker's limits (rows and bytes). Settings go first so a
 * routine reaches other devices before the stack that depends on it.
 */
export function buildPushes(
  state: PersistedState,
): { body: SyncRequestBody; snapshot: PushSnapshot }[] {
  const keys = [...state.sync.outbox].sort((a, b) =>
    a === SETTINGS_KEY ? -1 : b === SETTINGS_KEY ? 1 : 0,
  )
  const pushes: { body: SyncRequestBody; snapshot: PushSnapshot }[] = []
  let size = Math.min(keys.length, SYNC_MAX_ROWS)
  for (let start = 0; start < keys.length;) {
    const slice = keys.slice(start, start + size)
    const { changes, snapshot } = buildChanges(state, slice)
    const body = { since: state.sync.rev, changes }
    if (JSON.stringify(body).length > SYNC_MAX_BYTES * 0.9 && size > 1) {
      size = Math.ceil(size / 2)
      continue
    }
    pushes.push({ body, snapshot })
    start += slice.length
  }
  return pushes
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function isTheme(value: string): value is ThemeId {
  return (THEME_IDS as readonly string[]).includes(value)
}

type Live<T> = Exclude<T, { deletedAt: number }>

/**
 * Merge rows from the Worker by last write wins (§8.1): a row replaces or deletes the local
 * entity when it is newer than it (and newer than a local deletion not yet pushed).
 */
export function applyRemote(
  state: PersistedState,
  remote: SyncResponse['changes'],
): PersistedState {
  let next = state
  const tombstones = { ...state.tombstones }

  const wins = (key: string, localUpdatedAt: number | undefined, remoteUpdatedAt: number) => {
    const localDeleted = tombstones[key]
    const local = Math.max(localUpdatedAt ?? -1, localDeleted ?? -1)
    return remoteUpdatedAt > local
  }

  if (remote.settings && wins(SETTINGS_KEY, state.settingsUpdatedAt, remote.settings.updatedAt)) {
    const s = remote.settings
    next = {
      ...next,
      routine: s.routine,
      locale: s.locale,
      ...(isTheme(s.theme) ? { theme: s.theme } : {}),
      // The time zone stays the one this device detects.
      settingsUpdatedAt: s.updatedAt,
    }
  }

  const merge = <
    L extends { updatedAt: number },
    R extends { updatedAt: number; deletedAt: number | null },
  >(
    local: readonly L[],
    rows: readonly R[],
    keyOfLocal: (item: L) => string,
    keyOfRow: (row: R) => string,
    toLocal: (row: Live<R>) => L,
  ): L[] => {
    const map = byKey(local, keyOfLocal)
    for (const row of rows) {
      const key = keyOfRow(row)
      const current = map.get(key)
      if (!wins(key, current?.updatedAt, row.deletedAt ?? row.updatedAt)) continue
      delete tombstones[key]
      if (row.deletedAt !== null) map.delete(key)
      else map.set(key, toLocal(row as Live<R>))
    }
    return [...map.values()]
  }

  next = {
    ...next,
    userProducts: merge(
      next.userProducts,
      remote.products,
      (p) => productKey(p.id),
      (r) => productKey(r.id),
      ({ deletedAt: _d, ...p }) => p,
    ),
    stack: merge(
      next.stack,
      remote.stack,
      (s) => stackKey(s.productId),
      (r) => stackKey(r.productId),
      ({ deletedAt: _d, ...s }) => s,
    ),
    shopping: merge(
      next.shopping,
      remote.shopping,
      (s) => shoppingKey(s.productId),
      (r) => shoppingKey(r.productId),
      ({ deletedAt: _d, ...s }) => s,
    ),
  }

  const checks = { ...next.checks }
  for (const row of remote.checks) {
    const k = syncCheckKey(row)
    const key = checkKeyOf(k)
    if (!wins(key, checks[k]?.at, row.deletedAt ?? row.updatedAt)) continue
    delete tombstones[key]
    if (row.deletedAt !== null) delete checks[k]
    else checks[k] = { units: row.units, at: row.updatedAt }
  }

  return { ...next, checks, tombstones }
}

/** The version of every row the Worker sent back, keyed as in the outbox. */
function remoteVersions(changes: SyncResponse['changes']): Map<string, number> {
  const out = new Map<string, number>()
  const v = (row: { updatedAt: number; deletedAt: number | null }) => row.deletedAt ?? row.updatedAt
  if (changes.settings) out.set(SETTINGS_KEY, changes.settings.updatedAt)
  for (const r of changes.products) out.set(productKey(r.id), v(r))
  for (const r of changes.stack) out.set(stackKey(r.productId), v(r))
  for (const r of changes.shopping) out.set(shoppingKey(r.productId), v(r))
  for (const r of changes.checks) out.set(checkKeyOf(syncCheckKey(r)), v(r))
  return out
}

/**
 * After a successful request: apply what came back, then drop from the outbox every key that
 * was sent and didn't change meanwhile (its tombstone too, once it reached the Worker).
 */
export function afterSync(
  state: PersistedState,
  snapshot: PushSnapshot,
  response: SyncResponse,
  now: number,
): PersistedState {
  const applied = applyRemote(state, response.changes)
  const versions = entityVersions(applied)
  const remote = remoteVersions(response.changes)
  const outbox: string[] = []
  const tombstones = { ...applied.tombstones }
  for (const key of applied.sync.outbox) {
    const sent = snapshot.get(key)
    if (sent === undefined) {
      outbox.push(key) // not part of this request
      continue
    }
    const current = versions.get(key) ?? tombstones[key]
    // Stored as sent, or replaced by the Worker's winning copy: done. Changed meanwhile: again.
    if (current === undefined || current === sent || current === remote.get(key)) {
      if (tombstones[key] === sent) delete tombstones[key]
      continue
    }
    outbox.push(key)
  }
  return {
    ...applied,
    tombstones,
    sync: { ...applied.sync, rev: response.rev, outbox, lastSyncAt: now, error: null },
  }
}

// ---------------------------------------------------------------------------
// First sign-in on a device (§8.4)
// ---------------------------------------------------------------------------

export function hasLocalData(state: PersistedState): boolean {
  return state.routine !== null || state.stack.length > 0 || state.userProducts.length > 0
}

export function remoteHasData(response: SyncResponse): boolean {
  const c = response.changes
  return (
    response.rev > 0 &&
    (c.settings?.routine != null ||
      c.stack.some((s) => s.deletedAt === null) ||
      c.products.some((p) => p.deletedAt === null))
  )
}

/** Queue every local entity (the backup, or "Combine both"). */
export function queueEverything(state: PersistedState, now: number): PersistedState {
  const keys = new Set(state.sync.outbox)
  for (const key of entityVersions(state).keys()) keys.add(key)
  return {
    ...state,
    settingsUpdatedAt: state.settingsUpdatedAt || now,
    sync: { ...state.sync, outbox: [...keys] },
  }
}

/** "Use my account's data": the device's own copy of the synced entities goes. */
export function dropLocalData(state: PersistedState): PersistedState {
  return {
    ...state,
    routine: null,
    stack: [],
    userProducts: [],
    shopping: [],
    checks: {},
    healthProfile: null,
    tombstones: {},
    lowAlerts: [],
    settingsUpdatedAt: 0,
    sync: { ...state.sync, outbox: [] },
  }
}
