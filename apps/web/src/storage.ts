/**
 * Typed localStorage persistence. The browser is the source of truth for guests (routine,
 * stack, bottles, shopping list); the server mirrors reminders, and for accounts the
 * synced entities.
 */
import {
  HealthProfile,
  Routine,
  ShoppingItem,
  StackEntry,
  StackItem,
  UserProduct,
} from '@smartstack/shared'
import { z } from 'zod'
import { currentTimeZone, localDateKey } from './dates'
import { detectLocale } from './i18n'
import { DEFAULT_THEME, THEME_IDS } from './themes'

/** The key stays `smartstack:v1`; the blob inside carries its own `version`. */
export const STORAGE_KEY = 'smartstack:v1'
export const STATE_VERSION = 2

export const PushState = z.object({
  status: z.enum(['off', 'subscribed', 'denied', 'unsupported']),
  /** Endpoint last registered with the Worker (to detect silent iOS re-subscriptions). */
  endpoint: z.string().nullable(),
  registeredAt: z.number().nullable(),
})
export type PushState = z.infer<typeof PushState>

export const TodayOverride = z.object({
  /** Local date the override applies to; discarded on any other day. */
  date: z.string(),
  /** The shifted routine, computed when "I'm running late" was tapped. */
  routine: Routine,
  shiftMinutes: z.number().int(),
})
export type TodayOverride = z.infer<typeof TodayOverride>

