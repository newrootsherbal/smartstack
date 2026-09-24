import { describe, expect, it } from 'vitest'
import { SHARED_VERSION } from './index'

describe('@smartstack/shared', () => {
  it('exports a version', () => {
    expect(SHARED_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
