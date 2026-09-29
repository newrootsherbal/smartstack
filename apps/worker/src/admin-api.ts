/**
 * /api/admin/… — staff admins compose and schedule news campaigns (§4.12, §7). Session bearer;
 * every route needs an account with role 'admin' and a verified email (403 `forbidden`), and
 * answers 404 while ACCOUNTS_MODE is "off" like the other account routes. Admins only ever see
 * counts, never who is in an audience. Logs: counts, codes and ids only.
 */
import {
  AudienceEstimateBody,
  CampaignInput,
  NEWS_MIN_SEGMENT_DEVICES,
  NEWS_NAME_MAX,
  ScheduleCampaignBody,
  type NewsAudience,
} from '@smartstack/shared'
import { Hono, type Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { accountsGate, requireSession, type AuthEnv } from './account-api'
import type { CampaignRow } from './env'
import { parseJsonBody, prepare, prepareAll } from './http'
import { parseBatchSize } from './logic'
import {
  activeCampaignsStatement,
  audienceEstimate,
  campaignByIdStatement,
  campaignLink,
  campaignViews,
  cancelCampaignStatement,
  contentFrom,
  duplicateCampaignRow,
  EDITABLE_STATUSES,
  insertCampaignStatement,
  isNewsAdmin,
  listCampaignsStatement,
  newCampaignRow,
  parseHostList,
  scheduleCampaignStatement,
  scheduleProblem,
  updateCampaignStatement,
  type CampaignContent,
} from './news/campaigns'
import { sendTestToOwnDevices } from './news/deliver'
import { audienceCountStatement, NEWS_PUSH_OPTIONS, parseStoredAudience } from './news/fanout'
import { isMissingHealthProfiles } from './news/segment'
import { sendPush, vapidConfig } from './push'

type Ctx = Context<AuthEnv>

export const adminApi = new Hono<AuthEnv>()

const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  if (!isNewsAdmin(c.get('auth').account)) return c.json({ error: 'forbidden' }, 403)
  await next()
})

// Mounted under /api; '/admin/*' also matches '/admin'.
adminApi.use('/admin/*', accountsGate, requireSession, requireAdmin)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Devices in the audience; null when segments can't be counted yet (migration 0004 missing). */
async function countAudience(c: Ctx, audience: NewsAudience, now: number): Promise<number | null> {
  try {
    const row = await prepare(c.env.DB, audienceCountStatement(audience, now)).first<{
      devices: number
    }>()
    return row?.devices ?? 0
  } catch (err) {
    if (isMissingHealthProfiles(err)) return null
    throw err
  }
}

/** Checks a segment reaches at least 10 devices; a response when it doesn't. */
async function segmentLargeEnough(
  c: Ctx,
  audience: NewsAudience,
  now: number,
): Promise<Response | null> {
  if (audience.type === 'all') return null
  const devices = await countAudience(c, audience, now)
  if (devices === null) return c.json({ error: 'segments_unavailable' }, 409)
  if (devices < NEWS_MIN_SEGMENT_DEVICES) return c.json({ error: 'audience_too_small' }, 409)
  return null
}

/** The validated body with its stored link, or the error response. */
async function readContent(c: Ctx): Promise<CampaignContent | Response> {
  const body = await parseJsonBody(c, CampaignInput)
  if (!body.ok) return body.response
  const hosts = parseHostList(c.env.NEWS_URL_HOSTS)
  if (hosts.length === 0) console.error('NEWS_URL_HOSTS is empty: no campaign link is allowed')
  const link = campaignLink(body.data.url, body.data.name, hosts)
  if (!link.ok) return c.json({ error: link.error }, 400)
  return contentFrom(body.data, link.url)
}

async function findCampaign(c: Ctx, id: string): Promise<CampaignRow | null> {
  return prepare(c.env.DB, campaignByIdStatement(id)).first<CampaignRow>()
}

/** `{ campaign }` with its 24 h warning computed against every scheduled/sending campaign. */
async function campaignResponse(c: Ctx, row: CampaignRow, status: 200 | 201 = 200) {
  const { results: active } = await prepare(c.env.DB, activeCampaignsStatement()).all<
    Pick<CampaignRow, 'id' | 'status' | 'send_at'>
  >()
  const [view] = campaignViews([row], active)
  return c.json({ campaign: view }, status)
}

