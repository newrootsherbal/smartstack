import {
  findProductByBarcode,
  inventoryUnitFor,
  normalizeBarcode,
  rulesForProduct,
  searchProducts,
} from '@smartstack/engine'
import { MAX_DOSES_PER_DAY, SYNC_MAX_STACK_ITEMS, type Product } from '@smartstack/shared'
import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { bottleFromDraft, initialBottleDraft, type BottleDraft } from '../bottle'
import { BottleCard } from '../components/BottleCard'
import { ProductCard } from '../components/ProductCard'
import { OtherBrandForm } from './OtherBrandForm'
import { Sheet } from '../components/Sheet'
import { ACCOUNTS_PUBLIC } from '../config'
import { formatUnits, parseCount, timesLabel } from '../format'
import { useProductText } from '../hooks/useProductText'
import { t, tl } from '../i18n'
import { hasCamera } from '../platform/scanner'
import { useCatalogue } from '../catalogue'
import { useAppState } from '../state/context'
import styles from './AddSupplement.module.css'

const ScanView = lazy(() => import('./ScanView'))

type Mode = 'scan' | 'manual' | 'browse' | 'other'

// Decided once at load: a device without a camera opens on the product list.
const DEFAULT_MODE: Mode = hasCamera() ? 'scan' : 'browse'
const MAX_RESULTS = 60

