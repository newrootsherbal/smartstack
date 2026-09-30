import { describe, expect, it } from 'vitest'
import type { CampaignRow } from '../env'
import {
  addAccount,
  addCampaign,
  addDevice,
  createTestDb,
  positional,
  runStatement,
  type TestDb,
} from '../test/sqlite-d1'
import {
  audienceEstimate,
  campaignLink,
  campaignView,
  cancelCampaignStatement,
  closeCampaignIds,
  duplicateCampaignRow,
  isNewsAdmin,
  newsOptInStatement,
  parseHostList,
  scheduleCampaignStatement,
  scheduleProblem,
  updateCampaignStatement,
  type CampaignContent,
} from './campaigns'

const NOW = Date.UTC(2026, 9, 1, 15, 0) // 11:00 in Toronto
const HOUR = 60 * 60 * 1000
const HOSTS = ['newrootsherbal.com', 'www.newrootsherbal.com']

function returning(db: TestDb, s: { sql: string; params: (string | number | null)[] }) {
  const { sql, args } = positional(s.sql, s.params)
  return db.sql.prepare(sql).get(...args) as CampaignRow | undefined
}

describe('isNewsAdmin', () => {
  it('needs the admin role and a verified email', () => {
    expect(isNewsAdmin({ role: 'admin', email_verified_at: 1 })).toBe(true)
    expect(isNewsAdmin({ role: 'admin', email_verified_at: null })).toBe(false)
    expect(isNewsAdmin({ role: 'user', email_verified_at: 1 })).toBe(false)
  })
})

describe('campaign links', () => {
  it('reads NEWS_URL_HOSTS', () => {
    expect(parseHostList(' NewRootsHerbal.com, www.newrootsherbal.com ,, ')).toEqual(HOSTS)
    expect(parseHostList(undefined)).toEqual([])
  })

  it('adds the UTM tags when absent, keeping the query and fragment', () => {
    expect(campaignLink('https://newrootsherbal.com/webinars', 'Vitamin D webinar', HOSTS)).toEqual(
      {
        ok: true,
        url: 'https://newrootsherbal.com/webinars?utm_source=smartstack&utm_medium=push&utm_campaign=vitamin-d-webinar',
      },
    )
    expect(
      campaignLink('https://www.newrootsherbal.com/p?id=12&q=a%20b#reviews', 'Été 2026', HOSTS),
    ).toEqual({
      ok: true,
      url: 'https://www.newrootsherbal.com/p?id=12&q=a%20b&utm_source=smartstack&utm_medium=push&utm_campaign=ete-2026#reviews',
    })
  })

  it('keeps UTM tags already there (an edit sends the stored link back)', () => {
    const stored = campaignLink('https://newrootsherbal.com/', 'First name', HOSTS)
    expect(stored.ok && campaignLink(stored.url, 'Renamed', HOSTS)).toEqual(stored)
    expect(
      campaignLink('https://newrootsherbal.com/?utm_campaign=fall', 'Anything', HOSTS),
    ).toEqual({
      ok: true,
      url: 'https://newrootsherbal.com/?utm_campaign=fall&utm_source=smartstack&utm_medium=push',
    })
  })

  it('refuses other hosts, ports, credentials and http', () => {
    const refused = { ok: false, error: 'url_host_not_allowed' }
    expect(campaignLink('https://evil.example/', 'x', HOSTS)).toEqual(refused)
    expect(campaignLink('https://shop.newrootsherbal.com/', 'x', HOSTS)).toEqual(refused)
    expect(campaignLink('https://newrootsherbal.com.evil.example/', 'x', HOSTS)).toEqual(refused)
    expect(campaignLink('https://newrootsherbal.com:8443/', 'x', HOSTS)).toEqual(refused)
    expect(campaignLink('https://user:pw@newrootsherbal.com/', 'x', HOSTS)).toEqual(refused)
    expect(campaignLink('http://newrootsherbal.com/', 'x', HOSTS)).toEqual(refused)
    expect(campaignLink('https://newrootsherbal.com/', 'x', [])).toEqual(refused)
    expect(campaignLink('https://NEWROOTSHERBAL.com/', 'x', HOSTS).ok).toBe(true)
  })
})

describe('schedule rules', () => {
  it('refuses the past (beyond a minute) and times outside 11:00–19:00 Toronto', () => {
    const noon = NOW + HOUR
    expect(scheduleProblem(noon, noon)).toBeNull()
    expect(scheduleProblem(noon - 30_000, noon)).toBeNull()
    expect(scheduleProblem(noon - 2 * 60_000, noon)).toBe('send_at_past')
    expect(scheduleProblem(NOW, NOW)).toBeNull() // 11:00
    expect(scheduleProblem(NOW - 60_000, NOW - 60_000)).toBe('outside_sending_window') // 10:59
    expect(scheduleProblem(NOW + 8 * HOUR, NOW)).toBeNull() // 19:00
    expect(scheduleProblem(NOW + 8 * HOUR + 60_000, NOW)).toBe('outside_sending_window')
    expect(scheduleProblem(NOW - HOUR + 24 * HOUR, NOW)).toBe('outside_sending_window') // 10:00
  })

  it('answers counts only, "fewer than 10" under 10, and blocks small segments only', () => {
    const segment = { type: 'segment' as const, goals: ['sleep' as const] }
    expect(audienceEstimate(1240, { type: 'all' }, 20)).toEqual({
      devices: 1240,
      tooSmall: false,
      canSchedule: true,
      etaMinutes: 62,
    })
    expect(audienceEstimate(9, segment, 20)).toEqual({
      devices: null,
      tooSmall: true,
      canSchedule: false,
      etaMinutes: 1,
    })
    expect(audienceEstimate(0, segment, 20).devices).toBeNull()
    expect(audienceEstimate(3, { type: 'all' }, 20)).toMatchObject({
      devices: null,
      canSchedule: true,
    })
    expect(audienceEstimate(10, segment, 20)).toMatchObject({ devices: 10, canSchedule: true })
  })
})

