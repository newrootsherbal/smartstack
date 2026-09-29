import {
  GENDERS,
  HEALTH_CONDITION_GROUPS,
  HEALTH_GOALS,
  NEWS_BODY_MAX,
  NEWS_TIME_ZONE,
  NEWS_TITLE_MAX,
  NEWS_TITLE_PREFIX,
  PREGNANCY_STATUSES,
  newsTextLength,
  type AudienceEstimate,
  type CampaignView,
} from '@smartstack/shared'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import {
  audienceFromDraft,
  draftFromCampaign,
  draftProblems,
  emptyDraft,
  etaParts,
  inputFromDraft,
  linkWithTags,
  sendAtFromDraft,
  titleLength,
  type CampaignDraft,
  type DraftField,
} from '../../admin/newsForm'
import { adminApi } from '../../api/admin'
import { ApiError } from '../../api/client'
import { getSessionToken } from '../../auth/store'
import { intlLocale, lookupMessage, t } from '../../i18n'
import { useAppState } from '../../state/context'
import styles from './News.module.css'

/** Draft and scheduled campaigns can still change; the others are history. */
const EDITABLE: readonly CampaignView['status'][] = ['draft', 'scheduled']

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    return lookupMessage(`admin.errors.${err.code}`) ?? t('admin.errors.other', { error: err.code })
  }
  return t('admin.errors.other', { error: err instanceof Error ? err.message : String(err) })
}

