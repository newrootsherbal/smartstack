import { afterEach, describe, expect, it } from 'vitest'
import { formatAmount, formatServingSize, formatUnits, timesLabel } from './format'
import { setLocale } from './i18n'

/** Drops every kind of space (Intl may use no-break or narrow ones between groups). */
const squash = (text: string) =>
  Array.from(text)
    .filter((c) => c.trim() !== '')
    .join('')

afterEach(() => setLocale('en'))

describe('formatAmount', () => {
  it('scales large counts and keeps small ones as printed', () => {
    expect(formatAmount(300, 'mg')).toBe('300 mg')
    expect(formatAmount(637.5, 'mg')).toBe('637.5 mg')
    expect(formatAmount(1e10, 'CFU')).toBe('10 billion CFU')
    expect(formatAmount(1.5e6, 'CFU')).toBe('1.5 million CFU')
    expect(formatAmount(10000, 'IU')).toBe('10,000 IU')
  })

  it('prints French numerals, unit symbols and plurals', () => {
    setLocale('fr')
    expect(formatAmount(637.5, 'mg')).toBe('637,5 mg')
    expect(formatAmount(1e10, 'CFU')).toBe('10 milliards UFC')
    expect(formatAmount(1.5e9, 'CFU')).toBe('1,5 milliard UFC')
    expect(squash(formatAmount(10000, 'IU'))).toBe('10000UI')
  })
})

describe('formatUnits', () => {
  it('uses the label word in English, pluralized', () => {
    expect(formatUnits(1, 'liquid', 'drop')).toBe('1 drop')
    expect(formatUnits(4, 'liquid', 'drop')).toBe('4 drops')
    expect(formatUnits(0.5, 'powder', 'teaspoon')).toBe('½ teaspoon')
    expect(formatUnits(2, 'liquid', 'ml')).toBe('2 ml')
    expect(formatUnits(2, 'softgel')).toBe('2 softgels')
    expect(formatUnits(2, 'tablet', 'widget')).toBe('2 widgets')
  })

  it('translates the label word in French and falls back to the form', () => {
    setLocale('fr')
    expect(formatUnits(4, 'liquid', 'drop')).toBe('4 gouttes')
    expect(formatUnits(2, 'powder', 'teaspoon')).toBe('2 cuillères à thé')
    expect(formatUnits(0.5, 'powder', 'teaspoon')).toBe('½ cuillère à thé')
    expect(formatUnits(1, 'capsule', 'capsule')).toBe('1 capsule')
    expect(formatUnits(2, 'softgel')).toBe('2 gélules')
    expect(formatUnits(2, 'tablet', 'widget')).toBe('2 comprimés')
  })
})

describe('formatServingSize', () => {
  it('leaves English as printed on the label', () => {
    expect(formatServingSize('1 enteric-coated capsule')).toBe('1 enteric-coated capsule')
    expect(formatServingSize('1 ml (40 drops)')).toBe('1 ml (40 drops)')
  })

  it('translates the label phrases it knows and keeps the rest as printed', () => {
    setLocale('fr')
    expect(formatServingSize('1 capsule')).toBe('1 capsule')
    expect(formatServingSize('2 capsules')).toBe('2 capsules')
    expect(formatServingSize('1 enteric-coated capsule')).toBe('1 capsule à enrobage entérique')
    expect(formatServingSize('6 vegetable capsules')).toBe('6 capsules végétales')
    expect(formatServingSize('½ teaspoon')).toBe('½ cuillère à thé')
    expect(formatServingSize('1 ¾ teaspoon')).toBe('1 ¾ cuillère à thé')
    expect(formatServingSize('1 teaspoon (5 ml)')).toBe('1 cuillère à thé (5 ml)')
    expect(formatServingSize('1 ml (40 drops)')).toBe('1 ml (40 gouttes)')
    expect(formatServingSize('¼ teaspoon (1,090 mg)')).toBe('¼ cuillère à thé (1,090 mg)')
    expect(formatServingSize('1 sublingual tablet')).toBe('1 comprimé sublingual')
    expect(formatServingSize('1-scoop serving')).toBe('1-scoop serving')
    expect(formatServingSize('10 g (2 heaping teaspoons) serving')).toBe(
      '10 g (2 heaping teaspoons) serving',
    )
  })
})

describe('timesLabel', () => {
  it('follows the language', () => {
    expect(timesLabel(2)).toBe('Twice a day')
    setLocale('fr')
    expect(timesLabel(2)).toBe('Deux fois par jour')
    expect(timesLabel(9)).toBe('Quatre fois par jour')
  })
})
