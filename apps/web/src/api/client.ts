/**
 * Thin client for /api/me/… . The anonymous id is the only credential.
 * Nothing here is called until the user taps "Turn on reminders."
 */
import type { PushSubscriptionBody, PutMeBody, PutScheduleBody } from '@smartstack/shared'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? `${status} ${code}`)
    this.name = 'ApiError'
  }
}

async function request(
  userId: string,
  method: 'PUT' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${userId}`,
    Accept: 'application/json',
    ...extraHeaders,
  }
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
    throw new ApiError(res.status, code)
  }
  return json
}

export const api = {
  putMe: (userId: string, body: PutMeBody) =>
    request(userId, 'PUT', '/api/me', body, { 'X-Beta-Key': import.meta.env.VITE_BETA_KEY ?? '' }),
  deleteMe: (userId: string) => request(userId, 'DELETE', '/api/me'),
  putPushSubscription: (userId: string, body: PushSubscriptionBody) =>
    request(userId, 'POST', '/api/me/push-subscription', body),
  deletePushSubscription: (userId: string, endpoint: string) =>
    request(userId, 'DELETE', '/api/me/push-subscription', { endpoint }),
  putSchedule: (userId: string, body: PutScheduleBody) =>
    request(userId, 'PUT', '/api/me/schedule', body),
  postTestReminder: (userId: string) => request(userId, 'POST', '/api/me/test-reminder'),
}
