/**
 * Forgot password, reset password and email verification. The emailed token travels in the URL
 * fragment (never sent to a server); it is read once and stripped from the address bar. On an
 * iPhone these links open in Safari, whose storage is separate from the Home Screen app, so the
 * pages never assume a session and end by sending the person back to the app.
 */
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@smartstack/shared'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { accountApi } from '../../api/account'
import { authErrorMessage } from '../../auth/flows'
import { derivePasswordKey } from '../../auth/kdf'
import { getSessionToken } from '../../auth/store'
import styles from '../../components/auth/Auth.module.css'
import { PasswordField } from '../../components/auth/PasswordField'
import { t } from '../../i18n'
import { useAppState } from '../../state/context'

/** `#token=…&email=…` → values, then the fragment is removed from the address bar. */
function useFragment(): URLSearchParams {
  const [params] = useState(() => new URLSearchParams(window.location.hash.slice(1)))
  useEffect(() => {
    if (window.location.hash) {
      history.replaceState(history.state, '', window.location.pathname + window.location.search)
    }
  }, [])
  return params
}

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(t('auth.error.email'))
    setBusy(true)
    try {
      await accountApi.forgotPassword({ email: email.trim() })
      setSent(true)
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="screen screen--no-nav">
      <h1>{t('auth.forgotTitle')}</h1>
      {sent ? (
        <p className="notice" role="status">
          {t('auth.forgotSent')}
        </p>
      ) : (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          noValidate
        >
          <p className="muted">{t('auth.forgotIntro')}</p>
          <label className="field">
            <span className="field__label">{t('auth.email')}</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {error && (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {t('auth.forgotSubmit')}
          </button>
        </form>
      )}
      <Link to="/login" className="small">
        {t('auth.backToLogin')}
      </Link>
    </main>
  )
}

export function ResetPassword() {
  const fragment = useFragment()
  const token = fragment.get('token')
  const [email, setEmail] = useState(fragment.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    if (!token) return setError(t('auth.error.invalidToken'))
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(t('auth.error.email'))
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      return setError(t('auth.error.passwordLength'))
    }
    setBusy(true)
    try {
      const key = await derivePasswordKey(email, password)
      await accountApi.resetPassword({ token, key, email: email.trim() })
      setDone(true)
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="screen screen--no-nav">
      <h1>{t('auth.resetTitle')}</h1>
      {done ? (
        <div className="stack-v">
          <p className="notice" role="status">
            {t('auth.resetDone')}
          </p>
          <Link to="/login" className="btn btn--primary">
            {t('auth.loginSubmit')}
          </Link>
        </div>
      ) : !token ? (
        <p className="notice notice--warn">{t('auth.error.invalidToken')}</p>
      ) : (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          noValidate
        >
          <label className="field">
            <span className="field__label">{t('auth.email')}</span>
            <input
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <PasswordField
            label={t('auth.newPassword')}
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            hint={t('auth.passwordHint')}
          />
          {error && (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {t('auth.resetSubmit')}
          </button>
        </form>
      )}
    </main>
  )
}

export function VerifyEmail() {
  const { dispatch } = useAppState()
  const fragment = useFragment()
  const token = fragment.get('token')
  const [status, setStatus] = useState<'working' | 'done' | 'failed'>(token ? 'working' : 'failed')
  const [error, setError] = useState<string | null>(token ? null : t('auth.error.invalidToken'))
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    void (async () => {
      try {
        await accountApi.verifyEmail(token)
        setStatus('done')
        // When the app's own session is here too, show the confirmed address right away.
        const session = getSessionToken()
        if (session) {
          const account = await accountApi.getAccount(session).catch(() => null)
          if (account) dispatch({ type: 'SET_ACCOUNT', account })
        }
      } catch (err) {
        setError(authErrorMessage(err))
        setStatus('failed')
      }
    })()
  }, [token, dispatch])

  return (
    <main className="screen screen--no-nav">
      <h1>{t('auth.verifyTitle')}</h1>
      {status === 'working' && <p className="muted">{t('common.loading')}</p>}
      {status === 'done' && (
        <p className="notice" role="status">
          {t('auth.verifyDone')}
        </p>
      )}
      {status === 'failed' && error && <p className="notice notice--warn">{error}</p>}
    </main>
  )
}
