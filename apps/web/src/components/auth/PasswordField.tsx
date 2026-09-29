import { PASSWORD_MAX_LENGTH } from '@smartstack/shared'
import { useId, useState } from 'react'
import { t } from '../../i18n'
import styles from './Auth.module.css'

interface PasswordFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  hint?: string
}

/** A password input with Show / Hide. No composition rules beyond 8–128 characters. */
export function PasswordField({ label, value, onChange, autoComplete, hint }: PasswordFieldProps) {
  const id = useId()
  const [shown, setShown] = useState(false)
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className={styles.passwordRow}>
        <input
          id={id}
          className="input"
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          maxLength={PASSWORD_MAX_LENGTH}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...(hint ? { 'aria-describedby': `${id}-hint` } : {})}
        />
        <button
          type="button"
          className="btn btn--small btn--outline"
          aria-pressed={shown}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? t('auth.hide') : t('auth.show')}
        </button>
      </div>
      {hint && (
        <span id={`${id}-hint`} className="small muted">
          {hint}
        </span>
      )}
    </div>
  )
}
