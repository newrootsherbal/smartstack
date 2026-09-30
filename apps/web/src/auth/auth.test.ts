import type { AccountView } from '@smartstack/shared'
import { describe, expect, it } from 'vitest'
import { afterSignInPath, safeReturnTo } from '../screens/auth/navigation'
import { defaultState } from '../storage'
import { authFromAccount } from './view'

const account: AccountView = {
  id: 'acc-1',
  email: 'a@example.com',
  emailVerified: false,
  name: 'Ann',
  locale: 'fr',
  role: 'user',
  providers: ['google'],
  hasPassword: true,
  consentNeeded: false,
}

describe('account on the device', () => {
  it('keeps what the app needs from the Worker’s view', () => {
    expect(authFromAccount(account)).toEqual({
      mode: 'account',
      accountId: 'acc-1',
      email: 'a@example.com',
      name: 'Ann',
      role: 'user',
      emailVerified: false,
      providers: ['password', 'google'],
      consentNeeded: false,
    })
    expect(authFromAccount({ ...account, hasPassword: false }).providers).toEqual(['google'])
  })
})

describe('where sign-in leads', () => {
  const onboarded = {
    ...defaultState(),
    routine: {
      wake: '07:00',
      bedtime: '22:00',
      coffee: null,
      breakfast: '08:00',
      lunch: null,
      dinner: null,
      exercise: null,
    },
  }

  it('only returns to paths inside the app', () => {
    expect(safeReturnTo('/profile')).toBe('/profile')
    expect(safeReturnTo('//evil.example')).toBeNull()
    // Browsers treat a backslash like a slash: "/\evil" would leave the origin too.
    expect(safeReturnTo('/\\evil.example')).toBeNull()
    expect(safeReturnTo('https://evil.example')).toBeNull()
    expect(safeReturnTo(null)).toBeNull()
  })

  it('asks for consent first, then goes back, else to Today or onboarding', () => {
    expect(afterSignInPath({ ...account, consentNeeded: true }, onboarded, '/profile', true)).toBe(
      '/auth/consent?new=1&from=%2Fprofile',
    )
    expect(afterSignInPath(account, onboarded, '/profile')).toBe('/profile')
    expect(afterSignInPath(account, onboarded, null)).toBe('/today')
    expect(afterSignInPath(account, defaultState(), null)).toBe('/onboarding')
  })
})
