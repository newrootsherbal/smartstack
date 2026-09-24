import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION, formatHHMM, parseHHMM, roundUpTo } from './index'

describe('@smartstack/engine', () => {
  it('exports a version', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('time helpers', () => {
  it('round-trips HH:MM', () => {
    expect(parseHHMM('00:00')).toBe(0)
    expect(parseHHMM('09:30')).toBe(570)
    expect(parseHHMM('23:59')).toBe(1439)
    expect(formatHHMM(570)).toBe('09:30')
    expect(formatHHMM(0)).toBe('00:00')
  })

  it('rejects malformed input', () => {
    expect(() => parseHHMM('9:30')).toThrow()
    expect(() => parseHHMM('24:00')).toThrow()
    expect(() => parseHHMM('12:60')).toThrow()
  })

  it('clamps when formatting', () => {
    expect(formatHHMM(-5)).toBe('00:00')
    expect(formatHHMM(1500)).toBe('23:59')
  })

  it('rounds up to 15 minutes', () => {
    expect(roundUpTo(550)).toBe(555)
    expect(roundUpTo(555)).toBe(555)
    expect(roundUpTo(556)).toBe(570)
  })
})
