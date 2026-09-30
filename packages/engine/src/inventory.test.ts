import { describe, expect, it } from 'vitest'
import { catalogue, getProduct } from './catalogue'
import {
  applyTick,
  dailyUse,
  daysLeft,
  inventoryUnitFor,
  isLow,
  parsePackageSize,
  productSizes,
  refill,
  undoTick,
  unitsPerDose,
} from './inventory'

describe('parsePackageSize', () => {
  it('counts capsules, softgels and tablets one by one', () => {
    expect(parsePackageSize('120', 'capsule', '1 capsule')).toEqual({ quantity: 120, unit: 'unit' })
    expect(parsePackageSize('90s', 'capsule', '1 capsule')).toEqual({ quantity: 90, unit: 'unit' })
    expect(parsePackageSize('120 (instead of 90)', 'capsule', '1 capsule')?.quantity).toBe(120)
    expect(parsePackageSize('Kit', 'capsule', '1 capsule')).toBeNull()
    expect(parsePackageSize(undefined, 'tablet', '1 tablet')).toBeNull()
  })

  it('reads servings printed on the label', () => {
    expect(parsePackageSize('100 g = 32 doses', 'powder', '1 tsp')).toEqual({
      quantity: 32,
      unit: 'serving',
    })
    expect(parsePackageSize('150 g / 50 portions', 'powder', '1 scoop')?.quantity).toBe(50)
    expect(parsePackageSize('30 ml · 1,050 Servings', 'liquid', '1 drop')?.quantity).toBe(1050)
    expect(parsePackageSize('454 g / ≈ 22 doses', 'powder', '1 scoop')?.quantity).toBe(22)
    expect(parsePackageSize('30 × 4.2 g', 'powder', '1 scoop (4.2 g)')?.quantity).toBe(30)
  })

  it('divides the bottle by the serving when both are in ml or in g', () => {
    expect(parsePackageSize('300 g', 'powder', '3 rounded tbsp. (30 g)')).toEqual({
      quantity: 10,
      unit: 'serving',
    })
    expect(parsePackageSize('50 ml', 'liquid', '1 ml (40 drops)')?.quantity).toBe(50)
    expect(parsePackageSize('500 ml', 'liquid', '1 tablespoon (15 ml)')?.quantity).toBe(33.3)
    expect(parsePackageSize('1 litre', 'liquid', '1 teaspoon (5 ml)')?.quantity).toBe(200)
    expect(parsePackageSize('100 g', 'powder', '¼ teaspoon (1,090 mg)')?.quantity).toBe(91.7)
    // Different units, or a serving with no metric amount: ask the person.
    expect(parsePackageSize('300 g', 'powder', '1 tbsp. (15 ml)')).toBeNull()
    expect(parsePackageSize('150 g', 'powder', '1 scoop')).toBeNull()
  })

  it('converts household measures of a liquid: teaspoons, tablespoons, drops', () => {
    expect(parsePackageSize('50 ml', 'liquid', '1 teaspoon')?.quantity).toBe(10)
    expect(parsePackageSize('95 ml', 'liquid', '½ teaspoon')?.quantity).toBe(38)
    expect(parsePackageSize('100 ml', 'liquid', '1/2 tsp.')?.quantity).toBe(40)
    expect(parsePackageSize('500 ml', 'liquid', '1 tablespoon')?.quantity).toBe(33.3)
    expect(parsePackageSize('500 ml', 'liquid', '1 c. à soupe')?.quantity).toBe(33.3)
    expect(parsePackageSize('15 ml', 'liquid', '1 drop')?.quantity).toBe(300)
    expect(parsePackageSize('15 ml', 'liquid', '6 drops')?.quantity).toBe(50)
    expect(parsePackageSize('30 ml', 'liquid', '2 gouttes')?.quantity).toBe(300)
    // A teaspoon of powder has no fixed weight: the label's grams are needed.
    expect(parsePackageSize('227 g', 'powder', '1 teaspoon')).toBeNull()
    expect(parsePackageSize('100 g', 'powder', '1 rounded teaspoon')).toBeNull()
    // Not measures at all.
    expect(parsePackageSize('15 ml', 'liquid', '1 bottle')).toBeNull()
    expect(parsePackageSize('50 ml', 'liquid', '1 liquid')).toBeNull()
  })

  it('parses the catalogue: every countable size, and prints the rate', () => {
    let total = 0
    let parsed = 0
    let countable = 0
    let countableParsed = 0
    const misses: string[] = []
    for (const product of catalogue.products) {
      for (const v of product.variants ?? []) {
        total++
        const text = v.size?.en ?? ''
        const result = parsePackageSize(text, product.form, product.servingSize)
        if (result) parsed++
        const unit = inventoryUnitFor(product.form)
        const isCountable =
          unit === 'unit'
            ? /^\d/.test(text)
            : // Servings printed on the label, or a serving the label measures in ml or g.
              /doses|portions|servings|×/i.test(text) ||
              /\d\s*(?:ml|g|mg|grams?)\b/i.test(product.servingSize)
        if (isCountable) {
          countable++
          if (result) countableParsed++
          else misses.push(`${product.id}: ${text}`)
        }
      }
    }
    // The engine has no DOM or Node types; the runner still has a console.
    ;(globalThis as unknown as { console: { log: (line: string) => void } }).console.log(
      `parsePackageSize: ${parsed}/${total} variant sizes parsed (${((parsed / total) * 100).toFixed(1)} %); ` +
        `${countableParsed}/${countable} countable (${((countableParsed / countable) * 100).toFixed(1)} %)`,
    )
    expect(total).toBeGreaterThan(500)
    expect(misses).toEqual([])
    expect(countableParsed / countable).toBeGreaterThanOrEqual(0.95)
    // Plain counts are the bulk of the catalogue and must all parse.
    expect(parsed / total).toBeGreaterThan(0.8)
  })

  it('lists a product’s sizes for the size chips', () => {
    const iron = getProduct('iron-bisglycinate')!
    const sizes = productSizes(iron)
    expect(sizes.length).toBeGreaterThanOrEqual(2)
    for (const s of sizes) expect(s.size?.unit).toBe('unit')
  })
})

describe('bottle arithmetic', () => {
  it('uses the label, the person or one serving per dose', () => {
    expect(unitsPerDose('unit', { unitsPerDose: 2 })).toBe(2)
    expect(unitsPerDose('unit', {}, 3)).toBe(3)
    expect(unitsPerDose('unit', {})).toBe(1)
    expect(unitsPerDose('serving', { unitsPerDose: 2 })).toBe(1)
    expect(dailyUse(2, 2)).toBe(4)
  })

  it('refills 5 + 30 = 35', () => {
    expect(refill(5, 30)).toBe(35)
    expect(refill(0.3, 0.1)).toBe(0.4)
  })

  it('ticks never below zero and unticks exactly what was taken', () => {
    expect(applyTick(10, 2)).toEqual({ remaining: 8, taken: 2 })
    expect(applyTick(1, 2)).toEqual({ remaining: 0, taken: 1 })
    expect(undoTick(0, 1)).toBe(1)
    expect(applyTick(0.3, 0.1)).toEqual({ remaining: 0.2, taken: 0.1 })
  })

  it('floors the days left and flags five days or less', () => {
    expect(daysLeft(68, 2)).toBe(34)
    expect(daysLeft(9, 2)).toBe(4)
    expect(daysLeft(1, 2)).toBe(0)
    expect(isLow(10, 2)).toBe(true)
    expect(isLow(11, 2)).toBe(false)
    expect(isLow(0, 0)).toBe(false)
  })
})
