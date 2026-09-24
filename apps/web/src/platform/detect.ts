import { Capacitor } from '@capacitor/core'
import type { Platform } from '@smartstack/shared'

/** Native later (Capacitor); web now. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const iDevice = /iPad|iPhone|iPod/.test(ua)
  // iPadOS 13+ reports itself as a Mac; touch points give it away.
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return iDevice || iPadOS
}

export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent)
}

/** True when running as an installed app (Home Screen / app window). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (navigator.standalone === true) return true
  return window.matchMedia?.('(display-mode: standalone)').matches ?? false
}

export function platformName(): Platform {
  if (isNative()) {
    const p = Capacitor.getPlatform()
    return p === 'ios' ? 'ios' : p === 'android' ? 'android' : 'desktop'
  }
  if (isIOS()) return 'ios'
  if (isAndroid()) return 'android'
  return 'desktop'
}

/**
 * iOS storage is separate between a Safari tab and a Home Screen app, so on
 * iOS the install gate comes before onboarding. Android shares storage.
 */
export function needsIOSInstallGate(): boolean {
  return !isNative() && isIOS() && !isStandalone()
}
