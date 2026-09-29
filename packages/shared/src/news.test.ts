import { describe, expect, it } from 'vitest'
import {
  AudienceEstimateBody,
  CampaignInput,
  campaignSlug,
  inNewsWindow,
  NEWS_TITLE_PREFIX,
  NewsAudience,
  NewsPushPayload,
  newsTextLength,
  newsTitleRoom,
  PutMeBody,
  PutNewsBody,
  ScheduleCampaignBody,
  stripNewsPrefix,
  torontoYear,
  withNewsPrefix,
  zonedParts,
  zonedTimeToEpoch,
} from './index'

const VALID = {
  name: 'Vitamin D webinar',
  titleEn: 'Free webinar on vitamin D',
  titleFr: 'Webinaire gratuit sur la vitamine D',
  bodyEn: 'Join our naturopath Thursday at 7 PM.',
  bodyFr: 'Joignez-vous à notre naturopathe jeudi à 19 h.',
  url: 'https://newrootsherbal.com/webinars',
  audience: { type: 'all' },
}

describe('news title prefix (N10)', () => {
  it('adds the prefix, or normalizes one typed by hand', () => {
    expect(withNewsPrefix('en', 'New products')).toBe('New Roots Herbal: New products')
    expect(withNewsPrefix('en', 'new roots herbal :New products ')).toBe(
      'New Roots Herbal: New products',
    )
    expect(withNewsPrefix('fr', 'Nouveautés')).toBe('New Roots Herbal : Nouveautés')
    expect(withNewsPrefix('fr', 'New Roots Herbal: Nouveautés')).toBe(
      'New Roots Herbal : Nouveautés',
    )
    expect(stripNewsPrefix('New Roots Herbal : Nouveautés')).toBe('Nouveautés')
  })

  it('leaves 42 characters in English and 41 in French', () => {
    expect(newsTitleRoom('en')).toBe(42)
    expect(newsTitleRoom('fr')).toBe(41)
    expect(NEWS_TITLE_PREFIX.en.length).toBe(18)
  })

  it('counts characters as people do', () => {
    expect(newsTextLength('été')).toBe(3)
    expect(newsTextLength('🌿 new')).toBe(5)
  })
})

describe('CampaignInput', () => {
  it('stores full titles and trims the rest', () => {
    const parsed = CampaignInput.parse({ ...VALID, name: '  Vitamin D webinar ' })
    expect(parsed.titleEn).toBe('New Roots Herbal: Free webinar on vitamin D')
    expect(parsed.titleFr).toBe('New Roots Herbal : Webinaire gratuit sur la vitamine D')
    expect(parsed.name).toBe('Vitamin D webinar')
    // Sending the stored title back (an edit) keeps it as is.
    expect(CampaignInput.parse({ ...VALID, titleEn: parsed.titleEn }).titleEn).toBe(parsed.titleEn)
  })

  it('limits titles to 60 characters with the prefix', () => {
    expect(CampaignInput.safeParse({ ...VALID, titleEn: 'x'.repeat(42) }).success).toBe(true)
    expect(CampaignInput.safeParse({ ...VALID, titleEn: 'x'.repeat(43) }).success).toBe(false)
    expect(CampaignInput.safeParse({ ...VALID, titleFr: 'é'.repeat(41) }).success).toBe(true)
    expect(CampaignInput.safeParse({ ...VALID, titleFr: 'é'.repeat(42) }).success).toBe(false)
    expect(CampaignInput.safeParse({ ...VALID, titleEn: 'New Roots Herbal: ' }).success).toBe(false)
    expect(CampaignInput.safeParse({ ...VALID, titleEn: 'Line\nbreak' }).success).toBe(false)
  })

  it('limits bodies to 100 characters', () => {
    expect(CampaignInput.safeParse({ ...VALID, bodyEn: 'b'.repeat(100) }).success).toBe(true)
    expect(CampaignInput.safeParse({ ...VALID, bodyEn: 'b'.repeat(101) }).success).toBe(false)
    expect(CampaignInput.safeParse({ ...VALID, bodyFr: '  ' }).success).toBe(false)
  })

  it('takes https links only', () => {
    expect(CampaignInput.safeParse({ ...VALID, url: 'http://newrootsherbal.com/' }).success).toBe(
      false,
    )
    expect(CampaignInput.safeParse({ ...VALID, url: 'javascript:alert(1)' }).success).toBe(false)
    expect(CampaignInput.safeParse({ ...VALID, url: 'newrootsherbal.com' }).success).toBe(false)
    expect(
      CampaignInput.safeParse({ ...VALID, url: ' https://newrootsherbal.com/a ' }).success,
    ).toBe(true)
  })
})

describe('campaignSlug', () => {
  it('makes a utm_campaign value', () => {
    expect(campaignSlug('Vitamin D webinar')).toBe('vitamin-d-webinar')
    expect(campaignSlug('Webinaire : vitamine D – été 2026')).toBe('webinaire-vitamine-d-ete-2026')
    expect(campaignSlug('!!!')).toBe('news')
    expect(campaignSlug('a'.repeat(100)).length).toBe(60)
  })
})

