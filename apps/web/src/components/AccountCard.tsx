import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@smartstack/shared'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { accountApi } from '../api/account'
import { authErrorMessage, deleteAccount, signOut, startOAuth } from '../auth/flows'
import { derivePasswordKey } from '../auth/kdf'
import { getSessionToken } from '../auth/store'
import { ACCOUNTS_PUBLIC, APPLE_ENABLED } from '../config'
import { relative } from '../dates'
import { getLocale, t } from '../i18n'
import { useAppState } from '../state/context'
import { PasswordField } from './auth/PasswordField'
import { Sheet } from './Sheet'

/**
 * Profile's first card. Guests: "Back up & sync" (only once accounts are public). Accounts:
 * email and its status, sign-in methods, Download my data, Log out, Delete my account.
 */
export function AccountCard() {
  const { state } = useAppState()
  if (state.auth.mode === 'account') return <AccountDetails />
  if (!ACCOUNTS_PUBLIC) return null
  return (
    <section className="card stack-v">
      <h2>{t('backup.title')}</h2>
      <p className="small muted">{t('backup.body')}</p>
      <div className="row">
        <Link to="/signup?from=/profile" className="btn btn--primary">
          {t('backup.create')}
        </Link>
        <Link to="/login?from=/profile" className="btn btn--outline">
          {t('backup.login')}
        </Link>
      </div>
    </section>
  )
}

function AccountDetails() {
  const { state, dispatch } = useAppState()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const [now] = useState(() => Date.now())
  const session = getSessionToken()
  const { auth } = state
  const hasPassword = auth.providers.includes('password')
  const hasGoogle = auth.providers.includes('google')

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setNotice(null)
    try {
      await work()
    } catch (err) {
      setNotice(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const refresh = async () => {
    if (!session) return
    dispatch({ type: 'SET_ACCOUNT', account: await accountApi.getAccount(session) })
  }

  const download = () =>
    run(async () => {
      if (!session) return
      const blob = await accountApi.exportData(session)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `smartstack-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    })

  const logOut = () => {
    if (!window.confirm(t('account.logoutConfirm'))) return
    void run(async () => {
      await signOut(session, state, dispatch)
      navigate(ACCOUNTS_PUBLIC ? '/welcome' : '/onboarding', { replace: true })
    })
  }

  const remove = () => {
    if (!session || !window.confirm(t('notice.N6'))) return
    void run(async () => {
      await deleteAccount(session, state, dispatch)
      navigate(ACCOUNTS_PUBLIC ? '/welcome' : '/onboarding', { replace: true })
    })
  }

  return (
    <section className="card stack-v">
      <h2>{t('account.title')}</h2>
      <p>
        {auth.name && (
          <>
            <strong>{auth.name}</strong>
            <br />
          </>
        )}
        {auth.email}
      </p>
      {auth.emailVerified ? (
        <p className="small muted">{t('account.emailVerified')}</p>
      ) : (
        <p className="small row">
          <span>{t('account.emailUnverified')}</span>
          <button
            type="button"
            className="btn btn--link btn--small"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (session) await accountApi.resendVerification(session)
                setNotice(t('account.verifySent'))
              })
            }
          >
            {t('account.sendAgain')}
          </button>
        </p>
      )}

      <p className="small muted" aria-live="polite">
        {state.sync.error === 'limit_reached'
          ? t('account.syncLimit')
          : state.sync.error
            ? t('account.syncError', { error: state.sync.error })
            : state.sync.lastSyncAt
              ? t('account.synced', { when: relative(state.sync.lastSyncAt, now) })
              : t('account.notSynced')}
      </p>

      <h3 className="small">{t('account.methods')}</h3>
      <ul className="list">
        <li className="row row--between">
          <span>{t('account.password')}</span>
          {hasPassword ? (
            <button
              type="button"
              className="btn btn--small btn--outline"
              onClick={() => setChanging(true)}
            >
              {t('account.change')}
            </button>
          ) : (
            <span className="small muted">{t('account.notSet')}</span>
          )}
        </li>
        <li className="row row--between">
          <span>Google</span>
          {hasGoogle ? (
            <span className="row">
              <span className="small muted">{t('account.connected')}</span>
              <button
                type="button"
                className="btn btn--small btn--link"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (!session) return
                    await accountApi.disconnect(session, 'google')
                    await refresh()
                  })
                }
              >
                {t('account.disconnect')}
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn btn--small btn--outline"
              disabled={busy}
              onClick={() =>
                void run(() => startOAuth('google', 'link', getLocale(), '/profile', session))
              }
            >
              {t('account.connect')}
            </button>
          )}
        </li>
        {APPLE_ENABLED && (
          <li className="row row--between">
            <span>Apple</span>
            {auth.providers.includes('apple') ? (
              <span className="small muted">{t('account.connected')}</span>
            ) : (
              <button
                type="button"
                className="btn btn--small btn--outline"
                disabled={busy}
                onClick={() =>
                  void run(() => startOAuth('apple', 'link', getLocale(), '/profile', session))
                }
              >
                {t('account.connect')}
              </button>
            )}
          </li>
        )}
      </ul>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="row">
        <button type="button" className="btn btn--outline" disabled={busy} onClick={download}>
          {t('account.download')}
        </button>
        <button type="button" className="btn btn--outline" disabled={busy} onClick={logOut}>
          {t('account.logout')}
        </button>
      </div>
      <button
        type="button"
        className="btn btn--danger"
        style={{ alignSelf: 'flex-start' }}
        disabled={busy}
        onClick={remove}
      >
        {t('account.delete')}
      </button>

      {changing && session && auth.email && (
        <ChangePasswordSheet
          session={session}
          email={auth.email}
          onClose={() => setChanging(false)}
          onDone={() => {
            setChanging(false)
            setNotice(t('account.passwordChanged'))
          }}
        />
      )}
    </section>
  )
}

function ChangePasswordSheet({
  session,
  email,
  onClose,
  onDone,
}: {
  session: string
  email: string
  onClose: () => void
  onDone: () => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    if (next.length < PASSWORD_MIN_LENGTH || next.length > PASSWORD_MAX_LENGTH) {
      return setError(t('auth.error.passwordLength'))
    }
    setBusy(true)
    try {
      const [currentKey, newKey] = await Promise.all([
        derivePasswordKey(email, current),
        derivePasswordKey(email, next),
      ])
      await accountApi.changePassword(session, { currentKey, newKey })
      onDone()
    } catch (err) {
      setError(authErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={t('account.changeTitle')}>
      <form
        className="stack-v"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <PasswordField
          label={t('account.currentPassword')}
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
        />
        <PasswordField
          label={t('auth.newPassword')}
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          hint={t('auth.passwordHint')}
        />
        {error && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {t('account.changeTitle')}
        </button>
      </form>
    </Sheet>
  )
}
