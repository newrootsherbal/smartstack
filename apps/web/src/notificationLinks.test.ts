import { describe, expect, it } from 'vitest'
import { NEWS_OFF_PATH, newsOffLabel, notificationTarget } from './notificationLinks'

const ORIGIN = 'https://schedule.flourishbodyandmind.com'

describe('notificationTarget', () => {
  it('opens our own pages', () => {
    expect(notificationTarget('/today', ORIGIN)).toBe(`${ORIGIN}/today`)
    expect(notificationTarget(NEWS_OFF_PATH, ORIGIN)).toBe(`${ORIGIN}/notifications?news=off`)
    expect(notificationTarget(`${ORIGIN}/shopping`, ORIGIN)).toBe(`${ORIGIN}/shopping`)
  })

  it('opens New Roots Herbal pages over https only', () => {
    const page = 'https://newrootsherbal.com/shop/x?utm_source=smartstack&utm_medium=push'
    expect(notificationTarget(page, ORIGIN)).toBe(page)
    expect(notificationTarget('https://www.newrootsherbal.com/webinar', ORIGIN)).toBe(
      'https://www.newrootsherbal.com/webinar',
    )
    expect(notificationTarget('http://newrootsherbal.com/x', ORIGIN)).toBe(`${ORIGIN}/today`)
  })

  it('opens the app for anything else', () => {
    for (const bad of [
      'https://evil.example/',
      'https://newrootsherbal.com.evil.example/',
      'https://user:pw@newrootsherbal.com/',
      'https://newrootsherbal.com:8443/',
      'javascript:alert(1)',
      'data:text/html,hi',
      '',
      null,
      42,
    ]) {
      expect(notificationTarget(bad, ORIGIN), String(bad)).toBe(`${ORIGIN}/today`)
    }
  })
})

describe('newsOffLabel', () => {
  it('follows the payload language, else the browser', () => {
    expect(newsOffLabel('fr', 'en-CA')).toBe('Désactiver les nouvelles')
    expect(newsOffLabel('en', 'fr-CA')).toBe('Turn off news')
    expect(newsOffLabel(undefined, 'fr-CA')).toBe('Désactiver les nouvelles')
    expect(newsOffLabel(undefined, 'en-US')).toBe('Turn off news')
  })
})
