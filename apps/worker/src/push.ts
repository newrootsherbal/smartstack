/**
 * One Web Push send. RFC 8291 encryption and the RFC 8292 VAPID header come
 * from @block65/webcrypto-web-push; the VAPID JWT is cached per push-service
 * origin for ~11 h (the library signs a 12 h token) so a tick costs one ES256
 * signature per origin, not per push.
 */
import { encryptNotification, vapidHeaders } from '@block65/webcrypto-web-push'
import type { PushSubscriptionRow } from './env'
import { classifyPushStatus, PUSH_TTL_SECONDS, type PushOutcome } from './logic'

export interface VapidConfig {
  subject: string
  publicKey: string
  privateKey: string
}

export interface PushPayload {
  title: string
  body: string
  tag: string
  url: string
}

const VAPID_CACHE_MS = 11 * 60 * 60 * 1000
const vapidCache = new Map<string, { authorization: string; expiresAt: number }>()

async function authorizationFor(endpoint: string, vapid: VapidConfig, now: number) {
  const origin = new URL(endpoint).origin
  const cached = vapidCache.get(origin)
  if (cached && cached.expiresAt > now + 60_000) return cached.authorization
  const { headers } = await vapidHeaders(
    { endpoint, expirationTime: null, keys: { auth: '', p256dh: '' } },
    vapid,
  )
  vapidCache.set(origin, { authorization: headers.authorization, expiresAt: now + VAPID_CACHE_MS })
  return headers.authorization
}

/** For tests. */
export function clearVapidCache(): void {
  vapidCache.clear()
}

export interface SendResult {
  outcome: PushOutcome
  status: number | null
}

export async function sendPush(
  sub: Pick<PushSubscriptionRow, 'endpoint' | 'p256dh' | 'auth'>,
  payload: PushPayload,
  topic: string,
  vapid: VapidConfig,
  now: number,
): Promise<SendResult> {
  try {
    const authorization = await authorizationFor(sub.endpoint, vapid, now)
    const body = await encryptNotification(
      {
        endpoint: sub.endpoint,
        expirationTime: null,
        keys: { auth: sub.auth, p256dh: sub.p256dh },
      },
      new TextEncoder().encode(JSON.stringify(payload)),
    )
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization,
        ttl: String(PUSH_TTL_SECONDS),
        urgency: 'high',
        topic,
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        'content-length': String(body.byteLength),
      },
      body,
    })
    // Drain so the connection can be reused.
    await res.body?.cancel()
    return { outcome: classifyPushStatus(res.status), status: res.status }
  } catch {
    // Network / DNS / TLS failure: try again next tick.
    return { outcome: 'retry', status: null }
  }
}

/** Run tasks with at most `limit` in flight (free plan: 6 concurrent connections). */
export async function withConcurrency<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array<T>(tasks.length)
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]!()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}
