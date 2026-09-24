import { t } from '../i18n'
import styles from './InstallGate.module.css'

/** iOS, not standalone: shown before anything else (see README, Web Push facts). */
export function InstallGate() {
  return (
    <main className={`screen screen--no-nav ${styles.gate}`}>
      <img src="/pwa-192x192.png" alt="" width={96} height={96} className={styles.icon} />
      <h1>{t('install.iosTitle')}</h1>
      <p className="muted">{t('install.iosIntro')}</p>
      <ol className={styles.steps}>
        <li>{t('install.iosStep1')}</li>
        <li>{t('install.iosStep2')}</li>
        <li>{t('install.iosStep3')}</li>
      </ol>
      <p className="small muted">{t('install.iosWhy')}</p>
    </main>
  )
}
