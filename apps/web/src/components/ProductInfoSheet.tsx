import { getProduct, getRule, rulesForProduct } from '@smartstack/engine'
import type { PinAnchor, Reason } from '@smartstack/shared'
import { useProductText } from '../hooks/useProductText'
import { t, tl } from '../i18n'
import { isShortReason } from '../i18n/render'
import { useTodaySchedule } from '../schedule'
import { useAppState } from '../state/context'
import styles from './ProductInfoSheet.module.css'
import { SeverityBadge } from './SeverityBadge'
import { Sheet } from './Sheet'

interface ProductInfoSheetProps {
  /** The product to explain; null keeps the sheet closed. */
  productId: string | null
  onClose: () => void
}

interface ScheduledDose {
  slot: number
  pinned?: PinAnchor
  anchor: PinAnchor | null
  minutes: number
}

/**
 * "More info ›": why the product sits where it does (with the evening suggestion and the
 * person's own choices), then the label text and where it comes from.
 */
export function ProductInfoSheet({ productId, onClose }: ProductInfoSheetProps) {
  const { dispatch } = useAppState()
  const { schedule } = useTodaySchedule()
  const product = productId ? getProduct(productId) : undefined
  const text = useProductText(product)

  const doses: ScheduledDose[] = []
  const reasons: Reason[] = []
  for (const placement of schedule?.placements ?? []) {
    for (const dose of placement.doses) {
      if (dose.productId !== productId) continue
      doses.push({
        slot: dose.slot,
        anchor: placement.anchor,
        minutes: placement.minutes,
        ...(dose.pinned ? { pinned: dose.pinned } : {}),
      })
    }
    for (const reason of placement.reasons) {
      if (reason.productId !== productId || !isShortReason(reason)) continue
      // One explanation per rule, even when several doses carry it.
      const key = `${reason.ruleId}:${reason.params.pinnedConflict ? 1 : 0}`
      if (!reasons.some((r) => `${r.ruleId}:${r.params.pinnedConflict ? 1 : 0}` === key)) {
        reasons.push(reason)
      }
    }
  }

  const pinnedDoses = doses.filter((d) => d.pinned)
  const suggestion = product
    ? rulesForProduct(product).find((r) => r.attribute === 'SUGGEST_BEDTIME')
    : undefined
  // Offered even after "No thanks" on Today: this is where the person can still say yes.
  const offerBedtime =
    suggestion && pinnedDoses.length === 0 && !doses.some((d) => d.anchor === 'bedtime')
  const lastDose = doses.reduce<ScheduledDose | null>(
    (last, d) => (!last || d.minutes > last.minutes ? d : last),
    null,
  )

  const open = productId !== null
  const title = product ? tl(product.shortName) : (productId ?? '')
  const hasTiming = offerBedtime || pinnedDoses.length > 0 || reasons.length > 0

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <section className={styles.section}>
        <h3>{t('info.timing')}</h3>
        {offerBedtime && suggestion && lastDose && (
          <div className={`notice ${styles.choice}`}>
            <span>{tl(suggestion.explanation)}</span>
            <button
              type="button"
              className="btn btn--small btn--primary"
              onClick={() =>
                dispatch({
                  type: 'SET_PIN',
                  productId: productId!,
                  slot: lastDose.slot,
                  anchor: 'bedtime',
                })
              }
            >
              {t('suggest.moveToBedtime')}
            </button>
          </div>
        )}
        {pinnedDoses.map((d) => (
          <div key={d.slot} className={`notice ${styles.choice}`}>
            <span>{t(`pinned.${d.pinned!}`)}</span>
            <button
              type="button"
              className="btn btn--small btn--outline"
              onClick={() =>
                dispatch({ type: 'SET_PIN', productId: productId!, slot: d.slot, anchor: null })
              }
            >
              {t('info.moveBack')}
            </button>
          </div>
        ))}
        {reasons.map((reason) => {
          const rule = getRule(reason.ruleId)
          if (!rule) return null
          return (
            <article
              key={`${reason.ruleId}:${reason.params.pinnedConflict ? 1 : 0}`}
              className={styles.reason}
            >
              <p className={styles.explanation}>{tl(rule.explanation)}</p>
              {reason.params.pinnedConflict && (
                <p className="small muted">{t('info.pinnedConflictNote')}</p>
              )}
              <SeverityBadge severity={reason.severity} />
              <details className={styles.details}>
                <summary>{t('common.learnMore')}</summary>
                <dl className={styles.dl}>
                  <dt>{t('info.evidence')}</dt>
                  <dd>
                    {rule.evidenceUrl ? (
                      <a href={rule.evidenceUrl} target="_blank" rel="noopener noreferrer">
                        {t('info.openSource')}
                        <span className="visually-hidden"> ({rule.evidenceUrl})</span>
                      </a>
                    ) : (
                      <span className="muted">{t('common.sourceToBeAdded')}</span>
                    )}
                  </dd>
                  <dt>{t('info.lastReviewed')}</dt>
                  <dd>{rule.lastReviewed ?? t('common.notYetReviewed')}</dd>
                  <dt>{t('info.reviewedBy')}</dt>
                  <dd>{rule.reviewedBy ?? t('common.notYetReviewed')}</dd>
                </dl>
              </details>
            </article>
          )
        })}
        {!hasTiming && <p className="small muted">{t('info.noTiming')}</p>}
      </section>

      {product && (
        <>
          <section className={styles.section}>
            <h3>{t('info.directions')}</h3>
            <p className="small">
              {text ? (text.directions ? tl(text.directions) : '—') : t('common.loading')}
            </p>
          </section>
          <section className={styles.section}>
            <h3>{t('info.warnings')}</h3>
            <p className="small">
              {text ? (text.warnings ? tl(text.warnings) : '—') : t('common.loading')}
            </p>
          </section>
          {product.ingredients.length === 0 && text?.facts && (
            <section className={styles.section}>
              <h3>{t('info.labelFacts')}</h3>
              <p className="small">{tl(text.facts)}</p>
            </section>
          )}
          <section className={styles.section}>
            {product.sourceUrl && (
              <a href={product.sourceUrl} target="_blank" rel="noopener noreferrer">
                {t('info.productPage')}
              </a>
            )}
            {product.status === 'sample' ? (
              <p className="small muted">
                <span className="tag tag--sample">{t('common.sample')}</span> {t('info.sampleNote')}
              </p>
            ) : (
              <p className="small muted">{t('info.draftNote')}</p>
            )}
          </section>
        </>
      )}
    </Sheet>
  )
}
