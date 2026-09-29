import { getProduct } from '@smartstack/engine'
import type { ShoppingItem } from '@smartstack/shared'
import { useCallback, useEffect, useState } from 'react'
import { bottleStatus } from '../bottle'
import { BottleSheet, type BottleSheetKind } from '../components/BottleSheet'
import { MoreInfoButton } from '../components/MoreInfoButton'
import { ProductInfoSheet } from '../components/ProductInfoSheet'
import { t, tl } from '../i18n'
import { buyOnlineUrl } from '../links'
import { useCatalogue } from '../catalogue'
import { useAppState } from '../state/context'
import styles from './Shopping.module.css'

const UNDO_MS = 6000

/** Products to buy: added when a bottle runs low, by hand, or as a suggestion. */
export function Shopping() {
  const { state, dispatch } = useAppState()
  const catalogue = useCatalogue()
  const [info, setInfo] = useState<string | null>(null)
  const closeInfo = useCallback(() => setInfo(null), [])
  const [bottle, setBottle] = useState<{ productId: string; kind: BottleSheetKind } | null>(null)
  const [removed, setRemoved] = useState<ShoppingItem | null>(null)

  // The undo notice disappears on its own after a few seconds.
  useEffect(() => {
    if (!removed) return
    const timer = window.setTimeout(() => setRemoved(null), UNDO_MS)
    return () => window.clearTimeout(timer)
  }, [removed])

  const nameOf = (productId: string) => {
    const product = getProduct(productId, catalogue)
    return product ? tl(product.shortName) : productId
  }

  const remove = (item: ShoppingItem) => {
    dispatch({ type: 'REMOVE_FROM_SHOPPING', productId: item.productId })
    setRemoved(item)
  }

  return (
    <main className="screen">
      <header className="screen-header">
        <h1>{t('shopping.title')}</h1>
        {state.shopping.length > 0 && (
          <p className="muted small">
            {t(`shopping.count.${state.shopping.length === 1 ? 'one' : 'other'}`, {
              count: state.shopping.length,
            })}
          </p>
        )}
      </header>

      {state.shopping.length === 0 ? (
        <p className="card muted">{t('shopping.empty')}</p>
      ) : (
        <ul className={`list card ${styles.list}`}>
          {state.shopping.map((item) => {
            const product = getProduct(item.productId, catalogue)
            const entry = state.stack.find((s) => s.productId === item.productId)
            const status = bottleStatus(entry, catalogue)
            const name = nameOf(item.productId)
            const chip =
              item.reason === 'low'
                ? t('shopping.chipLow')
                : item.reason === 'manual'
                  ? t('shopping.chipManual')
                  : item.replacesProductId
                    ? t('shopping.chipInstead', { product: nameOf(item.replacesProductId) })
                    : null
            return (
              <li key={item.productId} className={styles.item}>
                <div className={styles.info}>
                  <strong>{product ? tl(product.name) : item.productId}</strong>
                  {product && <span className="small muted">{product.brand}</span>}
                  {status && <span className="small">{status}</span>}
                  {chip && (
                    <span className={`tag ${item.reason === 'low' ? styles.low : ''}`}>{chip}</span>
                  )}
                </div>
                <div className={styles.actions}>
                  {entry && (
                    <button
                      type="button"
                      className="btn btn--small btn--primary"
                      onClick={() =>
                        setBottle({
                          productId: item.productId,
                          kind: entry.inventory ? 'refill' : 'track',
                        })
                      }
                    >
                      {t('bottle.refill')}
                    </button>
                  )}
                  {product?.sourceUrl && product.brand === 'New Roots Herbal' && (
                    <a
                      className="btn btn--small btn--outline"
                      href={buyOnlineUrl(product.sourceUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('shopping.buyOnlineLabel', { product: name })}
                    >
                      {t('shopping.buyOnline')} ›
                    </a>
                  )}
                  <MoreInfoButton product={name} onClick={() => setInfo(item.productId)} />
                  <button
                    type="button"
                    className="btn btn--small btn--link"
                    onClick={() => remove(item)}
                  >
                    {t('common.remove')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {removed && (
        <div className={`notice ${styles.toast}`} role="status">
          <span>{t('shopping.removed', { product: nameOf(removed.productId) })}</span>
          <button
            type="button"
            className="btn btn--small btn--link"
            onClick={() => {
              dispatch({ type: 'RESTORE_SHOPPING', item: removed })
              setRemoved(null)
            }}
          >
            {t('shopping.undo')}
          </button>
        </div>
      )}

      <ProductInfoSheet productId={info} onClose={closeInfo} />
      {bottle && (
        <BottleSheet
          productId={bottle.productId}
          kind={bottle.kind}
          onClose={() => setBottle(null)}
          // Tracking a new bottle from the list means it was bought: it leaves the list.
          {...(bottle.kind === 'track'
            ? {
                onDone: () =>
                  dispatch({ type: 'REMOVE_FROM_SHOPPING', productId: bottle.productId }),
              }
            : {})}
        />
      )}
    </main>
  )
}
