/**
 * Thin client for the Worker. `/api/me/…` takes the anonymous device id as its bearer;
 * `/api/auth/…` and `/api/account/…` take the session token (or nothing). Nothing here is
 * called until the person turns on reminders or chooses to create an account / log in.
 */
import type {
  PushSubscriptionBody,
  PutMeBody,
  PutScheduleBody,
  TestReminderBody,
} from '@smartstack/shared'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    /** Seconds from a 429's Retry-After, when the server sent one. */
    public readonly retryAfter: number | null = null,
    message?: string,
  ) {
    super(message ?? `${status} ${code}`)
    this.name = 'ApiError'
  }
}

export type Method = 'GET' | 'PUT' | 'POST' | 'DELETE'

/** One JSON request; `bearer` null sends no Authorization header. */
export async function request(
  bearer: string | null,
  method: Method,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders }
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? null : JSON.stringify(body),
    credentials: 'omit',
    cache: 'no-store',
  })
  if (res.status === 204) return null
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const code =
      json && typeof json === 'object' && 'error' in json
        ? String((json as { error: unknown }).error)
        : 'request_failed'
    const retry = Number.parseInt(res.headers.get('retry-after') ?? '', 10)
    throw new ApiError(res.status, code, Number.isFinite(retry) ? retry : null)
  }
  return json
}

export const BETA_HEADER = { 'X-Beta-Key': import.meta.env.VITE_BETA_KEY ?? '' }

export const api = {
  putMe: (userId: string, body: PutMeBody) => request(userId, 'PUT', '/api/me', body, BETA_HEADER),
  deleteMe: (userId: string) => request(userId, 'DELETE', '/api/me'),
  putPushSubscription: (userId: string, body: PushSubscriptionBody) =>
    request(userId, 'POST', '/api/me/push-subscription', body),
  deletePushSubscription: (userId: string, endpoint: string) =>
    request(userId, 'DELETE', '/api/me/push-subscription', { endpoint }),
  putSchedule: (userId: string, body: PutScheduleBody) =>
    request(userId, 'PUT', '/api/me/schedule', body),
  postTestReminder: (userId: string, body: TestReminderBody) =>
    request(userId, 'POST', '/api/me/test-reminder', body),
}
