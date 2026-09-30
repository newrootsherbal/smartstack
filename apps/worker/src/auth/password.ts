/**
 * Passwords (docs/smartstack-phase2-prompt.md §5.2). The browser stretches the password with
 * PBKDF2-SHA256 (600 000 iterations) and sends base64url(key); the Worker only stores
 * HMAC-SHA256(AUTH_PEPPER, salt ‖ key), which costs microseconds of CPU. No PBKDF2 here:
 * production Workers cap it at 100 000 iterations and the free plan allows 10 ms of CPU.
 */
import { KDF_KEY_BYTES, KDF_VERSION, PasswordKey } from '@smartstack/shared'
import {
  base64urlDecode,
  base64urlEncode,
  concatBytes,
  constantTimeEqual,
  hmacSha256,
  randomBytes,
  utf8,
} from './crypto'

export const CURRENT_KDF_VERSION = KDF_VERSION
export const SALT_BYTES = 16
/** The setup doc generates 32 random bytes as base64url (43 characters). */
export const PEPPER_MIN_LENGTH = 32

/** The pepper, or null when it is missing or too short to be the generated secret. */
export function usablePepper(raw: string | undefined): string | null {
  const pepper = raw?.trim() ?? ''
  return pepper.length >= PEPPER_MIN_LENGTH ? pepper : null
}

/** The client's derived key: exactly 32 bytes, canonical base64url. */
export function decodePasswordKey(key: string): Uint8Array | null {
  if (!PasswordKey.safeParse(key).success) return null
  const bytes = base64urlDecode(key)
  return bytes && bytes.length === KDF_KEY_BYTES ? bytes : null
}

/** base64url(HMAC-SHA256(key = UTF-8 pepper, message = salt ‖ key)). */
export async function hashPasswordKey(
  pepper: string,
  salt: Uint8Array,
  key: Uint8Array,
): Promise<string> {
  return base64urlEncode(await hmacSha256(utf8(pepper), concatBytes(salt, key)))
}

export interface StoredPassword {
  hash: string
  salt: string
  kdfVersion: number
}

/** A fresh random salt and the stored hash for a new or changed password. */
export async function newStoredPassword(
  pepper: string,
  key: Uint8Array,
  salt: Uint8Array = randomBytes(SALT_BYTES),
): Promise<StoredPassword> {
  return {
    hash: await hashPasswordKey(pepper, salt, key),
    salt: base64urlEncode(salt),
    kdfVersion: CURRENT_KDF_VERSION,
  }
}

/** Constant-time comparison of the recomputed HMAC with the stored one. */
export async function verifyPasswordKey(
  pepper: string,
  storedSalt: string,
  storedHash: string,
  key: Uint8Array,
): Promise<boolean> {
  const salt = base64urlDecode(storedSalt)
  const expected = base64urlDecode(storedHash)
  if (!salt || !expected) return false
  const actual = base64urlDecode(await hashPasswordKey(pepper, salt, key))
  return actual !== null && constantTimeEqual(actual, expected)
}

/** Login answers `rehash: true` so the client re-derives with the current parameters. */
export function needsRehash(kdfVersion: number | null): boolean {
  return kdfVersion !== null && kdfVersion < CURRENT_KDF_VERSION
}
