/**
 * POST /api/sync (docs/smartstack-phase2-prompt.md §8): session + consent. The statements are
 * built by the pure functions in sync.ts; this file only reads the request and runs them.
 * Logs: counts, codes and ids only.
 */
import { SYNC_MAX_BYTES, SYNC_MAX_ROWS, SyncRequest } from '@smartstack/shared'
import { Hono } from 'hono'
import { accountsGate, requireSession, type AuthEnv } from './account-api'
import { consentNeeded } from './auth/account'
import { consentVersion } from './config'
import { prepareAll } from './http'
import {
  declaredTooLarge,
  describeIssues,
  limitReadStatement,
  limitViolations,
  rawRowCount,
  syncParams,
  syncPlan,
  syncResponse,
  tablesToCheck,
  hasChanges,
  type LimitedTable,
  type LimitRow,
  type SyncReadRows,
} from './sync'

export const syncApi = new Hono<AuthEnv>()

syncApi.use('/sync', accountsGate, requireSession)

syncApi.post('/sync', async (c) => {
  const { account } = c.get('auth')
  // Law 25 (§5.8): nothing syncs until the account consented to the current texts.
  if (consentNeeded(account, consentVersion(c.env))) {
    return c.json({ error: 'consent_required', detail: ['account'] }, 403)
  }

  if (declaredTooLarge(c.req.header('content-length'), SYNC_MAX_BYTES)) {
    return c.json({ error: 'payload_too_large', detail: [`at most ${SYNC_MAX_BYTES} bytes`] }, 413)
  }
  const buffer = await c.req.arrayBuffer()
  if (buffer.byteLength > SYNC_MAX_BYTES) {
    return c.json({ error: 'payload_too_large', detail: [`at most ${SYNC_MAX_BYTES} bytes`] }, 413)
  }
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(buffer))
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  if (rawRowCount(json) > SYNC_MAX_ROWS) {
    return c.json({ error: 'too_many_rows', detail: [`at most ${SYNC_MAX_ROWS} rows`] }, 413)
  }
  const parsed = SyncRequest.safeParse(json)
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', detail: describeIssues(parsed.error.issues) }, 400)
  }
  const { since, changes } = parsed.data
  const checks = tablesToCheck(changes)
  if (checks.length > 0) {
    const results = await c.env.DB.batch<LimitRow>(
      prepareAll(
        c.env.DB,
        checks.map((t) => limitReadStatement(t, account.id)),
      ),
    )
    const serverRows = new Map<LimitedTable['entity'], LimitRow[]>(
      checks.map((t, i) => [t.entity, results[i]?.results ?? []]),
    )
    const violations = limitViolations(changes, serverRows)
    if (violations.length > 0) return c.json({ error: 'limit_reached', detail: violations }, 409)
  }

  const params = syncParams(changes)
  const plan = syncPlan(account.id, since, params)
  const results = await c.env.DB.batch(prepareAll(c.env.DB, plan.statements))
  const rev = (results[0]?.results[0] as { rev?: number } | undefined)?.rev
  if (rev === undefined) return c.json({ error: 'unauthorized' }, 401) // account just deleted
  const read = (i: number) => results[plan.firstRead + i]?.results ?? []
  const rows = {
    settings: read(0),
    health: read(1),
    products: read(2),
    stack: read(3),
    shopping: read(4),
    checks: read(5),
  } as SyncReadRows
  const response = syncResponse(rev, rows)
  if (hasChanges(params)) {
    const pushed =
      (params.settings ? 1 : 0) +
      (params.health ? 1 : 0) +
      params.user_products.length +
      params.stack_items.length +
      params.shopping_items.length +
      params.dose_checks.length
    console.log(JSON.stringify({ sync: account.id, pushed, rev }))
  }
  return c.json(response)
})
