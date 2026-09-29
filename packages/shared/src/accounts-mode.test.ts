import { describe, expect, it } from 'vitest'
import { accountsOpenTo, emailInDomains, parseAccountsMode, parseEmailDomains } from './index'

describe('accounts launch gate', () => {
  it('parses the three modes and treats anything else as off', () => {
    expect(parseAccountsMode('public')).toBe('public')
    expect(parseAccountsMode(' Staff ')).toBe('staff')
    expect(parseAccountsMode('off')).toBe('off')
    expect(parseAccountsMode('pubic')).toBe('off')
    expect(parseAccountsMode(undefined)).toBe('off')
    expect(parseAccountsMode('')).toBe('off')
  })

  it('parses staff domains', () => {
    expect(parseEmailDomains('newrootsherbal.com, @Example.org ,,')).toEqual([
      'newrootsherbal.com',
      'example.org',
    ])
    expect(parseEmailDomains(undefined)).toEqual([])
  })

  it('matches the exact domain only', () => {
    const domains = ['newrootsherbal.com']
    expect(emailInDomains('Peter@NewRootsHerbal.com', domains)).toBe(true)
    expect(emailInDomains('a@mail.newrootsherbal.com', domains)).toBe(false)
    expect(emailInDomains('a@newrootsherbal.com.evil.test', domains)).toBe(false)
    expect(emailInDomains('newrootsherbal.com', domains)).toBe(false)
    expect(emailInDomains('@newrootsherbal.com', domains)).toBe(false)
  })

  it('opens accounts by mode', () => {
    const staff = ['newrootsherbal.com']
    expect(accountsOpenTo('public', 'a@gmail.com', staff)).toBe(true)
    expect(accountsOpenTo('staff', 'a@gmail.com', staff)).toBe(false)
    expect(accountsOpenTo('staff', 'a@newrootsherbal.com', staff)).toBe(true)
    expect(accountsOpenTo('off', 'a@newrootsherbal.com', staff)).toBe(false)
  })
})
