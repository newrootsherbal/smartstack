import { findDuplicateIngredients, getIngredient, getProduct } from '@smartstack/engine'
import { MAX_DOSES_PER_DAY } from '@smartstack/shared'
import { Link } from 'react-router'
import { formatAmount, formatServingSize, timesLabel } from '../format'
import { t, tl } from '../i18n'
import { useAppState } from '../state/context'
import styles from './StackScreen.module.css'

export function StackScreen() {
  const { state, dispatch } = useAppState()
  const duplicates = findDuplicateIngredients(state.stack)

  const remove = (productId: string) => {
    const product = getProduct(productId)
    const name = product ? tl(product.shortName) : productId
    if (window.confirm(t('stack.removeConfirm', { product: name }))) {
      dispatch({ type: 'REMOVE_PRODUCT', productId })
    }
  }

  return (
    <main className="screen">
      <header className="screen-header">
        <h1>{t('stack.title')}</h1>
        {state.stack.length > 0 && (
          <p className="muted small">{t('stack.count', { count: state.stack.length })}</p>
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
            const product = getProduct(item.productId)
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
            return (
              <li key={item.productId} className={styles.item}>
                <div className={styles.info}>
                  <strong>{tl(product.name)}</strong>
                  <span className="small muted">
                    {product.brand} · {formatServingSize(product.servingSize)}
                    {item.dosesPerDay !== product.dosesPerDayDefault &&
                      ` · ${t('stack.labelSays', { times: timesLabel(product.dosesPerDayDefault) })}`}
                  </span>
                </div>
                <label className={styles.doses}>
                  <span className="visually-hidden">{t('common.timesPerDay')}</span>
                  <select
                    className="input"
                    value={item.dosesPerDay}
                    onChange={(e) =>
                      dispatch({
                        type: 'SET_DOSES',
                        productId: item.productId,
                        dosesPerDay: Number(e.target.value),
                      })
                    }
                  >
                    {Array.from({ length: MAX_DOSES_PER_DAY }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {timesLabel(n)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn--small btn--danger"
                  onClick={() => remove(item.productId)}
                >
                  {t('common.remove')}
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
            const ingredient = getIngredient(d.ingredientId)
            const name = ingredient ? tl(ingredient.name) : d.ingredientId
            return (
              <div key={d.ingredientId} className="stack-v">
                <h3>{name}</h3>
                <ul className={styles.amounts}>
                  {d.entries.map((e) => {
                    const p = getProduct(e.productId)
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
    </main>
  )
}
