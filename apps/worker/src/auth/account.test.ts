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

const STACK_ROW = {
  product_id: 'iron',
  doses_per_day: 1,
  pins: '["breakfast"]',
  dismissed: '[]',
  units_per_dose: null,
  variant_upc: null,
  inv_remaining: 20,
  inv_unit: 'unit' as const,
  inv_package_size: 60,
  low_flagged_at: NOW,
  added_at: NOW,
  updated_at: NOW,
  deleted_at: null,
  rev: 3,
}

/** A deleted product as the upsert leaves it: placeholders except the key and dates. */
const PRODUCT_TOMBSTONE_ROW = {
  id: '',
  product_type: 'other' as const,
  brand: null,
  name: '',
  upc: null,
  npn: null,
  din: null,
  strength: null,
  form: 'other' as const,
  dose_unit: '',
  units_per_dose: 1,
  doses_per_day: 1,
  package_quantity: null,
  package_unit: null,
  timing: '[]',
  ingredients: '[]',
  directions: null,
  warnings: null,
  notes: null,
  created_at: 0,
  updated_at: NOW,
  deleted_at: NOW,
  rev: 4,
}
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
    // Account, sign-in methods, sessions, devices, then the synced data: settings, the health
    // profile (0004) and the 4 tables of migration 0003.
    expect(exportStatements('acc-1')).toHaveLength(10)
    for (const s of exportStatements('acc-1')) expect(s.params).toEqual(['acc-1'])
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
        synced: {
          settings: [],
          health: [],
          products: [{ ...PRODUCT_TOMBSTONE_ROW, id: 'u_0f8fad5b-d9cb-469f-a165-70867728950e' }],
          stack: [STACK_ROW],
          shopping: [],
          checks: [],
        },
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
    // Synced data: as the app syncs it, dates as ISO strings, tombstones reduced to key + dates.
    expect(data.settings).toBeNull()
    expect(data.products).toEqual([
      {
        id: 'u_0f8fad5b-d9cb-469f-a165-70867728950e',
        updatedAt: '2026-10-01T14:00:00.000Z',
        deletedAt: '2026-10-01T14:00:00.000Z',
      },
    ])
    expect(data.stack).toEqual([
      {
        productId: 'iron',
        dosesPerDay: 1,
        pins: ['breakfast'],
        dismissed: [],
        inventory: {
          remaining: 20,
          unit: 'unit',
          packageSize: 60,
          lowFlaggedAt: '2026-10-01T14:00:00.000Z',
        },
        addedAt: '2026-10-01T14:00:00.000Z',
        updatedAt: '2026-10-01T14:00:00.000Z',
        deletedAt: null,
      },
    ])
    expect(data.shoppingList).toEqual([])
    expect(data.doseChecks).toEqual([])
    expect(exportFileName(NOW)).toBe('smartstack-account-2026-10-01.json')
  })
})
