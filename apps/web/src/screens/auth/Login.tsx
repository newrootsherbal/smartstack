import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { accountApi } from '../../api/account'
import { authErrorMessage, completeSignIn } from '../../auth/flows'
import { derivePasswordKey } from '../../auth/kdf'
import styles from '../../components/auth/Auth.module.css'
import { PasswordField } from '../../components/auth/PasswordField'
import { ProviderButtons } from '../../components/auth/ProviderButtons'
import { t } from '../../i18n'
import { platformName } from '../../platform/detect'
import { useAppState } from '../../state/context'
import { afterSignInPath, safeReturnTo } from './navigation'

/** Email + password or Google. One generic error, whatever was wrong. */
export function Login() {
  const { state, dispatch } = useAppState()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const returnTo = safeReturnTo(params.get('from'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    if (!email.trim() || !password) return setError(t('auth.error.invalidCredentials'))
    setBusy(true)
    try {
      const key = await derivePasswordKey(email, password)
      const result = await accountApi.login({ email: email.trim(), key, platform: platformName() })
      // `rehash` asks for a key with newer stretching parameters; only version 1 exists so far.
      completeSignIn(result.token, result.account, state, dispatch)
      navigate(afterSignInPath(result.account, state, returnTo), { replace: true })
    } catch (err) {
      setError(authErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <main className="screen screen--no-nav">
      <h1>{t('auth.loginTitle')}</h1>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        noValidate
      >
        <ProviderButtons returnTo={returnTo} />
        <p className={styles.divider}>{t('auth.or')}</p>
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
        <PasswordField
          label={t('auth.password')}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        {error && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? t('auth.loggingIn') : t('auth.loginSubmit')}
        </button>
        <Link to="/forgot-password" className="small">
          {t('auth.forgotLink')}
        </Link>
        <p className="small">
          {t('auth.noAccount')}{' '}
          <Link to={returnTo ? `/signup?from=${encodeURIComponent(returnTo)}` : '/signup'}>
            {t('auth.signupLink')}
          </Link>
        </p>
      </form>
    </main>
  )
}