/** After a conditional update changed nothing: 404 when the campaign is gone, else 409. */
async function statusRefusal(c: Ctx, id: string): Promise<Response> {
  const row = await findCampaign(c, id)
  return row
    ? c.json({ error: 'invalid_status', detail: row.status }, 409)
    : c.json({ error: 'not_found' }, 404)
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

adminApi.get('/admin/campaigns', async (c) => {
  const [list, active] = await c.env.DB.batch<CampaignRow>(
    prepareAll(c.env.DB, [listCampaignsStatement(), activeCampaignsStatement()]),
  )
  return c.json({ campaigns: campaignViews(list?.results ?? [], active?.results ?? []) })
})

adminApi.post('/admin/campaigns', async (c) => {
  const content = await readContent(c)
  if (content instanceof Response) return content
  const row = newCampaignRow(crypto.randomUUID(), content, c.get('auth').account.id, Date.now())
  await prepare(c.env.DB, insertCampaignStatement(row)).run()
  console.log(`news: campaign ${row.id} created`)
  return campaignResponse(c, row, 201)
})

adminApi.put('/admin/campaigns/:id', async (c) => {
  const id = c.req.param('id')
  const content = await readContent(c)
  if (content instanceof Response) return content
  const existing = await findCampaign(c, id)
  if (!existing) return c.json({ error: 'not_found' }, 404)
  if (!EDITABLE_STATUSES.includes(existing.status)) {
    return c.json({ error: 'invalid_status', detail: existing.status }, 409)
  }
  const now = Date.now()
  // A scheduled segment must still reach 10 devices after the edit.
  if (existing.status === 'scheduled') {
    const refusal = await segmentLargeEnough(c, content.audience, now)
    if (refusal) return refusal
  }
  const updated = await prepare(
    c.env.DB,
    updateCampaignStatement(id, content, now),
  ).first<CampaignRow>()
  if (!updated) return statusRefusal(c, id)
  return campaignResponse(c, updated)
})

adminApi.post('/admin/campaigns/:id/schedule', async (c) => {
  const id = c.req.param('id')
  const body = await parseJsonBody(c, ScheduleCampaignBody)
  if (!body.ok) return body.response
  const existing = await findCampaign(c, id)
  if (!existing) return c.json({ error: 'not_found' }, 404)
  if (!EDITABLE_STATUSES.includes(existing.status)) {
    return c.json({ error: 'invalid_status', detail: existing.status }, 409)
  }
  const now = Date.now()
  const problem = scheduleProblem(body.data.sendAt, now)
  if (problem) return c.json({ error: problem }, 400)
  const audience = parseStoredAudience(existing.audience)
  if (!audience) return c.json({ error: 'internal' }, 500)
  const refusal = await segmentLargeEnough(c, audience, now)
  if (refusal) return refusal
  const scheduled = await prepare(
    c.env.DB,
    scheduleCampaignStatement(id, body.data.sendAt, now),
  ).first<CampaignRow>()
  if (!scheduled) return statusRefusal(c, id)
  console.log(`news: campaign ${id} scheduled`)
  return campaignResponse(c, scheduled)
})

adminApi.post('/admin/campaigns/:id/cancel', async (c) => {
  const id = c.req.param('id')
  const cancelled = await prepare(
    c.env.DB,
    cancelCampaignStatement(id, Date.now()),
  ).first<CampaignRow>()
  if (!cancelled) return statusRefusal(c, id)
  console.log(`news: campaign ${id} cancelled`)
  return campaignResponse(c, cancelled)
})

adminApi.post('/admin/campaigns/:id/duplicate', async (c) => {
  const source = await findCampaign(c, c.req.param('id'))
  if (!source) return c.json({ error: 'not_found' }, 404)
  const row = duplicateCampaignRow(
    source,
    crypto.randomUUID(),
    c.get('auth').account.id,
    Date.now(),
    NEWS_NAME_MAX,
  )
  await prepare(c.env.DB, insertCampaignStatement(row)).run()
  console.log(`news: campaign ${row.id} duplicated from ${source.id}`)
  return campaignResponse(c, row, 201)
})

adminApi.post('/admin/campaigns/:id/test', async (c) => {
  const campaign = await findCampaign(c, c.req.param('id'))
  if (!campaign) return c.json({ error: 'not_found' }, 404)
  const vapid = vapidConfig(c.env)
  if (!vapid) {
    console.error('VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY missing: news cannot be sent')
    return c.json({ error: 'push_not_configured' }, 503)
  }
  const now = Date.now()
  const result = await sendTestToOwnDevices(
    c.env.DB,
    campaign,
    c.get('auth').account.id,
    (sub, payload, topic) => sendPush(sub, payload, topic, vapid, now, NEWS_PUSH_OPTIONS),
  )
  if (!result) return c.json({ error: 'no_devices' }, 409)
  console.log(`news: test of campaign ${campaign.id}: ${result.sent} sent, ${result.failed} failed`)
  return c.json(result)
})

adminApi.post('/admin/audience-estimate', async (c) => {
  const body = await parseJsonBody(c, AudienceEstimateBody)
  if (!body.ok) return body.response
  const devices = await countAudience(c, body.data.audience, Date.now())
  if (devices === null) return c.json({ error: 'segments_unavailable' }, 409)
  return c.json(
    audienceEstimate(devices, body.data.audience, parseBatchSize(c.env.MAX_PUSHES_PER_TICK)),
  )
})
