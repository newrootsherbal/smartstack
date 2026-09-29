/**
 * Byte helpers on WebCrypto (workerd and Node 22 alike). No bindings, no I/O.
 */
import { BASE64URL_32_RE } from '@smartstack/shared'

export const TOKEN_BYTES = 32

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

export function base64urlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Unpadded base64url → bytes; null when the text isn't base64url. */
export function base64urlDecode(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null
  const padded =
    text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? utf8(data) : data
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

export async function hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, message))
}

/** Compares every byte whatever the first difference (lengths are public: fixed-size values). */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

/** 32 random bytes as base64url: session tokens, emailed tokens, OAuth state, PKCE verifier. */
export function randomToken(): string {
  return base64urlEncode(randomBytes(TOKEN_BYTES))
}

/** The 32 bytes behind a canonical base64url token, or null. */
export function decodeToken32(token: string): Uint8Array | null {
  if (!BASE64URL_32_RE.test(token)) return null
  const bytes = base64urlDecode(token)
  return bytes && bytes.length === TOKEN_BYTES ? bytes : null
}

/**
 * What D1 stores for a bearer or emailed token (and what the app sends as claimHash): the
 * lowercase hex SHA-256 of the token's 32 raw bytes. Null for a malformed token.
 */
export async function tokenHash(token: string): Promise<string | null> {
  const bytes = decodeToken32(token)
  return bytes ? sha256Hex(bytes) : null
}
