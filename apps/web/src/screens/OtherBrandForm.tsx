import { inventoryUnitFor } from '@smartstack/engine'
import {
  DOSE_UNITS,
  INGREDIENT_UNITS,
  MAX_DOSES_PER_DAY,
  PIN_ANCHORS,
  PREFILL_FORMS,
  SYNC_MAX_USER_PRODUCTS,
  USER_PRODUCT_TIMINGS,
  type DoseUnit,
  type IngredientUnit,
  type PinAnchor,
  type UserProductTiming,
} from '@smartstack/shared'
import { lazy, Suspense, useId, useState, type ReactNode } from 'react'
import { accountApi } from '../api/account'
import { ApiError } from '../api/client'
import { authErrorMessage } from '../auth/flows'
import { getSessionToken } from '../auth/store'
import { Sheet } from '../components/Sheet'
import { useCatalogue } from '../catalogue'
import { bottleUnitWord, parseCount, timesLabel } from '../format'
import { getLocale, lookupMessage, t, tl, type MessageKey } from '../i18n'
import {
  applyPrefill,
  draftToUserProduct,
  emptyDraft,
  userPackageSize,
  userProductToDraft,
  validateDraft,
  type DraftField,
  type OtherBrandDraft,
  type OtherBrandType,
} from '../otherBrand'
import { useAppState } from '../state/context'
import styles from './OtherBrandForm.module.css'

const ScanView = lazy(() => import('./ScanView'))

const PIN_LABELS: Record<PinAnchor, MessageKey> = {
  wake: 'onboarding.wake',
  breakfast: 'onboarding.breakfast',
  lunch: 'onboarding.lunch',
  dinner: 'onboarding.dinner',
  bedtime: 'onboarding.bedtime',
}

function doseUnitLabel(unit: DoseUnit): string {
  if (unit === 'other') return t('other.doseUnitOther')
  return lookupMessage(`unitLabel.${unit}.other`) ?? unit
}

interface OtherBrandFormProps {
  /** Prefilled from the unknown-barcode sheet. */
  upc?: string | undefined
  /** Editing a product the person already added. */
  editId?: string | undefined
  onDone: (productId: string) => void
  onCancel: () => void
}

type BottleMode = 'new' | 'opened' | 'none'

/**
 * Products from other brands, medications and foods (accounts only). The person reviews
 * everything, including what Health Canada filled in, before saving.
 */
