/**
 * Keeps a signed-in account's data in step with the Worker (build prompt §8.3), next to
 * SyncManager (which only mirrors reminders). Renders nothing, except the first-sign-in choice
 * when both this device and the account already have a stack (§8.4).
 *
 * Push/pull 1.5 s after a change, on open, when the app becomes visible and when the network
 * comes back. A 401 keeps local data and asks to log in again; offline retries silently.
 */
import type { SyncResponse } from '@smartstack/shared'
import { useEffect, useRef, useState } from 'react'
import { accountApi } from '../api/account'
import { ApiError } from '../api/client'
import { setSessionExpired } from '../auth/sessionStatus'
import { getSessionToken } from '../auth/store'
import { Sheet } from '../components/Sheet'
import { t } from '../i18n'
import { useAppState } from '../state/context'
import type { PersistedState } from '../storage'
import { afterSync, buildPushes, hasLocalData, remoteHasData } from './entities'

const DEBOUNCE_MS = 1500
/** More requests than this in one go means something keeps changing: stop until next time. */
const MAX_ROUNDS = 10

export function AccountSync() {
  const { state, dispatch } = useAppState()
  const stateRef = useRef<PersistedState>(state)
  const running = useRef(false)
  const again = useRef(false)
  const [choice, setChoice] = useState<SyncResponse | null>(null)

  useEffect(() => {
    stateRef.current = state
  })

  // One sync at a time; a request made meanwhile runs right after. Kept in a ref so the
  // listeners below always call the latest version.
  const syncOnce = async (): Promise<void> => {
    const start = stateRef.current
    if (start.auth.mode !== 'account' || start.auth.consentNeeded) return
    const session = getSessionToken()
    if (!session) return
    if (running.current) {
      again.current = true
      return
    }
    running.current = true
    try {
      if (!start.sync.initialized) {
        const first = await accountApi.sync(session, { since: 0, changes: {} })
        const current = stateRef.current
        if (hasLocalData(current) && remoteHasData(first)) {
          // Both have a stack: the person decides (the sheet stays until they do).
          setChoice(first)
          return
        }
        // Nothing local → take the account's data; an empty account → back up this device.
        if (!remoteHasData(first)) dispatch({ type: 'SYNC_QUEUE_ALL', at: Date.now() })
        dispatch({ type: 'SYNC_RESULT', snapshot: new Map(), response: first, at: Date.now() })
        dispatch({ type: 'SYNC_INITIALIZED' })
        // The backup (if any) goes up in the next run, once this state has rendered.
        again.current = true
        return
      }

      for (let round = 0; round < MAX_ROUNDS; round++) {
        const current = stateRef.current
        const [push] = buildPushes(current)
        const body = push?.body ?? { since: current.sync.rev, changes: {} }
        const snapshot = push?.snapshot ?? new Map<string, number>()
        const response = await accountApi.sync(session, body)
        const at = Date.now()
        dispatch({ type: 'SYNC_RESULT', snapshot, response, at })
        // The render hasn't happened yet: keep the mirror in step for the next round.
        stateRef.current = afterSync(stateRef.current, snapshot, response, at)
        if (!push || stateRef.current.sync.outbox.length === 0) break
      }
      setSessionExpired(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSessionExpired(true)
      } else if (err instanceof ApiError && err.status === 403 && err.code === 'consent_required') {
        // A new policy version: the consent screen comes back before anything syncs.
        const account = await accountApi.getAccount(session).catch(() => null)
        if (account) dispatch({ type: 'SET_ACCOUNT', account })
      } else if (err instanceof ApiError && err.status === 409) {
        dispatch({ type: 'SYNC_ERROR', error: 'limit_reached' })
      } else if (err instanceof ApiError) {
        dispatch({ type: 'SYNC_ERROR', error: `${err.status} ${err.code}` })
      }
      // Offline: nothing to show; the next change, open or `online` retries.
    } finally {
      running.current = false
      if (again.current) {
        again.current = false
        window.setTimeout(() => void runRef.current(), 0)
      }
    }
  }
  const runRef = useRef(syncOnce)
  useEffect(() => {
    runRef.current = syncOnce
  })
  const [run] = useState(() => () => runRef.current())

  // Open, sign-in, consent given: sync now.
  const { mode, accountId, consentNeeded } = state.auth
  useEffect(() => {
    if (mode === 'account' && !consentNeeded) void run()
  }, [mode, accountId, consentNeeded, run])

  // A local change: push 1.5 s after the last one.
  const outbox = state.sync.outbox
  useEffect(() => {
    if (mode !== 'account' || outbox.length === 0) return
    const timer = window.setTimeout(() => void run(), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [mode, outbox, run])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run()
    }
    const onOnline = () => void run()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [run])

  const decide = (combine: boolean) => {
    if (!choice) return
    const at = Date.now()
    if (combine) dispatch({ type: 'SYNC_QUEUE_ALL', at })
    else dispatch({ type: 'SYNC_USE_ACCOUNT' })
    // Combine: the account's rows merge by last write wins, then everything local goes up.
    dispatch({ type: 'SYNC_RESULT', snapshot: new Map(), response: choice, at })
    dispatch({ type: 'SYNC_INITIALIZED' })
    setChoice(null)
    window.setTimeout(() => void runRef.current(), 0)
  }

  return (
    // Dismissing decides nothing: the question comes back on the next sync.
    <Sheet open={choice !== null} onClose={() => setChoice(null)} title={t('sync.choiceTitle')}>
      <p>{t('sync.choiceBody')}</p>
      <div className="stack-v">
        <button type="button" className="btn btn--primary" onClick={() => decide(true)}>
          {t('sync.combine')}
        </button>
        <button type="button" className="btn btn--outline" onClick={() => decide(false)}>
          {t('sync.useAccount')}
        </button>
      </div>
    </Sheet>
  )
}
