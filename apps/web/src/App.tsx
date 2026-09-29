import { lazy, Suspense } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router'
import { Banner } from './components/Banner'
import { BottomNav } from './components/BottomNav'
import { InstallGate } from './components/InstallGate'
import { LowStockSheet } from './components/LowStockSheet'
import { t } from './i18n'
import { needsIOSInstallGate } from './platform/detect'
import { SyncManager } from './reminders/SyncManager'
import { AddSupplement } from './screens/AddSupplement'
import { Onboarding } from './screens/Onboarding'
import { Notifications } from './screens/Notifications'
import { Profile } from './screens/Profile'
import { Shopping } from './screens/Shopping'
import { StackScreen } from './screens/StackScreen'
import { Today } from './screens/Today'
import { useAppState } from './state/context'

const DevBarcodes = lazy(() => import('./screens/dev/Barcodes'))
const DevStyleguide = lazy(() => import('./screens/dev/Styleguide'))

function RequireOnboarded() {
  const { state } = useAppState()
  if (!state.routine) return <Navigate to="/onboarding" replace />
  return <Outlet />
}

function Home() {
  const { state } = useAppState()
  return <Navigate to={state.routine ? '/today' : '/onboarding'} replace />
}

export function App() {
  const location = useLocation()
  const { state } = useAppState()
  const isDevRoute = location.pathname.startsWith('/dev/')

  // iOS: the Home Screen app has its own storage, so install comes before onboarding.
  if (needsIOSInstallGate() && !isDevRoute) {
    return (
      <>
        <Banner />
        <InstallGate />
      </>
    )
  }

  const showNav = state.routine !== null && location.pathname !== '/onboarding' && !isDevRoute

  return (
    <>
      <Banner />
      <SyncManager />
      <Suspense
        fallback={<main className="screen screen--no-nav muted">{t('common.loading')}</main>}
      >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/onboarding" element={<Onboarding />} />
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
