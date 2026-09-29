/**
 * News campaigns for the admin API (§4.12, §7), the pure parts: who may administer, link
 * checks and UTM tags, the schedule rules, the audience estimate, row ↔ view, statements.
 */
import {
  campaignSlug,
  inNewsWindow,
  NEWS_CAP_MS,
  NEWS_MIN_SEGMENT_DEVICES,
  NEWS_UTM_MEDIUM,
  NEWS_UTM_SOURCE,
  type AudienceEstimate,
  type CampaignFields,
  type CampaignView,
  type NewsAudience,
} from '@smartstack/shared'
import type { AccountRow, CampaignRow, CampaignStatus } from '../env'
import type { Statement } from '../logic'
import { parseStoredAudience } from './fanout'

// ---------------------------------------------------------------------------
// Who may administer
// ---------------------------------------------------------------------------

/** Admins are accounts with role 'admin' (granted by SQL) and a verified email. */
export function isNewsAdmin(account: Pick<AccountRow, 'role' | 'email_verified_at'>): boolean {
  return account.role === 'admin' && account.email_verified_at !== null
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** NEWS_URL_HOSTS ("newrootsherbal.com, www.newrootsherbal.com") → lowercase host names. */
export function parseHostList(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}

export type LinkResult = { ok: true; url: string } | { ok: false; error: 'url_host_not_allowed' }

/**
 * The link as stored: https, a host from NEWS_URL_HOSTS (exactly; no port, no credentials), and
 * utm_source=smartstack, utm_medium=push, utm_campaign=<slug of the name> added when absent.
 * Existing query parameters and the fragment are kept as they were.
 */
export function campaignLink(raw: string, name: string, hosts: readonly string[]): LinkResult {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: 'url_host_not_allowed' }
  }
  if (
    url.protocol !== 'https:' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    !hosts.includes(url.hostname.toLowerCase())
  ) {
    return { ok: false, error: 'url_host_not_allowed' }
  }
  const present = new URLSearchParams(url.search)
  const extra = (
    [
      ['utm_source', NEWS_UTM_SOURCE],
      ['utm_medium', NEWS_UTM_MEDIUM],
      ['utm_campaign', campaignSlug(name)],
    ] as const
  )
    .filter(([key]) => !present.has(key))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
  if (extra.length) {
    const current = url.search.replace(/^\?/, '')
    url.search = current ? `${current}&${extra.join('&')}` : extra.join('&')
  }
  return { ok: true, url: url.toString() }
}

// ---------------------------------------------------------------------------
// Scheduling rules
// ---------------------------------------------------------------------------

/** A send time more than this far in the past is refused (the picker rounds to the minute). */
export const SEND_AT_GRACE_MS = 60 * 1000

export type ScheduleProblem = 'send_at_past' | 'outside_sending_window'

export function scheduleProblem(sendAt: number, now: number): ScheduleProblem | null {
  if (sendAt < now - SEND_AT_GRACE_MS) return 'send_at_past'
  if (!inNewsWindow(sendAt)) return 'outside_sending_window'
  return null
}

export const EDITABLE_STATUSES: readonly CampaignStatus[] = ['draft', 'scheduled']

/**
 * Admins only ever see counts, and under 10 only "fewer than 10". A segment under 10 can't be
 * scheduled; "everyone who opted in" always can. The ETA assumes the whole per-tick budget.
 */
