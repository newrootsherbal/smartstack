import { describe, expect, it } from 'vitest'
import {
  AccountView,
  Base64Url32,
  ClaimHash,
  ConsentBody,
  DeviceLinkBody,
  Email,
  kdfSalt,
  LoginBody,
  OAuthClaimBody,
  OAuthStartBody,
  SignupBody,
} from './index'

/** base64url of 32 bytes: 43 characters, last one canonical. */
const KEY = 'q'.repeat(42) + 'A'
const KEY2 = 'Z9_-'.repeat(10) + 'ab' + 'w'

describe('auth primitives', () => {
  it('normalizes emails before checking the format', () => {
    expect(Email.parse('  Test.One@Example.COM ')).toBe('test.one@example.com')
    expect(Email.safeParse('not-an-email').success).toBe(false)
    expect(Email.safeParse(`${'a'.repeat(250)}@x.io`).success).toBe(false)
  })

  it('accepts exactly 32 bytes of canonical base64url', () => {
    expect(Base64Url32.safeParse(KEY).success).toBe(true)
    expect(Base64Url32.safeParse(KEY2).success).toBe(true)
    expect(Base64Url32.safeParse(KEY.slice(1)).success).toBe(false) // 42 chars
    expect(Base64Url32.safeParse(KEY + 'A').success).toBe(false) // 44 chars
    expect(Base64Url32.safeParse('q'.repeat(42) + 'B').success).toBe(false) // non-canonical tail
    expect(Base64Url32.safeParse('q'.repeat(42) + '=').success).toBe(false) // padding
    expect(Base64Url32.safeParse('+'.repeat(42) + 'A').success).toBe(false) // base64, not url
  })

  it('checks the claim hash is lowercase hex SHA-256', () => {
    expect(ClaimHash.safeParse('a'.repeat(64)).success).toBe(true)
    expect(ClaimHash.safeParse('A'.repeat(64)).success).toBe(false)
    expect(ClaimHash.safeParse('a'.repeat(63)).success).toBe(false)
  })

  it('builds the KDF salt from the normalized email', () => {
    expect(kdfSalt(' Test.One@Example.com')).toBe('smartstack/v1/test.one@example.com')
  })
})

describe('auth request bodies', () => {
  const signup = {
    email: 'test.one@example.com',
    key: KEY,
    locale: 'fr',
    consent: true,
    age14: true,
  }

  it('requires both consents on sign-up', () => {
    expect(SignupBody.safeParse(signup).success).toBe(true)
    expect(SignupBody.safeParse({ ...signup, consent: false }).success).toBe(false)
    expect(SignupBody.safeParse({ ...signup, age14: undefined }).success).toBe(false)
    expect(SignupBody.safeParse({ ...signup, locale: 'de' }).success).toBe(false)
    expect(SignupBody.safeParse({ ...signup, name: 'x'.repeat(61) }).success).toBe(false)
    expect(SignupBody.parse({ ...signup, name: '  Marie ', platform: 'android' }).name).toBe(
      'Marie',
    )
  })

  it('never accepts a raw password in place of the key', () => {
    expect(LoginBody.safeParse({ email: 'a@b.co', key: 'hunter2hunter2' }).success).toBe(false)
    expect(LoginBody.safeParse({ email: 'a@b.co', key: KEY }).success).toBe(true)
  })

  it('validates OAuth start and claim', () => {
    const start = { provider: 'google', intent: 'login', claimHash: 'f'.repeat(64), locale: 'en' }
    expect(OAuthStartBody.safeParse(start).success).toBe(true)
    expect(OAuthStartBody.safeParse({ ...start, provider: 'apple' }).success).toBe(true)
    expect(OAuthStartBody.safeParse({ ...start, provider: 'github' }).success).toBe(false)
    expect(OAuthStartBody.safeParse({ ...start, intent: 'signup' }).success).toBe(false)
    expect(OAuthClaimBody.safeParse({ state: KEY, claimSecret: KEY2 }).success).toBe(true)
    expect(OAuthClaimBody.safeParse({ state: 'short', claimSecret: KEY2 }).success).toBe(false)
  })

  it('validates consent and device bodies', () => {
    expect(ConsentBody.safeParse({ age14: true }).success).toBe(true)
    expect(ConsentBody.safeParse({ age14: false }).success).toBe(false)
    expect(
      DeviceLinkBody.safeParse({ deviceId: '3f2b9d4e-1c7a-4b8e-9a2d-6f1e2c3b4a5d' }).success,
    ).toBe(true)
    expect(DeviceLinkBody.safeParse({ deviceId: 'nope' }).success).toBe(false)
  })

  it('describes the account view', () => {
    const view = {
      id: 'a1',
      email: 'test.one@example.com',
      emailVerified: false,
      name: null,
      locale: 'en',
      role: 'user',
      providers: ['google'],
      hasPassword: true,
      consentNeeded: false,
    }
    expect(AccountView.safeParse(view).success).toBe(true)
    expect(AccountView.safeParse({ ...view, providers: ['facebook'] }).success).toBe(false)
  })
})
