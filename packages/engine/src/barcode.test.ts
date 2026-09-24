import { describe, expect, it } from 'vitest'
import {
  barcodesMatch,
  ean13CheckDigit,
  isValidEan13,
  normalizeBarcode,
  sampleEan13,
} from './barcode'
import { findProductByBarcode as find } from './catalogue'
import { sampleCatalogue } from './sample'

const findProductByBarcode = (code: string) => find(code, sampleCatalogue)

describe('EAN-13', () => {
  it('computes the check digit', () => {
    expect(ean13CheckDigit('200000000000')).toBe(8)
    expect(ean13CheckDigit('200000000001')).toBe(5)
    expect(ean13CheckDigit('400638133393')).toBe(1) // well-known example: 4006381333931
  })

  it('builds sample codes in the restricted-circulation range', () => {
    expect(sampleEan13(0)).toBe('2000000000008')
    expect(sampleEan13(1)).toBe('2000000000015')
    expect(sampleEan13(9)).toBe('2000000000091')
    expect(isValidEan13(sampleEan13(123))).toBe(true)
  })

  it('validates', () => {
    expect(isValidEan13('2000000000008')).toBe(true)
    expect(isValidEan13('2000000000009')).toBe(false)
    expect(isValidEan13('12345')).toBe(false)
  })
})

describe('normalizeBarcode', () => {
  it('treats a 13-digit code starting with 0 as the 12-digit UPC-A', () => {
    expect(normalizeBarcode('0012345678905')).toBe('012345678905')
    expect(barcodesMatch('0012345678905', '012345678905')).toBe(true)
  })

  it('leaves other codes alone (trimmed)', () => {
    expect(normalizeBarcode(' 2000000000008 ')).toBe('2000000000008')
    expect(normalizeBarcode('https://example.com/x')).toBe('https://example.com/x')
  })
})

describe('findProductByBarcode (sample fixture)', () => {
  it('finds sample products by their EAN-13', () => {
    expect(findProductByBarcode('2000000000008')?.id).toBe('sample-iron')
    expect(findProductByBarcode('2000000000039')?.id).toBe('sample-multi')
  })

  it('returns undefined for anything outside the sample catalogue', () => {
    expect(findProductByBarcode('4006381333931')).toBeUndefined()
    expect(findProductByBarcode('')).toBeUndefined()
  })

  it('every seed UPC is a valid EAN-13 with the sample prefix', () => {
    for (const p of sampleCatalogue.products) {
      expect(isValidEan13(p.upc)).toBe(true)
      expect(p.upc.startsWith('200')).toBe(true)
    }
  })
})
