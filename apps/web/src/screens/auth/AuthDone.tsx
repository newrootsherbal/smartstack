import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { accountApi } from '../../api/account'
import { ApiError } from '../../api/client'
import { authErrorMessage, claimPending, pendingFor } from '../../auth/flows'
import { getSessionToken, setPendingOAuth } from '../../auth/store'
import { t } from '../../i18n'
import { useAppState } from '../../state/context'
import { afterSignInPath } from './navigation'

/**
 * Where the provider sends the browser back (`/auth/done?state=…`). If this browsing context
 * started the attempt, it claims the session now. Otherwise (the Safari sheet on an iPhone,
 * whose storage is separate) it tells the person to return to the app, which claims when it
 * becomes visible again (OAuthResume).
 */
export function AuthDone() {
  const { state, dispatch } = useAppState()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const attemptState = params.get('state')
  const providerError = params.get('error')
  // Decided once, from the URL and whether this context holds the attempt.
  const [initial] = useState(() => {
    const pending = pendingFor(attemptState)
    if (providerError) return { view: 'failed' as const, pending }
    return { view: pending ? ('working' as const) : ('elsewhere' as const), pending }
  })
  const [view, setView] = useState<'working' | 'elsewhere' | 'failed'>(initial.view)
  const [message, setMessage] = useState<string | null>(() =>
    providerError ? authErrorMessage(new ApiError(400, providerError)) : null,
  )
  const started = useRef(false)
  const stateRef = useRef(state)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const { pending } = initial
    if (!pending) return
    if (providerError) {
      setPendingOAuth(null)
      return
    }
    void (async () => {
      const outcome = await claimPending(pending)
      if (outcome.kind === 'signed_in') {
        dispatch({ type: 'SET_ACCOUNT', account: outcome.account })
        navigate(
          afterSignInPath(outcome.account, stateRef.current, outcome.returnTo, outcome.isNew),
          { replace: true },
        )
      } else if (outcome.kind === 'already_claimed') {
        // Android: the custom tab shares storage with the app, which may have claimed first.
        const session = getSessionToken()
        const account = session ? await accountApi.getAccount(session).catch(() => null) : null
        if (account) {
          dispatch({ type: 'SET_ACCOUNT', account })
          navigate(afterSignInPath(account, stateRef.current, null), { replace: true })
        } else {
          setView('elsewhere')
        }
      } else if (outcome.kind === 'waiting') {
        setView('elsewhere')
      } else {
        setMessage(authErrorMessage(new ApiError(400, outcome.code)))
        setView('failed')
      }
    })()
  }, [initial, providerError, dispatch, navigate])

  return (
    <main className="screen screen--no-nav">
      {view === 'working' && <p className="muted">{t('auth.doneWorking')}</p>}
      {view === 'elsewhere' && (
        <p className="notice" role="status">
          {t('auth.doneElsewhere')}
        </p>
      )}
      {view === 'failed' && (
        <div className="stack-v">
          <p className="notice notice--warn" role="alert">
            {message}
          </p>
          <Link to="/login" className="btn btn--outline">
            {t('auth.backToLogin')}
          </Link>
        </div>
      )}
    </main>
  )
}
