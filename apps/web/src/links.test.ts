import { describe, expect, it } from 'vitest'
import { buyOnlineUrl } from './links'

describe('buyOnlineUrl', () => {
  it('adds the shopping-list campaign tags to the product page', () => {
    expect(buyOnlineUrl('https://newrootsherbal.com/products/iron-bisglycinate')).toBe(
      'https://newrootsherbal.com/products/iron-bisglycinate?utm_source=smartstack&utm_medium=app&utm_campaign=shopping_list',
    )
  })

  it('keeps an existing query string', () => {
    expect(buyOnlineUrl('https://newrootsherbal.com/p?variant=2')).toContain(
      'variant=2&utm_source=',
    )
  })
})
