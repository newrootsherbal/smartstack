import { t } from '../i18n'
import styles from './MoreInfoButton.module.css'

interface MoreInfoButtonProps {
  /** Product name for the accessible label ("More info about Iron"). */
  product: string
  onClick: () => void
  className?: string | undefined
}

/** "More info ›" on every dose, stack item and shopping-list item. */
export function MoreInfoButton({ product, onClick, className }: MoreInfoButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn--link btn--small ${styles.button} ${className ?? ''}`}
      aria-label={t('common.moreInfoAbout', { product })}
      onClick={onClick}
    >
      {t('common.moreInfo')}
      <svg
        className={styles.chevron}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  )
}
