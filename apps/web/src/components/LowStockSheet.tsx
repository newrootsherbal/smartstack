import { daysLeft, getProduct } from '@smartstack/engine'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { alternativesFor } from '../alternatives'
import { useCatalogue } from '../catalogue'
import { formatBottleAmount, formatDaysLeft } from '../format'
import { t, tl } from '../i18n'
import { useAppState } from '../state/context'
import { dailyUseOf } from '../state/reducer'
import { BottleSheet } from './BottleSheet'
import { Sheet } from './Sheet'

/** Screens where a popup would get in the way of setting things up. */
const QUIET_ROUTES = ['/onboarding', '/welcome']

/**
 * "You're almost out of …": shown once per bottle, right after a dose or a count brought
 * it to 5 days or less. The product is already on the shopping list. For another brand with
 * a New Roots Herbal alternative, the sheet suggests it instead (build prompt §4.5).
 */
export function LowStockSheet() {
  const { state, dispatch } = useAppState()
  const catalogue = useCatalogue()
  const navigate = useNavigate()
  const location = useLocation()
  const [refilling, setRefilling] = useState<string | null>(null)
  const productId = state.lowAlerts[0]
  const entry = productId ? state.stack.find((s) => s.productId === productId) : undefined
  const product = productId ? getProduct(productId, catalogue) : undefined
  const inv = entry?.inventory

  if (refilling) {
    // Closing without refilling leaves the current product on the shopping list.
    return <BottleSheet productId={refilling} kind="refill" onClose={() => setRefilling(null)} />
  }
  if (!productId || !entry || !product || !inv) return null
  if (QUIET_ROUTES.some((r) => location.pathname.startsWith(r))) return null

  const ack = () => dispatch({ type: 'ACK_LOW_ALERT', productId })
  const days = daysLeft(inv.remaining, dailyUseOf(entry, catalogue))
  const alternative = alternativesFor(productId, state, catalogue)[0]
  const alternativeProduct = alternative ? getProduct(alternative.productId, catalogue) : undefined

  if (alternative && alternativeProduct) {
    return (
      <Sheet open onClose={ack} title={t('low.title')}>
        <p>
          {t('low.bodyAlternative', {
            product: tl(product.shortName),
            alternative: tl(alternativeProduct.name),
          })}
        </p>
        <div className="stack-v">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              // The alternative replaces the current product on the list.
              dispatch({
                type: 'ADD_TO_SHOPPING',
                productId: alternativeProduct.id,
                reason: 'alternative',
                replacesProductId: productId,
              })
              dispatch({ type: 'REMOVE_FROM_SHOPPING', productId })
              ack()
            }}
          >
            {t('manage.addToShopping')}
          </button>
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => {
              ack()
              setRefilling(productId)
            }}
          >
            {t('low.refillCurrent')}
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet open onClose={ack} title={t('low.title')}>
      <p>
        {t('low.body', {
          product: tl(product.shortName),
          days: formatDaysLeft(days, 'low'),
          amount: formatBottleAmount(inv.remaining, inv.unit, product.form, product.unitLabel),
        })}
      </p>
      <div className="row">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            ack()
            navigate('/shopping')
          }}
        >
          {t('low.viewList')}
        </button>
        <button type="button" className="btn btn--outline" onClick={ack}>
          {t('low.ok')}
        </button>
      </div>
    </Sheet>
  )
}
