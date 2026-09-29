import type { Routine, Stack } from '@smartstack/shared'
import { describe, expect, it } from 'vitest'
import { sampleCatalogue } from './sample'
import { buildSchedule as buildScheduleWith } from './scheduler'

// Every test runs against the stable sample fixture, not the imported catalogue.
const buildSchedule = (routine: Routine, stack: Stack) =>
  buildScheduleWith(routine, stack, { catalogue: sampleCatalogue })

const one = (...ids: string[]): Stack => ids.map((productId) => ({ productId, dosesPerDay: 1 }))

/** The pitch document's section-5 routine. */
const section5Routine: Routine = {
  wake: '06:30',
  coffee: '07:00',
  breakfast: '07:30',
  lunch: '12:00',
  dinner: '18:00',
  exercise: null,
  bedtime: '22:00',
}

describe('buildSchedule — pitch section 5 example', () => {
  const stack = one(
    'sample-iron',
    'sample-calmag',
    'sample-magnesium',
    'sample-multi',
    'sample-omega-3',
    'sample-probiotic',
  )
  const schedule = buildSchedule(section5Routine, stack)

  it('places every product at the expected time and anchor', () => {
    expect(schedule.placements.map((p) => [p.time, p.anchor, p.productIds])).toEqual([
      ['07:30', 'breakfast', ['sample-multi']],
      ['09:30', null, ['sample-iron']],
      ['12:00', 'lunch', ['sample-omega-3', 'sample-probiotic']],
      ['18:00', 'dinner', ['sample-calmag']],
      ['22:00', 'bedtime', ['sample-magnesium']],
    ])
  })

  it('explains the iron placement with the calcium and coffee rules', () => {
    const iron = schedule.placements.find((p) => p.time === '09:30')
    const ruleIds = iron?.reasons.map((r) => r.ruleId)
    expect(ruleIds).toContain('rule-iron-separate-calcium')
    expect(ruleIds).toContain('rule-iron-separate-coffee')
    const calcium = iron?.reasons.find((r) => r.ruleId === 'rule-iron-separate-calcium')
    expect(calcium?.severity).toBe('timing_conflict')
    expect(calcium?.params.separationMinutes).toBe(120)
    expect(calcium?.params.otherIngredientId).toBe('calcium')
    expect(calcium?.params.otherProductIds).toEqual(
      expect.arrayContaining(['sample-calmag', 'sample-multi']),
    )
  })

  it('lists the three adjustments from the pitch (as a superset)', () => {
    const codes = schedule.adjustments.map((a) => [a.productId, a.code])
    expect(codes).toEqual(
      expect.arrayContaining([
        ['sample-iron', 'MOVED_AWAY_FROM_INGREDIENT'],
        ['sample-omega-3', 'MOVED_TO_MEAL'],
        ['sample-magnesium', 'MOVED_TO_BEDTIME'],
      ]),
    )
    const iron = schedule.adjustments.find((a) => a.productId === 'sample-iron')
    expect(iron?.params).toMatchObject({ otherIngredientId: 'calcium', from: '07:30', to: '09:30' })
    expect(schedule.adjustments.some((a) => a.productId === 'sample-multi')).toBe(false)
  })

  it('emits at most one adjustment per product', () => {
    const ids = schedule.adjustments.map((a) => a.productId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never uses the product-instruction or important severities in seed reasons', () => {
    for (const p of schedule.placements) {
      for (const r of p.reasons) {
        expect(['timing_conflict', 'consideration', 'informational']).toContain(r.severity)
      }
    }
  })
})

describe('buildSchedule — separation rules', () => {
  it('stays silent about coffee when the routine has none', () => {
    const routine: Routine = { ...section5Routine, coffee: null }
    const schedule = buildSchedule(routine, one('sample-iron', 'sample-multi'))
    const iron = schedule.placements.find((p) => p.productIds.includes('sample-iron'))
    expect(iron?.time).toBe('09:30')
    expect(iron?.reasons.map((r) => r.attribute)).not.toContain('SEPARATE_FROM_COFFEE_TEA')
    expect(iron?.reasons.map((r) => r.attribute)).toContain('SEPARATE_FROM_CALCIUM')
  })

  it('moves iron away from coffee alone, rounding up to 15 minutes', () => {
    const routine: Routine = { ...section5Routine, coffee: '07:10' }
    const schedule = buildSchedule(routine, one('sample-iron'))
    expect(schedule.placements.map((p) => [p.time, p.productIds])).toEqual([
      ['09:15', ['sample-iron']],
    ])
    expect(schedule.adjustments).toEqual([
      expect.objectContaining({ productId: 'sample-iron', code: 'MOVED_AWAY_FROM_COFFEE_TEA' }),
    ])
  })

  it('leaves iron at breakfast when nothing conflicts', () => {
    const routine: Routine = { ...section5Routine, coffee: null }
    const schedule = buildSchedule(routine, one('sample-iron'))
    expect(schedule.placements).toHaveLength(1)
    expect(schedule.placements[0]?.time).toBe('07:30')
    expect(schedule.placements[0]?.anchor).toBe('breakfast')
    expect(schedule.placements[0]?.reasons.map((r) => r.attribute)).toEqual(['TAKE_WITH_WATER'])
    expect(schedule.adjustments).toEqual([])
  })

  it('does not emit a calcium reason when no stack product contains calcium', () => {
    const schedule = buildSchedule(
      { ...section5Routine, coffee: null },
      one('sample-iron', 'sample-zinc'),
    )
    const iron = schedule.placements.find((p) => p.productIds.includes('sample-iron'))
    expect(iron?.reasons.map((r) => r.attribute)).not.toContain('SEPARATE_FROM_CALCIUM')
  })
})

describe('buildSchedule — multiple doses per day', () => {
  it('sends the second dose to the next preferred meal (dinner, lunch, breakfast)', () => {
    const schedule = buildSchedule(section5Routine, [
      { productId: 'sample-calmag', dosesPerDay: 2 },
    ])
    expect(schedule.placements.map((p) => [p.time, p.anchor, p.doses])).toEqual([
      // Doses are numbered in time order: the label's first dose of the day is dose 0.
      // `slot` keeps the creation order (the main dose went to dinner, the extra one to lunch).
      ['12:00', 'lunch', [{ productId: 'sample-calmag', doseIndex: 0, slot: 1 }]],
      ['18:00', 'dinner', [{ productId: 'sample-calmag', doseIndex: 1, slot: 0 }]],
    ])
  })

  it('applies separation to every dose', () => {
    const schedule = buildSchedule(section5Routine, [
      { productId: 'sample-iron', dosesPerDay: 2 },
      { productId: 'sample-calmag', dosesPerDay: 1 },
    ])
    expect(schedule.placements.map((p) => [p.time, p.productIds])).toEqual([
      ['09:00', ['sample-iron']],
      ['18:00', ['sample-calmag']],
      ['20:00', ['sample-iron']],
    ])
    // One adjustment per product even when two doses moved.
    expect(schedule.adjustments.filter((a) => a.productId === 'sample-iron')).toHaveLength(1)
  })

  it('caps at four doses and falls back to bedtime once the meals are used', () => {
    const schedule = buildSchedule(section5Routine, [{ productId: 'sample-zinc', dosesPerDay: 4 }])
    expect(schedule.placements.map((p) => p.anchor)).toEqual([
      'breakfast',
      'lunch',
      'dinner',
      'bedtime',
    ])
  })
})

describe('buildSchedule — routine fallbacks', () => {
  it('uses the first available meal when breakfast is skipped', () => {
    const routine: Routine = { ...section5Routine, breakfast: null, coffee: null }
    const schedule = buildSchedule(routine, one('sample-multi', 'sample-zinc'))
    expect(schedule.placements).toEqual([
      expect.objectContaining({
        time: '12:00',
        anchor: 'lunch',
        productIds: ['sample-multi', 'sample-zinc'],
      }),
    ])
    // MORNING resolved to lunch through the fallback chain: nothing moved from baseline.
    expect(schedule.adjustments).toEqual([])
  })

  it('throws on an unknown product id', () => {
    expect(() => buildSchedule(section5Routine, one('nope'))).toThrow(/unknown product/)
  })

  it('groups products that share a time into one placement', () => {
    const schedule = buildSchedule(
      section5Routine,
      one('sample-zinc', 'sample-vitamin-c', 'sample-b-complex'),
    )
    expect(schedule.placements).toHaveLength(1)
    expect(schedule.placements[0]?.productIds).toEqual([
      'sample-zinc',
      'sample-vitamin-c',
      'sample-b-complex',
    ])
  })
})

describe('buildSchedule — many doses, few anchors', () => {
  it('never puts two doses of one product at the same time, even with only two meals', () => {
    const routine: Routine = { ...section5Routine, coffee: null, lunch: null }
    const schedule = buildSchedule(routine, [{ productId: 'sample-zinc', dosesPerDay: 4 }])
    const times = schedule.placements.map((p) => p.time)
    expect(new Set(times).size).toBe(4)
    // breakfast, dinner, bedtime, then the middle of the widest gap (07:30–18:00 → 12:45)
    expect(times).toEqual(['07:30', '12:45', '18:00', '22:00'])
    expect(schedule.placements.map((p) => p.anchor)).toEqual([
      'breakfast',
      null,
      'dinner',
      'bedtime',
    ])
  })

  it('numbers doses chronologically and keeps reasons per dose', () => {
    const routine: Routine = { ...section5Routine, coffee: null, lunch: null }
    const schedule = buildSchedule(routine, [{ productId: 'sample-calmag', dosesPerDay: 4 }])
    const doses = schedule.placements.flatMap((p) => p.doses.map((d) => [p.time, d.doseIndex]))
    expect(doses).toEqual([
      ['07:30', 0],
      ['12:45', 1],
      ['18:00', 2],
      ['22:00', 3],
    ])
    for (const p of schedule.placements) {
      for (const reason of p.reasons) {
        expect(p.doses.some((d) => d.doseIndex === reason.doseIndex)).toBe(true)
      }
    }
  })

  it('splits the widest remaining gap for a fifth dose only when capped', () => {
    const routine: Routine = { ...section5Routine, coffee: null }
    const schedule = buildSchedule(routine, [{ productId: 'sample-zinc', dosesPerDay: 4 }])
    // Three meals + bedtime: no gap splitting needed.
    expect(schedule.placements.map((p) => p.time)).toEqual(['07:30', '12:00', '18:00', '22:00'])
  })
})

describe('buildSchedule — pins (the person chose the time)', () => {
  it('pins a dose to wake-up, an anchor the engine never picks itself', () => {
    const schedule = buildSchedule(section5Routine, [
      { productId: 'sample-multi', dosesPerDay: 1, pins: ['wake'] },
    ])
    expect(schedule.placements.map((p) => [p.time, p.anchor])).toEqual([['06:30', 'wake']])
    expect(schedule.placements[0]?.doses).toEqual([
      { productId: 'sample-multi', doseIndex: 0, slot: 0, pinned: 'wake' },
    ])
    expect(schedule.adjustments).toEqual([
      expect.objectContaining({
        code: 'MOVED_BY_YOU',
        productId: 'sample-multi',
        params: expect.objectContaining({ from: '07:30', to: '06:30' }),
      }),
    ])
  })

  it('beats a fixed-anchor rule', () => {
    const schedule = buildSchedule(section5Routine, [
      { productId: 'sample-magnesium', dosesPerDay: 1, pins: ['lunch'] },
    ])
    expect(schedule.placements.map((p) => [p.time, p.anchor])).toEqual([['12:00', 'lunch']])
    // The bedtime rule's reason only shows when the dose is at bedtime.
    expect(schedule.placements[0]?.reasons.map((r) => r.attribute)).not.toContain('BEDTIME')
  })

  it('falls back like a meal preference when the pinned meal is skipped', () => {
    const schedule = buildSchedule({ ...section5Routine, lunch: null }, [
      { productId: 'sample-multi', dosesPerDay: 1, pins: ['lunch'] },
    ])
    expect(schedule.placements.map((p) => p.anchor)).toEqual(['breakfast'])
  })

  it('moves an unpinned dose of the same product out of the pinned slot', () => {
    const schedule = buildSchedule(section5Routine, [
      { productId: 'sample-calmag', dosesPerDay: 2, pins: [null, 'dinner'] },
    ])
    expect(schedule.placements.map((p) => [p.time, p.doses])).toEqual([
      ['12:00', [{ productId: 'sample-calmag', doseIndex: 0, slot: 0 }]],
      ['18:00', [{ productId: 'sample-calmag', doseIndex: 1, slot: 1, pinned: 'dinner' }]],
    ])
  })

  it('ignores pins beyond the number of doses', () => {
    const schedule = buildSchedule(section5Routine, [
      { productId: 'sample-multi', dosesPerDay: 1, pins: [null, 'bedtime'] },
    ])
    expect(schedule.placements.map((p) => p.anchor)).toEqual(['breakfast'])
    expect(schedule.adjustments).toEqual([])
  })

  it('never moves a pinned dose for a separation rule: the other product moves', () => {
    const schedule = buildSchedule(section5Routine, [
      { productId: 'sample-iron', dosesPerDay: 1, pins: ['breakfast'] },
      { productId: 'sample-multi', dosesPerDay: 1 },
    ])
    expect(schedule.placements.map((p) => [p.time, p.productIds])).toEqual([
      ['07:30', ['sample-iron']],
      ['09:30', ['sample-multi']],
    ])
    const multi = schedule.placements[1]?.reasons.find(
      (r) => r.ruleId === 'rule-iron-separate-calcium',
    )
    expect(multi).toMatchObject({
      ruleId: 'rule-iron-separate-calcium',
      attribute: 'SEPARATE_FROM_IRON',
      params: { otherIngredientId: 'iron', otherProductIds: ['sample-iron'] },
    })
    expect(schedule.adjustments.find((a) => a.productId === 'sample-multi')).toMatchObject({
      code: 'MOVED_AWAY_FROM_INGREDIENT',
      params: { otherIngredientId: 'iron', from: '07:30', to: '09:30' },
    })
    // Coffee can't move and neither can the pinned iron: the reason stays, nothing moves.
    const iron = schedule.placements[0]?.reasons.map((r) => r.attribute)
    expect(iron).toContain('SEPARATE_FROM_COFFEE_TEA')
  })

  it('keeps two pinned, conflicting doses and flags the later one', () => {
    const schedule = buildSchedule(section5Routine, [
      { productId: 'sample-iron', dosesPerDay: 1, pins: ['breakfast'] },
      { productId: 'sample-multi', dosesPerDay: 1, pins: ['wake'] },
    ])
    expect(schedule.placements.map((p) => [p.time, p.productIds])).toEqual([
      ['06:30', ['sample-multi']],
      ['07:30', ['sample-iron']],
    ])
    const conflict = schedule.placements[1]?.reasons.find((r) => r.params.pinnedConflict)
    expect(conflict).toMatchObject({
      productId: 'sample-iron',
      severity: 'timing_conflict',
      attribute: 'SEPARATE_FROM_CALCIUM',
      params: { otherProductIds: ['sample-multi'] },
    })
    expect(schedule.placements[0]?.reasons.some((r) => r.params.pinnedConflict)).toBe(false)
  })

  it('still lets an unpinned product move itself away from a pinned one', () => {
    const schedule = buildSchedule(section5Routine, [
      { productId: 'sample-iron', dosesPerDay: 1 },
      { productId: 'sample-multi', dosesPerDay: 1, pins: ['breakfast'] },
    ])
    expect(schedule.placements.map((p) => [p.time, p.productIds])).toEqual([
      ['07:30', ['sample-multi']],
      ['09:30', ['sample-iron']],
    ])
  })
})
