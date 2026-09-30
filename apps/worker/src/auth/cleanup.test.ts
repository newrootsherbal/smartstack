import { describe, expect, it } from 'vitest'
import { authCleanupStatements } from './cleanup'

const NOW = Date.UTC(2026, 9, 1, 14, 0, 0)

describe('daily cleanup (§8.6)', () => {
  it('deletes expired sessions, spent email tokens, old attempts and throttle rows', () => {
    const [sessions, tokens, attempts, throttle] = authCleanupStatements(NOW)
    expect(sessions).toEqual({ sql: 'DELETE FROM sessions WHERE expires_at <= ?1', params: [NOW] })
    expect(tokens?.sql).toMatch(/used_at IS NOT NULL OR expires_at <= \?1/)
    expect(tokens?.params).toEqual([NOW])
    expect(attempts?.sql).toMatch(/DELETE FROM oauth_attempts WHERE created_at < \?1/)
    expect(attempts?.params).toEqual([NOW - 24 * 3600_000])
    expect(throttle?.sql).toMatch(/DELETE FROM auth_throttle WHERE window_start < \?1/)
    expect(throttle?.params).toEqual([NOW - 24 * 3600_000])
    expect(authCleanupStatements(NOW)).toHaveLength(4)
  })
})
