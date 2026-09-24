/**
 * Barcode helpers. Pure functions, shared by the catalogue lookup, the data
 * validator and the /dev/barcodes page.
 */

/** GS1 prefix range reserved for restricted circulation; never assigned to retail products. */
export const SAMPLE_EAN13_PREFIX = '200'

/** EAN-13 check digit for the first 12 digits. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error(`expected 12 digits, got ${first12}`)
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const digit = Number(first12[i])
    sum += i % 2 === 0 ? digit : digit * 3
  }
  return (10 - (sum % 10)) % 10
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12])
}

/** Build the n-th sample EAN-13 (200000000000 + n, plus check digit). */
export function sampleEan13(n: number): string {
  const body = (SAMPLE_EAN13_PREFIX + String(n).padStart(9, '0')).slice(0, 12)
  return body + String(ean13CheckDigit(body))
}

/**
 * Normalize a scanned or typed code so catalogue lookups compare like with like.
 * A 13-digit code starting with 0 is the same article as the 12-digit UPC-A.
 * Non-numeric payloads (e.g. QR text) are trimmed and returned unchanged.
 */
export function normalizeBarcode(raw: string): string {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return trimmed
  if (trimmed.length === 13 && trimmed.startsWith('0')) return trimmed.slice(1)
  return trimmed
}

export function barcodesMatch(a: string, b: string): boolean {
  return normalizeBarcode(a) === normalizeBarcode(b)
}
