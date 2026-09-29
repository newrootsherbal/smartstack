/** Small request helpers shared by the account routes (JSON bodies, background work, SQL). */
import type { Context } from 'hono'
import type { z } from 'zod'
import type { Statement } from './logic'

export type BodyResult<T> = { ok: true; data: T } | { ok: false; response: Response }

/** Parses and validates a JSON body; 400 `invalid_json` / `invalid_body` otherwise. */
export async function parseJsonBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<BodyResult<z.infer<T>>> {
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

/** Runs work after the response (ctx.waitUntil); failures are logged, never thrown. */
export function defer(c: Context, work: Promise<unknown>): void {
  const guarded = work.catch((err: unknown) => {
    console.error('background task failed:', err instanceof Error ? err.message : String(err))
  })
  try {
    c.executionCtx.waitUntil(guarded)
  } catch {
    // No ExecutionContext (e.g. app.request in a test): the promise still runs.
  }
}

export function prepare(db: D1Database, s: Statement): D1PreparedStatement {
  return db.prepare(s.sql).bind(...s.params)
}

export function prepareAll(
  db: D1Database,
  statements: readonly Statement[],
): D1PreparedStatement[] {
  return statements.map((s) => prepare(db, s))
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message)
}
