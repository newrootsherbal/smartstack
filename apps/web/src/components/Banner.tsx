import { t } from '../i18n'
import styles from './Banner.module.css'

/** Persistent, non-dismissable: every screen, all of Phase 1. */
export function Banner() {
  return (
    <div className={styles.banner} role="note" aria-live="off">
      <span className={styles.dot} aria-hidden="true" />
      <p>{t('banner.sample')}</p>
    </div>
  )
}
