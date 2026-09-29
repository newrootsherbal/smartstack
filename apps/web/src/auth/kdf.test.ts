import { pbkdf2Sync } from 'node:crypto'
import { KDF_ITERATIONS } from '@smartstack/shared'
import { describe, expect, it } from 'vitest'
import { derivePasswordKey } from './kdf'

/** The same derivation with Node's own PBKDF2, as an independent reference. */
function reference(email: string, password: string, iterations: number): string {
  return pbkdf2Sync(
    Buffer.from(password.normalize('NFC'), 'utf8'),
    Buffer.from(`smartstack/v1/${email.trim().toLowerCase()}`, 'utf8'),
    iterations,
    32,
    'sha256',
  ).toString('base64url')
}

describe('derivePasswordKey', () => {
  it('matches an independent PBKDF2-SHA256 at the real 600 000 iterations', async () => {
    const key = await derivePasswordKey('  Peter@Example.com ', 'correct horse battery')
    expect(key).toBe(reference('peter@example.com', 'correct horse battery', KDF_ITERATIONS))
    expect(key).toHaveLength(43)
  })

  it('normalizes the password (NFC) so é typed two ways gives one key', async () => {
    const composed = await derivePasswordKey('a@b.co', 'café-pass', 1000)
    const decomposed = await derivePasswordKey('a@b.co', 'café-pass', 1000)
    expect(composed).toBe(decomposed)
  })

  it('salts with the address', async () => {
    expect(await derivePasswordKey('a@b.co', 'password1', 1000)).not.toBe(
      await derivePasswordKey('c@b.co', 'password1', 1000),
    )
  })
})
