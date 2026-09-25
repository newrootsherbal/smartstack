/**
 * Typed localStorage persistence. The browser is the source of truth for
 * routine, stack and schedule; the server only mirrors reminders.
 */
import { Routine, Stack } from '@smartstack/shared'
import { z } from 'zod'
import { currentTimeZone, localDateKey } from './dates'
import { detectLocale } from './i18n'

export const STORAGE_KEY = 'smartstack:v1'

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

export const PersistedState = z.object({
  version: z.literal(1),
  userId: z.uuid(),
  createdAt: z.number(),
  routine: Routine.nullable(),
  stack: Stack,
  todayOverride: TodayOverride.nullable(),
  /** `${localDate}:${productId}:${doseIndex}` → true. Past dates are pruned on load. */
  checks: z.record(z.string(), z.literal(true)),
  pushState: PushState,
  lastSync: z.number().nullable(),
  lastSyncHash: z.string().nullable(),
  tz: z.string(),
  locale: z.enum(['en', 'fr']),
})
export type PersistedState = z.infer<typeof PersistedState>

export function newUserId(): string {
  return crypto.randomUUID()
}

export function defaultState(userId = newUserId()): PersistedState {
  return {
    version: 1,
    userId,
    createdAt: Date.now(),
    routine: null,
    stack: [],
    todayOverride: null,
    checks: {},
    pushState: { status: 'off', endpoint: null, registeredAt: null },
    lastSync: null,
    lastSyncHash: null,
    tz: currentTimeZone(),
    // A new user starts in the browser's language when the app speaks it.
    locale: detectLocale(),
  }
}

/** Drop check marks and overrides that belong to a past day. Pure. */
export function pruneForToday(state: PersistedState, today = localDateKey()): PersistedState {
  const checks: PersistedState['checks'] = {}
  for (const key of Object.keys(state.checks)) {
    if (key.startsWith(`${today}:`)) checks[key] = true
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
    const parsed = PersistedState.safeParse(JSON.parse(raw))
    if (parsed.success) return pruneForToday(parsed.data)
    // Keep the anonymous id if we can, so server-side rows stay deletable.
    const maybeId = (JSON.parse(raw) as { userId?: unknown }).userId
    const idCheck = z.uuid().safeParse(maybeId)
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
