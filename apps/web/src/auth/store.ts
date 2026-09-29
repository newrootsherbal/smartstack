/**
 * The session token and a pending OAuth attempt live in their own localStorage keys, outside
 * the state blob (build prompt §5.3, §5.4), so clearing the stack never logs anyone in or out.
 */
import type { OAuthIntent, OAuthProviderId } from '@smartstack/shared'

export const SESSION_KEY = 'smartstack:session'
export const OAUTH_KEY = 'smartstack:oauth'
/** The Worker keeps an attempt 10 minutes. */
export const OAUTH_TTL_MS = 10 * 60 * 1000

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Private mode: the session lasts as long as the page.
  }
}

export function getSessionToken(): string | null {
  return read(SESSION_KEY)
}

export function setSessionToken(token: string | null): void {
  write(SESSION_KEY, token)
}

export interface PendingOAuth {
  provider: OAuthProviderId
  intent: OAuthIntent
  state: string
  /** Only this browsing context knows it; its hash went to the Worker. */
  claimSecret: string
  createdAt: number
  /** Where to go once signed in. */
  returnTo: string | null
}

export function getPendingOAuth(now = Date.now()): PendingOAuth | null {
  const raw = read(OAUTH_KEY)
  if (!raw) return null
  try {
    const pending = JSON.parse(raw) as PendingOAuth
    if (typeof pending.state !== 'string' || typeof pending.claimSecret !== 'string') return null
    if (now - pending.createdAt > OAUTH_TTL_MS) {
      write(OAUTH_KEY, null)
      return null
    }
    return pending
  } catch {
    return null
  }
}

export function setPendingOAuth(pending: PendingOAuth | null): void {
  write(OAUTH_KEY, pending ? JSON.stringify(pending) : null)
}
