/**
 * Password stretching in the browser (build prompt §5.2): the password never leaves the device.
 * key = PBKDF2-HMAC-SHA256(password NFC, "smartstack/v1/" + normalized email, 600 000, 32 bytes),
 * sent as base64url. The Worker only keeps a peppered HMAC of it.
 */
import { KDF_ITERATIONS, KDF_KEY_BYTES, kdfSalt } from '@smartstack/shared'
import { base64urlEncode } from './bytes'

export async function derivePasswordKey(
  email: string,
  password: string,
  iterations: number = KDF_ITERATIONS,
): Promise<string> {
  const encoder = new TextEncoder()
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(kdfSalt(email)), iterations },
    material,
    KDF_KEY_BYTES * 8,
  )
  return base64urlEncode(new Uint8Array(bits))
}
