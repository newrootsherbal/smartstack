/**
 * /api/me/… — the anonymous UUID in `Authorization: Bearer` is the only
 * credential. Unknown ids get 401, except PUT /api/me which creates the user
 * (behind X-Beta-Key). Bodies are validated with the shared zod schemas.
 */
import {
  MAX_SUBSCRIPTIONS_PER_USER,
  PushSubscriptionBody,
  PutMeBody,
  PutScheduleBody,
  TestReminderBody,
} from '@smartstack/shared'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { Env, PushSubscriptionRow, UserRow } from './env'
import { scheduleStatements, TEST_LEAD_MS, testReminderAllowed } from './logic'

type Variables = { userId: string }
type AppEnv = { Bindings: Env; Variables: Variables }

const BEARER = /^Bearer\s+(.+)$/i
const Uuid = z.uuid()

function bearerUserId(c: Context<AppEnv>): string | null {
  const header = c.req.header('authorization') ?? ''
  const match = BEARER.exec(header)
  if (!match) return null
  const parsed = Uuid.safeParse(match[1]?.trim())
  return parsed.success ? parsed.data : null
}

async function parseBody<T extends z.ZodType>(
  c: Context<AppEnv>,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let json: unknown
  try {
    json = await c.req.json()
  } catch {
    return { ok: false, response: c.json({ error: 'invalid_json' }, 400) }
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    return {
      ok: false,
      response: c.json(
        {
          error: 'invalid_body',
          detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        },
        400,
      ),
    }
  }
  return { ok: true, data: parsed.data }
}

export const api = new Hono<AppEnv>().basePath('/api')

api.get('/health', (c) => c.json({ ok: true }))

// Every /api/me route needs a well-formed bearer UUID (hono: '/me/*' also matches '/me').
api.use('/me/*', async (c, next) => {
  const userId = bearerUserId(c)
  if (!userId) return c.json({ error: 'unauthorized' }, 401)
  c.set('userId', userId)
  await next()
})

// Everything except PUT /api/me requires an existing user.
api.use('/me/*', async (c, next) => {
  if (c.req.method === 'PUT' && c.req.path === '/api/me') return next()
  const user = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?1')
    .bind(c.get('userId'))
    .first<Pick<UserRow, 'id'>>()
  if (!user) return c.json({ error: 'unknown_user' }, 401)
  await next()
})

/** Create or update the anonymous user. */
api.put('/me', async (c) => {
  if (!c.env.BETA_KEY || c.req.header('x-beta-key') !== c.env.BETA_KEY) {
    return c.json({ error: 'beta_key_required' }, 403)
  }
  const body = await parseBody(c, PutMeBody)
  if (!body.ok) return body.response
  const now = Date.now()
  await c.env.DB.prepare(
    `INSERT INTO users (id, tz, platform, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(id) DO UPDATE SET tz = excluded.tz, platform = excluded.platform, last_seen_at = excluded.last_seen_at`,
  )
    .bind(c.get('userId'), body.data.tz, body.data.platform, now)
    .run()
  return c.json({ ok: true })
})

/** Delete the user and everything attached (explicit, even with ON DELETE CASCADE). */
api.delete('/me', async (c) => {
  const userId = c.get('userId')
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM reminders WHERE user_id = ?1').bind(userId),
    c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?1').bind(userId),
    c.env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(userId),
  ])
  return c.body(null, 204)
})

api.post('/me/push-subscription', async (c) => {
  const body = await parseBody(c, PushSubscriptionBody)
  if (!body.ok) return body.response
  const userId = c.get('userId')
  const now = Date.now()
  const existing = await c.env.DB.prepare(
    'SELECT id, user_id FROM push_subscriptions WHERE endpoint = ?1',
  )
    .bind(body.data.endpoint)
    .first<Pick<PushSubscriptionRow, 'id' | 'user_id'>>()
  if (!existing) {
    const count = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?1',
    )
      .bind(userId)
      .first<{ n: number }>()
    if ((count?.n ?? 0) >= MAX_SUBSCRIPTIONS_PER_USER) {
      return c.json({ error: 'too_many_subscriptions' }, 409)
    }
  }
  // Same endpoint re-registered (possibly by a reinstalled app): keys and owner refresh.
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at, failures)
     VALUES (?1, ?2, ?3, ?4, ?5, 0)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
       auth = excluded.auth, failures = 0`,
  )
    .bind(userId, body.data.endpoint, body.data.keys.p256dh, body.data.keys.auth, now)
    .run()
  return c.json({ ok: true })
})

api.delete('/me/push-subscription', async (c) => {
  const body = await parseBody(c, z.object({ endpoint: z.url() }))
  if (!body.ok) return body.response
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?1 AND endpoint = ?2')
    .bind(c.get('userId'), body.data.endpoint)
    .run()
  return c.body(null, 204)
})

/** Replace the rolling 7-day window (pending future schedule rows only). */
api.put('/me/schedule', async (c) => {
  const body = await parseBody(c, PutScheduleBody)
  if (!body.ok) return body.response
  const now = Date.now()
  const statements = scheduleStatements(c.get('userId'), body.data.reminders, now, () =>
    crypto.randomUUID(),
  )
  await c.env.DB.batch(statements.map((s) => c.env.DB.prepare(s.sql).bind(...s.params)))
  return c.json({ ok: true, count: body.data.reminders.length })
})

/** One test reminder 2 minutes out, at most once per 2 minutes. */
api.post('/me/test-reminder', async (c) => {
  const userId = c.get('userId')
  const raw = c.req.header('content-length') === '0' || !c.req.header('content-type') ? {} : null
  const body = raw ? { ok: true as const, data: {} } : await parseBody(c, TestReminderBody)
  if (!body.ok) return body.response
  const now = Date.now()
  const last = await c.env.DB.prepare(
    `SELECT scheduled_at FROM reminders WHERE user_id = ?1 AND kind = 'test'
     ORDER BY scheduled_at DESC LIMIT 1`,
  )
    .bind(userId)
    .first<{ scheduled_at: number }>()
  if (!testReminderAllowed(last?.scheduled_at ?? null, now)) {
    return c.json({ error: 'rate_limited' }, 429)
  }
  const scheduledAt = now + TEST_LEAD_MS
  await c.env.DB.prepare(
    `INSERT INTO reminders (id, user_id, kind, scheduled_at, slot_key, product_ids, title, body, status)
     VALUES (?1, ?2, 'test', ?3, ?4, '[]', ?5, ?6, 'pending')`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      scheduledAt,
      `test:${scheduledAt}`,
      body.data.title ?? 'SmartStack test reminder',
      body.data.body ?? 'Reminders are working on this device.',
    )
    .run()
  return c.json({ ok: true, scheduledAt })
})

api.notFound((c) => c.json({ error: 'not_found' }, 404))
api.onError((err, c) => {
  console.error('api error', err instanceof Error ? err.message : String(err))
  return c.json({ error: 'internal' }, 500)
})
