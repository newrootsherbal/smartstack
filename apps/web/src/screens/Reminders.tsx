import { useState } from 'react'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { t } from '../i18n'
import { isIOS, platformName } from '../platform/detect'
import { useSyncStatus } from '../reminders/syncStatus'
import { useReminders } from '../reminders/useReminders'

const STALE_MS = 5 * 24 * 60 * 60 * 1000

function relative(ts: number, now: number): string {
  const diffMin = Math.round((now - ts) / 60000)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, 'minute')
  const diffH = Math.round(diffMin / 60)
  if (Math.abs(diffH) < 24) return rtf.format(-diffH, 'hour')
  return rtf.format(-Math.round(diffH / 24), 'day')
}

export function Reminders() {
  const r = useReminders()
  const [now] = useState(() => Date.now())
  const sync = useSyncStatus()
  const install = useInstallPrompt()
  const platform = platformName()
  const subscribed = r.pushState.status === 'subscribed'
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
              onClick={r.enable}
              disabled={r.busy || !r.vapidConfigured}
            >
              {r.busy ? t('reminders.turningOn') : t('reminders.turnOn')}
            </button>
          </>
        )}

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

      <p className="small muted">{t('reminders.privacy')}</p>
    </main>
  )
}
