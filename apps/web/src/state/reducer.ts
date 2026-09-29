import {
  applyTick,
  catalogue as bundledCatalogue,
  getProduct,
  isLow,
  refill,
  undoTick,
  unitsPerDose,
} from '@smartstack/engine'
import type {
  AccountView,
  Catalogue,
  HealthProfile,
  SyncResponse,
  InventoryUnit,
  PinAnchor,
  Routine,
  ShoppingItem,
  StackEntry,
  StackItem,
  UserProduct,
} from '@smartstack/shared'
import {
  afterSync,
  dropLocalData,
  queueEverything,
  type PushSnapshot,
} from '../account-sync/entities'
import { authFromAccount } from '../auth/view'
import { catalogueFor } from '../catalogue'
import { checkKey, type PersistedState, type PushState, type TodayOverride } from '../storage'
import type { ThemeId } from '../themes'

/** A bottle as the Add flow and the Manage sheet describe it. */
export interface BottleInput {
  remaining: number
  unit: InventoryUnit
  packageSize: number | null
}

export type Action =
  | { type: 'SET_ROUTINE'; routine: Routine }
  | {
      type: 'ADD_PRODUCT'
      productId: string
      dosesPerDay: number
      pins?: (PinAnchor | null)[]
      unitsPerDose?: number
      variantUpc?: string
      bottle?: BottleInput
      at?: number
    }
  | { type: 'REMOVE_PRODUCT'; productId: string }
  | { type: 'SET_DOSES'; productId: string; dosesPerDay: number }
  /** Pin one dose slot to an anchor, or give it back to the engine (null). */
  | { type: 'SET_PIN'; productId: string; slot: number; anchor: PinAnchor | null }
  /** The person turned a suggestion down (e.g. SUGGEST_BEDTIME). */
  | { type: 'DISMISS_SUGGESTION'; productId: string; code: string }
  /** Tick or untick a dose; a tick takes one dose off a tracked bottle. */
  | { type: 'TOGGLE_CHECK'; date: string; productId: string; doseIndex: number; at?: number }
  /** Start tracking a bottle, or set the exact count left ("Edit count"). */
  | { type: 'SET_BOTTLE'; productId: string; bottle: BottleInput; at?: number }
  | { type: 'UNTRACK_BOTTLE'; productId: string }
  | { type: 'REFILL'; productId: string; added: number; at?: number }
  | { type: 'SET_UNITS_PER_DOSE'; productId: string; unitsPerDose: number }
  | {
      type: 'ADD_TO_SHOPPING'
      productId: string
      reason: 'manual' | 'alternative'
      replacesProductId?: string
      at?: number
    }
  | { type: 'REMOVE_FROM_SHOPPING'; productId: string; at?: number }
  /** Undo of a removal: puts the item back exactly as it was. */
  | { type: 'RESTORE_SHOPPING'; item: ShoppingItem }
  /** The running-low sheet for this product was shown. */
  | { type: 'ACK_LOW_ALERT'; productId: string }
  | { type: 'SET_REMINDER_NAMES'; on: boolean }
  | { type: 'SET_REMINDERS_ENABLED'; on: boolean }
  | { type: 'SET_NEWS_OPT_IN'; on: boolean }
  | { type: 'SET_NEWS_PROMPT_ASKED' }
  | { type: 'DISMISS_REMINDERS_CARD' }
  | { type: 'SET_TODAY_OVERRIDE'; override: TodayOverride | null }
  | { type: 'SET_PUSH_STATE'; pushState: PushState }
  | { type: 'SET_SYNC'; lastSync: number | null; lastSyncHash: string | null }
  | { type: 'SET_TZ'; tz: string }
  | { type: 'SET_LOCALE'; locale: 'en' | 'fr' }
  | { type: 'SET_THEME'; theme: ThemeId }
  /** Signed in (sign-up, login, OAuth claim) or the account was refreshed. */
  | { type: 'SET_ACCOUNT'; account: AccountView }
  /** The Worker answered a sync: apply its rows, clear what was stored as sent. */
  | { type: 'SYNC_RESULT'; snapshot: PushSnapshot; response: SyncResponse; at: number }
  | { type: 'SYNC_ERROR'; error: string | null }
  /** First sign-in: push everything local (backup, or "Combine both"). */
  | { type: 'SYNC_QUEUE_ALL'; at: number }
  /** First sign-in, "Use my account's data": the device's copy goes, the account's comes. */
  | { type: 'SYNC_USE_ACCOUNT' }
  | { type: 'SYNC_INITIALIZED' }
  /** A product the person added or edited (other brand, medication, food). */
  | { type: 'UPSERT_USER_PRODUCT'; product: UserProduct }
  /** Deleting it also takes it out of the stack and the shopping list. */
  | { type: 'DELETE_USER_PRODUCT'; id: string }
  /** Saved on every change (the storage consent is part of the profile). */
  | { type: 'SET_HEALTH_PROFILE'; profile: HealthProfile }
  /** Deletes the profile; the account stays. The tombstone syncs the deletion. */
  | { type: 'DELETE_HEALTH_PROFILE'; at: number }
  /** "Continue without an account", or accounts aren't open to the public. */
  | { type: 'SET_GUEST' }
  | { type: 'RESET'; state: PersistedState }

