import { Link, useNavigate } from 'react-router'
import { ProviderButtons } from '../../components/auth/ProviderButtons'
import { t } from '../../i18n'
import { useAppState } from '../../state/context'
import styles from './Welcome.module.css'

/**
 * First open (and existing Phase 1 users, once): sign up, log in, or keep using the app on
 * this device only. Whatever the choice, local data is untouched.
 */
export function Welcome() {
  const { state, dispatch } = useAppState()
  const navigate = useNavigate()

  const guest = () => {
    dispatch({ type: 'SET_GUEST' })
    navigate(state.routine ? '/today' : '/onboarding', { replace: true })
  }

  return (
    <main className={`screen screen--no-nav ${styles.welcome}`}>
      <header className={styles.brand}>
        <img
          src="/nrh-logo.png"
          width={160}
          height={147}
          alt="New Roots Herbal"
          className={styles.logo}
        />
        <h1>{t('welcome.title')}</h1>
        <p className="muted">{t('welcome.tagline')}</p>
      </header>

      <div className={`stack-v ${styles.actions}`}>
        <ProviderButtons />
        <Link to="/signup" className="btn btn--primary">
          {t('welcome.email')}
        </Link>
        <Link to="/login" className="btn btn--outline">
          {t('welcome.login')}
        </Link>
      </div>

      <div className={`stack-v ${styles.guest}`}>
        <button type="button" className="btn btn--link" onClick={guest}>
          {t('welcome.guest')}
        </button>
        <p className="small muted">{t('notice.N1')}</p>
      </div>
    </main>
  )
}
