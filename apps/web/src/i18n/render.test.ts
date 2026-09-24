import { buildSchedule } from '@smartstack/engine'
import type { Routine } from '@smartstack/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { en, fr, leafKeys, setLocale, t } from './index'
import { renderAdjustment, renderReasonShort } from './render'

const routine: Routine = {
  wake: '06:30',
  coffee: '07:00',
  breakfast: '07:30',
  lunch: '12:00',
  dinner: '18:00',
  exercise: null,
  bedtime: '22:00',
}

describe('adjustment sentences (pitch section 11)', () => {
  it('renders the engine codes through en.json', () => {
    const schedule = buildSchedule(
      routine,
      [
        'sample-iron',
        'sample-calmag',
        'sample-magnesium',
        'sample-multi',
        'sample-omega-3',
        'sample-probiotic',
      ].map((productId) => ({ productId, dosesPerDay: 1 })),
    )
    const rendered = schedule.adjustments.map((a) => renderAdjustment(a))
    expect(rendered).toContain('Iron moved away from calcium')
    expect(rendered).toContain('Fish oil moved to a meal')
    expect(rendered).toContain('Magnesium moved to bedtime')
  })

  it('renders the short reason lines from the pitch mock-up', () => {
    const schedule = buildSchedule(routine, [
      { productId: 'sample-iron', dosesPerDay: 1 },
      { productId: 'sample-calmag', dosesPerDay: 1 },
    ])
    const iron = schedule.placements.find((p) => p.productIds.includes('sample-iron'))!
    const lines = iron.reasons.map(renderReasonShort)
    expect(lines).toContain('Take separately from calcium')
    expect(lines).toContain('Avoid coffee/tea around this dose')
  })
})

describe('i18n dictionaries', () => {
  afterEach(() => setLocale('en'))

  it('fr.json mirrors every key of en.json', () => {
    expect(leafKeys(fr).sort()).toEqual(leafKeys(en).sort())
  })

  it('falls back to English when the French value is empty', () => {
    setLocale('fr')
    expect(t('adjustment.MOVED_TO_BEDTIME', { product: 'X' })).toMatch(/X/)
  })

  it('interpolates parameters and leaves unknown placeholders visible', () => {
    expect(t('reason.separatedBy', { hours: 2, ingredient: 'calcium' })).toBe(
      'Separated by 2 h from calcium',
    )
    expect(t('reason.separatedBy', { hours: 2 })).toBe('Separated by 2 h from {ingredient}')
  })
})
