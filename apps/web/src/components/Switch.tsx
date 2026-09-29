import { useId, type ReactNode } from 'react'
import styles from './Switch.module.css'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Bold first line. */
  label: string
  /** Explanation under the label (consent and notice texts go here word for word). */
  children?: ReactNode
  disabled?: boolean | undefined
}

/** An on/off setting: a native checkbox exposed as a switch. */
export function Switch({ checked, onChange, label, children, disabled }: SwitchProps) {
  const id = useId()
  return (
    <div className={styles.row}>
      <label className={styles.text} htmlFor={id}>
        <strong>{label}</strong>
        {children && <span className="small muted">{children}</span>}
      </label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className={styles.switch}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  )
}
