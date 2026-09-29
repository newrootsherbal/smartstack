import { NEWS_CAP_MS } from '@smartstack/shared'
import { describe, expect, it } from 'vitest'
import type { CampaignRow } from '../env'
import {
  audienceCountStatement,
  fanoutPlan,
  fanoutSelectStatement,
  newsBudget,
  newsPayload,
  parseStoredAudience,
  type FanoutRow,
} from './fanout'

const NOW = Date.UTC(2026, 9, 1, 15, 0) // 11:00 in Toronto

const CAMPAIGN: Pick<
  CampaignRow,
  'id' | 'cursor' | 'title_en' | 'title_fr' | 'body_en' | 'body_fr' | 'url'
> = {
  id: 'c1',
  cursor: 10,
  title_en: 'New Roots Herbal: Webinar',
  title_fr: 'New Roots Herbal : Webinaire',
  body_en: 'Thursday 7 PM',
  body_fr: 'Jeudi 19 h',
  url: 'https://newrootsherbal.com/?utm_source=smartstack',
}

function row(id: number, userId: string, locale = 'en'): FanoutRow {
  return {
    id,
    user_id: userId,
    endpoint: `https://push.invalid/${id}`,
    p256dh: 'k',
    auth: 'a',
    locale,
  }
}

describe('news budget', () => {
  it('gets what the reminders left of MAX_PUSHES_PER_TICK', () => {
    expect(newsBudget(20, 0)).toBe(20)
    expect(newsBudget(20, 7)).toBe(13)
    expect(newsBudget(20, 20)).toBe(0)
    expect(newsBudget(20, 26)).toBe(0) // several devices per reminder
  })
})

describe('newsPayload', () => {
  it("uses the device's language, English by default", () => {
    expect(newsPayload(CAMPAIGN, 'fr')).toEqual({
      title: 'New Roots Herbal : Webinaire',
      body: 'Jeudi 19 h',
      tag: 'news:c1',
      url: CAMPAIGN.url,
      kind: 'news',
      campaignId: 'c1',
      lang: 'fr',
    })
    expect(newsPayload(CAMPAIGN, 'en').title).toBe('New Roots Herbal: Webinar')
    expect(newsPayload(CAMPAIGN, 'de').lang).toBe('en')
    expect(newsPayload(CAMPAIGN, null).body).toBe('Thursday 7 PM')
  })
})

describe('fanoutSelectStatement', () => {
  it('starts after the cursor, skips devices capped in the last 24 h, limits to the budget', () => {
    const s = fanoutSelectStatement({ cursor: 42 }, { type: 'all' }, NOW, 13)
    expect(s.sql).toMatch(/ps\.id > \?/)
    expect(s.sql).toMatch(/u\.last_news_at IS NULL OR u\.last_news_at <= \?/)
    expect(s.sql).toMatch(/ORDER BY ps\.id\s+LIMIT \?/)
    expect(s.params).toEqual([42, NOW - NEWS_CAP_MS, 13])
  })

  it('adds the segment parameters between the cap and the limit', () => {
    const s = fanoutSelectStatement({ cursor: 0 }, { type: 'segment', goals: ['sleep'] }, NOW, 5)
    expect(s.params).toEqual([0, NOW - NEWS_CAP_MS, 'sleep', 5])
    expect(s.sql.match(/\?/g)).toHaveLength(4)
    expect(audienceCountStatement({ type: 'segment', ageMin: 30 }, NOW).params).toEqual([1996])
  })
})

describe('fanoutPlan', () => {
  it('moves the cursor, counts, and stamps the devices that got it', () => {
    const rows = [row(11, 'a'), row(12, 'a'), row(15, 'b'), row(20, 'c')]
    const plan = fanoutPlan(CAMPAIGN, rows, ['sent', 'sent', 'failed', 'sent'], 4, NOW)
    expect(plan).toMatchObject({ sent: 3, failed: 1, gone: 0, cursor: 20, done: false })
    const [progress, stamp, ...rest] = plan.statements
    expect(progress?.sql).toMatch(/cursor = MAX\(cursor, \?1\)/)
    expect(progress?.params).toEqual([20, 3, 1, 'c1'])
    expect(stamp?.sql).toMatch(/UPDATE users SET last_news_at = \?1 WHERE id IN \(\?2, \?3\)/)
    expect(stamp?.params).toEqual([NOW, 'a', 'c'])
    expect(rest).toEqual([])
  })

  it('deletes 404/410 subscriptions; every other failure counts, no retry', () => {
    const rows = [row(11, 'a'), row(12, 'b'), row(13, 'c'), row(14, 'd')]
    const plan = fanoutPlan(CAMPAIGN, rows, ['gone', 'retry', 'auth_error', 'failed'], 10, NOW)
    expect(plan).toMatchObject({ sent: 0, failed: 4, gone: 1, authErrors: 1, cursor: 14 })
    expect(plan.statements.map((s) => s.sql.split(/\s+/).slice(0, 2).join(' '))).toEqual([
      'UPDATE campaigns',
      'DELETE FROM',
      'UPDATE campaigns', // finished: fewer rows than the budget
    ])
    expect(plan.statements[1]?.params).toEqual([11])
  })

  it('finishes when fewer rows than the budget come back', () => {
    const empty = fanoutPlan(CAMPAIGN, [], [], 20, NOW)
    expect(empty).toMatchObject({ sent: 0, failed: 0, cursor: 10, done: true })
    expect(empty.statements).toHaveLength(1)
    expect(empty.statements[0]?.sql).toMatch(/status = 'sent', finished_at = \?1/)
    expect(empty.statements[0]?.sql).toMatch(/status = 'sending'/)
    expect(fanoutPlan(CAMPAIGN, [row(11, 'a')], ['sent'], 1, NOW).done).toBe(false)
  })

  it('chunks long id lists under the parameter limit', () => {
    const rows = Array.from({ length: 200 }, (_, i) => row(100 + i, `u${i}`))
    const plan = fanoutPlan(
      CAMPAIGN,
      rows,
      rows.map(() => 'sent' as const),
      200,
      NOW,
    )
    for (const s of plan.statements) expect(s.params.length).toBeLessThan(100)
    expect(plan.statements.filter((s) => s.sql.includes('last_news_at'))).toHaveLength(3)
  })
})

describe('parseStoredAudience', () => {
  it('reads what the API stored and refuses anything else', () => {
    expect(parseStoredAudience('{"type":"all"}')).toEqual({ type: 'all' })
    expect(parseStoredAudience('{"type":"segment","goals":["sleep"]}')).toEqual({
      type: 'segment',
      goals: ['sleep'],
    })
    expect(parseStoredAudience('{"type":"segment"}')).toBeNull()
    expect(parseStoredAudience('nope')).toBeNull()
  })
})
