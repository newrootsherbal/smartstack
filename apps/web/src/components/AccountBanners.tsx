import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { accountApi } from '../api/account'
import { useSessionExpired } from '../auth/sessionStatus'
import { getSessionToken } from '../auth/store'
import { t } from '../i18n'
import { useAppState } from '../state/context'

/** Pages where the banners would talk about what the page itself is doing. */
const QUIET = [
  '/welcome',
  '/signup',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/auth/',
  '/privacy',
  '/terms',
]

/** "Confirm your email · Send again" (non-blocking) and "Log in again" after a 401. */
export function AccountBanners() {
  const { state } = useAppState()
  const location = useLocation()
  const expired = useSessionExpired()
  const [sent, setSent] = useState(false)
  if (state.auth.mode !== 'account') return null
  if (QUIET.some((p) => location.pathname.startsWith(p))) return null

  if (expired) {
    return (
      <p className="notice notice--warn row row--between" role="status">
        <span>{t('account.expired')}</span>
        <Link
          to={`/login?from=${encodeURIComponent(location.pathname)}`}
          className="btn btn--small"
        >
          {t('auth.loginSubmit')}
        </Link>
      </p>
    )
  }
  if (state.auth.emailVerified) return null
  return (
    <p className="notice row row--between" role="status">
      <span>{sent ? t('account.verifySent') : t('account.verifyBanner')}</span>
      {!sent && (
        <button
          type="button"
          className="btn btn--small btn--link"
          onClick={() => {
            const session = getSessionToken()
            if (!session) return
            setSent(true)
            void accountApi.resendVerification(session).catch(() => setSent(false))
          }}
        >
          {t('account.sendAgain')}
        </button>
      )}
    </p>
  )
}
