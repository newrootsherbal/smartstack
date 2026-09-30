import { catalogue, getProduct } from '@smartstack/engine'
import { describe, expect, it } from 'vitest'
import { bottleFromDraft, bottleStatus, initialBottleDraft } from './bottle'

const iron = getProduct('iron-bisglycinate')!
const broth = getProduct('beef-bone-broth-protein')!

describe('bottle questions', () => {
  it('knows the size from the scanned barcode, so nothing is asked', () => {
    const draft = initialBottleDraft(iron, '628747131865')
    expect(draft).toMatchObject({ mode: 'new', sizeUpc: '628747131865', scanned: true, full: '60' })
    expect(bottleFromDraft(draft, iron)).toEqual({
      kind: 'bottle',
      bottle: { remaining: 60, unit: 'unit', packageSize: 60 },
      variantUpc: '628747131865',
    })
  })

  it('offers size chips when the product was browsed and has several sizes', () => {
    const draft = initialBottleDraft(iron, null)
    expect(draft.sizeUpc).toBeNull()
    expect(bottleFromDraft(draft, iron)).toEqual({ kind: 'invalid' })
    const picked = { ...draft, sizeUpc: '628747118989' }
    expect(bottleFromDraft(picked, iron)).toMatchObject({ bottle: { remaining: 30 } })
  })

  it('counts powders in servings from the only size', () => {
    const draft = initialBottleDraft(broth, null)
    expect(bottleFromDraft(draft, broth)).toEqual({
      kind: 'bottle',
      bottle: { remaining: 10, unit: 'serving', packageSize: 10 },
      variantUpc: '628747022934',
    })
  })

  it('asks how many are left in an opened bottle (decimals allowed)', () => {
    const draft = { ...initialBottleDraft(broth, null), mode: 'opened' as const }
    expect(bottleFromDraft(draft, broth)).toEqual({ kind: 'invalid' })
    expect(bottleFromDraft({ ...draft, left: '3,5' }, broth)).toMatchObject({
      bottle: { remaining: 3.5, unit: 'serving', packageSize: 10 },
    })
  })

  it("tracks nothing for Don't track", () => {
    const draft = { ...initialBottleDraft(iron, null), mode: 'none' as const }
    expect(bottleFromDraft(draft, iron)).toEqual({ kind: 'none' })
  })

  it('writes the status line', () => {
    const entry = {
      productId: 'iron-bisglycinate',
      dosesPerDay: 2,
      addedAt: 0,
      updatedAt: 0,
      inventory: { remaining: 68, unit: 'unit' as const, packageSize: 120, lowFlaggedAt: null },
    }
    expect(bottleStatus(entry, catalogue)).toBe('68 capsules left · about 34 days')
    expect(
      bottleStatus({ ...entry, inventory: { ...entry.inventory, remaining: 1 } }, catalogue),
    ).toBe('1 capsule left · Empty')
    expect(bottleStatus({ ...entry, inventory: undefined }, catalogue)).toBeNull()
  })
})
