import { findProductByBarcode, normalizeBarcode, searchProducts } from '@smartstack/engine'
import { MAX_DOSES_PER_DAY, type Product } from '@smartstack/shared'
import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ProductCard } from '../components/ProductCard'
import { formatUnits, timesLabel } from '../format'
import { useProductText } from '../hooks/useProductText'
import { t, tl } from '../i18n'
import { hasCamera } from '../platform/scanner'
import { useAppState } from '../state/context'
import styles from './AddSupplement.module.css'

const ScanView = lazy(() => import('./ScanView'))

type Mode = 'scan' | 'manual' | 'browse'

// Decided once at load: a device without a camera opens on the product list.
const DEFAULT_MODE: Mode = hasCamera() ? 'scan' : 'browse'
const MAX_RESULTS = 60

export function AddSupplement() {
  const { state, dispatch } = useAppState()
  const [mode, setMode] = useState<Mode>(DEFAULT_MODE)
  const [upc, setUpc] = useState('')
  const [query, setQuery] = useState('')
  const [candidate, setCandidate] = useState<Product | null>(null)
  const [doses, setDoses] = useState(1)
  const [adjusting, setAdjusting] = useState(false)
  const [notFound, setNotFound] = useState<string | null>(null)
  const [added, setAdded] = useState<Product | null>(null)
  const text = useProductText(candidate)

  const select = useCallback(
    (product: Product) => {
      const inStack = state.stack.find((s) => s.productId === product.id)
      setNotFound(null)
      setAdded(null)
      setCandidate(product)
      setDoses(inStack?.dosesPerDay ?? product.dosesPerDayDefault)
      setAdjusting(!!inStack && inStack.dosesPerDay !== product.dosesPerDayDefault)
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

  const results = useMemo(() => searchProducts(query), [query])
  const inStack = candidate ? state.stack.some((s) => s.productId === candidate.id) : false

  return (
    <main className="screen">
      <h1>{t('add.title')}</h1>

      <div className={styles.tabs} role="tablist">
        {(['scan', 'manual', 'browse'] as Mode[]).map((m) => (
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

          <div className="card stack-v">
            <p className="small" style={{ fontWeight: 600 }}>
              {t('add.suggestedUse')}
            </p>
            <p className="small">
              {text ? (text.directions ? tl(text.directions) : '—') : t('common.loading')}
            </p>
          </div>

          {inStack && <p className="notice">{t('add.alreadyInStack')}</p>}

          <div className={`card ${styles.doseCard}`}>
            <div>
              <p className="small muted">{t('common.timesPerDay')}</p>
              <p>
                <strong>{timesLabel(doses)}</strong>
                {candidate.unitsPerDose && (
                  <span className="muted">
                    {' '}
                    · {formatUnits(candidate.unitsPerDose, candidate.form, candidate.unitLabel)}
                  </span>
                )}
                {doses === candidate.dosesPerDayDefault && (
                  <span className="small muted"> ({t('common.fromLabel')})</span>
                )}
              </p>
            </div>
            {adjusting ? (
              <label className="field">
                <span className="visually-hidden">{t('common.timesPerDay')}</span>
                <select
                  className="input"
                  value={doses}
                  onChange={(e) => setDoses(Number(e.target.value))}
                >
                  {Array.from({ length: MAX_DOSES_PER_DAY }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {timesLabel(n)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <button
                type="button"
                className="btn btn--small btn--outline"
                onClick={() => setAdjusting(true)}
              >
                {t('add.adjust')}
              </button>
            )}
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

          {mode === 'browse' && (
            <div className="stack-v">
              <input
                className="input"
                type="search"
                autoComplete="off"
                placeholder={t('add.searchPlaceholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={t('add.searchPlaceholder')}
              />
              <p className="small muted">{t('add.results', { count: results.length })}</p>
              {results.length === 0 ? (
                <p className="notice">{t('add.noResults', { query })}</p>
              ) : (
                <ul className={`list card ${styles.productList}`}>
                  {results.slice(0, MAX_RESULTS).map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={styles.productButton}
                        onClick={() => select(p)}
                      >
                        <span>
                          <strong>{tl(p.name)}</strong>
                          {p.subtitle && <span className="small muted"> · {tl(p.subtitle)}</span>}
                        </span>
                        {p.status === 'sample' && (
                          <span className="tag tag--sample">{t('common.sample')}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </main>
  )
}
