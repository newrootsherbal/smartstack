import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { accountApi } from '../../api/account'
import { authErrorMessage, deleteAccount, signOut } from '../../auth/flows'
import { getSessionToken } from '../../auth/store'
import { AccountConsents } from '../../components/auth/AccountConsents'
import styles from '../../components/auth/Auth.module.css'
import { t } from '../../i18n'
import { useAppState } from '../../state/context'
import { safeReturnTo } from './navigation'

/**
 * The account consents (C1, C2, C3) for accounts created through Google, and again for anyone
 * when CONSENT_VERSION changes. Nothing syncs before it. Declining deletes an account that was
 * just created; an existing account is logged out on this device instead.
 */
export function AuthConsent() {
  const { state, dispatch } = useAppState()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const isNew = params.get('new') === '1'
  const returnTo = safeReturnTo(params.get('from'))
  const [consent, setConsent] = useState(false)
  const [age14, setAge14] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const session = getSessionToken()

  const accept = async () => {
    setError(null)
    if (!consent || !age14) return setError(t('auth.error.consents'))
    if (!session) return navigate('/login', { replace: true })
    setBusy(true)
    try {
      const account = await accountApi.consent(session)
      dispatch({ type: 'SET_ACCOUNT', account })
      navigate(returnTo ?? (state.routine ? '/today' : '/onboarding'), { replace: true })
    } catch (err) {
      setError(authErrorMessage(err))
      setBusy(false)
    }
  }

  const decline = async () => {
    if (isNew && !window.confirm(t('auth.consentDeclineConfirm'))) return
    setBusy(true)
    try {
      if (isNew && session) await deleteAccount(session, state, dispatch)
      else await signOut(session, state, dispatch)
      navigate('/welcome', { replace: true })
    } catch (err) {
      setError(authErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <main className="screen screen--no-nav">
      <h1>{t('auth.consentTitle')}</h1>
      <div className={styles.form}>
        <p className="muted">{t('auth.consentIntro')}</p>
        <AccountConsents
          consent={consent}
          age14={age14}
          onConsent={setConsent}
          onAge14={setAge14}
        />
        {error && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => void accept()}
        >
          {t('auth.consentAccept')}
        </button>
        <button
          type="button"
          className="btn btn--link"
          disabled={busy}
          onClick={() => void decline()}
        >
          {isNew ? t('auth.consentDeclineNew') : t('auth.consentDecline')}
        </button>
      </div>
    </main>
  )
}
