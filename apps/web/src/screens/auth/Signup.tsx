import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@smartstack/shared'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { accountApi } from '../../api/account'
import { authErrorMessage, completeSignIn } from '../../auth/flows'
import { derivePasswordKey } from '../../auth/kdf'
import { AccountConsents } from '../../components/auth/AccountConsents'
import styles from '../../components/auth/Auth.module.css'
import { PasswordField } from '../../components/auth/PasswordField'
import { ProviderButtons } from '../../components/auth/ProviderButtons'
import { getLocale, t } from '../../i18n'
import { platformName } from '../../platform/detect'
import { useAppState } from '../../state/context'
import { afterSignInPath, safeReturnTo } from './navigation'

/** Email sign-up: the password is stretched on the device before anything is sent. */
export function Signup() {
  const { state, dispatch } = useAppState()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const returnTo = safeReturnTo(params.get('from'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [consent, setConsent] = useState(false)
  const [age14, setAge14] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(t('auth.error.email'))
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      return setError(t('auth.error.passwordLength'))
    }
    if (!consent || !age14) return setError(t('auth.error.consents'))
    setBusy(true)
    try {
      const key = await derivePasswordKey(email, password)
      const result = await accountApi.signup({
        email: email.trim(),
        key,
        ...(name.trim() ? { name: name.trim() } : {}),
        locale: getLocale(),
        consent: true,
        age14: true,
        platform: platformName(),
      })
      completeSignIn(result.token, result.account, state, dispatch)
      navigate(afterSignInPath(result.account, state, returnTo), { replace: true })
    } catch (err) {
      setError(authErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <main className="screen screen--no-nav">
      <h1>{t('auth.signupTitle')}</h1>
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
          autoComplete="new-password"
          hint={t('auth.passwordHint')}
        />
        <label className="field">
          <span className="field__label">{t('auth.firstName')}</span>
          <input
            className="input"
            autoComplete="given-name"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
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
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? t('auth.creating') : t('auth.signupSubmit')}
        </button>
        <p className="small">
          {t('auth.haveAccount')}{' '}
          <Link to={returnTo ? `/login?from=${encodeURIComponent(returnTo)}` : '/login'}>
            {t('auth.loginLink')}
          </Link>
        </p>
      </form>
    </main>
  )
}