export function AddSupplement() {
  const { state, dispatch } = useAppState()
  const catalogue = useCatalogue()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState<Mode>(() =>
    params.get('mode') === 'other' ? 'other' : DEFAULT_MODE,
  )
  // /add?mode=other[&upc=…][&edit=u_…] (the unknown-barcode sheet, Manage → Edit product).
  const otherUpc = params.get('upc') ?? undefined
  const otherEdit = params.get('edit') ?? undefined
  const [lastParams, setLastParams] = useState(params.toString())
  if (params.toString() !== lastParams) {
    setLastParams(params.toString())
    if (params.get('mode') === 'other') setMode('other')
  }
  // Other brands need an account; the tab shows once accounts are public (to explain why).
  const showOther = state.auth.mode === 'account' || ACCOUNTS_PUBLIC
  const [upc, setUpc] = useState('')
  const [query, setQuery] = useState('')
  const [candidate, setCandidate] = useState<Product | null>(null)
  const [doses, setDoses] = useState(1)
  const [adjusting, setAdjusting] = useState(false)
  const [notFound, setNotFound] = useState<string | null>(null)
  const [added, setAdded] = useState<Product | null>(null)
  const [atBedtime, setAtBedtime] = useState(false)
  const [bottle, setBottle] = useState<BottleDraft | null>(null)
  const [perDose, setPerDose] = useState('1')
  const [invalid, setInvalid] = useState(false)
  const [stackFull, setStackFull] = useState(false)
  const text = useProductText(candidate)

  const select = useCallback(
    (product: Product, scannedUpc: string | null = null) => {
      const inStack = state.stack.find((s) => s.productId === product.id)
      setNotFound(null)
      setAdded(null)
      setCandidate(product)
      setDoses(inStack?.dosesPerDay ?? product.dosesPerDayDefault)
      setAdjusting(!!inStack && inStack.dosesPerDay !== product.dosesPerDayDefault)
      setAtBedtime(false)
      // A bottle already tracked keeps its count; otherwise "New bottle" is preselected and
      // a scanned barcode says which size it is.
      setBottle(inStack?.inventory ? null : initialBottleDraft(product, scannedUpc))
      setPerDose('1')
      setInvalid(false)
      setStackFull(false)
    },
    [state.stack],
  )

  const lookup = useCallback(
    (code: string) => {
      const normalized = normalizeBarcode(code)
      if (!normalized) return
      const product = findProductByBarcode(normalized, catalogue)
      if (!product) {
        setNotFound(normalized)
        setCandidate(null)
        return
      }
      select(product, normalized)
    },
    [select, catalogue],
  )

  const confirm = () => {
    if (!candidate) return
    // An account keeps at most SYNC_MAX_STACK_ITEMS products in its stack (the Worker's limit).
    if (
      state.auth.mode === 'account' &&
      !state.stack.some((s) => s.productId === candidate.id) &&
      state.stack.length >= SYNC_MAX_STACK_ITEMS
    ) {
      setStackFull(true)
      return
    }
    const result = bottle ? bottleFromDraft(bottle, candidate) : { kind: 'none' as const }
    const units = askPerDose ? parseCount(perDose) : null
    if (result.kind === 'invalid' || (askPerDose && (units === null || units <= 0))) {
      setInvalid(true)
      return
    }
    // "Take it at bedtime" pins the day's last dose (slot doses - 1) to bedtime.
    const pins = atBedtime
      ? [...Array.from({ length: doses - 1 }, () => null), 'bedtime' as const]
      : undefined
    dispatch({
      type: 'ADD_PRODUCT',
      productId: candidate.id,
      dosesPerDay: doses,
      ...(pins ? { pins } : {}),
      ...(result.kind === 'bottle'
        ? {
            bottle: result.bottle,
            ...(result.variantUpc ? { variantUpc: result.variantUpc } : {}),
          }
        : {}),
      ...(askPerDose && units ? { unitsPerDose: units } : {}),
    })
    setAdded(candidate)
    setCandidate(null)
    setUpc('')
  }

  const results = useMemo(() => searchProducts(query, catalogue), [query, catalogue])
  const mine = results.filter((p) => p.status === 'user')
  const theirs = results.filter((p) => p.status !== 'user')
  // An unknown code opens a sheet for accounts (add it by hand) and, once accounts are public,
  // for guests (why an account helps). Otherwise the plain "not found" notice stays.
  const unknownSheet = state.auth.mode === 'account' || ACCOUNTS_PUBLIC
  const inStack = candidate ? state.stack.some((s) => s.productId === candidate.id) : false
  // The label doesn't say how many units a dose is: ask, since the bottle count needs it.
  const askPerDose =
    !!candidate &&
    !!bottle &&
    bottle.mode !== 'none' &&
    inventoryUnitFor(candidate.form) === 'unit' &&
    !candidate.unitsPerDose
  const suggestsBedtime = candidate
    ? rulesForProduct(candidate, catalogue).some((r) => r.attribute === 'SUGGEST_BEDTIME')
    : false

  return (
    <main className="screen">
      <h1>{t('add.title')}</h1>

      <div className={styles.tabs} role="tablist">
        {(['scan', 'manual', 'browse', 'other'] as Mode[])
          .filter((m) => m !== 'other' || showOther)
          .map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`${styles.tab} ${mode === m ? styles.tabActive : ''}`}
              onClick={() => {
                setMode(m)
                setNotFound(null)
                if (params.size > 0) setParams({}, { replace: true })
              }}
            >
              {m === 'other' ? t('other.tab') : t(`add.${m}`)}
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

      {mode === 'other' ? (
        state.auth.mode === 'account' ? (
          <OtherBrandForm
            key={`${otherUpc ?? ''}:${otherEdit ?? ''}`}
            upc={otherUpc}
            editId={otherEdit}
            onDone={() => navigate('/stack')}
            onCancel={() => {
              setMode(DEFAULT_MODE)
              setParams({}, { replace: true })
            }}
          />
        ) : (
          <section className="card stack-v">
            <h2>{t('other.needAccountTitle')}</h2>
            <p className="small muted">{t('other.needAccount')}</p>
            <div className="row">
              <Link to="/signup?from=/add" className="btn btn--primary">
                {t('backup.create')}
              </Link>
              <Link to="/login?from=/add" className="btn btn--outline">
                {t('backup.login')}
              </Link>
            </div>
          </section>
        )
      ) : candidate ? (
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

          {candidate.ingredients.length === 0 && text?.facts && (
            <div className="card stack-v">
              <p className="small" style={{ fontWeight: 600 }}>
                {t('add.labelFacts')}
              </p>
              <p className="small">{tl(text.facts)}</p>
            </div>
          )}

          {candidate.kind === 'topical' && (
            <p className="notice notice--warn" role="alert">
              {t('add.topicalNotice')}
            </p>
          )}
          {inStack && <p className="notice">{t('add.alreadyInStack')}</p>}
          {stackFull && (
            <p className="notice notice--warn" role="alert">
              {t('add.stackFull', { max: SYNC_MAX_STACK_ITEMS })}
            </p>
          )}

          {candidate.kind !== 'topical' && (
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
          )}

          {candidate.kind !== 'topical' && bottle && (
            <BottleCard
              product={candidate}
              draft={bottle}
              onChange={(d) => {
                setBottle(d)
                setInvalid(false)
              }}
              invalid={invalid}
            />
          )}

          {askPerDose && (
            <label className="card field">
              <span className="field__label">{t('bottle.perDoseQuestion')}</span>
              <span className="small muted">{t('bottle.perDoseHint')}</span>
              <input
                className="input"
                inputMode="decimal"
                value={perDose}
                onChange={(e) => {
                  setPerDose(e.target.value)
                  setInvalid(false)
                }}
              />
            </label>
          )}

          {candidate.kind !== 'topical' && suggestsBedtime && (
            <label className={`card ${styles.checkbox}`}>
              <input
                type="checkbox"
                checked={atBedtime}
                onChange={(e) => setAtBedtime(e.target.checked)}
              />
              <span>{t('add.takeAtBedtime')}</span>
            </label>
          )}

          <div className="row">
            <button
              type="button"
              className="btn btn--primary"
              onClick={confirm}
              disabled={candidate.kind === 'topical'}
            >
              {t('add.addToStack')}
            </button>
            <button type="button" className="btn btn--outline" onClick={() => setCandidate(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </section>
      ) : (
        <>
          {notFound && !unknownSheet && (
            <div className="notice notice--warn stack-v" role="alert">
              <strong>{t('add.notFound')}</strong>
              <span className="small">
                {t('add.notFoundHint')} <span className="muted">({notFound})</span>
              </span>
            </div>
          )}

          {mode === 'scan' && (
            <Suspense fallback={<p className="muted">{t('add.scanStarting')}</p>}>
              <ScanView
                onDetected={lookup}
                onUnavailable={() => setMode('manual')}
                paused={notFound !== null && unknownSheet}
              />
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
                  {/* The person's own products first, under their own heading. */}
                  {mine.length > 0 && (
                    <li className={styles.listHeading}>{t('other.yourProducts')}</li>
                  )}
                  {[...mine, ...theirs].slice(0, MAX_RESULTS).map((p) => (
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
      <Sheet
        open={notFound !== null && unknownSheet}
        onClose={() => setNotFound(null)}
        title={state.auth.mode === 'account' ? t('add.unknownTitle') : t('add.notFound')}
      >
        {state.auth.mode === 'account' ? (
          <>
            <p className="muted">{t('add.unknownCode', { code: notFound ?? '' })}</p>
            <div className="row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => navigate(`/add?mode=other&upc=${notFound ?? ''}`)}
              >
                {t('add.addManually')}
              </button>
              <button type="button" className="btn btn--outline" onClick={() => setNotFound(null)}>
                {t('add.scanAgain')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>{t('add.guestUnknown')}</p>
            <div className="row">
              <Link to="/signup?from=/add" className="btn btn--primary">
                {t('backup.create')}
              </Link>
              <Link to="/login?from=/add" className="btn btn--outline">
                {t('backup.login')}
              </Link>
              <button type="button" className="btn btn--link" onClick={() => setNotFound(null)}>
                {t('add.notNow')}
              </button>
            </div>
          </>
        )}
      </Sheet>
    </main>
  )
}
