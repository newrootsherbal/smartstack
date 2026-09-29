import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router'
import { AccountSync } from './account-sync/AccountSync'
import { AccountSession } from './auth/AccountSession'
import { AccountBanners } from './components/AccountBanners'
import { Banner } from './components/Banner'
import { BottomNav } from './components/BottomNav'
import { InstallGate } from './components/InstallGate'
import { LowStockSheet } from './components/LowStockSheet'
import { ACCOUNTS_PUBLIC } from './config'
import { t } from './i18n'
import { needsIOSInstallGate } from './platform/detect'
import { SyncManager } from './reminders/SyncManager'
import { AddSupplement } from './screens/AddSupplement'
import { AuthConsent } from './screens/auth/AuthConsent'
import { AuthDone } from './screens/auth/AuthDone'
import { Login } from './screens/auth/Login'
import { ForgotPassword, ResetPassword, VerifyEmail } from './screens/auth/Recovery'
import { Signup } from './screens/auth/Signup'
import { Welcome } from './screens/auth/Welcome'
import { Notifications } from './screens/Notifications'
import { Onboarding } from './screens/Onboarding'
import { Profile } from './screens/Profile'
import { Shopping } from './screens/Shopping'
import { StackScreen } from './screens/StackScreen'
import { Today } from './screens/Today'
import { useAppState } from './state/context'

const DevBarcodes = lazy(() => import('./screens/dev/Barcodes'))
const DevStyleguide = lazy(() => import('./screens/dev/Styleguide'))
const Legal = lazy(() => import('./screens/Legal'))

/** Routes that never show the bottom nav and never redirect to the welcome screen. */
const STANDALONE = [
  '/welcome',
  '/signup',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/auth/',
  '/privacy',
  '/terms',
  '/onboarding',
]

/** The welcome screen is answered once, and only while accounts are open to the public. */
function useNeedsWelcome(): boolean {
  const { state } = useAppState()
  return ACCOUNTS_PUBLIC && state.auth.mode === 'unset'
}

function RequireWelcomeAnswered() {
  if (useNeedsWelcome()) return <Navigate to="/welcome" replace />
  return <Outlet />
}

function RequireOnboarded() {
  const { state } = useAppState()
  const needsWelcome = useNeedsWelcome()
  if (needsWelcome) return <Navigate to="/welcome" replace />
  // Nothing syncs before the account consents (Google sign-ups, or a new policy version).
  if (state.auth.mode === 'account' && state.auth.consentNeeded) {
    return <Navigate to="/auth/consent" replace />
  }
  if (!state.routine) return <Navigate to="/onboarding" replace />
  return <Outlet />
}

function Home() {
  const { state } = useAppState()
  const needsWelcome = useNeedsWelcome()
  if (needsWelcome) return <Navigate to="/welcome" replace />
  return <Navigate to={state.routine ? '/today' : '/onboarding'} replace />
}

export function App() {
  const location = useLocation()
  const { state, dispatch } = useAppState()
  const isDevRoute = location.pathname.startsWith('/dev/')

  // Accounts off or staff-only: the public app is guest-only, without a welcome screen.
  useEffect(() => {
    if (!ACCOUNTS_PUBLIC && state.auth.mode === 'unset') dispatch({ type: 'SET_GUEST' })
  }, [state.auth.mode, dispatch])

  // iOS: the Home Screen app has its own storage, so install comes before onboarding. The
  // emailed links and the legal pages open in Safari and must work there.
  const browserOnly = ['/reset-password', '/verify-email', '/auth/done', '/privacy', '/terms']
  if (
    needsIOSInstallGate() &&
    !isDevRoute &&
    !browserOnly.some((p) => location.pathname.startsWith(p))
  ) {
    return (
      <>
        <Banner />
        <InstallGate />
      </>
    )
  }

  const showNav =
    state.routine !== null &&
    !isDevRoute &&
    !STANDALONE.some((p) => location.pathname.startsWith(p))

  return (
    <>
      <Banner />
      <AccountBanners />
      <SyncManager />
      <AccountSession />
      <AccountSync />
      <Suspense
        fallback={<main className="screen screen--no-nav muted">{t('common.loading')}</main>}
      >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/auth/done" element={<AuthDone />} />
          <Route path="/auth/consent" element={<AuthConsent />} />
          <Route path="/privacy" element={<Legal doc="privacy" />} />
          <Route path="/terms" element={<Legal doc="terms" />} />
          <Route element={<RequireWelcomeAnswered />}>
            <Route path="/onboarding" element={<Onboarding />} />
          </Route>
          <Route element={<RequireOnboarded />}>
            <Route path="/today" element={<Today />} />
            <Route path="/add" element={<AddSupplement />} />
            <Route path="/stack" element={<StackScreen />} />
            <Route path="/shopping" element={<Shopping />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/notifications" element={<Notifications />} />
            {/* Phase 1 paths (bookmarks, notification links). */}
            <Route path="/reminders" element={<Navigate to="/notifications" replace />} />
            <Route path="/settings" element={<Navigate to="/profile" replace />} />
          </Route>
          <Route path="/dev/barcodes" element={<DevBarcodes />} />
          <Route path="/dev/styleguide" element={<DevStyleguide />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      {showNav && <BottomNav />}
      {state.routine && <LowStockSheet />}
    </>
  )
}
