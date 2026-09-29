import { Link } from 'react-router'
import { t } from '../../i18n'
import styles from './Auth.module.css'
import { ConsentText } from './ConsentText'

interface AccountConsentsProps {
  consent: boolean
  age14: boolean
  onConsent: (checked: boolean) => void
  onAge14: (checked: boolean) => void
}

/**
 * C1 and C2 (two required, unticked checkboxes) and C3 under them. The terms are a contract of
 * adhesion under the Charter of the French language, so C3 links both versions, French first,
 * whatever the app language.
 */
export function AccountConsents({ consent, age14, onConsent, onAge14 }: AccountConsentsProps) {
  const external = { target: '_blank', rel: 'noopener noreferrer' } as const
  return (
    <div className="stack-v">
      <label className={styles.check}>
        <input type="checkbox" checked={consent} onChange={(e) => onConsent(e.target.checked)} />
        <span>
          <ConsentText
            text={t('consent.C1')}
            link={(words) => (
              <Link to="/privacy" {...external}>
                {words}
              </Link>
            )}
          />
        </span>
      </label>
      <label className={styles.check}>
        <input type="checkbox" checked={age14} onChange={(e) => onAge14(e.target.checked)} />
        <span>{t('consent.C2')}</span>
      </label>
      <p className="small muted">
        <ConsentText
          text={t('consent.C3')}
          link={() => (
            <>
              <Link to="/terms?lang=fr" lang="fr" {...external}>
                Conditions d’utilisation
              </Link>
              {' · '}
              <Link to="/terms?lang=en" lang="en" {...external}>
                Terms of Use
              </Link>
            </>
          )}
        />
      </p>
    </div>
  )
}
