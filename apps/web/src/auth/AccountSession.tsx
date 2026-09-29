/**
 * Background account work, rendered once in App (renders nothing):
 * - refresh the account on open and when the app comes back (email confirmed elsewhere,
 *   consent version changed); a 401 means the session ended: local data stays, and a banner
 *   asks to log in again;
 * - finish a Google sign-in started from this window when it becomes visible again (on an
 *   iPhone the provider's redirect may land in a Safari sheet with separate storage).
 */
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { accountApi } from '../api/account'
import { ApiError } from '../api/client'
import { afterSignInPath } from '../screens/auth/navigation'
import { useAppState } from '../state/context'
import { claimPending } from './flows'
import { setSessionExpired } from './sessionStatus'
import { getPendingOAuth, getSessionToken } from './store'

export function AccountSession() {
  const { state, dispatch } = useAppState()
  const navigate = useNavigate()
  const location = useLocation()
  const stateRef = useRef(state)
  const pathRef = useRef(location.pathname)
  useEffect(() => {
    stateRef.current = state
    pathRef.current = location.pathname
  })

  useEffect(() => {
    let running = false
    const tick = async (onOpen = false) => {
      if (running || (!onOpen && document.visibilityState !== 'visible')) return
      running = true
      try {
        const pending = getPendingOAuth()
        // /auth/done claims by itself; everywhere else, a finished attempt is claimed here.
        if (pending && !pathRef.current.startsWith('/auth/done')) {
          const outcome = await claimPending(pending)
          if (outcome.kind === 'signed_in') {
            setSessionExpired(false)
            dispatch({ type: 'SET_ACCOUNT', account: outcome.account })
            navigate(
              afterSignInPath(outcome.account, stateRef.current, outcome.returnTo, outcome.isNew),
              { replace: true },
            )
            return
          }
        }
        const session = getSessionToken()
        if (stateRef.current.auth.mode !== 'account' || !session) return
        const account = await accountApi.getAccount(session)
        setSessionExpired(false)
        dispatch({ type: 'SET_ACCOUNT', account })
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) setSessionExpired(true)
        // Offline or a server error: try again on the next open.
      } finally {
        running = false
      }
    }
    void tick(true)
    const onVisible = () => void tick()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [dispatch, navigate])

  return null
}
