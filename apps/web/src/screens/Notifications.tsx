import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Sheet } from '../components/Sheet'
import { Switch } from '../components/Switch'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { relative } from '../dates'
import { t } from '../i18n'
import { isIOS, platformName } from '../platform/detect'
import { useSyncStatus } from '../reminders/syncStatus'
import { useNews } from '../reminders/useNews'
import { useReminders } from '../reminders/useReminders'
import { useAppState } from '../state/context'

const STALE_MS = 5 * 24 * 60 * 60 * 1000

/** Notifications: dose reminders and news for this device (either can be on alone). */
export function Notifications() {
  const { state, dispatch } = useAppState()
  const r = useReminders()
  const news = useNews()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [askNews, setAskNews] = useState(false)
  const [newsOffDone, setNewsOffDone] = useState(false)
  const handledNewsOff = useRef(false)

  // "Turn off news" from an Android notification opens /notifications?news=off.
  const newsOffParam = params.get('news') === 'off'
  useEffect(() => {
    if (!newsOffParam || handledNewsOff.current) return
    handledNewsOff.current = true
    navigate('/notifications', { replace: true })
    if (!state.newsOptIn) return
    void news.disable().then((ok) => {
      if (ok) setNewsOffDone(true)
    })
  }, [newsOffParam, navigate, news, state.newsOptIn])

  const turnOnReminders = () => {
    void r.enable().then((on) => {
      // Asked once, right after reminders go on (C7).
      if (on && !state.newsOptIn && !state.newsPromptAsked) setAskNews(true)
    })
  }
  const [now] = useState(() => Date.now())
  const sync = useSyncStatus()
  const install = useInstallPrompt()
  const platform = platformName()
  const subscribed = r.on
  const denied = r.permission === 'denied' || r.pushState.status === 'denied'
  const unsupported = r.permission === 'unsupported' || r.pushState.status === 'unsupported'
  const stale = subscribed && r.lastSync !== null && now - r.lastSync > STALE_MS

  return (
    <main className="screen">
      <h1>{t('reminders.title')}</h1>
      <p className="muted">{t('reminders.intro')}</p>

      {(install.canInstall || install.installed) && platform !== 'ios' && (
        <section className="card stack-v">
          <p className="small muted">{t('install.androidHint')}</p>
          {install.installed ? (
            <p className="notice">{t('install.androidInstalled')}</p>
          ) : (
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => void install.promptInstall()}
            >
              {t('install.androidButton')}
            </button>
          )}
        </section>
      )}

      {stale && <p className="notice notice--warn">{t('reminders.stale')}</p>}

      <section className="card stack-v">
        <h2>{t('reminders.section')}</h2>
        {unsupported ? (
          <p className="notice notice--warn">{t('reminders.unsupported')}</p>
        ) : denied ? (
          <div className="notice notice--warn stack-v">
            <strong>{t('reminders.denied')}</strong>
            <span className="small">
              {isIOS()
                ? t('reminders.deniedIos')
                : platform === 'android'
                  ? t('reminders.deniedAndroid')
                  : t('reminders.deniedDesktop')}
            </span>
          </div>
        ) : subscribed ? (
          <>
            <p className="notice">{t('reminders.statusOn')}</p>
            <p className="small muted">
              {r.lastSync
                ? t('reminders.lastSync', { when: relative(r.lastSync, now) })
                : t('reminders.neverSynced')}
              {sync.syncing && ' …'}
            </p>
            <p className="small muted">{t('reminders.windowNote')}</p>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void r.sendTest()}
              disabled={r.busy}
            >
              {t('reminders.test')}
            </button>
            {r.testStatus === 'sent' && <p className="notice">{t('reminders.testSent')}</p>}
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => void r.disable()}
              disabled={r.busy}
            >
              {t('reminders.turnOff')}
            </button>
          </>
        ) : (
          <>
            <p className="muted">{t('reminders.statusOff')}</p>
            {!r.vapidConfigured && (
              <p className="notice notice--warn">{t('reminders.vapidMissing')}</p>
            )}
            <button
              type="button"
              className="btn btn--primary"
              onClick={turnOnReminders}
              disabled={r.busy || !r.vapidConfigured}
            >
              {r.busy ? t('reminders.turningOn') : t('reminders.turnOn')}
            </button>
          </>
        )}

        <Switch
          checked={state.reminderProductNames}
          onChange={(on) => dispatch({ type: 'SET_REMINDER_NAMES', on })}
          label={t('reminders.namesTitle')}
        >
          {t('reminders.namesBody')}
        </Switch>

        {(r.error || sync.error) && (
          <p className="notice notice--error" role="alert">
            {r.testStatus === 'failed' && r.error
              ? t('reminders.testFailed', { error: r.error })
              : r.errorKind === 'push' && r.error
                ? t('reminders.pushServiceFailed', { error: r.error })
                : t('reminders.syncFailed', { error: r.error ?? sync.error ?? '' })}
          </p>
        )}
      </section>

      <section className="card stack-v">
        <h2>{t('news.section')}</h2>
        {newsOffDone && (
          <p className="notice" role="status">
            {t('news.turnedOff')}
          </p>
        )}
        {denied || unsupported ? (
          <p className="small muted">{t('news.needsNotifications')}</p>
        ) : (
          <Switch
            checked={news.on}
            disabled={news.busy || !news.vapidConfigured}
            onChange={(on) => {
              // Synchronous in the click: the permission prompt must come before any await.
              if (on) void news.enable()
              else void news.disable()
            }}
            label={t('consent.C6title')}
          >
            {t('consent.C6')}
          </Switch>
        )}
        {news.error && (
          <p className="notice notice--error" role="alert">
            {t('reminders.syncFailed', { error: news.error })}
          </p>
        )}
      </section>

      <p className="small muted">{t('reminders.privacy')}</p>

      <Sheet
        open={askNews}
        onClose={() => {
          setAskNews(false)
          dispatch({ type: 'SET_NEWS_PROMPT_ASKED' })
        }}
        title={t('news.section')}
      >
        <p>{t('consent.C7')}</p>
        <div className="row">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setAskNews(false)
              void news.enable()
            }}
          >
            {t('news.yes')}
          </button>
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => {
              setAskNews(false)
              dispatch({ type: 'SET_NEWS_PROMPT_ASKED' })
            }}
          >
            {t('suggest.noThanks')}
          </button>
        </div>
      </Sheet>
    </main>
  )
}
