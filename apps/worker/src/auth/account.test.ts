import { describe, expect, it } from 'vitest'
import type { AccountWithProviders } from '../env'
import {
  accountView,
  buildAccountExport,
  canDisconnect,
  consentNeeded,
  deleteAccountStatement,
  exportFileName,
  exportStatements,
  insertAccountStatement,
  newAccountRow,
  parseProviders,
  setPasswordStatement,
} from './account'

const NOW = Date.UTC(2026, 9, 1, 14, 0, 0)
const VERSION = '2026-10'

const account = (overrides: Partial<AccountWithProviders> = {}): AccountWithProviders => ({
  ...newAccountRow({
    id: 'acc-1',
    email: 'test.one@example.com',
    locale: 'en',
    displayName: 'Test',
    now: NOW,
    emailVerified: false,
    consentVersion: VERSION,
    password: { hash: 'HASH', salt: 'SALT', kdfVersion: 1 },
  }),
  ...overrides,
})

describe('consent gate (§5.8)', () => {
  it('passes only with consent to the current version', () => {
    expect(consentNeeded({ consent_version: VERSION, consent_at: NOW }, VERSION)).toBe(false)
    expect(consentNeeded({ consent_version: '2026-09', consent_at: NOW }, VERSION)).toBe(true)
    expect(consentNeeded({ consent_version: null, consent_at: null }, VERSION)).toBe(true)
    expect(consentNeeded({ consent_version: VERSION, consent_at: null }, VERSION)).toBe(true)
    // CONSENT_VERSION missing: everyone stays gated rather than silently passing.
    expect(consentNeeded({ consent_version: VERSION, consent_at: NOW }, null)).toBe(true)
  })

  it('records consent with email sign-up, not with provider sign-up', () => {
    const email = account()
    expect([email.consent_version, email.consent_at, email.age_confirmed_at]).toEqual([
      VERSION,
      NOW,
      NOW,
    ])
    const google = newAccountRow({
      id: 'g',
      email: 'g@example.com',
      locale: 'fr',
      displayName: null,
      now: NOW,
      emailVerified: true,
      consentVersion: null,
      password: null,
    })
    expect(accountView(google, VERSION).consentNeeded).toBe(true)
    expect(google.email_verified_at).toBe(NOW)
  })
})

describe('account view', () => {
  it('exposes what the app needs and nothing secret', () => {
    const view = accountView(account({ providers: 'google' }), VERSION)
    expect(view).toEqual({
      id: 'acc-1',
      email: 'test.one@example.com',
      emailVerified: false,
      name: 'Test',
      locale: 'en',
      role: 'user',
      providers: ['google'],
      hasPassword: true,
      consentNeeded: false,
    })
    expect(JSON.stringify(view)).not.toMatch(/HASH|SALT/)
  })

  it('parses providers from group_concat', () => {
    expect(parseProviders(null)).toEqual([])
    expect(parseProviders('google,apple,google,x')).toEqual(['apple', 'google'])
  })
})

describe('sign-in methods', () => {
  it('refuses to disconnect the only sign-in method', () => {
    expect(canDisconnect({ password_hash: null, providers: 'google' }, 'google')).toBe(
      'last_sign_in_method',
    )
    expect(canDisconnect({ password_hash: 'h', providers: 'google' }, 'google')).toBe('ok')
    expect(canDisconnect({ password_hash: null, providers: 'apple,google' }, 'google')).toBe('ok')
    expect(canDisconnect({ password_hash: 'h', providers: null }, 'google')).toBe('not_connected')
  })

  it('verifies the email on reset, not on change', () => {
    const pw = { hash: 'h', salt: 's', kdfVersion: 1 }
    expect(setPasswordStatement('a', pw, NOW, { verifyEmail: true }).sql).toMatch(
      /email_verified_at = COALESCE\(email_verified_at, \?5\)/,
    )
    expect(setPasswordStatement('a', pw, NOW, { verifyEmail: false }).sql).not.toMatch(
      /email_verified_at/,
    )
  })

  it('inserts the account with 13 bound parameters', () => {
    const s = insertAccountStatement(account())
    expect(s.params).toHaveLength(13)
    expect(s.sql.match(/\?\d+/g)?.length).toBe(14) // ?12 is reused for updated_at
  })
})

describe('deletion and export (§5.9)', () => {
  it('deletes the account row and lets ON DELETE CASCADE do the rest', () => {
    expect(deleteAccountStatement('acc-1')).toEqual({
      sql: 'DELETE FROM accounts WHERE id = ?1',
      params: ['acc-1'],
    })
  })

  it('exports every row of the account without secrets', () => {
    expect(exportStatements('acc-1')).toHaveLength(4)
    expect(exportStatements('acc-1')[2]!.sql).not.toMatch(/SELECT \*|\bid\b,/)
    const data = buildAccountExport(
      {
        account: account({ email_verified_at: NOW }),
        identities: [
          {
            provider: 'google',
            subject: '1234',
            email: 'test.one@example.com',
            created_at: NOW,
            last_used_at: NOW,
          },
        ],
        sessions: [{ platform: 'android', created_at: NOW, last_used_at: NOW, expires_at: NOW }],
        devices: [
          {
            id: '3f2b9d4e-1c7a-4b8e-9a2d-6f1e2c3b4a5d',
            tz: 'America/Toronto',
            platform: 'android',
            created_at: NOW,
            last_seen_at: NOW,
          },
        ],
      },
      NOW,
    )
    const json = JSON.stringify(data)
    expect(json).not.toMatch(/HASH|SALT|password_hash|password_salt|refresh/)
    expect(data.account).toMatchObject({
      email: 'test.one@example.com',
      hasPassword: true,
      consentVersion: VERSION,
      emailVerifiedAt: '2026-10-01T14:00:00.000Z',
    })
    expect(data.signInMethods).toHaveLength(1)
    expect(data.sessions[0]).toEqual({
      platform: 'android',
      createdAt: '2026-10-01T14:00:00.000Z',
      lastUsedAt: '2026-10-01T14:00:00.000Z',
      expiresAt: '2026-10-01T14:00:00.000Z',
    })
    expect(data.devices[0]?.timeZone).toBe('America/Toronto')
    expect(exportFileName(NOW)).toBe('smartstack-account-2026-10-01.json')
  })
})
