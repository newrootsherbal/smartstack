import { getProduct, inventoryUnitFor, refill } from '@smartstack/engine'
import { useId, useState } from 'react'
import { bottleUnitWord, formatNumber, parseCount } from '../format'
import { t, tl } from '../i18n'
import { useAppState } from '../state/context'
import { bottleFromDraft, initialBottleDraft, type BottleDraft } from '../bottle'
import { BottleCard } from './BottleCard'
import { Sheet } from './Sheet'

export type BottleSheetKind = 'refill' | 'edit' | 'track'

interface BottleSheetProps {
  productId: string
  kind: BottleSheetKind
  onClose: () => void
  /** After a successful save (the shopping list removes the item it was opened from). */
  onDone?: () => void
}

/**
 * Refill ("How many did you add?", with the running sum), Edit count (the exact number
 * left) and Track (start tracking a bottle), for one stack product.
 */
export function BottleSheet({ productId, kind, onClose, onDone }: BottleSheetProps) {
  const { state, dispatch } = useAppState()
  const entry = state.stack.find((s) => s.productId === productId)
  const product = getProduct(productId)
  const inv = entry?.inventory
  const id = useId()
  const [amount, setAmount] = useState(() =>
    kind === 'refill'
      ? inv?.packageSize !== null && inv?.packageSize !== undefined
        ? String(inv.packageSize)
        : ''
      : kind === 'edit' && inv
        ? String(inv.remaining)
        : '',
  )
  const [draft, setDraft] = useState<BottleDraft | null>(() =>
    product ? initialBottleDraft(product, entry?.variantUpc ?? null) : null,
  )
  const [perDose, setPerDose] = useState('1')
  const [invalid, setInvalid] = useState(false)

  if (!entry || !product) return null
  const unit = inv?.unit ?? inventoryUnitFor(product.form)
  const word = bottleUnitWord(unit, product.form, product.unitLabel)
  const name = tl(product.shortName)
  const askPerDose =
    kind === 'track' && unit === 'unit' && !product.unitsPerDose && entry.unitsPerDose === undefined

  const done = () => {
    onDone?.()
    onClose()
  }

  const save = () => {
    if (kind === 'track') {
      if (!draft) return
      const result = bottleFromDraft(draft, product)
      const units = askPerDose ? parseCount(perDose) : null
      if (result.kind !== 'bottle' || (askPerDose && (units === null || units <= 0))) {
        setInvalid(true)
        return
      }
      if (askPerDose && units) {
        dispatch({ type: 'SET_UNITS_PER_DOSE', productId, unitsPerDose: units })
      }
      dispatch({ type: 'SET_BOTTLE', productId, bottle: result.bottle })
      done()
      return
    }
    const n = parseCount(amount)
    if (n === null || !inv) {
      setInvalid(true)
      return
    }
    if (kind === 'refill') dispatch({ type: 'REFILL', productId, added: n })
    else dispatch({ type: 'SET_BOTTLE', productId, bottle: { ...inv, remaining: n } })
    done()
  }

  const added = parseCount(amount)
  const title =
    kind === 'refill'
      ? t('bottle.refillTitle', { product: name })
      : kind === 'edit'
        ? t('bottle.editCountTitle', { units: word })
        : t('bottle.trackTitle', { product: name })

  return (
    <Sheet open onClose={onClose} title={title}>
      <form
        className="stack-v"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        {kind === 'track' && draft ? (
          <>
            <BottleCard
              product={product}
              draft={draft}
              onChange={(d) => {
                setDraft(d)
                setInvalid(false)
              }}
              trackOnly
              invalid={invalid}
            />
            {askPerDose && (
              <div className="field">
                <label className="field__label" htmlFor={`${id}-per`}>
                  {t('bottle.perDoseQuestion')}
                </label>
                <span className="small muted">{t('bottle.perDoseHint')}</span>
                <input
                  id={`${id}-per`}
                  className="input"
                  inputMode="decimal"
                  value={perDose}
                  onChange={(e) => setPerDose(e.target.value)}
                />
              </div>
            )}
          </>
        ) : (
          <div className="field">
            <label className="field__label" htmlFor={`${id}-n`}>
              {kind === 'refill'
                ? t('bottle.refillQuestion')
                : t('bottle.editCountTitle', { units: word })}
            </label>
            <input
              id={`${id}-n`}
              className="input"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                setInvalid(false)
              }}
            />
            {kind === 'refill' && inv && added !== null && (
              <p className="small muted" aria-live="polite">
                {t('bottle.refillSum', {
                  left: formatNumber(inv.remaining),
                  added: formatNumber(added),
                  total: formatNumber(refill(inv.remaining, added)),
                })}
              </p>
            )}
            {invalid && (
              <p className="small notice notice--warn" role="alert">
                {t('bottle.invalid')}
              </p>
            )}
          </div>
        )}
        <div className="row">
          <button type="submit" className="btn btn--primary">
            {kind === 'refill' ? t('bottle.refill') : t('common.save')}
          </button>
          <button type="button" className="btn btn--outline" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
        {kind === 'edit' && (
          <button
            type="button"
            className="btn btn--link btn--small"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => {
              dispatch({ type: 'UNTRACK_BOTTLE', productId })
              onClose()
            }}
          >
            {t('bottle.stopTracking')}
          </button>
        )}
      </form>
    </Sheet>
  )
}
