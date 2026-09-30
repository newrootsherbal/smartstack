import { inventoryUnitFor, productSizes } from '@smartstack/engine'
import type { Product } from '@smartstack/shared'
import { useId } from 'react'
import type { BottleDraft, BottleMode } from '../bottle'
import { bottleUnitWord, formatBottleAmount } from '../format'
import { t, tl } from '../i18n'
import styles from './BottleCard.module.css'

interface BottleCardProps {
  product: Product
  draft: BottleDraft
  onChange: (draft: BottleDraft) => void
  /** Hide "Don't track" (the Track sheet is already a choice to track). */
  trackOnly?: boolean
  invalid?: boolean
}

/** "Your bottle": [New bottle] [Already opened] [Don't track], then the one question needed. */
export function BottleCard({ product, draft, onChange, trackOnly, invalid }: BottleCardProps) {
  const id = useId()
  const unit = inventoryUnitFor(product.form)
  const word = bottleUnitWord(unit, product.form, product.unitLabel)
  const sizes = productSizes(product)
  const chosen = sizes.find((s) => s.upc === draft.sizeUpc)
  const showChips = !draft.scanned && sizes.length > 1
  // With size chips, the question only comes when the chosen size doesn't say.
  const askFull =
    draft.mode === 'new' && (chosen ? !chosen.size : !sizes.some((s) => s.size !== null))
  const modes: BottleMode[] = trackOnly ? ['new', 'opened'] : ['new', 'opened', 'none']
  const modeLabel = {
    new: 'bottle.new',
    opened: 'bottle.opened',
    none: 'bottle.dontTrack',
  } as const

  // Capsules: "120 capsules". Liquids and powders: the size as printed, then what it holds
  // ("200 ml · 40 servings"), since the printed size is what the person sees on the bottle.
  const sizeLabel = (s: (typeof sizes)[number]) => {
    const printed = s.label ? tl(s.label) : null
    if (!s.size) return printed ?? s.upc
    const amount = formatBottleAmount(s.size.quantity, s.size.unit, product.form, product.unitLabel)
    if (s.size.unit !== 'serving' || !printed) return amount
    // "226 g = 45 portions" already says it: don't repeat "· 45 servings".
    const digits = String(s.size.quantity).replace('.', '\\.')
    return new RegExp(`(^|\\D)${digits}(\\D|$)`).test(printed) ? printed : `${printed} · ${amount}`
  }

  return (
    <div className="card stack-v">
      <p className="small" style={{ fontWeight: 600 }}>
        {t('bottle.title')}
      </p>
      <div className={styles.segmented} role="radiogroup" aria-label={t('bottle.title')}>
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={draft.mode === m}
            className={`btn btn--small ${draft.mode === m ? 'btn--primary' : 'btn--outline'}`}
            onClick={() => onChange({ ...draft, mode: m })}
          >
            {t(modeLabel[m])}
          </button>
        ))}
      </div>

      {draft.mode !== 'none' && (
        <>
          {draft.scanned && chosen && <p className="small muted">{sizeLabel(chosen)}</p>}
          {showChips && (
            <div className="stack-v">
              <p className="small">{t('bottle.whichSize')}</p>
              <div className={styles.chips} role="radiogroup" aria-label={t('bottle.whichSize')}>
                {sizes.map((s) => (
                  <button
                    key={s.upc}
                    type="button"
                    role="radio"
                    aria-checked={draft.sizeUpc === s.upc}
                    className={`${styles.chip} ${draft.sizeUpc === s.upc ? styles.chipOn : ''}`}
                    onClick={() =>
                      onChange({
                        ...draft,
                        sizeUpc: s.upc,
                        full: s.size ? String(s.size.quantity) : draft.full,
                      })
                    }
                  >
                    {sizeLabel(s)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {askFull && (
            <div className="field">
              <label className="field__label" htmlFor={`${id}-full`}>
                {t('bottle.fullQuestion', { units: word })}
              </label>
              <input
                id={`${id}-full`}
                className="input"
                inputMode="decimal"
                autoComplete="off"
                value={draft.full}
                onChange={(e) => onChange({ ...draft, full: e.target.value })}
              />
            </div>
          )}
          {draft.mode === 'opened' && (
            <div className="field">
              <label className="field__label" htmlFor={`${id}-left`}>
                {t('bottle.leftQuestion', { units: word })}
              </label>
              <input
                id={`${id}-left`}
                className="input"
                inputMode="decimal"
                autoComplete="off"
                value={draft.left}
                onChange={(e) => onChange({ ...draft, left: e.target.value })}
              />
            </div>
          )}
          {invalid && (
            <p className="small notice notice--warn" role="alert">
              {t('bottle.invalid')}
            </p>
          )}
        </>
      )}
    </div>
  )
}