export function OtherBrandForm({ upc, editId, onDone, onCancel }: OtherBrandFormProps) {
  const { state, dispatch } = useAppState()
  const catalogue = useCatalogue()
  const id = useId()
  const editing = editId ? state.userProducts.find((p) => p.id === editId) : undefined
  const entry = editId ? state.stack.find((s) => s.productId === editId) : undefined
  const [draft, setDraft] = useState<OtherBrandDraft | null>(() =>
    editing ? userProductToDraft(editing, entry?.pins ?? []) : null,
  )
  const [errors, setErrors] = useState<DraftField[]>([])
  const [bottleMode, setBottleMode] = useState<BottleMode>(editing ? 'none' : 'new')
  const [full, setFull] = useState('')
  const [left, setLeft] = useState('')
  const [bottleInvalid, setBottleInvalid] = useState(false)
  const [lookup, setLookup] = useState<{ busy: boolean; message: string | null }>({
    busy: false,
    message: null,
  })
  const [scanning, setScanning] = useState(false)
  const [limit, setLimit] = useState(false)

  const pickType = (type: OtherBrandType) => setDraft(emptyDraft(type, upc ?? ''))

  if (!draft) {
    return (
      <section className="stack-v">
        <h2>{t('other.kindQuestion')}</h2>
        {(['nhp', 'medication', 'other'] as const).map((type) => (
          <button
            key={type}
            type="button"
            className={`card ${styles.kind}`}
            onClick={() => pickType(type)}
          >
            <strong>{t(`other.kind.${type}`)}</strong>
            <span className="small muted">{t(`other.kindHint.${type}`)}</span>
          </button>
        ))}
        <button type="button" className="btn btn--outline" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </section>
    )
  }

  const medication = draft.type === 'medication'
  const set = (next: Partial<OtherBrandDraft>) => setDraft({ ...draft, ...next })
  const invalid = (field: DraftField) => errors.includes(field)
  const unit = inventoryUnitFor(draft.form || 'other')
  const word = bottleUnitWord(unit, draft.form || 'other', draft.doseUnit || undefined)
  const knownSize = userPackageSize(draftToUserProduct(draft, 'u_preview', 0, catalogue))

  const fillFromHealthCanada = async () => {
    const kind = medication ? 'din' : 'npn'
    const number = (medication ? draft.din : draft.npn).replace(/\D/g, '')
    const session = getSessionToken()
    if (!session || number.length !== 8) {
      setErrors([medication ? 'din' : 'npn'])
      return
    }
    setLookup({ busy: true, message: null })
    try {
      const prefill = await accountApi.lookup(session, kind, number, getLocale())
      setDraft(applyPrefill(draft, prefill))
      setErrors([])
      setLookup({ busy: false, message: prefill.partial ? t('other.partial') : t('other.filled') })
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 404
          ? t('other.notFound')
          : err instanceof ApiError && (err.status === 502 || err.status === 504)
            ? t('other.lookupFailed')
            : err instanceof ApiError && err.code === 'invalid_number'
              ? t('other.notFound')
              : authErrorMessage(err)
      setLookup({ busy: false, message })
    }
  }

  const save = () => {
    const problems = validateDraft(draft)
    setErrors(problems)
    if (problems.length > 0) return
    if (!editing && state.userProducts.length >= SYNC_MAX_USER_PRODUCTS) {
      setLimit(true)
      return
    }
    const now = Date.now()
    const productId = editing?.id ?? `u_${crypto.randomUUID()}`
    const product = draftToUserProduct(draft, productId, now, catalogue, editing?.createdAt ?? now)
    let bottle = null
    if (bottleMode !== 'none') {
      const size = userPackageSize(product)?.quantity ?? parseCount(full)
      const remaining = bottleMode === 'new' ? size : parseCount(left)
      if (remaining === null || (bottleMode === 'new' && !remaining)) {
        setBottleInvalid(true)
        return
      }
      bottle = { remaining, unit: inventoryUnitFor(product.form), packageSize: size ?? null }
    }
    dispatch({ type: 'UPSERT_USER_PRODUCT', product })
    const pins = medication
      ? (draft.times.slice(0, product.dosesPerDay) as PinAnchor[])
      : (entry?.pins ?? undefined)
    dispatch({
      type: 'ADD_PRODUCT',
      productId,
      dosesPerDay: product.dosesPerDay,
      at: now,
      ...(pins ? { pins } : {}),
      ...(bottle ? { bottle } : {}),
    })
    onDone(productId)
  }

  const field = (name: DraftField | null, label: string, control: ReactNode, hint?: string) => (
    <label className="field">
      <span className="field__label">{label}</span>
      {hint && <span className="small muted">{hint}</span>}
      {control}
      {name && invalid(name) && (
        <span className="small notice notice--warn" role="alert">
          {t('other.check')}
        </span>
      )}
    </label>
  )

  const input = (
    name: DraftField | null,
    value: string,
    onChange: (value: string) => void,
    extra: { inputMode?: 'numeric' | 'decimal' | 'text'; maxLength?: number } = {},
  ) => (
    <input
      className="input"
      value={value}
      aria-invalid={name ? invalid(name) : undefined}
      autoComplete="off"
      {...(extra.inputMode ? { inputMode: extra.inputMode } : {})}
      {...(extra.maxLength ? { maxLength: extra.maxLength } : {})}
      onChange={(e) => onChange(e.target.value)}
    />
  )

  return (
    <form
      className={`stack-v ${styles.form}`}
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      noValidate
    >
      <h2>{editing ? t('other.editTitle') : t(`other.kind.${draft.type}`)}</h2>

      {medication && <p className="notice notice--warn">{t('notice.N3')}</p>}

      <section className="card stack-v">
        <h3>{t('other.product')}</h3>
        {!medication &&
          field(
            'brand',
            t('other.brand'),
            input('brand', draft.brand, (v) => set({ brand: v }), { maxLength: 80 }),
          )}
        {field(
          'name',
          medication ? t('other.medName') : t('other.name'),
          input('name', draft.name, (v) => set({ name: v }), { maxLength: 120 }),
        )}
        {medication &&
          field(
            null,
            t('other.company'),
            input(null, draft.brand, (v) => set({ brand: v }), { maxLength: 80 }),
          )}
        <div className={styles.inline}>
          {field(
            'upc',
            t('other.barcode'),
            input('upc', draft.upc, (v) => set({ upc: v }), {
              inputMode: 'numeric',
              maxLength: 14,
            }),
          )}
          <button
            type="button"
            className="btn btn--small btn--outline"
            onClick={() => setScanning(true)}
          >
            {t('other.scan')}
          </button>
        </div>
        {draft.type !== 'other' && (
          <div className={styles.inline}>
            {medication
              ? field(
                  'din',
                  t('other.din'),
                  input('din', draft.din, (v) => set({ din: v }), {
                    inputMode: 'numeric',
                    maxLength: 8,
                  }),
                )
              : field(
                  'npn',
                  t('other.npn'),
                  input('npn', draft.npn, (v) => set({ npn: v }), {
                    inputMode: 'numeric',
                    maxLength: 8,
                  }),
                )}
            <button
              type="button"
              className="btn btn--small btn--outline"
              disabled={lookup.busy}
              onClick={() => void fillFromHealthCanada()}
            >
              {lookup.busy ? t('other.filling') : t('other.fill')}
            </button>
          </div>
        )}
        {draft.type !== 'other' && <p className="small muted">{t('notice.N5')}</p>}
        {lookup.message && (
          <p className="notice small" role="status">
            {lookup.message}
          </p>
        )}
        {medication &&
          field(
            null,
            t('other.strength'),
            input(null, draft.strength, (v) => set({ strength: v }), { maxLength: 40 }),
          )}
      </section>

      <section className="card stack-v">
        <h3>{t('other.format')}</h3>
        {field(
          'form',
          t('other.form'),
          <select
            className="input"
            value={draft.form}
            aria-invalid={invalid('form')}
            onChange={(e) => set({ form: e.target.value as OtherBrandDraft['form'] })}
          >
            <option value="">—</option>
            {PREFILL_FORMS.map((f) => (
              <option key={f} value={f}>
                {t(`other.forms.${f}`)}
              </option>
            ))}
          </select>,
        )}
        <div className={styles.inline}>
          {field(
            'packageQuantity',
            medication ? t('other.bottleSizeOptional') : t('other.bottleSize'),
            input('packageQuantity', draft.packageQuantity, (v) => set({ packageQuantity: v }), {
              inputMode: 'decimal',
              maxLength: 8,
            }),
          )}
          <select
            className="input"
            aria-label={t('other.bottleUnit')}
            value={draft.packageUnit}
            onChange={(e) => set({ packageUnit: e.target.value as OtherBrandDraft['packageUnit'] })}
          >
            <option value="unit">{t('other.packageUnits.unit')}</option>
            <option value="ml">ml</option>
            <option value="g">g</option>
          </select>
        </div>
      </section>

      <section className="card stack-v">
        <h3>{t('other.dose')}</h3>
        <div className={styles.inline}>
          {field(
            'amountPerDose',
            t('other.amountPerDose'),
            input('amountPerDose', draft.amountPerDose, (v) => set({ amountPerDose: v }), {
              inputMode: 'decimal',
              maxLength: 6,
            }),
          )}
          {field(
            'doseUnit',
            t('other.doseUnit'),
            <select
              className="input"
              value={draft.doseUnit}
              aria-invalid={invalid('doseUnit')}
              onChange={(e) => set({ doseUnit: e.target.value as DoseUnit })}
            >
              <option value="">—</option>
              {DOSE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {doseUnitLabel(u)}
                </option>
              ))}
            </select>,
          )}
        </div>
        {field(
          null,
          t('common.timesPerDay'),
          <select
            className="input"
            value={draft.dosesPerDay}
            onChange={(e) => {
              const n = Number(e.target.value)
              set({
                dosesPerDay: n,
                times: Array.from({ length: n }, (_, i) => draft.times[i] ?? ''),
              })
            }}
          >
            {Array.from({ length: MAX_DOSES_PER_DAY }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {timesLabel(n)}
              </option>
            ))}
          </select>,
        )}
        {medication && (
          <fieldset className={styles.group} aria-invalid={invalid('times')}>
            <legend>{t('other.whenTitle')}</legend>
            {draft.times.slice(0, draft.dosesPerDay).map((time, i) => (
              <label key={i} className="field">
                {draft.dosesPerDay > 1 && (
                  <span className="field__label">{t('manage.doseN', { n: i + 1 })}</span>
                )}
                <select
                  className="input"
                  value={time}
                  onChange={(e) => {
                    const times = [...draft.times]
                    times[i] = e.target.value as PinAnchor | ''
                    set({ times })
                  }}
                >
                  <option value="">—</option>
                  {PIN_ANCHORS.map((a) => (
                    <option key={a} value={a}>
                      {t(PIN_LABELS[a])}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {invalid('times') && (
              <span className="small notice notice--warn" role="alert">
                {t('other.check')}
              </span>
            )}
          </fieldset>
        )}
      </section>

      {!medication && (
        <section className="card stack-v">
          <h3>{t('other.label')}</h3>
          {USER_PRODUCT_TIMINGS.map((timing: UserProductTiming) => (
            <label key={timing} className={styles.check}>
              <input
                type="checkbox"
                checked={draft.timing.includes(timing)}
                onChange={(e) =>
                  set({
                    timing: e.target.checked
                      ? [...draft.timing, timing]
                      : draft.timing.filter((x) => x !== timing),
                  })
                }
              />
              <span>{t(`other.timings.${timing}`)}</span>
            </label>
          ))}
        </section>
      )}

      <section className="card stack-v">
        <h3>{t('other.ingredients')}</h3>
        <p className="small muted">{t('other.ingredientsHint')}</p>
        <datalist id={`${id}-ingredients`}>
          {catalogue.ingredients.map((ing) => (
            <option key={ing.id} value={tl(ing.name)} />
          ))}
        </datalist>
        {draft.ingredients.map((row, i) => {
          const update = (next: Partial<typeof row>) => {
            const ingredients = [...draft.ingredients]
            ingredients[i] = { ...row, ...next }
            set({ ingredients })
          }
          return (
            <div key={i} className={styles.ingredient}>
              <input
                className="input"
                list={`${id}-ingredients`}
                aria-label={t('other.ingredient')}
                placeholder={t('other.ingredient')}
                maxLength={120}
                value={row.name}
                onChange={(e) => update({ name: e.target.value })}
              />
              <input
                className="input"
                inputMode="decimal"
                aria-label={t('other.amount')}
                placeholder={t('other.amount')}
                maxLength={10}
                value={row.amount}
                onChange={(e) => update({ amount: e.target.value })}
              />
              <select
                className="input"
                aria-label={t('other.ingredientUnit')}
                value={row.unit}
                onChange={(e) => update({ unit: e.target.value as IngredientUnit | '' })}
              >
                <option value="">—</option>
                {INGREDIENT_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {lookupMessage(`unit.${u}`) ?? u}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn--small btn--link"
                onClick={() => set({ ingredients: draft.ingredients.filter((_, j) => j !== i) })}
              >
                {t('common.remove')}
              </button>
            </div>
          )
        })}
        {draft.ingredients.length > 0 && draft.doseUnit && (
          <p className="small muted">
            {t('other.perUnit', {
              unit: lookupMessage(`unitLabel.${draft.doseUnit}.one`) ?? draft.doseUnit,
            })}
          </p>
        )}
        <button
          type="button"
          className="btn btn--small btn--outline"
          style={{ alignSelf: 'flex-start' }}
          onClick={() =>
            set({ ingredients: [...draft.ingredients, { name: '', amount: '', unit: '' }] })
          }
        >
          {t('other.addIngredient')}
        </button>
      </section>

      <section className="card stack-v">
        {field(
          null,
          t('other.directions'),
          <textarea
            className="input"
            rows={3}
            maxLength={1000}
            value={draft.directions}
            onChange={(e) => set({ directions: e.target.value })}
          />,
        )}
        {field(
          null,
          t('other.warnings'),
          <textarea
            className="input"
            rows={3}
            maxLength={1000}
            value={draft.warnings}
            onChange={(e) => set({ warnings: e.target.value })}
          />,
        )}
        {field(
          null,
          t('other.notes'),
          <textarea
            className="input"
            rows={2}
            maxLength={1000}
            value={draft.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />,
        )}
      </section>

      <section className="card stack-v">
        <p className="small" style={{ fontWeight: 600 }}>
          {t('bottle.title')}
        </p>
        <div className="row" role="radiogroup" aria-label={t('bottle.title')}>
          {(['new', 'opened', 'none'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={bottleMode === m}
              className={`btn btn--small ${bottleMode === m ? 'btn--primary' : 'btn--outline'}`}
              onClick={() => {
                setBottleMode(m)
                setBottleInvalid(false)
              }}
            >
              {t(
                m === 'new' ? 'bottle.new' : m === 'opened' ? 'bottle.opened' : 'bottle.dontTrack',
              )}
            </button>
          ))}
        </div>
        {bottleMode !== 'none' && !knownSize && (
          <label className="field">
            <span className="field__label">{t('bottle.fullQuestion', { units: word })}</span>
            <input
              className="input"
              inputMode="decimal"
              value={full}
              onChange={(e) => setFull(e.target.value)}
            />
          </label>
        )}
        {bottleMode === 'opened' && (
          <label className="field">
            <span className="field__label">{t('bottle.leftQuestion', { units: word })}</span>
            <input
              className="input"
              inputMode="decimal"
              value={left}
              onChange={(e) => setLeft(e.target.value)}
            />
          </label>
        )}
        {bottleInvalid && (
          <p className="small notice notice--warn" role="alert">
            {t('bottle.invalid')}
          </p>
        )}
      </section>

      {errors.length > 0 && (
        <p className="notice notice--error" role="alert">
          {t('other.fix')}
        </p>
      )}
      {limit && (
        <p className="notice notice--warn" role="alert">
          {t('other.limit', { max: SYNC_MAX_USER_PRODUCTS })}
        </p>
      )}
      <div className="row">
        <button type="submit" className="btn btn--primary">
          {editing ? t('other.saveEdit') : t('add.addToStack')}
        </button>
        <button type="button" className="btn btn--outline" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>

      <Sheet open={scanning} onClose={() => setScanning(false)} title={t('other.scan')}>
        {scanning && (
          <Suspense fallback={<p className="muted">{t('add.scanStarting')}</p>}>
            <ScanView
              onDetected={(code) => {
                set({ upc: code })
                setScanning(false)
              }}
              onUnavailable={() => setScanning(false)}
            />
          </Suspense>
        )}
      </Sheet>
    </form>
  )
}