function torontoDateTime(epochMs: number): string {
  const text = new Intl.DateTimeFormat(intlLocale(), {
    timeZone: NEWS_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(epochMs)
  return t('admin.sendsAt', { date: text })
}

function healthLabel(group: string, code: string): string {
  return lookupMessage(`health.${group}.${code}`) ?? code
}

function toggle<T extends string>(list: readonly T[], code: T, on: boolean): T[] {
  return on ? [...new Set([...list, code])] : list.filter((c) => c !== code)
}

/**
 * /admin/news (§4.12): staff admins compose, test and schedule news campaigns. The Worker checks
 * the role on every call; this screen only hides itself from everyone else.
 */
export default function AdminNews() {
  const { state } = useAppState()
  const session = getSessionToken()
  const isAdmin =
    state.auth.mode === 'account' && state.auth.role === 'admin' && state.auth.emailVerified
  if (!isAdmin || !session) {
    return (
      <main className="screen">
        <h1>{t('admin.newsTitle')}</h1>
        <p className="notice notice--warn">{t('admin.onlyAdmins')}</p>
        <Link to="/profile" className="btn btn--outline">
          {t('profile.title')}
        </Link>
      </main>
    )
  }
  return <Campaigns session={session} />
}

type Editing = { campaign: CampaignView | null } | null

function Campaigns({ session }: { session: string }) {
  const [campaigns, setCampaigns] = useState<CampaignView[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing>(null)

  useEffect(() => {
    if (editing) return
    let live = true
    adminApi
      .campaigns(session)
      .then((list) => {
        if (!live) return
        setCampaigns(list)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (live) setLoadError(errorText(err))
      })
    return () => {
      live = false
    }
  }, [session, editing])

  if (editing) {
    return (
      <CampaignEditor
        key={editing.campaign?.id ?? 'new'}
        session={session}
        initial={editing.campaign}
        onOpen={(campaign) => setEditing({ campaign })}
        onBack={() => setEditing(null)}
      />
    )
  }

  return (
    <main className="screen">
      <Link to="/profile" className="btn btn--link">
        ← {t('profile.title')}
      </Link>
      <h1>{t('admin.newsTitle')}</h1>
      <p className="small muted">{t('admin.hint')}</p>
      <button
        type="button"
        className="btn btn--primary"
        onClick={() => setEditing({ campaign: null })}
      >
        {t('admin.newCampaign')}
      </button>
      {loadError && (
        <p className="notice notice--error" role="alert">
          {t('admin.loadFailed', { error: loadError })}
        </p>
      )}
      {campaigns === null && !loadError && <p className="muted">{t('common.loading')}</p>}
      {campaigns?.length === 0 && <p className="muted">{t('admin.empty')}</p>}
      {campaigns && campaigns.length > 0 && (
        <ul className={styles.list}>
          {campaigns.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={`card ${styles.item}`}
                onClick={() => setEditing({ campaign: c })}
              >
                <span className={styles.itemHead}>
                  <span className={styles.itemName}>{c.name}</span>
                  <span className={`tag ${styles.status}`}>{t(`admin.status.${c.status}`)}</span>
                </span>
                {c.sendAt !== null && <span className="small">{torontoDateTime(c.sendAt)}</span>}
                {(c.status === 'sending' || c.status === 'sent' || c.sentCount > 0) && (
                  <span className="small muted">
                    {t('admin.counts', { sent: c.sentCount, failed: c.failedCount })}
                  </span>
                )}
                {c.closeToAnother && (
                  <span className="small notice notice--warn">{t('admin.closeWarning')}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

type EstimateState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; estimate: AudienceEstimate }
  | { status: 'error'; error: string }

function CampaignEditor({
  session,
  initial,
  onOpen,
  onBack,
}: {
  session: string
  initial: CampaignView | null
  onOpen: (campaign: CampaignView) => void
  onBack: () => void
}) {
  const id = useId()
  const [openedAt] = useState(() => Date.now())
  const [campaign, setCampaign] = useState<CampaignView | null>(initial)
  const [draft, setDraft] = useState<CampaignDraft>(() =>
    initial ? draftFromCampaign(initial, openedAt) : emptyDraft(openedAt),
  )
  const [showProblems, setShowProblems] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [estimate, setEstimate] = useState<EstimateState>({ status: 'idle' })

  const editable = campaign === null || EDITABLE.includes(campaign.status)
  const problems = draftProblems(draft)
  const shown = (field: DraftField) => showProblems && problems.has(field)
  const set = (next: Partial<CampaignDraft>) => {
    setDraft((d) => ({ ...d, ...next }))
    setNotice(null)
  }

  // The audience estimate follows the audience (debounced; counts only).
  const audienceKey = JSON.stringify(audienceFromDraft(draft))
  const audienceValid =
    !problems.has('audience') && !problems.has('ageMin') && !problems.has('ageMax')
  useEffect(() => {
    if (!audienceValid) return
    let live = true
    const timer = window.setTimeout(() => {
      setEstimate({ status: 'loading' })
      adminApi
        .estimate(session, JSON.parse(audienceKey) as ReturnType<typeof audienceFromDraft>)
        .then((value) => {
          if (live) setEstimate({ status: 'done', estimate: value })
        })
        .catch((err: unknown) => {
          if (live) setEstimate({ status: 'error', error: errorText(err) })
        })
    }, 400)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [session, audienceKey, audienceValid])

  /** Create or update; the saved campaign, or null (the reason is shown). */
  const save = async (): Promise<CampaignView | null> => {
    if (problems.size > 0) {
      setShowProblems(true)
      setError(t('admin.invalid'))
      return null
    }
    const body = inputFromDraft(draft)
    const saved = campaign
      ? await adminApi.update(session, campaign.id, body)
      : await adminApi.create(session, body)
    setCampaign(saved)
    return saved
  }

  const run = (action: () => Promise<string | null>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    action()
      .then((message) => setNotice(message))
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false))
  }

  const sendAtCheck = sendAtFromDraft(draft, openedAt)
  const canSchedule =
    estimate.status === 'done' ? estimate.estimate.canSchedule : estimate.status !== 'error'

  const field = (name: DraftField | null, label: string, control: ReactNode, hint?: ReactNode) => (
    <label className="field">
      <span className="field__label">{label}</span>
      {hint && <span className="small muted">{hint}</span>}
      {control}
      {name && shown(name) && (
        <span className="small notice notice--warn" role="alert">
          {t('admin.invalid')}
        </span>
      )}
    </label>
  )

  const counter = (count: number, max: number) => (
    <span className={`small ${styles.counter} ${count > max ? styles.over : 'muted'}`}>
      {t('admin.counter', { count, max })}
    </span>
  )

  const language = (locale: 'en' | 'fr') => {
    const titleKey = locale === 'en' ? 'titleEn' : 'titleFr'
    const bodyKey = locale === 'en' ? 'bodyEn' : 'bodyFr'
    return (
      <section className="card stack-v" lang={locale}>
        <h2>{t(locale === 'en' ? 'admin.english' : 'admin.french')}</h2>
        {field(
          titleKey,
          t('admin.titleField'),
          <>
            <input
              className="input"
              value={draft[titleKey]}
              onChange={(e) => set({ [titleKey]: e.target.value })}
            />
            {counter(titleLength(locale, draft[titleKey]), NEWS_TITLE_MAX)}
          </>,
          t('admin.titleHint', { prefix: NEWS_TITLE_PREFIX[locale].trim() }),
        )}
        {field(
          bodyKey,
          t('admin.bodyField'),
          <>
            <textarea
              className={`input ${styles.textarea}`}
              value={draft[bodyKey]}
              onChange={(e) => set({ [bodyKey]: e.target.value.replace(/[\r\n]+/g, ' ') })}
            />
            {counter(newsTextLength(draft[bodyKey].trim()), NEWS_BODY_MAX)}
          </>,
        )}
      </section>
    )
  }

  const checks = <T extends string>(
    group: string,
    codes: readonly T[],
    value: readonly T[],
    onChange: (next: T[]) => void,
  ) => (
    <div className={styles.options}>
      {codes.map((code) => (
        <label key={code} className={styles.option}>
          <input
            type="checkbox"
            checked={value.includes(code)}
            onChange={(e) => onChange(toggle(value, code, e.target.checked))}
          />
          <span>{healthLabel(group, code)}</span>
        </label>
      ))}
    </div>
  )

  const estimateText = () => {
    if (!audienceValid) return null
    if (estimate.status === 'loading' || estimate.status === 'idle') {
      return <p className="small muted">{t('admin.estimating')}</p>
    }
    if (estimate.status === 'error') {
      return (
        <p className="small notice notice--warn">
          {t('admin.estimateFailed', { error: estimate.error })}
        </p>
      )
    }
    const e = estimate.estimate
    const eta = etaParts(e.etaMinutes)
    const time = new Intl.NumberFormat(intlLocale(), {
      style: 'unit',
      unit: eta.unit,
      unitDisplay: 'long',
      maximumFractionDigits: 1,
    }).format(eta.value)
    return (
      <div className="stack-v">
        <p>
          <strong>
            {e.devices === null
              ? t('admin.estimateFew')
              : t('admin.estimate', {
                  count: new Intl.NumberFormat(intlLocale()).format(e.devices),
                })}
          </strong>
        </p>
        {!e.canSchedule && <p className="small notice notice--warn">{t('admin.tooSmall')}</p>}
        {e.devices !== null && e.devices > 0 && (
          <p className="small muted">{t('admin.estimateEta', { time })}</p>
        )}
      </div>
    )
  }

  const tagged = linkWithTags(draft.url, draft.name)

  return (
    <main className="screen">
      <button type="button" className="btn btn--link" onClick={onBack}>
        ← {t('admin.back')}
      </button>
      <h1>{campaign ? campaign.name : t('admin.newCampaign')}</h1>
      {campaign && (
        <p className="row">
          <span className="tag">{t(`admin.status.${campaign.status}`)}</span>
          {campaign.sendAt !== null && (
            <span className="small">{torontoDateTime(campaign.sendAt)}</span>
          )}
        </p>
      )}
      {campaign &&
        (campaign.status === 'sending' || campaign.status === 'sent' || campaign.sentCount > 0) && (
          <p className="small muted">
            {t('admin.counts', { sent: campaign.sentCount, failed: campaign.failedCount })}
          </p>
        )}
      {campaign?.closeToAnother && <p className="notice notice--warn">{t('admin.closeWarning')}</p>}
      {!editable && <p className="notice">{t('admin.readOnly')}</p>}

      <fieldset className={styles.fieldset} disabled={!editable || busy}>
        <section className="card stack-v">
          {field(
            'name',
            t('admin.name'),
            <input
              className="input"
              value={draft.name}
              maxLength={80}
              onChange={(e) => set({ name: e.target.value })}
            />,
            t('admin.nameHint'),
          )}
        </section>

        <div className={styles.languages}>
          {language('en')}
          {language('fr')}
        </div>

        <section className="card stack-v">
          {field(
            'url',
            t('admin.link'),
            <input
              className="input"
              type="url"
              inputMode="url"
              value={draft.url}
              onChange={(e) => set({ url: e.target.value })}
            />,
          )}
          {tagged && (
            <p className="small muted">
              {t('admin.linkHint')} <span className={styles.link}>{tagged}</span>
            </p>
          )}
        </section>

        <section className="card stack-v">
          <h2 id={`${id}-audience`}>{t('admin.audience')}</h2>
          <div className={styles.options} role="radiogroup" aria-labelledby={`${id}-audience`}>
            {(['all', 'segment'] as const).map((type) => (
              <label key={type} className={styles.option}>
                <input
                  type="radio"
                  name={`${id}-audience`}
                  checked={draft.audienceType === type}
                  onChange={() => set({ audienceType: type })}
                />
                <span>{t(type === 'all' ? 'admin.audienceAll' : 'admin.audienceSegment')}</span>
              </label>
            ))}
          </div>
          {draft.audienceType === 'segment' && (
            <>
              <p className="small muted">{t('admin.segmentHint')}</p>
              {shown('audience') && (
                <p className="small notice notice--warn" role="alert">
                  {t('admin.invalid')}
                </p>
              )}
              <h3 className="small">{t('admin.conditions')}</h3>
              {Object.entries(HEALTH_CONDITION_GROUPS).map(([group, codes]) => (
                <fieldset key={group} className={styles.group}>
                  <legend>{healthLabel('groups', group)}</legend>
                  {checks('conditions', codes, draft.conditions, (conditions) =>
                    set({ conditions }),
                  )}
                </fieldset>
              ))}
              <h3 className="small">{t('admin.goals')}</h3>
              {checks('goals', HEALTH_GOALS, draft.goals, (goals) => set({ goals }))}
              <h3 className="small">{t('admin.genders')}</h3>
              {checks('gender', GENDERS, draft.genders, (genders) => set({ genders }))}
              <h3 className="small">{t('admin.pregnancy')}</h3>
              {checks('pregnancy', PREGNANCY_STATUSES, draft.pregnancy, (pregnancy) =>
                set({ pregnancy }),
              )}
              <h3 className="small">{t('admin.age')}</h3>
              <div className={styles.inline}>
                {field(
                  'ageMin',
                  t('admin.ageMin'),
                  <input
                    className={`input ${styles.short}`}
                    inputMode="numeric"
                    maxLength={3}
                    value={draft.ageMin}
                    onChange={(e) => set({ ageMin: e.target.value.replace(/\D/g, '') })}
                  />,
                )}
                {field(
                  'ageMax',
                  t('admin.ageMax'),
                  <input
                    className={`input ${styles.short}`}
                    inputMode="numeric"
                    maxLength={3}
                    value={draft.ageMax}
                    onChange={(e) => set({ ageMax: e.target.value.replace(/\D/g, '') })}
                  />,
                )}
              </div>
            </>
          )}
          {editable && estimateText()}
        </section>

        <section className="card stack-v">
          <h2>{t('admin.when')}</h2>
          <p className="small muted">{t('admin.windowHint')}</p>
          <div className={styles.inline}>
            {field(
              null,
              t('admin.date'),
              <input
                className="input"
                type="date"
                value={draft.sendDate}
                onChange={(e) => set({ sendDate: e.target.value })}
              />,
            )}
            {field(
              null,
              t('admin.time'),
              <input
                className="input"
                type="time"
                min="11:00"
                max="19:00"
                step={300}
                value={draft.sendTime}
                onChange={(e) => set({ sendTime: e.target.value })}
              />,
            )}
          </div>
          {!sendAtCheck.ok && (
            <p className="small notice notice--warn">
              {sendAtCheck.problem === 'window'
                ? t('admin.errors.outside_sending_window')
                : sendAtCheck.problem === 'past'
                  ? t('admin.errors.send_at_past')
                  : t('admin.sendAtInvalid')}
            </p>
          )}
        </section>
      </fieldset>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}

      <div className="row">
        {editable && (
          <>
            <button
              type="button"
              className="btn btn--outline"
              disabled={busy}
              onClick={() => run(async () => ((await save()) ? t('admin.saved') : null))}
            >
              {t('admin.save')}
            </button>
            <button
              type="button"
              className="btn btn--outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const saved = await save()
                  if (!saved) return null
                  const result = await adminApi.test(session, saved.id)
                  return t('admin.testSent', { sent: result.sent, devices: result.devices })
                })
              }
            >
              {t('admin.test')}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || !sendAtCheck.ok || !canSchedule}
              onClick={() =>
                run(async () => {
                  const when = sendAtFromDraft(draft, Date.now())
                  if (!when.ok) {
                    setError(
                      when.problem === 'window'
                        ? t('admin.errors.outside_sending_window')
                        : when.problem === 'past'
                          ? t('admin.errors.send_at_past')
                          : t('admin.sendAtInvalid'),
                    )
                    return null
                  }
                  const saved = await save()
                  if (!saved) return null
                  setCampaign(await adminApi.schedule(session, saved.id, when.sendAt))
                  return t('admin.scheduled')
                })
              }
            >
              {t('admin.schedule')}
            </button>
          </>
        )}
        {campaign && (campaign.status === 'scheduled' || campaign.status === 'sending') && (
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(t('admin.cancelConfirm'))) return
              run(async () => {
                setCampaign(await adminApi.cancel(session, campaign.id))
                return t('admin.cancelled')
              })
            }}
          >
            {t('admin.cancel')}
          </button>
        )}
        {campaign && (
          <button
            type="button"
            className="btn btn--outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                onOpen(await adminApi.duplicate(session, campaign.id))
                return null
              })
            }
          >
            {t('admin.duplicate')}
          </button>
        )}
      </div>
    </main>
  )
}
