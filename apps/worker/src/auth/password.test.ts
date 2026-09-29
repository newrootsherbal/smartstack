import { describe, expect, it } from 'vitest'
import {
  base64urlDecode,
  base64urlEncode,
  constantTimeEqual,
  decodeToken32,
  sha256Hex,
  tokenHash,
  utf8,
} from './crypto'
import {
  decodePasswordKey,
  hashPasswordKey,
  needsRehash,
  newStoredPassword,
  usablePepper,
  verifyPasswordKey,
} from './password'

const bytes = (length: number, start: number) =>
  Uint8Array.from({ length }, (_, i) => (start + i) & 0xff)

const PEPPER = 'smartstack-test-pepper-0123456789abcdefghij' // 43 chars, test only
const SALT = bytes(16, 0) // base64url AAECAwQFBgcICQoLDA0ODw
const KEY = bytes(32, 0x20) // base64url ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8
const KEY_B64U = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8'

describe('byte helpers', () => {
  it('round-trips base64url without padding', () => {
    expect(base64urlEncode(SALT)).toBe('AAECAwQFBgcICQoLDA0ODw')
    expect(base64urlEncode(KEY)).toBe(KEY_B64U)
    expect(base64urlDecode(KEY_B64U)).toEqual(KEY)
    expect(base64urlEncode(Uint8Array.from([0xfb, 0xff]))).toBe('-_8')
    expect(base64urlDecode('-_8')).toEqual(Uint8Array.from([0xfb, 0xff]))
    expect(base64urlDecode('a+b/')).toBeNull()
    expect(base64urlDecode('abcde')).toBeNull() // impossible length
  })

  it('hashes with SHA-256 (FIPS 180-2 "abc" vector)', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('stores tokens as the hex SHA-256 of their 32 raw bytes', async () => {
    const token = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc' // 32 × 0x07
    expect(decodeToken32(token)).toEqual(new Uint8Array(32).fill(7))
    expect(await tokenHash(token)).toBe(
      '4bb06f8e4e3a7715d201d573d0aa423762e55dabd61a2c02278fa56cc6d294e0',
    )
    expect(await tokenHash(token.slice(1))).toBeNull()
    expect(await tokenHash(token + 'A')).toBeNull()
    expect(await tokenHash('not a token')).toBeNull()
  })

  it('compares in constant time and rejects length mismatches', () => {
    expect(constantTimeEqual(bytes(32, 1), bytes(32, 1))).toBe(true)
    const other = bytes(32, 1)
    other[31] = 0
    expect(constantTimeEqual(bytes(32, 1), other)).toBe(false)
    expect(constantTimeEqual(bytes(32, 1), bytes(31, 1))).toBe(false)
  })
})

describe('password hashing (HMAC-SHA256(pepper, salt ‖ key))', () => {
  it('matches RFC 4231 test case 2 when salt ‖ key spells its message', async () => {
    const hash = await hashPasswordKey('Jefe', utf8('what do ya '), utf8('want for nothing?'))
    // 5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843, base64url
    expect(hash).toBe('W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM')
  })

  it('matches a vector computed independently with node:crypto', async () => {
    expect(await hashPasswordKey(PEPPER, SALT, KEY)).toBe(
      '6VWk0ISdjcR0L7KLcVj6-USRbkw75bxaB2M_AESrpes',
    )
  })

  it('verifies the right key and rejects anything else', async () => {
    const stored = await newStoredPassword(PEPPER, KEY, SALT)
    expect(stored).toEqual({
      hash: '6VWk0ISdjcR0L7KLcVj6-USRbkw75bxaB2M_AESrpes',
      salt: 'AAECAwQFBgcICQoLDA0ODw',
      kdfVersion: 1,
    })
    expect(await verifyPasswordKey(PEPPER, stored.salt, stored.hash, KEY)).toBe(true)
    expect(await verifyPasswordKey(PEPPER, stored.salt, stored.hash, bytes(32, 0x21))).toBe(false)
    expect(await verifyPasswordKey(PEPPER + 'x', stored.salt, stored.hash, KEY)).toBe(false)
    expect(await verifyPasswordKey(PEPPER, 'AAECAwQFBgcICQoLDA0ODg', stored.hash, KEY)).toBe(false)
    expect(await verifyPasswordKey(PEPPER, '%%%', stored.hash, KEY)).toBe(false)
  })

  it('draws a fresh 16-byte salt per password', async () => {
    const a = await newStoredPassword(PEPPER, KEY)
    const b = await newStoredPassword(PEPPER, KEY)
    expect(base64urlDecode(a.salt)).toHaveLength(16)
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
  })

  it('accepts only a 32-byte base64url key from the client', () => {
    expect(decodePasswordKey(KEY_B64U)).toEqual(KEY)
    expect(decodePasswordKey(KEY_B64U.slice(0, -1))).toBeNull()
    expect(decodePasswordKey('correct horse battery staple')).toBeNull()
  })

  it('requires a pepper of at least 32 characters', () => {
    expect(usablePepper(undefined)).toBeNull()
    expect(usablePepper('')).toBeNull()
    expect(usablePepper('short')).toBeNull()
    expect(usablePepper(`  ${PEPPER} `)).toBe(PEPPER)
  })

  it('asks for a rehash only below the current KDF version', () => {
    expect(needsRehash(1)).toBe(false)
    expect(needsRehash(0)).toBe(true)
    expect(needsRehash(null)).toBe(false)
  })
})
