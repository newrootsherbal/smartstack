/**
 * Barcode helpers. Pure functions, shared by the catalogue lookup, the data
 * validator, the importer and the /dev/barcodes page.
 */

/** GS1 prefix range reserved for restricted circulation; never assigned to retail products. */
export const SAMPLE_EAN13_PREFIX = '200'

/** GS1 modulo-10 check digit for the leading digits of an EAN-13 (12 digits) or UPC-A (11 digits). */
function gs1CheckDigit(digits: string): number {
  // Weights alternate 3,1,3… from the rightmost data digit.
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits[digits.length - 1 - i])
    sum += i % 2 === 0 ? digit * 3 : digit
  }
  return (10 - (sum % 10)) % 10
}

/** EAN-13 check digit for the first 12 digits. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error(`expected 12 digits, got ${first12}`)
  return gs1CheckDigit(first12)
}

/** UPC-A check digit for the first 11 digits. */
export function upcaCheckDigit(first11: string): number {
  if (!/^\d{11}$/.test(first11)) throw new Error(`expected 11 digits, got ${first11}`)
  return gs1CheckDigit(first11)
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12])
}

export function isValidUpcA(code: string): boolean {
  if (!/^\d{12}$/.test(code)) return false
  return upcaCheckDigit(code.slice(0, 11)) === Number(code[11])
}

/** True for a well-formed 12-digit UPC-A or 13-digit EAN-13. */
export function isValidRetailBarcode(code: string): boolean {
  return code.length === 12 ? isValidUpcA(code) : isValidEan13(code)
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