export function audienceEstimate(
  devices: number,
  audience: NewsAudience,
  pushesPerTick: number,
): AudienceEstimate {
  const tooSmall = devices < NEWS_MIN_SEGMENT_DEVICES
  return {
    devices: tooSmall ? null : devices,
    tooSmall,
    canSchedule: audience.type === 'all' || !tooSmall,
    etaMinutes: tooSmall ? 1 : Math.ceil(devices / Math.max(1, pushesPerTick)),
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Scheduled or sending campaigns less than 24 h from another one (the list's warning). */
export function closeCampaignIds(
  rows: readonly Pick<CampaignRow, 'id' | 'status' | 'send_at'>[],
): Set<string> {
  const active = rows
    .filter((r) => (r.status === 'scheduled' || r.status === 'sending') && r.send_at !== null)
    .sort((a, b) => (a.send_at ?? 0) - (b.send_at ?? 0))
  const close = new Set<string>()
  for (let i = 1; i < active.length; i++) {
    const prev = active[i - 1]!
    const cur = active[i]!
    if ((cur.send_at ?? 0) - (prev.send_at ?? 0) < NEWS_CAP_MS) {
      close.add(prev.id)
      close.add(cur.id)
    }
  }
  return close
}

export function campaignView(row: CampaignRow, closeToAnother: boolean): CampaignView {
  const audience = parseStoredAudience(row.audience)
  if (!audience) console.error(`news: campaign ${row.id} has an unreadable audience`)
  return {
    id: row.id,
    name: row.name,
    titleEn: row.title_en,
    titleFr: row.title_fr,
    bodyEn: row.body_en,
    bodyFr: row.body_fr,
    url: row.url,
    audience: audience ?? { type: 'all' },
    sendAt: row.send_at,
    status: row.status,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    closeToAnother,
  }
}

/** Views for `rows`, the closeness computed against `active` (every scheduled/sending one). */
export function campaignViews(
  rows: readonly CampaignRow[],
  active: readonly Pick<CampaignRow, 'id' | 'status' | 'send_at'>[] = rows,
): CampaignView[] {
  const close = closeCampaignIds(active)
  return rows.map((row) => campaignView(row, close.has(row.id)))
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export const LIST_LIMIT = 200

export function listCampaignsStatement(): Statement {
  return {
    sql: `SELECT * FROM campaigns ORDER BY created_at DESC LIMIT ?1`,
    params: [LIST_LIMIT],
  }
}

export function campaignByIdStatement(id: string): Statement {
  return { sql: `SELECT * FROM campaigns WHERE id = ?1`, params: [id] }
}

/** Every scheduled or sending campaign (for the 24 h warning). */
export function activeCampaignsStatement(): Statement {
  return {
    sql: `SELECT id, status, send_at FROM campaigns WHERE status IN ('scheduled', 'sending')`,
    params: [],
  }
}

/** The validated input with its stored link, ready for a statement. */
export interface CampaignContent {
  name: string
  titleEn: string
  titleFr: string
  bodyEn: string
  bodyFr: string
  url: string
  audience: NewsAudience
}

export function contentFrom(fields: CampaignFields, url: string): CampaignContent {
  return { ...fields, url }
}

export function newCampaignRow(
  id: string,
  content: CampaignContent,
  createdBy: string | null,
  now: number,
): CampaignRow {
  return {
    id,
    name: content.name,
    title_en: content.titleEn,
    title_fr: content.titleFr,
    body_en: content.bodyEn,
    body_fr: content.bodyFr,
    url: content.url,
    audience: JSON.stringify(content.audience),
    send_at: null,
    status: 'draft',
    cursor: 0,
    sent_count: 0,
    failed_count: 0,
    created_by: createdBy,
    created_at: now,
    updated_at: now,
    finished_at: null,
  }
}

export function insertCampaignStatement(row: CampaignRow): Statement {
  return {
    sql: `INSERT INTO campaigns (id, name, title_en, title_fr, body_en, body_fr, url, audience,
            send_at, status, cursor, sent_count, failed_count, created_by, created_at, updated_at,
            finished_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`,
    params: [
      row.id,
      row.name,
      row.title_en,
      row.title_fr,
      row.body_en,
      row.body_fr,
      row.url,
      row.audience,
      row.send_at,
      row.status,
      row.cursor,
      row.sent_count,
      row.failed_count,
      row.created_by,
      row.created_at,
      row.updated_at,
      row.finished_at,
    ],
  }
}

/** A draft copy: same texts, link and audience; no time, no counts. */
export function duplicateCampaignRow(
  source: CampaignRow,
  id: string,
  createdBy: string | null,
  now: number,
  nameMax: number,
): CampaignRow {
  const name = `${source.name} (copy)`.slice(0, nameMax)
  return {
    ...source,
    id,
    name,
    send_at: null,
    status: 'draft',
    cursor: 0,
    sent_count: 0,
    failed_count: 0,
    created_by: createdBy,
    created_at: now,
    updated_at: now,
    finished_at: null,
  }
}

/** Full replacement of the content of a draft or scheduled campaign (time and status stay). */
export function updateCampaignStatement(
  id: string,
  content: CampaignContent,
  now: number,
): Statement {
  return {
    sql: `UPDATE campaigns SET name = ?2, title_en = ?3, title_fr = ?4, body_en = ?5, body_fr = ?6,
            url = ?7, audience = ?8, updated_at = ?9
          WHERE id = ?1 AND status IN ('draft', 'scheduled')
          RETURNING *`,
    params: [
      id,
      content.name,
      content.titleEn,
      content.titleFr,
      content.bodyEn,
      content.bodyFr,
      content.url,
      JSON.stringify(content.audience),
      now,
    ],
  }
}

export function scheduleCampaignStatement(id: string, sendAt: number, now: number): Statement {
  return {
    sql: `UPDATE campaigns SET status = 'scheduled', send_at = ?2, updated_at = ?3
          WHERE id = ?1 AND status IN ('draft', 'scheduled')
          RETURNING *`,
    params: [id, sendAt, now],
  }
}

export function cancelCampaignStatement(id: string, now: number): Statement {
  return {
    sql: `UPDATE campaigns SET status = 'cancelled', finished_at = ?2, updated_at = ?2
          WHERE id = ?1 AND status IN ('scheduled', 'sending')
          RETURNING *`,
    params: [id, now],
  }
}

// ---------------------------------------------------------------------------
// Device opt-in (PUT /api/me/news)
// ---------------------------------------------------------------------------

/**
 * Turning news on stamps news_opt_in_at, turning it off stamps news_opt_out_at (proof of
 * consent). Only a change writes: repeating the same answer costs no row write.
 */
export function newsOptInStatement(userId: string, optIn: boolean, now: number): Statement {
  return optIn
    ? {
        sql: `UPDATE users SET news_opt_in = 1, news_opt_in_at = ?2 WHERE id = ?1 AND news_opt_in = 0`,
        params: [userId, now],
      }
    : {
        sql: `UPDATE users SET news_opt_in = 0, news_opt_out_at = ?2 WHERE id = ?1 AND news_opt_in = 1`,
        params: [userId, now],
      }
}
