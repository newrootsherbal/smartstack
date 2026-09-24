import { findProductByBarcode, listProducts, normalizeBarcode } from '@smartstack/engine'
import { MAX_DOSES_PER_DAY, type Product } from '@smartstack/shared'
import { lazy, Suspense, useCallback, useState } from 'react'
import { Link } from 'react-router'
import { ProductCard } from '../components/ProductCard'
import { t, tl } from '../i18n'
import { hasCamera } from '../platform/scanner'
import { useAppState } from '../state/context'
import styles from './AddSupplement.module.css'

const ScanView = lazy(() => import('./ScanView'))

type Mode = 'scan' | 'manual' | 'list'

// Decided once at load: a device without a camera opens on the sample list.
const DEFAULT_MODE: Mode = hasCamera() ? 'scan' : 'list'

export function AddSupplement() {
  const { state, dispatch } = useAppState()
  const [mode, setMode] = useState<Mode>(DEFAULT_MODE)
  const [upc, setUpc] = useState('')
  const [candidate, setCandidate] = useState<Product | null>(null)
  const [doses, setDoses] = useState(1)
  const [notFound, setNotFound] = useState<string | null>(null)
  const [added, setAdded] = useState<Product | null>(null)

  const select = useCallback(
    (product: Product) => {
      const inStack = state.stack.find((s) => s.productId === product.id)
      setNotFound(null)
      setAdded(null)
      setCandidate(product)
      setDoses(inStack?.dosesPerDay ?? product.dosesPerDayDefault)
    },
    [state.stack],
  )

  const lookup = useCallback(
    (code: string) => {
      const normalized = normalizeBarcode(code)
      if (!normalized) return
      const product = findProductByBarcode(normalized)
      if (!product) {
        setNotFound(normalized)
        setCandidate(null)
        return
      }
      select(product)
    },
    [select],
  )

  const confirm = () => {
    if (!candidate) return
    dispatch({ type: 'ADD_PRODUCT', productId: candidate.id, dosesPerDay: doses })
    setAdded(candidate)
    setCandidate(null)
    setUpc('')
  }

  const inStack = candidate ? state.stack.some((s) => s.productId === candidate.id) : false

  return (
    <main className="screen">
      <h1>{t('add.title')}</h1>

      <div className={styles.tabs} role="tablist">
        {(['scan', 'manual', 'list'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`${styles.tab} ${mode === m ? styles.tabActive : ''}`}
            onClick={() => {
              setMode(m)
              setNotFound(null)
            }}
          >
            {t(`add.${m}`)}
          </button>
        ))}
      </div>

      {added && (
        <div className="notice stack-v">
          <p>{t('add.added', { product: tl(added.shortName) })}</p>
          <div className="row">
            <Link to="/today" className="btn btn--small btn--primary">
              {t('add.viewToday')}
            </Link>
            <button
              type="button"
              className="btn btn--small btn--outline"
              onClick={() => setAdded(null)}
            >
              {t('add.addAnother')}
            </button>
          </div>
        </div>
      )}

      {candidate ? (
        <section className="stack-v">
          <h2>{t('add.confirmTitle')}</h2>
          <ProductCard product={candidate} />
          {inStack && <p className="notice">{t('add.alreadyInStack')}</p>}
          <div className="field">
            <label className="field__label" htmlFor="doses">
              {t('common.dosesPerDay')}
            </label>
            <select
              id="doses"
              className="input"
              value={doses}
              onChange={(e) => setDoses(Number(e.target.value))}
            >
              {Array.from({ length: MAX_DOSES_PER_DAY }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {t('common.perDay', { n })}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={confirm}>
              {t('add.addToStack')}
            </button>
            <button type="button" className="btn btn--outline" onClick={() => setCandidate(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </section>
      ) : (
        <>
          {notFound && (
            <div className="notice notice--warn stack-v" role="alert">
              <strong>{t('add.notFound')}</strong>
              <span className="small">
                {t('add.notFoundHint')} <span className="muted">({notFound})</span>
              </span>
            </div>
          )}

          {mode === 'scan' && (
            <Suspense fallback={<p className="muted">{t('add.scanStarting')}</p>}>
              <ScanView onDetected={lookup} onUnavailable={() => setMode('manual')} />
            </Suspense>
          )}

          {mode === 'manual' && (
            <form
              className="stack-v"
              onSubmit={(e) => {
                e.preventDefault()
                lookup(upc)
              }}
            >
              <div className="field">
                <label className="field__label" htmlFor="upc">
                  {t('add.upcLabel')}
                </label>
                <input
                  id="upc"
                  className="input"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={t('add.upcPlaceholder')}
                  value={upc}
                  onChange={(e) => setUpc(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn--primary" disabled={upc.trim() === ''}>
                {t('add.lookup')}
              </button>
            </form>
          )}

          {mode === 'list' && (
            <ul className={`list card ${styles.productList}`}>
              {listProducts().map((p) => (
                <li key={p.id}>
                  <button type="button" className={styles.productButton} onClick={() => select(p)}>
                    <span>
                      <strong>{tl(p.name)}</strong>
                      <span className="small muted"> · {p.form}</span>
                    </span>
                    <span className="tag tag--sample">{t('common.sample')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  )
}
