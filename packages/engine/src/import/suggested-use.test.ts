import { describe, expect, it } from 'vitest'
import { frenchSentenceFor, parseSuggestedUse } from './suggested-use'

describe('parseSuggestedUse', () => {
  it('reads units and once-daily frequency, with food', () => {
    const p = parseSuggestedUse(
      'Adults: Take 1 capsule daily with food or as directed by your health-care practitioner. If you are taking other medications, take this product a few hours before or after them.',
    )
    expect(p.dosesPerDay).toBe(1)
    expect(p.unitsPerDose).toBe(1)
    expect(p.unitLabel).toBe('capsule')
    expect(p.timing.map((t) => t.attribute)).toEqual(['WITH_FOOD'])
    expect(p.timing[0]?.sentence).toMatch(/^Adults: Take 1 capsule daily with food/)
  })

  it('reads twice daily and N times daily', () => {
    expect(parseSuggestedUse('Adults: Take 1 softgel twice daily.').dosesPerDay).toBe(2)
    expect(
      parseSuggestedUse('Adults: Take 2 capsules three times daily with meals.').dosesPerDay,
    ).toBe(3)
    expect(parseSuggestedUse('Adults: Take 1 capsule four times daily.').dosesPerDay).toBe(4)
    expect(parseSuggestedUse('Take 1 capsule 1–3 times daily.').dosesPerDay).toBe(1)
    expect(parseSuggestedUse('Take 1 capsule every 4 hours.').dosesPerDay).toBe(4)
  })

  it('takes the low end of a unit range and recognizes other unit words', () => {
    const p = parseSuggestedUse(
      'Adults, adolescents, and children ≥ 6 years old: Take 1–2 capsules daily with water or juice.',
    )
    expect(p.unitsPerDose).toBe(1)
    expect(p.dosesPerDay).toBe(1)
    expect(p.timing.map((t) => t.attribute)).toEqual(['TAKE_WITH_WATER'])
    expect(parseSuggestedUse('Take ½ teaspoon twice daily.').unitLabel).toBe('teaspoon')
    expect(parseSuggestedUse('Take 5 drops daily.').unitsPerDose).toBe(5)
  })

  it('finds bedtime, morning and empty-stomach hints', () => {
    expect(parseSuggestedUse('Take 1 capsule at bedtime.').timing.map((t) => t.attribute)).toEqual([
      'BEDTIME',
    ])
    expect(
      parseSuggestedUse('Take 1 capsule in the morning on an empty stomach.').timing.map(
        (t) => t.attribute,
      ),
    ).toEqual(['WITHOUT_FOOD', 'MORNING'])
  })

  it('defaults to once daily when nothing is stated', () => {
    const p = parseSuggestedUse('')
    expect(p).toEqual({ dosesPerDay: 1, unitsPerDose: null, unitLabel: null, timing: [] })
  })

  it('picks the matching French sentence', () => {
    expect(
      frenchSentenceFor(
        'WITH_FOOD',
        'Adultes : Prendre 1 capsule par jour avec de la nourriture ou tel qu’indiqué. En cas de prise d’autres médicaments, prendre ce produit quelques heures avant ou après ceux-ci.',
      ),
    ).toMatch(/^Adultes : Prendre 1 capsule par jour avec de la nourriture/)
    expect(frenchSentenceFor('BEDTIME', 'Prendre le matin.')).toBeUndefined()
  })
})