describe('closeCampaignIds', () => {
  it('flags scheduled or sending campaigns less than 24 h apart', () => {
    const rows = [
      { id: 'a', status: 'scheduled' as const, send_at: NOW },
      { id: 'b', status: 'scheduled' as const, send_at: NOW + 23 * HOUR },
      { id: 'c', status: 'scheduled' as const, send_at: NOW + 72 * HOUR },
      { id: 'd', status: 'sent' as const, send_at: NOW + 73 * HOUR },
      { id: 'e', status: 'draft' as const, send_at: null },
      { id: 'f', status: 'sending' as const, send_at: NOW + 95 * HOUR },
    ]
    expect([...closeCampaignIds(rows)].sort()).toEqual(['a', 'b', 'c', 'f'])
    expect(closeCampaignIds([rows[0]!, rows[2]!]).size).toBe(0)
  })
})

describe('campaign statements (SQLite)', () => {
  const CONTENT: CampaignContent = {
    name: 'Edited',
    titleEn: 'New Roots Herbal: Edited',
    titleFr: 'New Roots Herbal : Modifié',
    bodyEn: 'Body 2',
    bodyFr: 'Corps 2',
    url: 'https://newrootsherbal.com/?utm_source=smartstack',
    audience: { type: 'segment', genders: ['woman'] },
  }

  it('edits drafts and scheduled campaigns only', () => {
    const db = createTestDb()
    addCampaign(db, 'draft', { now: NOW, status: 'draft' })
    addCampaign(db, 'sent', { now: NOW, status: 'sent' })
    const edited = returning(db, updateCampaignStatement('draft', CONTENT, NOW + 1))
    expect(edited).toMatchObject({ name: 'Edited', status: 'draft', updated_at: NOW + 1 })
    expect(JSON.parse(edited!.audience)).toEqual(CONTENT.audience)
    expect(returning(db, updateCampaignStatement('sent', CONTENT, NOW + 1))).toBeUndefined()
  })

  it('schedules drafts, reschedules, and cancels scheduled or sending campaigns', () => {
    const db = createTestDb()
    addCampaign(db, 'c1', { now: NOW, status: 'draft' })
    expect(returning(db, scheduleCampaignStatement('c1', NOW + HOUR, NOW))).toMatchObject({
      status: 'scheduled',
      send_at: NOW + HOUR,
    })
    expect(returning(db, scheduleCampaignStatement('c1', NOW + 2 * HOUR, NOW))).toMatchObject({
      send_at: NOW + 2 * HOUR,
    })
    expect(returning(db, cancelCampaignStatement('c1', NOW))).toMatchObject({
      status: 'cancelled',
      finished_at: NOW,
    })
    expect(returning(db, cancelCampaignStatement('c1', NOW))).toBeUndefined()
    expect(returning(db, scheduleCampaignStatement('c1', NOW, NOW))).toBeUndefined()
    addCampaign(db, 'draft', { now: NOW, status: 'draft' })
    expect(returning(db, cancelCampaignStatement('draft', NOW))).toBeUndefined()
  })

  it('duplicates into a fresh draft', () => {
    const db = createTestDb()
    addAccount(db, 'admin', { role: 'admin' })
    addCampaign(db, 'c1', { now: NOW, status: 'sent' })
    const source = db.sql
      .prepare(`SELECT * FROM campaigns WHERE id = 'c1'`)
      .get() as unknown as CampaignRow
    const copy = duplicateCampaignRow(
      { ...source, cursor: 7, sent_count: 5 },
      'c2',
      'admin',
      NOW,
      80,
    )
    expect(copy).toMatchObject({
      id: 'c2',
      name: 'c1 (copy)',
      status: 'draft',
      send_at: null,
      cursor: 0,
      sent_count: 0,
      failed_count: 0,
      created_by: 'admin',
      finished_at: null,
      url: source.url,
      audience: source.audience,
    })
    expect(duplicateCampaignRow(source, 'c3', null, NOW, 5).name).toBe('c1 (c')
    expect(campaignView(copy, false)).toMatchObject({ id: 'c2', audience: { type: 'all' } })
  })

  it('records news opt-in and opt-out times, writing only on a change', () => {
    const db = createTestDb()
    addDevice(db, 'dev', { optIn: false })
    const state = () =>
      db.sql
        .prepare(`SELECT news_opt_in, news_opt_in_at, news_opt_out_at FROM users WHERE id = 'dev'`)
        .get()
    runStatement(db, newsOptInStatement('dev', true, 100))
    expect(state()).toEqual({ news_opt_in: 1, news_opt_in_at: 100, news_opt_out_at: null })
    runStatement(db, newsOptInStatement('dev', true, 200)) // no change: nothing written
    expect(state()).toEqual({ news_opt_in: 1, news_opt_in_at: 100, news_opt_out_at: null })
    runStatement(db, newsOptInStatement('dev', false, 300))
    expect(state()).toEqual({ news_opt_in: 0, news_opt_in_at: 100, news_opt_out_at: 300 })
    runStatement(db, newsOptInStatement('dev', true, 400))
    expect(state()).toEqual({ news_opt_in: 1, news_opt_in_at: 400, news_opt_out_at: 300 })
  })
})