export function reducer(state: PersistedState, action: Action): PersistedState {
  switch (action.type) {
    case 'SET_ROUTINE':
      // A new routine invalidates today's "running late" shift.
      return { ...state, routine: action.routine, todayOverride: null }
    case 'ADD_PRODUCT': {
      const at = action.at ?? Date.now()
      const existing = state.stack.find((s) => s.productId === action.productId)
      const base: StackEntry = existing
        ? { ...existing, dosesPerDay: action.dosesPerDay, updatedAt: at }
        : {
            productId: action.productId,
            dosesPerDay: action.dosesPerDay,
            addedAt: at,
            updatedAt: at,
          }
      let entry = withPins(base, action.pins ?? base.pins ?? [])
      if (action.unitsPerDose !== undefined) entry = { ...entry, unitsPerDose: action.unitsPerDose }
      if (action.variantUpc !== undefined) entry = { ...entry, variantUpc: action.variantUpc }
      if (action.bottle) entry = { ...entry, inventory: { ...action.bottle, lowFlaggedAt: null } }
      const stack = existing
        ? state.stack.map((s) => (s.productId === action.productId ? entry : s))
        : [...state.stack, entry]
      const next = { ...state, stack }
      return action.bottle ? afterDecrease(next, action.productId, at) : next
    }
    case 'REMOVE_PRODUCT':
      return {
        ...state,
        stack: state.stack.filter((s) => s.productId !== action.productId),
        lowAlerts: state.lowAlerts.filter((id) => id !== action.productId),
      }
    case 'SET_DOSES':
      return updateEntry(state, action.productId, (s) =>
        // Pins past the new number of doses no longer mean anything.
        withPins({ ...s, dosesPerDay: action.dosesPerDay }, s.pins ?? []),
      )
    case 'SET_PIN':
      return updateEntry(state, action.productId, (s) => {
        const pins = [...(s.pins ?? [])]
        while (pins.length <= action.slot) pins.push(null)
        pins[action.slot] = action.anchor
        return withPins(s, pins)
      })
    case 'DISMISS_SUGGESTION':
      return updateEntry(state, action.productId, (s) =>
        s.dismissed?.includes(action.code)
          ? s
          : { ...s, dismissed: [...(s.dismissed ?? []), action.code] },
      )
    case 'TOGGLE_CHECK': {
      const at = action.at ?? Date.now()
      const key = checkKey(action.date, action.productId, action.doseIndex)
      const checks = { ...state.checks }
      const previous = checks[key]
      const entry = state.stack.find((s) => s.productId === action.productId)
      const inv = entry?.inventory
      if (previous) {
        // Untick: give back exactly what the tick took.
        delete checks[key]
        const next = { ...state, checks }
        if (!inv || previous.units === 0) return next
        return updateEntry(next, action.productId, (s) => ({
          ...s,
          inventory: { ...inv, remaining: undoTick(inv.remaining, previous.units) },
        }))
      }
      if (!entry || !inv) {
        checks[key] = { units: 0, at }
        return { ...state, checks }
      }
      const { remaining, taken } = applyTick(
        inv.remaining,
        perDose(entry, catalogueFor(state.userProducts)),
      )
      checks[key] = { units: taken, at }
      const next = updateEntry({ ...state, checks }, action.productId, (s) => ({
        ...s,
        inventory: { ...inv, remaining },
      }))
      return afterDecrease(next, action.productId, at)
    }
    case 'SET_BOTTLE': {
      const at = action.at ?? Date.now()
      const entry = state.stack.find((s) => s.productId === action.productId)
      if (!entry) return state
      const before = entry.inventory
      const daily =
        entry.dosesPerDay *
        perDose(
          { ...entry, inventory: { ...action.bottle, lowFlaggedAt: null } },
          catalogueFor(state.userProducts),
        )
      // Edited back above the threshold: the next low bottle is flagged again.
      const lowFlaggedAt =
        before && before.lowFlaggedAt !== null && isLow(action.bottle.remaining, daily)
          ? before.lowFlaggedAt
          : null
      const next = updateEntry(state, action.productId, (s) => ({
        ...s,
        inventory: { ...action.bottle, lowFlaggedAt },
      }))
      return afterDecrease(next, action.productId, at)
    }
    case 'UNTRACK_BOTTLE':
      return {
        ...updateEntry(state, action.productId, (s) => {
          const { inventory: _inventory, ...rest } = s
          return rest
        }),
        lowAlerts: state.lowAlerts.filter((id) => id !== action.productId),
      }
    case 'REFILL': {
      const at = action.at ?? Date.now()
      const next = updateEntry(state, action.productId, (s) =>
        s.inventory
          ? {
              ...s,
              inventory: {
                ...s.inventory,
                remaining: refill(s.inventory.remaining, action.added),
                lowFlaggedAt: null,
              },
            }
          : s,
      )
      return {
        ...removeShopping(next, action.productId, at),
        lowAlerts: next.lowAlerts.filter((id) => id !== action.productId),
      }
    }
    case 'SET_UNITS_PER_DOSE':
      return updateEntry(state, action.productId, (s) => ({
        ...s,
        unitsPerDose: action.unitsPerDose,
      }))
    case 'ADD_TO_SHOPPING': {
      const at = action.at ?? Date.now()
      const item: ShoppingItem = {
        productId: action.productId,
        reason: action.reason,
        ...(action.replacesProductId ? { replacesProductId: action.replacesProductId } : {}),
        addedAt: at,
        updatedAt: at,
      }
      const shopping = state.shopping.some((s) => s.productId === action.productId)
        ? state.shopping.map((s) => (s.productId === action.productId ? item : s))
        : [...state.shopping, item]
      return { ...state, shopping }
    }
    case 'REMOVE_FROM_SHOPPING': {
      const at = action.at ?? Date.now()
      const item = state.shopping.find((s) => s.productId === action.productId)
      // The bottle keeps its low flag, so it doesn't come back until the next bottle runs low.
      let next = removeShopping(state, action.productId, at)
      // Removing a replacement puts the product it replaced back, if that one is still low.
      const replaced = item?.replacesProductId
        ? next.stack.find((s) => s.productId === item.replacesProductId)
        : undefined
      if (
        replaced?.inventory &&
        isLow(replaced.inventory.remaining, dailyUseOf(replaced, catalogueFor(next.userProducts)))
      ) {
        next = addLowItem(next, replaced.productId, at)
      }
      return next
    }
    case 'RESTORE_SHOPPING':
      return {
        ...state,
        shopping: [
          ...state.shopping.filter((s) => s.productId !== action.item.productId),
          action.item,
        ],
      }
    case 'ACK_LOW_ALERT':
      return { ...state, lowAlerts: state.lowAlerts.filter((id) => id !== action.productId) }
    case 'SET_REMINDER_NAMES':
      return { ...state, reminderProductNames: action.on }
    case 'SET_REMINDERS_ENABLED':
      return { ...state, remindersEnabled: action.on }
    case 'SET_NEWS_OPT_IN':
      // Once news is on, the one-time question has no reason to come back.
      return { ...state, newsOptIn: action.on, newsPromptAsked: true }
    case 'SET_NEWS_PROMPT_ASKED':
      return { ...state, newsPromptAsked: true }
    case 'DISMISS_REMINDERS_CARD':
      return { ...state, remindersCardDismissed: true }
    case 'SET_TODAY_OVERRIDE':
      return { ...state, todayOverride: action.override }
    case 'SET_PUSH_STATE':
      return { ...state, pushState: action.pushState }
    case 'SET_SYNC':
      return { ...state, lastSync: action.lastSync, lastSyncHash: action.lastSyncHash }
    case 'SET_TZ':
      return { ...state, tz: action.tz }
    case 'SET_LOCALE':
      return { ...state, locale: action.locale }
    case 'SET_THEME':
      return { ...state, theme: action.theme }
    case 'SET_ACCOUNT': {
      const auth = authFromAccount(action.account)
      // Another account on this device starts its sync from scratch.
      if (state.auth.accountId === auth.accountId) return { ...state, auth }
      return {
        ...state,
        auth,
        tombstones: {},
        sync: { rev: 0, outbox: [], lastSyncAt: null, error: null, initialized: false },
      }
    }
    case 'SYNC_RESULT':
      return afterSync(state, action.snapshot, action.response, action.at)
    case 'SYNC_ERROR':
      return { ...state, sync: { ...state.sync, error: action.error } }
    case 'SYNC_QUEUE_ALL':
      return queueEverything(state, action.at)
    case 'SYNC_USE_ACCOUNT':
      return dropLocalData(state)
    case 'SYNC_INITIALIZED':
      return { ...state, sync: { ...state.sync, initialized: true } }
    case 'UPSERT_USER_PRODUCT': {
      const exists = state.userProducts.some((p) => p.id === action.product.id)
      return {
        ...state,
        userProducts: exists
          ? state.userProducts.map((p) => (p.id === action.product.id ? action.product : p))
          : [...state.userProducts, action.product],
      }
    }
    case 'DELETE_USER_PRODUCT':
      return {
        ...state,
        userProducts: state.userProducts.filter((p) => p.id !== action.id),
        stack: state.stack.filter((s) => s.productId !== action.id),
        shopping: state.shopping.filter(
          (s) => s.productId !== action.id && s.replacesProductId !== action.id,
        ),
        lowAlerts: state.lowAlerts.filter((id) => id !== action.id),
      }
    case 'SET_HEALTH_PROFILE': {
      const { health: _deleted, ...tombstones } = state.tombstones
      return { ...state, healthProfile: action.profile, tombstones }
    }
    case 'DELETE_HEALTH_PROFILE':
      return {
        ...state,
        healthProfile: null,
        tombstones: { ...state.tombstones, health: action.at },
      }
    case 'SET_GUEST':
      return state.auth.mode === 'unset'
        ? { ...state, auth: { ...state.auth, mode: 'guest' } }
        : state
    case 'RESET':
      return action.state
  }
}

