import { getProduct } from '@smartstack/engine'
import { MAX_DOSES_PER_DAY, PIN_ANCHORS, type PinAnchor } from '@smartstack/shared'
import { useId } from 'react'
import { bottleStatus } from '../bottle'
import { timesLabel } from '../format'
import { t, tl, type MessageKey } from '../i18n'
import { useCatalogue } from '../catalogue'
import { useAppState } from '../state/context'
import styles from './ManageSheet.module.css'
import { MoreInfoButton } from './MoreInfoButton'
import { Sheet } from './Sheet'

/** Routine words for the "Move to…" choices (the same labels as onboarding). */
const PIN_LABELS: Record<PinAnchor, MessageKey> = {
  wake: 'onboarding.wake',
  breakfast: 'onboarding.breakfast',
  lunch: 'onboarding.lunch',
  dinner: 'onboarding.dinner',
  bedtime: 'onboarding.bedtime',
}

export type ManageAction = 'refill' | 'edit' | 'track' | 'info'

interface ManageSheetProps {
  productId: string
  onClose: () => void
  /** Opens another sheet for this product (the Manage sheet closes first). */
  onOpen: (action: ManageAction) => void
}

/** Everything about one stack item, kept out of the list rows. */
export function ManageSheet({ productId, onClose, onOpen }: ManageSheetProps) {
  const { state, dispatch } = useAppState()
  const catalogue = useCatalogue()
  const id = useId()
  const entry = state.stack.find((s) => s.productId === productId)
  const product = getProduct(productId, catalogue)
  if (!entry) return null
  const name = product ? tl(product.shortName) : productId
  const status = bottleStatus(entry, catalogue)
  const onList = state.shopping.some((s) => s.productId === productId)
  const slots = Array.from({ length: entry.dosesPerDay }, (_, i) => i)

  const remove = () => {
    if (window.confirm(t('stack.removeConfirm', { product: name }))) {
      dispatch({ type: 'REMOVE_PRODUCT', productId })
      onClose()
    }
  }

  return (
    <Sheet open onClose={onClose} title={name}>
      <section className={styles.section}>
        <p className="small">{status ?? t('bottle.notTracked')}</p>
        <div className="row">
          {entry.inventory ? (
            <>
              <button
                type="button"
                className="btn btn--small btn--primary"
                onClick={() => onOpen('refill')}
              >
                {t('bottle.refill')}
              </button>
              <button
                type="button"
                className="btn btn--small btn--outline"
                onClick={() => onOpen('edit')}
              >
                {t('bottle.editCount')}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn--small btn--outline"
              onClick={() => onOpen('track')}
            >
              {t('bottle.track')}
            </button>
          )}
        </div>
      </section>

      <section className={styles.section}>
        <label className="field">
          <span className="field__label">{t('common.timesPerDay')}</span>
          <select
            className="input"
            value={entry.dosesPerDay}
            onChange={(e) =>
              dispatch({ type: 'SET_DOSES', productId, dosesPerDay: Number(e.target.value) })
            }
          >
            {Array.from({ length: MAX_DOSES_PER_DAY }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {timesLabel(n)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className={styles.section}>
        <h3>{t('manage.moveTo')}</h3>
        <p className="small muted">{t('manage.moveToHint')}</p>
        {slots.map((slot) => (
          <label key={slot} className={`field ${styles.pin}`} htmlFor={`${id}-${slot}`}>
            {slots.length > 1 && (
              <span className="field__label">{t('manage.doseN', { n: slot + 1 })}</span>
            )}
            <select
              id={`${id}-${slot}`}
              className="input"
              aria-label={
                slots.length > 1
                  ? `${t('manage.moveTo')} ${t('manage.doseN', { n: slot + 1 })}`
                  : t('manage.moveTo')
              }
              value={entry.pins?.[slot] ?? ''}
              onChange={(e) =>
                dispatch({
                  type: 'SET_PIN',
                  productId,
                  slot,
                  anchor: e.target.value ? (e.target.value as PinAnchor) : null,
                })
              }
            >
              <option value="">{t('manage.automatic')}</option>
              {PIN_ANCHORS.map((a) => (
                <option key={a} value={a}>
                  {t(PIN_LABELS[a])}
                </option>
              ))}
            </select>
          </label>
        ))}
      </section>

      <section className={styles.section}>
        {onList ? (
          <p className="small muted">{t('manage.onShopping')}</p>
        ) : (
          <button
            type="button"
            className="btn btn--small btn--outline"
            onClick={() => dispatch({ type: 'ADD_TO_SHOPPING', productId, reason: 'manual' })}
          >
            {t('manage.addToShopping')}
          </button>
        )}
        <MoreInfoButton product={name} onClick={() => onOpen('info')} className={styles.left} />
        <button type="button" className="btn btn--small btn--danger" onClick={remove}>
          {t('manage.removeTitle')}
        </button>
      </section>
    </Sheet>
  )
}
