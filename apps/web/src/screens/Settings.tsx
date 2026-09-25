import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { catalogue } from '@smartstack/engine'
import { api } from '../api/client'
import { t, type Locale, type MessageKey } from '../i18n'
import { unsubscribe } from '../platform/reminders'
import { useAppState } from '../state/context'
import { clearState, defaultState } from '../storage'
import { THEMES } from '../themes'
import styles from './Settings.module.css'

/** Each language names itself, whatever the current one is. */
const LANGUAGES: { locale: Locale; label: MessageKey }[] = [
  { locale: 'en', label: 'settings.english' },
  { locale: 'fr', label: 'settings.french' },
]

export function Settings() {
  const { state, dispatch } = useAppState()
  const navigate = useNavigate()
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const deleteEverything = async () => {
    if (!window.confirm(t('settings.deleteConfirm'))) return
    setBusy(true)
    let serverFailed = false
    try {
      // Only ever talked to the server if reminders were turned on.
      if (state.pushState.status === 'subscribed' || state.lastSync !== null) {
        await api.deleteMe(state.userId).catch(() => {
          serverFailed = true
        })
      }
      await unsubscribe().catch(() => undefined)
    } finally {
      clearState()
      dispatch({ type: 'RESET', state: { ...defaultState(), theme: state.theme } })
      setBusy(false)
      if (serverFailed) {
        setNotice(t('settings.deleteFailedServer'))
        window.setTimeout(() => navigate('/onboarding', { replace: true }), 2500)
      } else {
        navigate('/onboarding', { replace: true })
      }
    }
  }

  return (
    <main className="screen">
      <h1>{t('settings.title')}</h1>

      <section className="card stack-v">
        <h2>{t('settings.routine')}</h2>
        <Link to="/onboarding?edit=1" className="btn btn--outline">
          {t('settings.editRoutine')}
        </Link>
      </section>

      <section className="card stack-v">
        <h2>{t('settings.timezone')}</h2>
        <p>{state.tz}</p>
        <p className="small muted">{t('settings.timezoneNote')}</p>
      </section>

      <section className="card stack-v">
        <h2>{t('settings.language')}</h2>
        <div className="row">
          {LANGUAGES.map(({ locale, label }) => (
            <button
              key={locale}
              type="button"
              lang={locale}
              aria-pressed={state.locale === locale}
              className={`btn btn--small ${state.locale === locale ? 'btn--primary' : 'btn--outline'}`}
              onClick={() => dispatch({ type: 'SET_LOCALE', locale })}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </section>

      <section className="card stack-v">
        <h2>{t('settings.theme')}</h2>
        <p className="small muted">{t('settings.themeHint')}</p>
        <div className={styles.themes} role="radiogroup" aria-label={t('settings.theme')}>
          {THEMES.map(({ id, emoji }) => {
            const selected = state.theme === id
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`${styles.theme} ${selected ? styles.themeSelected : ''}`}
                onClick={() => dispatch({ type: 'SET_THEME', theme: id })}
              >
                <span className={styles.preview} data-theme={id} aria-hidden="true">
                  <span className={styles.previewCard}>
                    <span className={styles.previewHeader} />
                    <span className={styles.previewRow} />
                    <span className={styles.previewRow} />
                  </span>
                  <span className={styles.previewButtons}>
                    <span className={styles.previewPrimary} />
                    <span className={styles.previewAccent} />
                  </span>
                </span>
                <span className={styles.themeName}>
                  <span aria-hidden="true">{emoji} </span>
                  {t(`theme.${id}.name`)}
                </span>
                <span className={styles.themeTagline}>{t(`theme.${id}.tagline`)}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="card stack-v">
        <h2>{t('settings.privacy')}</h2>
        <p className="small">{t('settings.privacyBody')}</p>
      </section>

      <section className="card stack-v">
        <h2>{t('settings.data')}</h2>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => void deleteEverything()}
          disabled={busy}
        >
          {t('settings.delete')}
        </button>
        {notice && <p className="notice notice--warn">{notice}</p>}
      </section>

      <section className="card stack-v">
        <h2>{t('settings.dev')}</h2>
        <div className="row">
          <Link to="/dev/barcodes" className="btn btn--small btn--outline">
            {t('settings.devBarcodes')}
          </Link>
          <Link to="/dev/styleguide" className="btn btn--small btn--outline">
            {t('settings.devStyleguide')}
          </Link>
        </div>
      </section>

      <p className="small muted">
        {t('settings.catalogue', { count: catalogue.products.length })}
        <br />
        {t('settings.version', { version: __APP_VERSION__ })}
      </p>
    </main>
  )
}