/**
 * Store pins trimmed to the number of doses, without trailing nulls, and drop the field
 * when nothing is pinned (so an untouched item stays `{ productId, dosesPerDay, … }`).
 */
export function withPins<T extends StackItem>(item: T, pins: readonly (PinAnchor | null)[]): T {
  const trimmed = pins.slice(0, item.dosesPerDay)
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === null) trimmed.pop()
  const { pins: _old, ...rest } = item
  return (trimmed.length > 0 ? { ...rest, pins: trimmed } : rest) as T
}

/** What one dose takes off this entry's bottle (pass the catalogue with the person's products). */
export function perDose(entry: StackEntry, catalogue: Catalogue = bundledCatalogue): number {
  const unit = entry.inventory?.unit ?? 'unit'
  return unitsPerDose(unit, getProduct(entry.productId, catalogue), entry.unitsPerDose)
}

export function dailyUseOf(entry: StackEntry, catalogue: Catalogue = bundledCatalogue): number {
  return entry.dosesPerDay * perDose(entry, catalogue)
}

function updateEntry(
  state: PersistedState,
  productId: string,
  update: (entry: StackEntry) => StackEntry,
): PersistedState {
  let changed = false
  const stack = state.stack.map((s) => {
    if (s.productId !== productId) return s
    const next = update(s)
    if (next === s) return s
    changed = true
    return { ...next, updatedAt: Date.now() }
  })
  return changed ? { ...state, stack } : state
}

