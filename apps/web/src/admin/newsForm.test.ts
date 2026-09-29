import type { CampaignView } from '@smartstack/shared'
import { describe, expect, it } from 'vitest'
import {
  audienceFromDraft,
  draftFromCampaign,
  draftProblems,
  emptyDraft,
  etaParts,
  inputFromDraft,
  linkWithTags,
  sendAtFromDraft,
  titleLength,
  torontoInputs,
  withoutOurTags,
  type CampaignDraft,
} from './newsForm'

// 2026-09-29 12:00 Toronto (EDT, UTC−4).
const NOON = Date.UTC(2026, 8, 29, 16, 0)

function valid(over: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    ...emptyDraft(NOON),
    name: 'Vitamin D webinar',
    titleEn: 'Free vitamin D webinar',
    titleFr: 'Webinaire gratuit sur la vitamine D',
    bodyEn: 'Join us Thursday at noon.',
    bodyFr: 'Joignez-vous à nous jeudi midi.',
    url: 'https://newrootsherbal.com/webinars',
    ...over,
  }
}

const view: CampaignView = {
  id: 'c1',
  name: 'Vitamin D webinar',
  titleEn: 'New Roots Herbal: Free webinar',
  titleFr: 'New Roots Herbal : Webinaire gratuit',
  bodyEn: 'Thursday at noon.',
  bodyFr: 'Jeudi midi.',
  url: 'https://newrootsherbal.com/w?utm_source=smartstack&utm_medium=push&utm_campaign=vitamin-d-webinar',
  audience: { type: 'segment', goals: ['sleep'], ageMin: 30 },
  sendAt: Date.UTC(2026, 9, 1, 15, 30),
  status: 'scheduled',
  sentCount: 0,
  failedCount: 0,
  createdAt: NOON,
  updatedAt: NOON,
  finishedAt: null,
  closeToAnother: false,
}

describe('news composer form', () => {
  it('starts with everyone, tomorrow at 11:00 Toronto time', () => {
    const d = emptyDraft(NOON)
    expect(d.audienceType).toBe('all')
    expect(d.sendDate).toBe('2026-09-30')
    expect(d.sendTime).toBe('11:00')
  })

  it('reads Toronto wall-clock time', () => {
    expect(torontoInputs(NOON)).toEqual({ date: '2026-09-29', time: '12:00' })
  })

  it('opens a saved campaign without prefixes or our tracking tags', () => {
    const d = draftFromCampaign(view, NOON)
    expect(d.titleEn).toBe('Free webinar')
    expect(d.titleFr).toBe('Webinaire gratuit')
    expect(d.url).toBe('https://newrootsherbal.com/w')
    expect(d.audienceType).toBe('segment')
    expect(d.goals).toEqual(['sleep'])
    expect(d.ageMin).toBe('30')
    expect(d.ageMax).toBe('')
    expect(d.sendDate).toBe('2026-10-01')
    expect(d.sendTime).toBe('11:30')
  })

  it("keeps someone else's tracking tags", () => {
    const url = 'https://newrootsherbal.com/?utm_source=newsletter&utm_campaign=x'
    expect(withoutOurTags(url)).toBe(url)
  })

  it('shows the link with the tags the Worker adds', () => {
    expect(linkWithTags('https://newrootsherbal.com/w', 'Vitamin D webinar')).toBe(
      'https://newrootsherbal.com/w?utm_source=smartstack&utm_medium=push&utm_campaign=vitamin-d-webinar',
    )
    expect(linkWithTags('http://newrootsherbal.com/', 'x')).toBeNull()
    expect(linkWithTags('not a link', 'x')).toBeNull()
  })

  it('builds the audience from the ticked parts only', () => {
    expect(audienceFromDraft(valid())).toEqual({ type: 'all' })
    expect(
      audienceFromDraft(valid({ audienceType: 'segment', goals: ['sleep'], ageMax: '40' })),
    ).toEqual({ type: 'segment', goals: ['sleep'], ageMax: 40 })
  })

  it('accepts a complete draft', () => {
    expect(draftProblems(valid()).size).toBe(0)
    expect(inputFromDraft(valid()).titleEn).toBe('Free vitamin D webinar')
  })

  it('flags what the Worker would refuse', () => {
    const problems = draftProblems(
      valid({ name: ' ', titleFr: 'x'.repeat(50), bodyEn: '', url: 'http://example.com' }),
    )
    expect([...problems].sort()).toEqual(['bodyEn', 'name', 'titleFr', 'url'])
  })

  it('needs at least one part in a segment, and a sensible age range', () => {
    expect(draftProblems(valid({ audienceType: 'segment' })).has('audience')).toBe(true)
    const ages = draftProblems(valid({ audienceType: 'segment', ageMin: '50', ageMax: '30' }))
    expect(ages.has('ageMax')).toBe(true)
  })

  it('counts the title with its prefix', () => {
    expect(titleLength('en', 'Hello')).toBe('New Roots Herbal: Hello'.length)
    expect(titleLength('fr', 'Bonjour')).toBe('New Roots Herbal : Bonjour'.length)
  })

  it('schedules only in the future, between 11:00 and 19:00 Toronto time', () => {
    expect(sendAtFromDraft(valid({ sendDate: '2026-09-30', sendTime: '11:00' }), NOON)).toEqual({
      ok: true,
      sendAt: Date.UTC(2026, 8, 30, 15, 0),
    })
    expect(sendAtFromDraft(valid({ sendDate: '2026-09-29', sendTime: '11:30' }), NOON)).toEqual({
      ok: false,
      problem: 'past',
    })
    expect(sendAtFromDraft(valid({ sendTime: '19:30' }), NOON)).toEqual({
      ok: false,
      problem: 'window',
    })
    expect(sendAtFromDraft(valid({ sendDate: '' }), NOON)).toEqual({
      ok: false,
      problem: 'invalid',
    })
  })

  it('rounds the delivery estimate', () => {
    expect(etaParts(0.4)).toEqual({ value: 1, unit: 'minute' })
    expect(etaParts(45)).toEqual({ value: 45, unit: 'minute' })
    expect(etaParts(125)).toEqual({ value: 2.1, unit: 'hour' })
  })
})
