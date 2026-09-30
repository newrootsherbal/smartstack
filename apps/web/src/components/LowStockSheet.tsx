import { daysLeft, getProduct } from '@smartstack/engine'
import { useLocation, useNavigate } from 'react-router'
import { formatBottleAmount, formatDaysLeft } from '../format'
import { t, tl } from '../i18n'
import { useAppState } from '../state/context'
import { dailyUseOf } from '../state/reducer'
import { Sheet } from './Sheet'

/** Screens where a popup would get in the way of setting things up. */
const QUIET_ROUTES = ['/onboarding', '/welcome']

/**
 * "You're almost out of …": shown once per bottle, right after a dose or a count brought
 * it to 5 days or less. The product is already on the shopping list.
 */
export function LowStockSheet() {
  const { state, dispatch } = useAppState()
  const navigate = useNavigate()
  const location = useLocation()
  const productId = state.lowAlerts[0]
  const entry = productId ? state.stack.find((s) => s.productId === productId) : undefined
  const product = productId ? getProduct(productId) : undefined
  const inv = entry?.inventory
  if (!productId || !entry || !product || !inv) return null
  if (QUIET_ROUTES.some((r) => location.pathname.startsWith(r))) return null

  const ack = () => dispatch({ type: 'ACK_LOW_ALERT', productId })
  const days = daysLeft(inv.remaining, dailyUseOf(entry))
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