function removeShopping(state: PersistedState, productId: string, _at: number): PersistedState {
  if (!state.shopping.some((s) => s.productId === productId)) return state
  return { ...state, shopping: state.shopping.filter((s) => s.productId !== productId) }
}

function addLowItem(state: PersistedState, productId: string, at: number): PersistedState {
  if (state.shopping.some((s) => s.productId === productId)) return state
  return {
    ...state,
    shopping: [...state.shopping, { productId, reason: 'low', addedAt: at, updatedAt: at }],
  }
}

/**
 * After a bottle count went down: at 5 days of use or less, and once per bottle, add the
 * product to the shopping list, flag the bottle and queue the running-low sheet.
 */
function afterDecrease(state: PersistedState, productId: string, at: number): PersistedState {
  const entry = state.stack.find((s) => s.productId === productId)
  const inv = entry?.inventory
  if (!entry || !inv || inv.lowFlaggedAt !== null) return state
  if (!isLow(inv.remaining, dailyUseOf(entry, catalogueFor(state.userProducts)))) return state
  const flagged = updateEntry(state, productId, (s) => ({
    ...s,
    inventory: { ...inv, lowFlaggedAt: at },
  }))
  const withItem = addLowItem(flagged, productId, at)
  return {
    ...withItem,
    lowAlerts: withItem.lowAlerts.includes(productId)
      ? withItem.lowAlerts
      : [...withItem.lowAlerts, productId],
  }
}