describe('NewsAudience', () => {
  it('accepts everyone and segments', () => {
    expect(NewsAudience.parse({ type: 'all' })).toEqual({ type: 'all' })
    const segment = {
      type: 'segment',
      conditions: ['ibs', 'gerd'],
      goals: ['digestion'],
      genders: ['woman'],
      ageMin: 30,
      ageMax: 60,
      pregnancy: ['none'],
    }
    expect(NewsAudience.parse(segment)).toEqual(segment)
    expect(AudienceEstimateBody.safeParse({ audience: segment }).success).toBe(true)
  })

  it('refuses empty, contradictory, duplicated or unknown criteria', () => {
    expect(NewsAudience.safeParse({ type: 'segment' }).success).toBe(false)
    expect(NewsAudience.safeParse({ type: 'segment', conditions: [], goals: [] }).success).toBe(
      false,
    )
    expect(NewsAudience.safeParse({ type: 'segment', ageMin: 60, ageMax: 30 }).success).toBe(false)
    expect(NewsAudience.safeParse({ type: 'segment', goals: ['sleep', 'sleep'] }).success).toBe(
      false,
    )
    expect(NewsAudience.safeParse({ type: 'segment', conditions: ['flu'] }).success).toBe(false)
    expect(NewsAudience.safeParse({ type: 'segment', ageMin: 17.5 }).success).toBe(false)
    expect(NewsAudience.safeParse({ type: 'everyone' }).success).toBe(false)
  })

  it('accepts an empty list next to another criterion', () => {
    expect(NewsAudience.safeParse({ type: 'segment', conditions: [], ageMin: 50 }).success).toBe(
      true,
    )
  })
})

describe('Toronto time and the sending window', () => {
  it('converts wall-clock times across daylight saving time', () => {
    // EST (UTC−5) before 8 March 2026, EDT (UTC−4) after.
    expect(zonedTimeToEpoch('2026-03-07', '11:00')).toBe(Date.UTC(2026, 2, 7, 16, 0))
    expect(zonedTimeToEpoch('2026-03-09', '11:00')).toBe(Date.UTC(2026, 2, 9, 15, 0))
    expect(zonedTimeToEpoch('2026-07-15', '19:00')).toBe(Date.UTC(2026, 6, 15, 23, 0))
    expect(zonedTimeToEpoch('2026-12-01', '19:00')).toBe(Date.UTC(2026, 11, 2, 0, 0))
  })

  it('handles the DST gap and overlap', () => {
    // 02:30 doesn't exist on 8 March 2026; 01:30 happens twice on 1 November 2026.
    expect(zonedTimeToEpoch('2026-03-08', '02:30')).toBeNull()
    expect(zonedTimeToEpoch('2026-11-01', '01:30')).toBe(Date.UTC(2026, 10, 1, 5, 30))
  })

  it('refuses malformed dates', () => {
    expect(zonedTimeToEpoch('2026-02-30', '12:00')).toBeNull()
    expect(zonedTimeToEpoch('2026-2-3', '12:00')).toBeNull()
    expect(zonedTimeToEpoch('2026-02-03', '24:00')).toBeNull()
  })

  it('reads wall-clock parts', () => {
    expect(zonedParts(Date.UTC(2026, 6, 15, 4, 5, 6))).toEqual({
      year: 2026,
      month: 7,
      day: 15,
      hour: 0,
      minute: 5,
      second: 6,
    })
  })

  it('allows 11:00 to 19:00 Toronto time, both ends included, summer and winter', () => {
    expect(inNewsWindow(Date.UTC(2026, 6, 15, 15, 0))).toBe(true) // 11:00 EDT
    expect(inNewsWindow(Date.UTC(2026, 6, 15, 14, 59))).toBe(false) // 10:59
    expect(inNewsWindow(Date.UTC(2026, 6, 15, 23, 0))).toBe(true) // 19:00
    expect(inNewsWindow(Date.UTC(2026, 6, 15, 23, 1))).toBe(false) // 19:01
    expect(inNewsWindow(Date.UTC(2026, 11, 1, 16, 0))).toBe(true) // 11:00 EST
    expect(inNewsWindow(Date.UTC(2026, 11, 1, 15, 59))).toBe(false)
    expect(inNewsWindow(Date.UTC(2026, 11, 2, 0, 0))).toBe(true) // 19:00 EST
    expect(inNewsWindow(Date.UTC(2026, 11, 2, 0, 1))).toBe(false)
  })

  it('takes the year in Toronto, not UTC', () => {
    expect(torontoYear(Date.UTC(2027, 0, 1, 3, 0))).toBe(2026) // 22:00 on 31 December
    expect(torontoYear(Date.UTC(2027, 0, 1, 5, 0))).toBe(2027)
  })
})

describe('device and schedule bodies', () => {
  it('lets PUT /api/me carry the language', () => {
    expect(PutMeBody.parse({ tz: 'America/Toronto', platform: 'android', locale: 'fr' })).toEqual({
      tz: 'America/Toronto',
      platform: 'android',
      locale: 'fr',
    })
    expect(PutMeBody.safeParse({ tz: 'America/Toronto', platform: 'ios' }).success).toBe(true)
    expect(
      PutMeBody.safeParse({ tz: 'America/Toronto', platform: 'ios', locale: 'de' }).success,
    ).toBe(false)
  })

  it('validates the opt-in and the send time', () => {
    expect(PutNewsBody.safeParse({ optIn: true }).success).toBe(true)
    expect(PutNewsBody.safeParse({ optIn: 'yes' }).success).toBe(false)
    expect(ScheduleCampaignBody.safeParse({ sendAt: 1.5 }).success).toBe(false)
    expect(ScheduleCampaignBody.safeParse({ sendAt: Date.UTC(2026, 9, 1, 15) }).success).toBe(true)
  })

  it('describes the news push payload', () => {
    expect(
      NewsPushPayload.safeParse({
        title: 'New Roots Herbal: Hi',
        body: 'Body',
        tag: 'news:abc',
        url: 'https://newrootsherbal.com/?utm_source=smartstack',
        kind: 'news',
        campaignId: 'abc',
        lang: 'fr',
      }).success,
    ).toBe(true)
  })
})
