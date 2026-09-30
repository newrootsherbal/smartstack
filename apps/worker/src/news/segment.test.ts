import {
  GENDERS,
  HEALTH_CONDITIONS,
  HEALTH_GOALS,
  NewsAudience,
  PREGNANCY_STATUSES,
} from '@smartstack/shared'
import { describe, expect, it } from 'vitest'
import { addAccount, addDevice, addProfile, createTestDb, type TestDb } from '../test/sqlite-d1'
import { audienceFilter, isMissingHealthProfiles } from './segment'

const YEAR = 2026

/** Device ids matching an audience, straight from SQLite. */
function matching(db: TestDb, audience: NewsAudience): string[] {
  const filter = audienceFilter(NewsAudience.parse(audience), YEAR)
  return (
    db.sql
      .prepare(`SELECT u.id FROM users u WHERE ${filter.sql} ORDER BY u.id`)
      .all(...filter.params) as { id: string }[]
  ).map((r) => r.id)
}

function seed(): TestDb {
  const db = createTestDb()
  // Guest devices: only ever in "everyone".
  addDevice(db, 'guest-in')
  addDevice(db, 'guest-out', { optIn: false })
  // ana: 1990, woman, IBS + GERD, digestion + sleep, not pregnant.
  addAccount(db, 'ana')
  addProfile(db, 'ana', {
    birthYear: 1990,
    gender: 'woman',
    pregnancy: 'none',
    conditions: ['ibs', 'gerd'],
    goals: ['digestion', 'sleep'],
  })
  addDevice(db, 'ana-phone', { accountId: 'ana' })
  addDevice(db, 'ana-laptop', { accountId: 'ana', optIn: false })
  // bob: 1960, man, high blood pressure, heart.
  addAccount(db, 'bob')
  addProfile(db, 'bob', {
    birthYear: 1960,
    gender: 'man',
    conditions: ['high_blood_pressure'],
    goals: ['heart'],
  })
  addDevice(db, 'bob-phone', { accountId: 'bob' })
  // cam: pregnant, no year of birth.
  addAccount(db, 'cam')
  addProfile(db, 'cam', { gender: 'woman', pregnancy: 'pregnant', goals: ['prenatal'] })
  addDevice(db, 'cam-phone', { accountId: 'cam' })
  // dee: matches IBS but never allowed targeting (C5 off).
  addAccount(db, 'dee')
  addProfile(db, 'dee', { conditions: ['ibs'], targeting: false })
  addDevice(db, 'dee-phone', { accountId: 'dee' })
  // eve: matches IBS but deleted her profile.
  addAccount(db, 'eve')
  addProfile(db, 'eve', { conditions: ['ibs'], deleted: true })
  addDevice(db, 'eve-phone', { accountId: 'eve' })
  // fay: an account without a health profile.
  addAccount(db, 'fay')
  addDevice(db, 'fay-phone', { accountId: 'fay' })
  // gus: a corrupt conditions column must not break the query.
  addAccount(db, 'gus')
  addProfile(db, 'gus', { conditions: 'not json', goals: ['sleep'] })
  addDevice(db, 'gus-phone', { accountId: 'gus' })
  return db
}

describe('audienceFilter (SQL)', () => {
  it('everyone: every device that opted in, guest or account, with or without a profile', () => {
    expect(matching(seed(), { type: 'all' })).toEqual([
      'ana-phone',
      'bob-phone',
      'cam-phone',
      'dee-phone',
      'eve-phone',
      'fay-phone',
      'guest-in',
      'gus-phone',
    ])
  })

  it('any of the conditions, only with targeting consent and a live profile', () => {
    const db = seed()
    expect(matching(db, { type: 'segment', conditions: ['ibs'] })).toEqual(['ana-phone'])
    expect(matching(db, { type: 'segment', conditions: ['ibs', 'high_blood_pressure'] })).toEqual([
      'ana-phone',
      'bob-phone',
    ])
    expect(matching(db, { type: 'segment', conditions: ['asthma'] })).toEqual([])
  })

  it('any of the goals, and a corrupt JSON column counts as empty', () => {
    expect(matching(seed(), { type: 'segment', goals: ['sleep', 'prenatal'] })).toEqual([
      'ana-phone',
      'cam-phone',
      'gus-phone',
    ])
  })

  it('genders and pregnancy statuses', () => {
    const db = seed()
    expect(matching(db, { type: 'segment', genders: ['woman'] })).toEqual([
      'ana-phone',
      'cam-phone',
    ])
    expect(matching(db, { type: 'segment', pregnancy: ['pregnant', 'breastfeeding'] })).toEqual([
      'cam-phone',
    ])
  })

  it('age from the year of birth; no year of birth never matches an age range', () => {
    const db = seed()
    // 2026 − 1990 = 36, 2026 − 1960 = 66.
    expect(matching(db, { type: 'segment', ageMin: 36, ageMax: 36 })).toEqual(['ana-phone'])
    expect(matching(db, { type: 'segment', ageMin: 37 })).toEqual(['bob-phone'])
    expect(matching(db, { type: 'segment', ageMax: 65 })).toEqual(['ana-phone'])
    expect(matching(db, { type: 'segment', ageMin: 0, ageMax: 120 })).toEqual([
      'ana-phone',
      'bob-phone',
    ])
  })

  it('ANDs the parts together', () => {
    const db = seed()
    expect(
      matching(db, { type: 'segment', genders: ['woman'], conditions: ['ibs'], ageMax: 40 }),
    ).toEqual(['ana-phone'])
    expect(matching(db, { type: 'segment', genders: ['man'], conditions: ['ibs'] })).toEqual([])
  })

  it('binds one parameter per code and per age bound, in textual order', () => {
    const filter = audienceFilter(
      { type: 'segment', conditions: ['ibs'], goals: ['sleep', 'energy'], ageMin: 30, ageMax: 50 },
      YEAR,
    )
    expect(filter.params).toEqual(['ibs', 'sleep', 'energy', 1976, 1996])
    expect(filter.sql.match(/\?/g)).toHaveLength(filter.params.length)
    expect(audienceFilter({ type: 'all' }, YEAR)).toEqual({ sql: 'u.news_opt_in = 1', params: [] })
  })

  it('stays well under 100 bound parameters with every code selected', () => {
    const everything = NewsAudience.parse({
      type: 'segment',
      conditions: HEALTH_CONDITIONS,
      goals: HEALTH_GOALS,
      genders: GENDERS,
      pregnancy: PREGNANCY_STATUSES,
      ageMin: 18,
      ageMax: 99,
    })
    const filter = audienceFilter(everything, YEAR)
    expect(filter.params.length).toBe(51)
    // The fan-out adds cursor, cap and limit: 54 in all.
    expect(filter.params.length + 3).toBeLessThan(100)
    expect(filter.sql.match(/\?/g)).toHaveLength(51)
  })

  it('recognizes a missing health_profiles table (migration 0004 not applied)', () => {
    expect(
      isMissingHealthProfiles(new Error('D1_ERROR: no such table: health_profiles: SQLITE_ERROR')),
    ).toBe(true)
    expect(isMissingHealthProfiles(new Error('no such table: campaigns'))).toBe(false)
    expect(isMissingHealthProfiles('no such table: health_profiles')).toBe(false)
  })
})
