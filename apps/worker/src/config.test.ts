import { describe, expect, it } from 'vitest'
import { consentVersion, emailMode, isLocalOrigin, signInRefusal } from './config'

describe('launch gate for sign-up and login', () => {
  const staff = { ACCOUNTS_MODE: 'staff', STAFF_EMAIL_DOMAINS: 'newrootsherbal.com' }

  it('refuses addresses outside the staff domains while in staff mode', () => {
    expect(signInRefusal(staff, 'test.one@example.com')).toBe('accounts_not_open')
    expect(signInRefusal(staff, 'staff@newrootsherbal.com')).toBeNull()
    expect(signInRefusal(staff, 'staff@mail.newrootsherbal.com')).toBe('accounts_not_open')
  })

  it('opens to everyone in public mode and to nobody when off or misspelled', () => {
    expect(signInRefusal({ ...staff, ACCOUNTS_MODE: 'public' }, 'test.one@example.com')).toBeNull()
    expect(signInRefusal({ ...staff, ACCOUNTS_MODE: 'off' }, 'staff@newrootsherbal.com')).toBe(
      'accounts_not_open',
    )
    expect(signInRefusal({ ...staff, ACCOUNTS_MODE: 'pubic' }, 'test.one@example.com')).toBe(
      'accounts_not_open',
    )
  })
})

describe('account vars', () => {
  it('reads CONSENT_VERSION, null when unset', () => {
    expect(consentVersion({ CONSENT_VERSION: ' 2026-10 ' })).toBe('2026-10')
    expect(consentVersion({ CONSENT_VERSION: '' })).toBeNull()
  })

  it('reads EMAIL_MODE', () => {
    expect(emailMode({ EMAIL_MODE: 'smtp2go' })).toBe('smtp2go')
    expect(emailMode({ EMAIL_MODE: 'LOG' })).toBe('log')
    expect(emailMode({ EMAIL_MODE: '' })).toBe('invalid')
  })

  it('recognizes local origins (where EMAIL_MODE=log may print tokens)', () => {
    expect(isLocalOrigin('http://localhost:5173')).toBe(true)
    expect(isLocalOrigin('http://127.0.0.1:8787')).toBe(true)
    expect(isLocalOrigin('https://schedule.flourishbodyandmind.com')).toBe(false)
    expect(isLocalOrigin('http://localhost.evil.example')).toBe(false)
    expect(isLocalOrigin('not a url')).toBe(false)
  })
})
