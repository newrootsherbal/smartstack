import { buildSchedule, sampleCatalogue } from '@smartstack/engine'
import type { Routine } from '@smartstack/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { detectLocale, en, fr, leafKeys, setLocale, t } from './index'
import { renderAdjustment, renderReasonShort, severityLabel } from './render'

const NBSP = String.fromCharCode(0xa0)

const routine: Routine = {
  wake: '06:30',
  coffee: '07:00',
  breakfast: '07:30',
  lunch: '12:00',
  dinner: '18:00',
  exercise: null,
  bedtime: '22:00',
}

const pitchStack = [
  'sample-iron',
  'sample-calmag',
  'sample-magnesium',
  'sample-multi',
  'sample-omega-3',
  'sample-probiotic',
].map((productId) => ({ productId, dosesPerDay: 1 }))

const ironAndCalcium = [
  { productId: 'sample-iron', dosesPerDay: 1 },
  { productId: 'sample-calmag', dosesPerDay: 1 },
]

function value(dict: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      dict,
    )
}

afterEach(() => setLocale('en'))

describe('adjustment sentences (pitch section 11)', () => {
  it('renders the engine codes through en.json', () => {
    const schedule = buildSchedule(routine, pitchStack, { catalogue: sampleCatalogue })
    const rendered = schedule.adjustments.map((a) => renderAdjustment(a, sampleCatalogue))
    expect(rendered).toContain('Iron moved away from calcium')
    expect(rendered).toContain('Fish oil moved to a meal')
    expect(rendered).toContain('Magnesium moved to bedtime')
  })

  it('renders the same codes through fr.json with French product and ingredient names', () => {
    setLocale('fr')
    const schedule = buildSchedule(routine, pitchStack, { catalogue: sampleCatalogue })
    const rendered = schedule.adjustments.map((a) => renderAdjustment(a, sampleCatalogue))
    expect(rendered).toContain(`Fer et calcium${NBSP}: à des moments différents`)
    expect(rendered).toContain(`Huile de poisson${NBSP}: maintenant avec un repas`)
    expect(rendered).toContain(`Magnésium${NBSP}: maintenant au coucher`)
  })

  it('renders the short reason lines from the pitch mock-up', () => {
    const schedule = buildSchedule(routine, ironAndCalcium, { catalogue: sampleCatalogue })
    const iron = schedule.placements.find((p) => p.productIds.includes('sample-iron'))!
    const lines = iron.reasons.map(renderReasonShort)
    expect(lines).toContain('Take separately from calcium')
    expect(lines).toContain('Avoid coffee/tea around this dose')
  })

  it('renders the short reason lines in French', () => {
    setLocale('fr')
    const schedule = buildSchedule(routine, ironAndCalcium, { catalogue: sampleCatalogue })
    const iron = schedule.placements.find((p) => p.productIds.includes('sample-iron'))!
    const lines = iron.reasons.map(renderReasonShort)
    expect(lines).toContain('Prendre à distance du calcium')
    expect(lines).toContain('Éviter le café et le thé autour de cette dose')
  })
})

describe('severity badges', () => {
  it('labels the levels in both languages, keeping empty sub-labels empty', () => {
    expect(severityLabel('timing_conflict')).toEqual({
      label: 'Timing conflict',
      sub: 'Action recommended',
    })
    setLocale('fr')
    expect(severityLabel('timing_conflict')).toEqual({
      label: 'Conflit d’horaire',
      sub: 'Action recommandée',
    })
    expect(severityLabel('consideration').sub).toBe('')
  })
})

describe('i18n dictionaries', () => {
  it('fr.json mirrors every key of en.json', () => {
    expect(leafKeys(fr).sort()).toEqual(leafKeys(en).sort())
  })

  it('translates every message (only labels empty in English may be empty in French)', () => {
    const untranslated = leafKeys(en).filter(
      (key) => value(fr, key) === '' && value(en, key) !== '',
    )
    expect(untranslated).toEqual([])
  })

  it('keeps every {placeholder} of the English message in the French one', () => {
    const placeholders = (text: unknown) => (String(text).match(/\{\w+\}/g) ?? []).sort()
    for (const key of leafKeys(en)) {
      expect(placeholders(value(fr, key)), key).toEqual(placeholders(value(en, key)))
    }
  })

  it('interpolates parameters and leaves unknown placeholders visible', () => {
    expect(t('reason.separatedBy', { hours: 2, ingredient: 'calcium' })).toBe(
      'Separated by 2 h from calcium',
    )
    expect(t('reason.separatedBy', { hours: 2 })).toBe('Separated by 2 h from {ingredient}')
  })

  it('returns an empty string for severities without a sub-label, never the key', () => {
    expect(t('severity.consideration.sub')).toBe('')
    expect(t('severity.timing_conflict.sub')).toBe('Action recommended')
  })
})

describe('detectLocale', () => {
  it('picks the first preferred language the app speaks, English otherwise', () => {
    expect(detectLocale(['fr-CA', 'en-CA'])).toBe('fr')
    expect(detectLocale(['en-CA', 'fr-CA'])).toBe('en')
    expect(detectLocale(['de-DE', 'fr'])).toBe('fr')
    expect(detectLocale(['de-DE'])).toBe('en')
    expect(detectLocale([])).toBe('en')
  })
})
