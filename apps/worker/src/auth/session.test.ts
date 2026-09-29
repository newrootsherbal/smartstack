import { describe, expect, it } from 'vitest'
import { tokenHash } from './crypto'
import {
  bearerToken,
  createSessionStatements,
  DAY_MS,
  endOtherSessionsStatement,
  newSession,
  SESSION_IDLE_MS,
  sessionIdFromHeader,
  sessionLookupStatement,
  sessionNeedsSlide,
  slideStatements,
} from './session'
import {
  consumeEmailTokenStatement,
  EMAIL_TOKEN_TTL_MS,
  emailTokenLink,
  insertEmailTokenStatement,
  newEmailToken,
  retireEmailTokensStatement,
} from './tokens'

const NOW = Date.UTC(2026, 9, 1, 14, 0, 0)

describe('sessions', () => {
  it('creates a 32-byte token and stores only its hash', async () => {
    const { token, id } = await newSession()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(await tokenHash(token)).toBe(id)
    expect(id).not.toContain(token)
  })

  it('reads the bearer token', async () => {
    const { token, id } = await newSession()
    expect(bearerToken(`Bearer ${token}`)).toBe(token)
    expect(bearerToken(`bearer   ${token} `)).toBe(token)
    expect(bearerToken(token)).toBeNull()
    expect(bearerToken(undefined)).toBeNull()
    expect(await sessionIdFromHeader(`Bearer ${token}`)).toBe(id)
    // A Phase 1 device UUID is not a session token.
    expect(await sessionIdFromHeader('Bearer 3f2b9d4e-1c7a-4b8e-9a2d-6f1e2c3b4a5d')).toBeNull()
  })

  it('expires after 90 days and stamps the login', () => {
    const [insert, stamp] = createSessionStatements('sid', 'acc', 'android', NOW)
    expect(insert?.params).toEqual(['sid', 'acc', 'android', NOW, NOW + 90 * DAY_MS])
    expect(SESSION_IDLE_MS).toBe(90 * DAY_MS)
    expect(stamp?.sql).toMatch(
      /last_login_at = \?2, last_active_at = \?2, inactivity_warned_at = NULL/,
    )
    expect(stamp?.params).toEqual(['acc', NOW])
  })

  it('looks sessions up with their account and ignores expired ones', () => {
    const s = sessionLookupStatement('sid', NOW)
    expect(s.sql).toMatch(/JOIN accounts a ON a.id = s.account_id/)
    expect(s.sql).toMatch(/s.expires_at > \?2/)
    expect(s.sql).toMatch(/group_concat\(DISTINCT provider\)/)
    expect(s.params).toEqual(['sid', NOW])
  })

  it('slides at most once a day', () => {
    expect(sessionNeedsSlide(NOW - DAY_MS + 1, NOW)).toBe(false)
    expect(sessionNeedsSlide(NOW - DAY_MS, NOW)).toBe(true)
    const [session, account] = slideStatements('sid', 'acc', NOW)
    expect(session?.params).toEqual(['sid', NOW, NOW + SESSION_IDLE_MS])
    expect(account?.sql).toMatch(/last_active_at < \?3/)
    expect(account?.params).toEqual(['acc', NOW, NOW - DAY_MS])
  })

  it('ends every other session', () => {
    expect(endOtherSessionsStatement('acc', 'keep')).toEqual({
      sql: 'DELETE FROM sessions WHERE account_id = ?1 AND id <> ?2',
      params: ['acc', 'keep'],
    })
    expect(endOtherSessionsStatement('acc', null).params).toEqual(['acc', ''])
  })
})

describe('email tokens', () => {
  it('hashes emailed tokens like session tokens', async () => {
    const { token, id } = await newEmailToken()
    expect(await tokenHash(token)).toBe(id)
  })

  it('builds fragment links so the token never reaches a server log', () => {
    expect(emailTokenLink('https://schedule.example/', 'verify_email', 'TOKEN')).toBe(
      'https://schedule.example/verify-email#token=TOKEN',
    )
    expect(emailTokenLink('http://localhost:5173', 'reset_password', 'T')).toBe(
      'http://localhost:5173/reset-password#token=T',
    )
    // The browser needs the address to derive the new key (it is the PBKDF2 salt).
    expect(emailTokenLink('http://localhost:5173', 'reset_password', 'T', 'a+b@x.co')).toBe(
      'http://localhost:5173/reset-password#token=T&email=a%2Bb%40x.co',
    )
    expect(emailTokenLink('http://localhost:5173', 'verify_email', 'T', 'a@x.co')).toBe(
      'http://localhost:5173/verify-email#token=T',
    )
  })

  it('consumes a reset token only for the address it was sent to', () => {
    const s = consumeEmailTokenStatement('h', 'reset_password', NOW, 'a@b.co')
    expect(s.sql).toContain('AND email = ?4')
    expect(s.params).toEqual(['h', 'reset_password', NOW, 'a@b.co'])
    expect(consumeEmailTokenStatement('h', 'verify_email', NOW).sql).not.toContain('email = ?4')
  })

  it('expires verification after 48 hours and resets after 1 hour', () => {
    expect(insertEmailTokenStatement('h', 'acc', 'verify_email', 'a@b.co', NOW).params).toEqual([
      'h',
      'acc',
      'verify_email',
      'a@b.co',
      NOW,
      NOW + 48 * 3600_000,
    ])
    expect(EMAIL_TOKEN_TTL_MS.reset_password).toBe(3600_000)
  })

  it('consumes a token once, atomically', () => {
    const s = consumeEmailTokenStatement('h', 'reset_password', NOW)
    expect(s.sql).toMatch(/used_at IS NULL AND expires_at > \?3/)
    expect(s.sql).toMatch(/RETURNING account_id, email/)
    expect(s.params).toEqual(['h', 'reset_password', NOW])
  })

  it('retires outstanding tokens by purpose or all at once', () => {
    expect(retireEmailTokensStatement('acc', NOW, 'verify_email').params).toEqual([
      'acc',
      NOW,
      'verify_email',
    ])
    expect(retireEmailTokensStatement('acc', NOW).sql).not.toMatch(/purpose/)
  })
})
