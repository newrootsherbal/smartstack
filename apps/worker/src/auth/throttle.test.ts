import { describe, expect, it } from 'vitest'
import type { ThrottleRow } from '../env'
import {
  combineVerdicts,
  THROTTLE,
  throttleHitStatement,
  throttleKey,
  throttleMessage,
  throttleReadStatement,
  verdictAfterHit,
  verdictBeforeAttempt,
} from './throttle'

const NOW = Date.UTC(2026, 9, 1, 14, 0, 0)
const MIN = 60_000
const row = (count: number, window_start: number): ThrottleRow => ({
  key: 'k',
  count,
  window_start,
})

describe('throttle limits (§5.7)', () => {
  it('uses exactly the documented limits', () => {
    expect(THROTTLE.loginEmail).toMatchObject({ limit: 5, windowMs: 15 * MIN })
    expect(THROTTLE.loginIp).toMatchObject({ limit: 30, windowMs: 15 * MIN })
    expect(THROTTLE.signupIp).toMatchObject({ limit: 5, windowMs: 60 * MIN })
    expect(THROTTLE.forgotEmail).toMatchObject({ limit: 3, windowMs: 60 * MIN })
    expect(THROTTLE.resendEmail).toMatchObject({ limit: 3, windowMs: 60 * MIN })
    expect(THROTTLE.oauthStartIp).toMatchObject({ limit: 20, windowMs: 15 * MIN })
    expect(THROTTLE.claimIp).toMatchObject({ limit: 10, windowMs: 15 * MIN })
    expect(THROTTLE.lookupAccount).toMatchObject({ limit: 30, windowMs: 60 * MIN })
  })

  it('keys by scope and the SHA-256 of the normalized value (no email or IP in clear)', async () => {
    const key = await throttleKey(THROTTLE.loginEmail, ' Test.One@Example.com ')
    expect(key).toMatch(/^login:email:[0-9a-f]{64}$/)
    expect(key).toBe(await throttleKey(THROTTLE.loginEmail, 'test.one@example.com'))
    expect(key).not.toContain('example')
    expect(await throttleKey(THROTTLE.forgotEmail, 'test.one@example.com')).not.toBe(key)
  })
})

describe('fixed windows', () => {
  it('upserts one hit and resets the count when the window is over', () => {
    const s = throttleHitStatement('k', THROTTLE.signupIp, NOW)
    expect(s.sql).toMatch(/ON CONFLICT \(key\) DO UPDATE/)
    expect(s.sql).toMatch(/RETURNING key, count, window_start/)
    expect(s.params).toEqual(['k', NOW, NOW - 60 * MIN])
  })

  it('refuses the hit that exceeds the limit, until the window ends', () => {
    const rule = THROTTLE.forgotEmail // 3 per hour
    const start = NOW - 10 * MIN
    expect(verdictAfterHit(null, rule, NOW)).toEqual({ allowed: true })
    expect(verdictAfterHit(row(3, start), rule, NOW)).toEqual({ allowed: true })
    expect(verdictAfterHit(row(4, start), rule, NOW)).toEqual({
      allowed: false,
      retryAfter: 50 * 60,
    })
    // A stale row (window over) never refuses; the next hit starts a new window.
    expect(verdictAfterHit(row(99, NOW - 60 * MIN), rule, NOW)).toEqual({ allowed: true })
  })

  it('counts failed logins only when they fail: the 6th attempt is refused', () => {
    const rule = THROTTLE.loginEmail // 5 per 15 min
    const start = NOW - 1 * MIN
    expect(verdictBeforeAttempt(row(4, start), rule, NOW)).toEqual({ allowed: true })
    expect(verdictBeforeAttempt(row(5, start), rule, NOW)).toEqual({
      allowed: false,
      retryAfter: 14 * 60,
    })
    expect(verdictBeforeAttempt(row(5, NOW - 15 * MIN), rule, NOW)).toEqual({ allowed: true })
  })

  it('never answers Retry-After below 1 second', () => {
    const rule = THROTTLE.claimIp
    expect(verdictAfterHit(row(11, NOW - 15 * MIN + 1), rule, NOW)).toEqual({
      allowed: false,
      retryAfter: 1,
    })
  })

  it('combines verdicts by the longest wait', () => {
    expect(combineVerdicts([{ allowed: true }, { allowed: true }])).toEqual({ allowed: true })
    expect(
      combineVerdicts([
        { allowed: false, retryAfter: 30 },
        { allowed: true },
        { allowed: false, retryAfter: 600 },
      ]),
    ).toEqual({ allowed: false, retryAfter: 600 })
  })

  it('reads several keys at once', () => {
    expect(throttleReadStatement(['a', 'b']).sql).toMatch(/IN \(\?1, \?2\)/)
  })

  it('says how long to wait', () => {
    expect(throttleMessage(30)).toBe('Too many attempts. Try again in 1 minute.')
    expect(throttleMessage(12 * 60)).toBe('Too many attempts. Try again in 12 minutes.')
  })
})
