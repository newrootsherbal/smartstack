import {
  ACTIVITY_LEVELS,
  AVOIDS,
  DIETS,
  GENDERS,
  HEALTH_CONDITION_GROUPS,
  HEALTH_GOALS,
  PREGNANCY_STATUSES,
  type HealthProfile as Profile,
} from '@smartstack/shared'
import { useId, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Switch } from '../components/Switch'
import { ACCOUNTS_PUBLIC } from '../config'
import { lookupMessage, t } from '../i18n'
import { useAppState } from '../state/context'
import styles from './HealthProfile.module.css'

/** Label of a code from the dictionaries (the product team may edit labels; codes are stable). */
function label(group: string, code: string): string {
  return lookupMessage(`health.${group}.${code}`) ?? code
}

function toggle<T extends string>(list: readonly T[], code: T, on: boolean): T[] {
  return on ? [...new Set([...list, code])] : list.filter((c) => c !== code)
}

/**
 * The health profile (accounts only): every question optional, nothing saved before the
 * storage consent (C4), used only to pick news, and only with its own switch (C5, off by
 * default). It never changes the schedule and isn't advice (N2).
 */
export function HealthProfile() {
  const { state, dispatch } = useAppState()
  const navigate = useNavigate()
  const id = useId()
  const [consent, setConsent] = useState(false)
  const profile = state.healthProfile
  // Typed freely; saved once it is a plausible year (or cleared).
  const [yearText, setYearText] = useState(() => String(state.healthProfile?.birthYear ?? ''))

  if (state.auth.mode !== 'account') {
    return (
      <main className="screen">
        <h1>{t('health.title')}</h1>
        <HealthLockedCard />
      </main>
    )
  }

  const save = (next: Partial<Profile>) => {
    if (!profile) return
    dispatch({
      type: 'SET_HEALTH_PROFILE',
      profile: { ...profile, ...next, updatedAt: Date.now() },
    })
  }

  if (!profile) {
    return (
      <main className="screen">
        <h1>{t('health.title')}</h1>
        <section className="card stack-v">
          <p className="muted">{t('health.intro')}</p>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>{t('consent.C4')}</span>
          </label>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!consent}
            onClick={() => {
              const now = Date.now()
              dispatch({
                type: 'SET_HEALTH_PROFILE',
                profile: {
                  birthYear: null,
                  gender: null,
                  pregnancy: null,
                  conditions: [],
                  goals: [],
                  diet: [],
                  avoids: [],
                  activity: null,
                  storageConsentAt: now,
                  targetingConsentAt: null,
                  updatedAt: now,
                },
              })
            }}
          >
            {t('health.start')}
          </button>
        </section>
        <p className="small muted">{t('notice.N2')}</p>
      </main>
    )
  }

  const thisYear = new Date().getFullYear()
  const radio = <T extends string>(
    name: string,
    group: string,
    codes: readonly T[],
    value: T | null,
    onChange: (code: T | null) => void,
  ) => (
    <div className={styles.options} role="radiogroup" aria-labelledby={`${id}-${name}`}>
      {codes.map((code) => (
        <label key={code} className={styles.option}>
          <input
            type="radio"
            name={`${id}-${name}`}
            checked={value === code}
            onChange={() => onChange(code)}
          />
          <span>{label(group, code)}</span>
        </label>
      ))}
      {!(codes as readonly string[]).includes('prefer_not') && (
        <label className={styles.option}>
          <input
            type="radio"
            name={`${id}-${name}`}
            checked={value === null}
            onChange={() => onChange(null)}
          />
          <span>{t('health.preferNot')}</span>
        </label>
      )}
    </div>
  )
  const checks = <T extends string>(
    group: string,
    codes: readonly T[],
    value: readonly T[],
    onChange: (next: T[]) => void,
  ) => (
    <div className={styles.options}>
      {codes.map((code) => (
        <label key={code} className={styles.option}>
          <input
            type="checkbox"
            checked={value.includes(code)}
            onChange={(e) => onChange(toggle(value, code, e.target.checked))}
          />
          <span>{label(group, code)}</span>
        </label>
      ))}
    </div>
  )

  return (
    <main className="screen">
      <h1>{t('health.title')}</h1>
      <p className="small muted">{t('health.optional')}</p>

      <section className="card stack-v">
        <label className="field" htmlFor={`${id}-year`}>
          <span className="field__label">{t('health.birthYear')}</span>
          <span className="small muted">{t('health.birthYearHint')}</span>
        </label>
        <input
          id={`${id}-year`}
          className={`input ${styles.year}`}
          inputMode="numeric"
          maxLength={4}
          placeholder={t('health.preferNot')}
          value={yearText}
          onChange={(e) => {
            const text = e.target.value.replace(/\D/g, '').slice(0, 4)
            setYearText(text)
            const n = Number.parseInt(text, 10)
            if (text === '') save({ birthYear: null })
            else if (text.length === 4 && n >= 1900 && n <= thisYear) save({ birthYear: n })
          }}
        />
      </section>

      <section className="card stack-v">
        <h2 id={`${id}-gender`}>{t('health.genderTitle')}</h2>
        {radio('gender', 'gender', GENDERS, profile.gender, (gender) =>
          save({ gender, ...(gender === 'man' ? { pregnancy: null } : {}) }),
        )}
      </section>

      {profile.gender !== 'man' && (
        <section className="card stack-v">
          <h2 id={`${id}-pregnancy`}>{t('health.pregnancyTitle')}</h2>
          {radio('pregnancy', 'pregnancy', PREGNANCY_STATUSES, profile.pregnancy, (pregnancy) =>
            save({ pregnancy }),
          )}
        </section>
      )}

      <section className="card stack-v">
        <h2>{t('health.conditionsTitle')}</h2>
        <p className="small muted">{t('health.listHint')}</p>
        {Object.entries(HEALTH_CONDITION_GROUPS).map(([group, codes]) => (
          <fieldset key={group} className={styles.group}>
            <legend>{label('groups', group)}</legend>
            {checks('conditions', codes, profile.conditions, (conditions) => save({ conditions }))}
          </fieldset>
        ))}
      </section>

      <section className="card stack-v">
        <h2>{t('health.goalsTitle')}</h2>
        <p className="small muted">{t('health.listHint')}</p>
        {checks('goals', HEALTH_GOALS, profile.goals, (goals) => save({ goals }))}
      </section>

      <section className="card stack-v">
        <h2>{t('health.dietTitle')}</h2>
        <p className="small muted">{t('health.listHint')}</p>
        {checks('diet', DIETS, profile.diet, (diet) => save({ diet }))}
        <h3 className="small">{t('health.avoidsTitle')}</h3>
        {checks('avoids', AVOIDS, profile.avoids, (avoids) => save({ avoids }))}
      </section>

      <section className="card stack-v">
        <h2 id={`${id}-activity`}>{t('health.activityTitle')}</h2>
        {radio('activity', 'activity', ACTIVITY_LEVELS, profile.activity, (activity) =>
          save({ activity }),
        )}
      </section>

      <section className="card stack-v">
        <HealthTargetingSwitch />
      </section>

      <p className="small muted">{t('notice.N2')}</p>
      <button
        type="button"
        className="btn btn--danger"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => {
          if (!window.confirm(t('notice.N7'))) return
          dispatch({ type: 'DELETE_HEALTH_PROFILE', at: Date.now() })
          navigate('/profile')
        }}
      >
        {t('health.delete')}
      </button>
    </main>
  )
}

/** C5: its own switch, off by default; also shown in Notifications. */
export function HealthTargetingSwitch() {
  const { state, dispatch } = useAppState()
  const profile = state.healthProfile
  if (!profile) return null
  return (
    <Switch
      checked={profile.targetingConsentAt !== null}
      onChange={(on) =>
        dispatch({
          type: 'SET_HEALTH_PROFILE',
          profile: {
            ...profile,
            targetingConsentAt: on ? Date.now() : null,
            updatedAt: Date.now(),
          },
        })
      }
      label={t('consent.C5title')}
    >
      {t('consent.C5')}
    </Switch>
  )
}

/** Guests: why an account is needed, with the way to one (only once accounts are public). */
export function HealthLockedCard() {
  return (
    <section className="card stack-v">
      <h2>{t('health.title')}</h2>
      <p className="small muted">{t('health.locked')}</p>
      {ACCOUNTS_PUBLIC && (
        <div className="row">
          <Link to="/signup?from=/profile/health" className="btn btn--primary">
            {t('backup.create')}
          </Link>
          <Link to="/login?from=/profile/health" className="btn btn--outline">
            {t('backup.login')}
          </Link>
        </div>
      )}
    </section>
  )
}
