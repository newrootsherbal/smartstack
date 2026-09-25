import { getProduct, parseHHMM, shiftRoutine } from '@smartstack/engine'
import type { Placement, Reason } from '@smartstack/shared'
import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import { Sheet } from '../components/Sheet'
import { WhySheet } from '../components/WhySheet'
import { formatClock, formatLongDate, minutesOfDay } from '../dates'
import { formatUnits } from '../format'
import { t, tl } from '../i18n'
import { renderAdjustment, renderReasonShort } from '../i18n/render'
import { useTodaySchedule } from '../schedule'
import { useAppState } from '../state/context'
import { checkKey } from '../storage'
import styles from './Today.module.css'

type SheetKind = 'none' | 'late' | 'adjustments'

export function Today() {
  const { state, dispatch } = useAppState()
  const { today, schedule } = useTodaySchedule()
  const [sheet, setSheet] = useState<SheetKind>('none')
  const [why, setWhy] = useState<Reason[] | null>(null)
  const closeWhy = useCallback(() => setWhy(null), [])
  const closeSheet = useCallback(() => setSheet('none'), [])

  const shift = (minutes: number) => {
    if (!state.routine) return
    const base = state.todayOverride?.date === today ? state.todayOverride.routine : state.routine
    const shifted = shiftRoutine(base, minutesOfDay(), minutes)
    const total =
      (state.todayOverride?.date === today ? state.todayOverride.shiftMinutes : 0) + minutes
    dispatch({
      type: 'SET_TODAY_OVERRIDE',
      override: { date: today, routine: shifted, shiftMinutes: total },
    })
    setSheet('none')
  }

  const totalDoses = schedule?.placements.reduce((n, p) => n + p.doses.length, 0) ?? 0
  const doseTotals = new Map<string, number>()
  for (const p of schedule?.placements ?? []) {
    for (const d of p.doses) doseTotals.set(d.productId, (doseTotals.get(d.productId) ?? 0) + 1)
  }
  const doneDoses =
    schedule?.placements.reduce(
      (n, p) =>
        n + p.doses.filter((d) => state.checks[checkKey(today, d.productId, d.doseIndex)]).length,
      0,
    ) ?? 0

  return (
    <main className="screen">
      <header className="screen-header">
        <div>
          <h1>{t('today.title')}</h1>
          <p className="muted small">{formatLongDate(today)}</p>
        </div>
        {schedule && (
          <p className="small muted">
            {t('today.dosesTaken', { done: doneDoses, total: totalDoses })}
          </p>
        )}
      </header>

      {state.todayOverride?.date === today && (
        <p className="notice notice--warn row row--between">
          <span>{t('today.lateActive', { minutes: state.todayOverride.shiftMinutes })}</span>
          <button
            type="button"
            className="btn btn--link btn--small"
            onClick={() => dispatch({ type: 'SET_TODAY_OVERRIDE', override: null })}
          >
            {t('today.lateUndo')}
          </button>
        </p>
      )}

      {!schedule ? (
        <div className="card stack-v">
          <h2>{t('today.empty')}</h2>
          <p className="muted">{t('today.emptyHint')}</p>
          <Link to="/add" className="btn btn--primary">
            {t('stack.addFirst')}
          </Link>
        </div>
      ) : (
        <>
          <div className={styles.actions}>
            <button type="button" className="btn btn--outline" onClick={() => setSheet('late')}>
              {t('today.runningLate')}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setSheet('adjustments')}
            >
              {t('today.optimize')}
            </button>
          </div>

          {schedule.placements.map((placement) => (
            <PlacementSection
              key={placement.time}
              placement={placement}
              today={today}
              checks={state.checks}
              doseTotals={doseTotals}
              onToggle={(productId, doseIndex) =>
                dispatch({ type: 'TOGGLE_CHECK', date: today, productId, doseIndex })
              }
              onWhy={setWhy}
            />
          ))}
        </>
      )}

      <WhySheet reasons={why} onClose={closeWhy} />

      <Sheet open={sheet === 'late'} onClose={closeSheet} title={t('today.lateTitle')}>
        <p className="muted">{t('today.lateIntro')}</p>
        <div className={styles.lateButtons}>
          <button type="button" className="btn btn--outline" onClick={() => shift(30)}>
            {t('today.late30')}
          </button>
          <button type="button" className="btn btn--outline" onClick={() => shift(60)}>
            {t('today.late60')}
          </button>
          <button type="button" className="btn btn--outline" onClick={() => shift(120)}>
            {t('today.late120')}
          </button>
        </div>
      </Sheet>

      <Sheet
        open={sheet === 'adjustments'}
        onClose={closeSheet}
        title={
          !schedule || schedule.adjustments.length === 0
            ? t('today.adjustmentsNone')
            : schedule.adjustments.length === 1
              ? t('today.adjustmentsOne')
              : t('today.adjustmentsTitle', { count: schedule.adjustments.length })
        }
      >
        <p className="muted">{t('today.adjustmentsIntro')}</p>
        {schedule && schedule.adjustments.length > 0 && (
          <ol className={styles.adjustments}>
            {schedule.adjustments.map((a) => (
              <li key={`${a.productId}:${a.ruleId}`}>
                <span>{renderAdjustment(a)}</span>
                <span className="muted small">
                  {formatClock(a.params.from)} → {formatClock(a.params.to)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Sheet>
    </main>
  )
}

interface PlacementSectionProps {
  placement: Placement
  today: string
  checks: Record<string, true>
  /** Doses per product across the whole day, to label "Dose 2 of 4". */
  doseTotals: ReadonlyMap<string, number>
  onToggle: (productId: string, doseIndex: number) => void
  onWhy: (reasons: Reason[]) => void
}

function PlacementSection({
  placement,
  today,
  checks,
  doseTotals,
  onToggle,
  onWhy,
}: PlacementSectionProps) {
  const heading = placement.anchor ? t(`anchor.${placement.anchor}`) : formatClock(placement.time)
  const past = parseHHMM(placement.time) < minutesOfDay()
  return (
    <section className={`${styles.section} ${past ? styles.past : ''}`}>
      <header className={styles.sectionHeader}>
        <h2>{heading}</h2>
        {placement.anchor && <span className={styles.time}>{formatClock(placement.time)}</span>}
      </header>
      <ul className={`list ${styles.rows}`}>
        {placement.doses.map((dose) => {
          const product = getProduct(dose.productId)
          // Only this dose's reasons: another dose of the same product may share the slot.
          const reasons = placement.reasons.filter(
            (r) => r.productId === dose.productId && r.doseIndex === dose.doseIndex,
          )
          const key = checkKey(today, dose.productId, dose.doseIndex)
          const checked = checks[key] === true
          const total = doseTotals.get(dose.productId) ?? 1
          return (
            <li key={key} className={styles.row}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(dose.productId, dose.doseIndex)}
                />
                <span className={checked ? styles.done : ''}>
                  {product ? tl(product.shortName) : dose.productId}
                  {product?.unitsPerDose && (
                    <span className="muted small">
                      {' '}
                      · {formatUnits(product.unitsPerDose, product.form)}
                    </span>
                  )}
                  {total > 1 && (
                    <span className="muted small">
                      {' '}
                      · {t('today.doseOf', { n: dose.doseIndex + 1, total })}
                    </span>
                  )}
                </span>
              </label>
              {reasons.length > 0 && (
                <>
                  <ul className={styles.reasons}>
                    {reasons.map((r) => (
                      <li key={r.ruleId}>{renderReasonShort(r)}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className={`btn btn--link btn--small ${styles.why}`}
                    onClick={() => onWhy(reasons)}
                  >
                    {t('common.why')}
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
