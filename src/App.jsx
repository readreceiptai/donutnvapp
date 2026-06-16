import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import AppShell from './components/AppShell'
import OperatorShell from './components/OperatorShell'
import AwningBar from './components/AwningBar'
import Landing from './pages/Landing'
import SignUp from './pages/SignUp'
import Login from './pages/Login'
import OwnerLogin from './pages/OwnerLogin'
import Find from './pages/Find'
import Rewards from './pages/Rewards'
import Account from './pages/Account'
import AdminHome from './pages/AdminHome'
import GoLive from './pages/operator/GoLive'
import Campaigns from './pages/operator/Campaigns'
import Bookings from './pages/operator/Bookings'
import BookTruck from './pages/BookTruck'
import TrackEvent from './pages/TrackEvent'
import Schedule from './pages/Schedule'
import OpSchedule from './pages/operator/Schedule'
import OpReviews from './pages/operator/Reviews'
import OpCorporate from './pages/operator/Corporate'
import OpCustomers from './pages/operator/Customers'
import Preview from './pages/Preview'

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

  return (<>{!onLanding && <AwningBar />}{content}</>)
}
