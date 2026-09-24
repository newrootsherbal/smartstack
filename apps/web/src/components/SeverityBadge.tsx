import type { Severity } from '@smartstack/shared'
import { severityLabel } from '../i18n/render'
import styles from './SeverityBadge.module.css'

const classFor: Record<Severity, string> = {
  important: styles.important!,
  timing_conflict: styles.timing!,
  consideration: styles.consideration!,
  product_instruction: styles.product!,
  informational: styles.info!,
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { label, sub } = severityLabel(severity)
  return (
    <span className={`${styles.badge} ${classFor[severity]}`}>
      <span className={styles.label}>{label}</span>
      {sub && <span className={styles.sub}>{sub}</span>}
    </span>
  )
}
