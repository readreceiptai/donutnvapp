import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import AppShell from './components/AppShell'
import OperatorShell from './components/OperatorShell'
import AwningBar from './components/AwningBar'
// Customer + auth screens stay eager — they're the common path and small.
import Landing from './pages/Landing'
import SignUp from './pages/SignUp'
import Login from './pages/Login'
import OwnerLogin from './pages/OwnerLogin'
import Find from './pages/Find'
import Rewards from './pages/Rewards'
import Account from './pages/Account'
import BookTruck from './pages/BookTruck'
import TrackEvent from './pages/TrackEvent'
import Schedule from './pages/Schedule'
// Operator + preview screens are code-split into their own chunks, so customers
// never download the franchisee/ELLE/admin code (and vice-versa). As the second
// app (ELLE) grows, its route lazy-loads here too.
const AdminHome = lazy(() => import('./pages/AdminHome'))
const GoLive = lazy(() => import('./pages/operator/GoLive'))
const Campaigns = lazy(() => import('./pages/operator/Campaigns'))
const Bookings = lazy(() => import('./pages/operator/Bookings'))
const OpSchedule = lazy(() => import('./pages/operator/Schedule'))
const OpReviews = lazy(() => import('./pages/operator/Reviews'))
const OpCorporate = lazy(() => import('./pages/operator/Corporate'))
const OpCustomers = lazy(() => import('./pages/operator/Customers'))
const Preview = lazy(() => import('./pages/Preview'))

function Loading() {
  return <div className="screen pad-top center"><p className="muted" style={{ marginTop: '40vh' }}>Loading…</p></div>
}

// Staging preview: unlock every screen with no login. On if VITE_PREVIEW_MODE=1
// or the URL has ?preview=1 (remembered for the session). Off in production.
function previewEnabled() {
  if (import.meta.env.VITE_PREVIEW_MODE === '1') return true
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.get('preview') === '1') sessionStorage.setItem('dnv_preview', '1')
    return sessionStorage.getItem('dnv_preview') === '1'
  } catch { return false }
}

export default function App() {
  const { session, profile, loading } = useAuth()
  const location = useLocation()
  const PREVIEW = previewEnabled()
  const path = location.pathname
  // The marketing landing is full-width and carries its OWN awning, so the
  // global phone-width awning is suppressed there.
  const onLanding = (path === '/' || path === '') && (PREVIEW || !session)

  let content
  if (PREVIEW) {
    content = (
      <Routes>
        <Route path="/preview" element={<Preview />} />
        <Route path="/" element={<Landing />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/login" element={<Login />} />
        <Route path="/owner" element={<OwnerLogin />} />
        <Route path="/book" element={<BookTruck />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/track/:token" element={<TrackEvent />} />
        <Route path="/find" element={<AppShell><Find /></AppShell>} />
        <Route path="/rewards" element={<AppShell><Rewards /></AppShell>} />
        <Route path="/account" element={<AppShell><Account /></AppShell>} />
        <Route path="/admin" element={<OperatorShell><AdminHome /></OperatorShell>} />
        <Route path="/admin/live" element={<OperatorShell><GoLive /></OperatorShell>} />
        <Route path="/admin/bookings" element={<OperatorShell><Bookings /></OperatorShell>} />
        <Route path="/admin/schedule" element={<OperatorShell><OpSchedule /></OperatorShell>} />
        <Route path="/admin/reviews" element={<OperatorShell><OpReviews /></OperatorShell>} />
        <Route path="/admin/corporate" element={<OperatorShell><OpCorporate /></OperatorShell>} />
        <Route path="/admin/customers" element={<OperatorShell><OpCustomers /></OperatorShell>} />
        <Route path="/admin/games" element={<OperatorShell><Campaigns /></OperatorShell>} />
        <Route path="*" element={<Navigate to="/preview" replace />} />
      </Routes>
    )
  } else if (loading) {
    content = <div className="screen pad-top center"><p className="muted" style={{ marginTop: '40vh' }}>Loading…</p></div>
  } else if (path.startsWith('/track/')) {
    content = <Routes><Route path="/track/:token" element={<TrackEvent />} /></Routes>
  } else if (!session) {
    content = (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/book" element={<BookTruck />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/login" element={<Login />} />
        <Route path="/owner" element={<OwnerLogin />} />
        <Route path="*" element={<Navigate to="/" replace state={{ from: location }} />} />
      </Routes>
    )
  } else if (profile && (profile.role === 'operator' || profile.role === 'admin')) {
    content = (
      <OperatorShell>
        <Routes>
          <Route path="/admin" element={<AdminHome />} />
          <Route path="/admin/live" element={<GoLive />} />
          <Route path="/admin/bookings" element={<Bookings />} />
          <Route path="/admin/schedule" element={<OpSchedule />} />
          <Route path="/admin/reviews" element={<OpReviews />} />
          <Route path="/admin/corporate" element={<OpCorporate />} />
          <Route path="/admin/customers" element={<OpCustomers />} />
          <Route path="/admin/games" element={<Campaigns />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </OperatorShell>
    )
  } else {
    content = (
      <AppShell>
        <Routes>
          <Route path="/" element={<Find />} />
          <Route path="/book" element={<BookTruck />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/account" element={<Account />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    )
  }

  return (<>{!onLanding && <AwningBar />}<Suspense fallback={<Loading />}>{content}</Suspense></>)
}
