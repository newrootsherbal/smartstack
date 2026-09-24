import type { Routine } from '@smartstack/shared'
import { describe, expect, it } from 'vitest'
import { shiftRoutine } from './shift'
import { parseHHMM } from './time'

const routine: Routine = {
  wake: '07:00',
  coffee: '07:30',
  breakfast: '08:00',
  lunch: '12:00',
  dinner: '18:00',
  exercise: null,
  bedtime: '22:30',
}

describe('shiftRoutine ("I\'m running late")', () => {
  it('shifts only anchors still in the future', () => {
    expect(shiftRoutine(routine, parseHHMM('10:00'), 60)).toEqual({
      wake: '07:00',
      coffee: '07:30',
      breakfast: '08:00',
      lunch: '13:00',
      dinner: '19:00',
      exercise: null,
      bedtime: '23:30',
    })
  })

  it('caps at 23:59 and keeps disabled anchors null', () => {
    const shifted = shiftRoutine(routine, parseHHMM('22:00'), 120)
    expect(shifted.bedtime).toBe('23:59')
    expect(shifted.exercise).toBeNull()
    expect(shifted.dinner).toBe('18:00')
  })

  it('treats an anchor exactly at "now" as still to come', () => {
    expect(shiftRoutine(routine, parseHHMM('12:00'), 30).lunch).toBe('12:30')
  })
})
