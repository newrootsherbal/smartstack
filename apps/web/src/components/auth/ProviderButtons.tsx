import type { OAuthIntent, OAuthProviderId } from '@smartstack/shared'
import { useState } from 'react'
import { authErrorMessage, startOAuth } from '../../auth/flows'
import { getSessionToken } from '../../auth/store'
import { APPLE_ENABLED } from '../../config'
import { getLocale, t } from '../../i18n'
import styles from './Auth.module.css'

/** Google's "G", from Google's sign-in branding guidelines (inline: no provider script or CDN). */
function GoogleLogo() {
  return (
    <svg className={styles.providerLogo} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

/** Apple's logo, for "Continue with Apple" (rendered only once Sign in with Apple is enabled). */
function AppleLogo() {
  return (
    <svg className={styles.providerLogo} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.37 12.77c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.59 1.1 8.75.73 1.05 1.6 2.23 2.73 2.19 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.83-1.22 1.18-2.4 1.2-2.46-.03-.01-2.3-.88-2.29-3.51zM14.2 6.3c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.64-1.05 1.68-.92 2.67.97.08 1.96-.49 2.56-1.22z"
      />
    </svg>
  )
}

interface ProviderButtonsProps {
  intent?: OAuthIntent
  /** Where to go once signed in (the screen that asked). */
  returnTo?: string | null
}

/** "Continue with Google" (and Apple later): a plain redirect, never the provider's script. */
export function ProviderButtons({ intent = 'login', returnTo = null }: ProviderButtonsProps) {
  const [busy, setBusy] = useState<OAuthProviderId | null>(null)
  const [error, setError] = useState<string | null>(null)

  const start = (provider: OAuthProviderId) => {
    setBusy(provider)
    setError(null)
    void startOAuth(provider, intent, getLocale(), returnTo, getSessionToken()).catch(
      (err: unknown) => {
        setBusy(null)
        setError(authErrorMessage(err))
      },
    )
  }

  return (
    <div className="stack-v">
      <button
        type="button"
        className={`btn ${styles.provider}`}
        onClick={() => start('google')}
        disabled={busy !== null}
      >
        <GoogleLogo />
        <span>{t('auth.google')}</span>
      </button>
      {APPLE_ENABLED && (
        <button
          type="button"
          className={`btn ${styles.provider} ${styles.apple}`}
          onClick={() => start('apple')}
          disabled={busy !== null}
        >
          <AppleLogo />
          <span>{t('auth.apple')}</span>
        </button>
      )}
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
