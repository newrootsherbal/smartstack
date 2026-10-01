import { findDuplicateIngredients, getIngredient, getProduct } from '@smartstack/engine'
import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import { bottleStatus } from '../bottle'
import { BottleSheet, type BottleSheetKind } from '../components/BottleSheet'
import { ManageSheet, type ManageAction } from '../components/ManageSheet'
import { MoreInfoButton } from '../components/MoreInfoButton'
import { ProductInfoSheet } from '../components/ProductInfoSheet'
import { formatAmount, timesLabel } from '../format'
import { t, tl } from '../i18n'
import { useCatalogue } from '../catalogue'
import { useAppState } from '../state/context'
import styles from './StackScreen.module.css'

export function StackScreen() {
  const { state, dispatch } = useAppState()
  const catalogue = useCatalogue()
  const duplicates = findDuplicateIngredients(state.stack, catalogue)
  const [info, setInfo] = useState<string | null>(null)
  const closeInfo = useCallback(() => setInfo(null), [])
  const [manage, setManage] = useState<string | null>(null)
  const [bottle, setBottle] = useState<{ productId: string; kind: BottleSheetKind } | null>(null)

  const openFromManage = (productId: string, action: ManageAction) => {
    setManage(null)
    if (action === 'info') setInfo(productId)
    else setBottle({ productId, kind: action })
  }

  return (
    <main className="screen">
      <header className="screen-header">
        <h1>{t('stack.title')}</h1>
        {state.stack.length > 0 && (
          <p className="muted small">
            {t(`stack.count.${state.stack.length === 1 ? 'one' : 'other'}`, {
              count: state.stack.length,
            })}
          </p>
        )}
      </header>

      {state.stack.length === 0 ? (
        <div className="card stack-v">
          <h2>{t('stack.empty')}</h2>
          <p className="muted">{t('stack.emptyHint')}</p>
          <Link to="/add" className="btn btn--primary">
            {t('stack.addFirst')}
          </Link>
        </div>
      ) : (
        <ul className={`list card ${styles.list}`}>
          {state.stack.map((item) => {
            const product = getProduct(item.productId, catalogue)
            if (!product) {
              return (
                <li key={item.productId} className={styles.item}>
                  <div className={styles.info}>
                    <strong>{item.productId}</strong>
                    <span className="small muted">{t('stack.unknownProduct')}</span>
                    <span className="small muted">{t('stack.unknownHint')}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn--small btn--danger"
                    onClick={() => dispatch({ type: 'REMOVE_PRODUCT', productId: item.productId })}
                  >
                    {t('common.remove')}
                  </button>
                </li>
              )
            }
            const status = bottleStatus(item, catalogue)
            const name = tl(product.shortName)
            return (
              <li key={item.productId} className={styles.item}>
                <div className={styles.info}>
                  <strong>{tl(product.name)}</strong>
                  <span className="small muted">
                    {product.brand} · {timesLabel(item.dosesPerDay)}
                    {item.dosesPerDay !== product.dosesPerDayDefault &&
                      ` (${t('stack.labelSays', { times: timesLabel(product.dosesPerDayDefault) })})`}
                  </span>
                  {status ? (
                    <span className="small">{status}</span>
                  ) : (
                    <span className="small muted">
                      {t('bottle.notTracked')} ·{' '}
                      <button
                        type="button"
                        className={`btn btn--link btn--small ${styles.inline}`}
                        onClick={() => setBottle({ productId: item.productId, kind: 'track' })}
                      >
                        {t('bottle.track')}
                      </button>
                    </span>
                  )}
                  <MoreInfoButton
                    product={name}
                    className={styles.moreInfo}
                    onClick={() => setInfo(product.id)}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn--small btn--outline"
                  aria-label={t('manage.buttonLabel', { product: name })}
                  onClick={() => setManage(item.productId)}
                >
                  {t('manage.button')}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {state.stack.length > 0 && (
        <Link to="/add" className="btn btn--outline">
          {t('stack.addFirst')}
        </Link>
      )}

      {duplicates.length > 0 && (
        <section className={`card stack-v ${styles.overlap}`}>
          <h2>{t('stack.overlapTitle')}</h2>
          {duplicates.map((d) => {
            const ingredient = getIngredient(d.ingredientId, catalogue)
            const name = ingredient ? tl(ingredient.name) : d.ingredientId
            return (
              <div key={d.ingredientId} className="stack-v">
                <h3>{name}</h3>
                <ul className={styles.amounts}>
                  {d.entries.map((e) => {
                    const p = getProduct(e.productId, catalogue)
                    return (
                      <li key={e.productId}>
                        <span>{p ? tl(p.shortName) : e.productId}</span>
                        <span className="muted">
                          {e.dosesPerDay > 1
                            ? t('stack.perDay', {
                                amount: formatAmount(e.amountPerDose, d.unit),
                                doses: e.dosesPerDay,
                              })
                            : formatAmount(e.amountPerDose, d.unit)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
                <p>{t('stack.overlapTotal', { total: formatAmount(d.total, d.unit) })}</p>
              </div>
            )
          })}
          <div className={styles.review}>
            <strong>{t('stack.reviewTitle')}</strong>
            <p className="small">{t('stack.reviewBody')}</p>
          </div>
        </section>
      )}
      <ProductInfoSheet productId={info} onClose={closeInfo} />
      {manage && (
        <ManageSheet
          productId={manage}
          onClose={() => setManage(null)}
          onOpen={(action) => openFromManage(manage, action)}
        />
      )}
      {bottle && (
        <BottleSheet
          productId={bottle.productId}
          kind={bottle.kind}
          onClose={() => setBottle(null)}
        />
      )}
    </main>
  )
}
