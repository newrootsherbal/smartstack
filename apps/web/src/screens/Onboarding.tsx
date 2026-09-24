import { Routine, type HHMM } from '@smartstack/shared'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { currentTimeZone } from '../dates'
import { t } from '../i18n'
import { useAppState } from '../state/context'
import styles from './Onboarding.module.css'

/** Pitch section 8 defaults. */
const DEFAULTS: Routine = {
  wake: '07:00',
  coffee: '07:30',
  breakfast: '08:00',
  lunch: '12:00',
  dinner: '18:00',
  exercise: '17:30',
  bedtime: '22:30',
}

type OptionalKey = 'coffee' | 'breakfast' | 'lunch' | 'dinner' | 'exercise'

const OPTIONAL: { key: OptionalKey; label: string; off: string }[] = [
  { key: 'coffee', label: 'onboarding.coffee', off: 'onboarding.noCoffee' },
  { key: 'breakfast', label: 'onboarding.breakfast', off: 'onboarding.noBreakfast' },
  { key: 'lunch', label: 'onboarding.lunch', off: 'onboarding.noLunch' },
  { key: 'dinner', label: 'onboarding.dinner', off: 'onboarding.noDinner' },
  { key: 'exercise', label: 'onboarding.exercise', off: 'onboarding.noExercise' },
]

interface Draft {
  wake: HHMM
  bedtime: HHMM
  coffee: HHMM | null
  breakfast: HHMM | null
  lunch: HHMM | null
  dinner: HHMM | null
  exercise: HHMM | null
  /** Remembered values for toggled-off anchors so switching back restores them. */
  remembered: Partial<Record<OptionalKey, HHMM>>
}

export function Onboarding() {
  const { state, dispatch } = useAppState()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const editing = params.get('edit') === '1' && state.routine !== null
  const [draft, setDraft] = useState<Draft>(() => ({
    ...(state.routine ?? DEFAULTS),
    remembered: {},
  }))
  const [error, setError] = useState<string | null>(null)

  const setTime = (key: keyof Routine, value: string) => {
    if (!/^\d{2}:\d{2}$/.test(value)) return
    setDraft((d) => ({ ...d, [key]: value as HHMM }))
  }

  const toggle = (key: OptionalKey, enabled: boolean) => {
    setDraft((d) => {
      if (enabled) {
        return { ...d, [key]: d.remembered[key] ?? DEFAULTS[key] }
      }
      const current = d[key]
      return {
        ...d,
        [key]: null,
        remembered: current ? { ...d.remembered, [key]: current } : d.remembered,
      }
    })
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const { remembered: _remembered, ...candidate } = draft
    const parsed = Routine.safeParse(candidate)
    if (!parsed.success) {
      setError(t('onboarding.mealRequired'))
      return
    }
    dispatch({ type: 'SET_ROUTINE', routine: parsed.data })
    navigate(editing || state.stack.length > 0 ? '/today' : '/add', { replace: true })
  }

  return (
    <main className={`screen ${editing ? '' : 'screen--no-nav'}`}>
      <header className="stack-v">
        <h1>{editing ? t('onboarding.editTitle') : t('onboarding.title')}</h1>
        <p className="muted">{t('onboarding.intro')}</p>
      </header>

      <form className={styles.form} onSubmit={submit}>
        <div className="field">
          <label className="field__label" htmlFor="wake">
            {t('onboarding.wake')}
          </label>
          <input
            id="wake"
            className="input"
            type="time"
            required
            value={draft.wake}
            onChange={(e) => setTime('wake', e.target.value)}
          />
        </div>

        {OPTIONAL.map(({ key, label, off }) => {
          const value = draft[key]
          return (
            <div className="field" key={key}>
              <label className="field__label" htmlFor={key}>
                {t(label as 'onboarding.coffee')}
              </label>
              <div className={styles.optional}>
                <input
                  id={key}
                  className="input"
                  type="time"
                  disabled={value === null}
                  value={value ?? draft.remembered[key] ?? DEFAULTS[key] ?? ''}
                  onChange={(e) => setTime(key, e.target.value)}
                />
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={value === null}
                    onChange={(e) => toggle(key, !e.target.checked)}
                  />
                  <span>{t(off as 'onboarding.noCoffee')}</span>
                </label>
              </div>
            </div>
          )
        })}

        <div className="field">
          <label className="field__label" htmlFor="bedtime">
            {t('onboarding.bedtime')}
          </label>
          <input
            id="bedtime"
            className="input"
            type="time"
            required
            value={draft.bedtime}
            onChange={(e) => setTime('bedtime', e.target.value)}
          />
        </div>

        <p className="small muted">{t('onboarding.timezone', { tz: currentTimeZone() })}</p>
        {error && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn--primary btn--block">
          {editing ? t('onboarding.save') : t('onboarding.build')}
        </button>
      </form>
    </main>
  )
}