export const AuthState = z.object({
  /** unset: the welcome screen has not been answered yet. */
  mode: z.enum(['unset', 'guest', 'account']),
  accountId: z.string().nullable(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  role: z.enum(['user', 'admin']),
  emailVerified: z.boolean(),
  providers: z.array(z.enum(['password', 'google', 'apple'])),
  consentNeeded: z.boolean(),
})
export type AuthState = z.infer<typeof AuthState>

/** A ticked dose and what it took off the bottle (given back when unticked). */
export const Check = z.object({ units: z.number().min(0), at: z.number() })
export type Check = z.infer<typeof Check>

export const SyncState = z.object({
  /** Last account revision pulled. */
  rev: z.number().int().min(0),
  /** Keys of entities changed since the last successful push. */
  outbox: z.array(z.string()),
  lastSyncAt: z.number().nullable(),
  error: z.string().nullable(),
})
export type SyncState = z.infer<typeof SyncState>

export const PersistedState = z.object({
  version: z.literal(STATE_VERSION),
  /** Anonymous device id (the Phase 1 "user"): the credential for /api/me. */
  userId: z.uuid(),
  createdAt: z.number(),
  auth: AuthState,
  routine: Routine.nullable(),
  stack: z.array(StackEntry),
  userProducts: z.array(UserProduct).catch([]),
  shopping: z.array(ShoppingItem).catch([]),
  healthProfile: HealthProfile.nullable().catch(null),
  todayOverride: TodayOverride.nullable(),
  /** `${localDate}:${productId}:${doseIndex}` → the tick. Past dates are pruned on load. */
  checks: z.record(z.string(), Check),
  /** Entity key → deletedAt, kept until the deletion is pushed (accounts). */
  tombstones: z.record(z.string(), z.number()).catch({}),
  sync: SyncState.catch({ rev: 0, outbox: [], lastSyncAt: null, error: null }),
  /** Products whose "running low" sheet is still to be shown (once per bottle). */
  lowAlerts: z.array(z.string()).catch([]),
  pushState: PushState,
  lastSync: z.number().nullable(),
  lastSyncHash: z.string().nullable(),
  /** Reminders name the products only when the person turns this on (N4, off by default). */
  reminderProductNames: z.boolean().catch(false),
  /** News notifications on this device (off by default). */
  newsOptIn: z.boolean().catch(false),
  /** The "Turn on reminders" card on Today was dismissed. */
  remindersCardDismissed: z.boolean().catch(false),
  tz: z.string(),
  locale: z.enum(['en', 'fr']),
  /** Colour theme (themes.ts). Missing or unknown falls back instead of resetting the user. */
  theme: z.enum(THEME_IDS).catch(DEFAULT_THEME),
})
export type PersistedState = z.infer<typeof PersistedState>

export const GUEST_AUTH: AuthState = {
  mode: 'unset',
  accountId: null,
  email: null,
  name: null,
  role: 'user',
  emailVerified: false,
  providers: [],
  consentNeeded: false,
}

export function newUserId(): string {
  return crypto.randomUUID()
}

export function defaultState(userId = newUserId(), now = Date.now()): PersistedState {
  return {
    version: STATE_VERSION,
    userId,
    createdAt: now,
    auth: GUEST_AUTH,
    routine: null,
    stack: [],
    userProducts: [],
    shopping: [],
    healthProfile: null,
    todayOverride: null,
    checks: {},
    tombstones: {},
    sync: { rev: 0, outbox: [], lastSyncAt: null, error: null },
    lowAlerts: [],
    pushState: { status: 'off', endpoint: null, registeredAt: null },
    lastSync: null,
    lastSyncHash: null,
    reminderProductNames: false,
    newsOptIn: false,
    remindersCardDismissed: false,
    tz: currentTimeZone(),
    // A new user starts in the browser's language when the app speaks it.
    locale: detectLocale(),
    theme: DEFAULT_THEME,
  }
}

/** The Phase 1 blob (version 1), as it was stored. */
const StateV1 = z.object({
  version: z.literal(1),
  userId: z.uuid(),
  createdAt: z.number(),
  routine: Routine.nullable(),
  stack: z.array(StackItem),
  todayOverride: TodayOverride.nullable(),
  checks: z.record(z.string(), z.literal(true)),
  pushState: PushState,
  lastSync: z.number().nullable(),
  lastSyncHash: z.string().nullable(),
  tz: z.string(),
  locale: z.enum(['en', 'fr']),
  theme: z.enum(THEME_IDS).catch(DEFAULT_THEME),
})

/**
 * Phase 1 → Phase 2: check marks record what they took (nothing, since bottles weren't
 * tracked), stack items get timestamps, the welcome screen is still to be answered, and
 * reminders stop naming products (the new default). Everything else is kept.
 */
export function migrateV1(raw: unknown, now = Date.now()): PersistedState | null {
  const parsed = StateV1.safeParse(raw)
  if (!parsed.success) return null
  const v1 = parsed.data
  const checks: PersistedState['checks'] = {}
  for (const key of Object.keys(v1.checks)) checks[key] = { units: 0, at: now }
  return {
    ...defaultState(v1.userId, now),
    createdAt: v1.createdAt,
    routine: v1.routine,
    stack: v1.stack.map((item) => ({ ...item, addedAt: now, updatedAt: now })),
    todayOverride: v1.todayOverride,
    checks,
    pushState: v1.pushState,
    lastSync: v1.lastSync,
    // Forces a re-send, so the server's rows lose their product names too.
    lastSyncHash: null,
    tz: v1.tz,
    locale: v1.locale,
    theme: v1.theme,
  }
}

/** Drop check marks and overrides that belong to a past day. Pure. */
export function pruneForToday(state: PersistedState, today = localDateKey()): PersistedState {
  const checks: PersistedState['checks'] = {}
  for (const [key, check] of Object.entries(state.checks)) {
    if (key.startsWith(`${today}:`)) checks[key] = check
  }
  const todayOverride = state.todayOverride?.date === today ? state.todayOverride : null
  return { ...state, checks, todayOverride }
}

export function loadState(storage: Storage = localStorage): PersistedState {
  let raw: string | null = null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return defaultState()
  }
  if (!raw) return defaultState()
  try {
    const json = JSON.parse(raw) as { version?: unknown; userId?: unknown }
    if (json.version === 1) {
      const migrated = migrateV1(json)
      if (migrated) return pruneForToday(migrated)
    } else {
      const parsed = PersistedState.safeParse(json)
      if (parsed.success) return pruneForToday(parsed.data)
    }
    // Keep the anonymous id if we can, so server-side rows stay deletable.
    const idCheck = z.uuid().safeParse(json.userId)
    return defaultState(idCheck.success ? idCheck.data : undefined)
  } catch {
    return defaultState()
  }
}

export function saveState(state: PersistedState, storage: Storage = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Quota or private mode: the in-memory state still works for this session.
  }
}

export function clearState(storage: Storage = localStorage): void {
  try {
    storage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function checkKey(date: string, productId: string, doseIndex: number): string {
  return `${date}:${productId}:${doseIndex}`
}
