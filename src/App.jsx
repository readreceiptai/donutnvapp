import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation, Link } from 'react-router-dom'
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
import Book from './pages/Book'
import Games from './pages/Games'
import Franchise from './pages/Franchise'
import TrackEvent from './pages/TrackEvent'
import Schedule from './pages/Schedule'
import Onboard from './pages/Onboard'
// Operator + preview screens are code-split into their own chunks, so customers
// never download the franchisee/ELLE/admin code (and vice-versa). As the second
// app (ELLE) grows, its route lazy-loads here too.
const AdminHome = lazy(() => import('./pages/AdminHome'))
const Dashboard = lazy(() => import('./pages/operator/Dashboard'))
const GoLive = lazy(() => import('./pages/operator/GoLive'))
const Campaigns = lazy(() => import('./pages/operator/Campaigns'))
const Bookings = lazy(() => import('./pages/operator/Bookings'))
const OpSchedule = lazy(() => import('./pages/operator/Schedule'))
const OpReviews = lazy(() => import('./pages/operator/Reviews'))
const OpCorporate = lazy(() => import('./pages/operator/Corporate'))
const OpCustomers = lazy(() => import('./pages/operator/Customers'))
const Elle = lazy(() => import('./pages/operator/Elle'))
const Unrouted = lazy(() => import('./pages/operator/Unrouted'))
const FranDev = lazy(() => import('./pages/operator/FranDev'))
const OpFeedback = lazy(() => import('./pages/operator/Feedback'))
const Preview = lazy(() => import('./pages/Preview'))

function Loading() {
  return <div className="screen pad-top center"><p className="muted" style={{ marginTop: '40vh' }}>Loading…</p></div>
}

// Signed in, but no profile row loaded. Happens if signup's complete_signup
// failed mid-way, or a stray login created an auth user with no profile. Without
// this the user drops into the customer shell and spins forever — give them a
// real way out (start over or sign out) instead of a dead end.
function NeedsSetup() {
  const { signOut, reloadProfile } = useAuth()
  return (
    <div className="screen pad-top center">
      <div className="card stack" style={{ maxWidth: 380, margin: '20vh auto 0' }}>
        <h1 style={{ marginTop: 0 }}>Let's finish setting up</h1>
        <p className="muted" style={{ margin: 0 }}>
          Your sign-in worked, but we couldn't find your account details. Create your
          account to pick up where you left off.
        </p>
        <Link className="btn btn-primary" to="/signup">Finish creating my account</Link>
        <button className="btn btn-ghost" onClick={() => reloadProfile()}>Try again</button>
        <button className="link" onClick={() => signOut()}>Sign out</button>
      </div>
    </div>
  )
}

// Staging preview: unlock every screen with no login. On if VITE_PREVIEW_MODE=1
// or the URL has ?preview=1 (remembered for the session). Off in production.
function previewEnabled() {
  // Preview unlocks every screen with NO login. It's allowed ONLY when the build
  // explicitly sets VITE_PREVIEW_MODE=1 (we set that on staging). There is no
  // ?preview=1 URL backdoor — so a production build (env var unset, as it will be
  // for donutnvapp.com) can never be unlocked from the address bar.
  return import.meta.env.VITE_PREVIEW_MODE === '1'
}

export default function App() {
  const { session, profile, entitlements, loading } = useAuth()
  const location = useLocation()
  const PREVIEW = previewEnabled()
  const path = location.pathname
  // The marketing landing is full-width and carries its OWN awning, so the
  // global phone-width awning is suppressed there.
  const onLanding = (path === '/' || path === '') && (PREVIEW || !session)
  // ELLE is its own full-screen product with its own dark skin — no DonutNV chrome.
  const onElle = path === '/elle'
  // Onboarding is a standalone full-screen wizard that owns its own chrome.
  const onOnboard = path === '/onboard'

  let content
  if (PREVIEW) {
    content = (
      <Routes>
        <Route path="/preview" element={<Preview />} />
        <Route path="/" element={<Landing />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/login" element={<Login />} />
        <Route path="/owner" element={<OwnerLogin />} />
        <Route path="/onboard" element={<Onboard />} />
        <Route path="/book" element={<Book />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/track/:token" element={<TrackEvent />} />
        <Route path="/find" element={<AppShell><Find /></AppShell>} />
        <Route path="/games" element={<AppShell><Games /></AppShell>} />
        <Route path="/rewards" element={<AppShell><Rewards /></AppShell>} />
        <Route path="/account" element={<AppShell><Account /></AppShell>} />
        <Route path="/admin" element={<OperatorShell><AdminHome /></OperatorShell>} />
        <Route path="/admin/dashboard" element={<OperatorShell><Dashboard /></OperatorShell>} />
        <Route path="/admin/live" element={<OperatorShell><GoLive /></OperatorShell>} />
        <Route path="/admin/bookings" element={<OperatorShell><Bookings /></OperatorShell>} />
        <Route path="/admin/schedule" element={<OperatorShell><OpSchedule /></OperatorShell>} />
        <Route path="/admin/reviews" element={<OperatorShell><OpReviews /></OperatorShell>} />
        <Route path="/admin/corporate" element={<OperatorShell><OpCorporate /></OperatorShell>} />
        <Route path="/admin/customers" element={<OperatorShell><OpCustomers /></OperatorShell>} />
        <Route path="/admin/unrouted" element={<OperatorShell><Unrouted /></OperatorShell>} />
        <Route path="/admin/franchise" element={<OperatorShell><FranDev /></OperatorShell>} />
        <Route path="/admin/feedback" element={<OperatorShell><OpFeedback /></OperatorShell>} />
        <Route path="/franchise" element={<Franchise />} />
        <Route path="/admin/games" element={<OperatorShell><Campaigns /></OperatorShell>} />
        <Route path="/elle" element={<Elle />} />
        <Route path="*" element={<Navigate to="/preview" replace />} />
      </Routes>
    )
  } else if (loading) {
    content = <div className="screen pad-top center"><p className="muted" style={{ marginTop: '40vh' }}>Loading…</p></div>
  } else if (path.startsWith('/track/')) {
    content = <Routes><Route path="/track/:token" element={<TrackEvent />} /></Routes>
  } else if (path === '/onboard') {
    // Public owner-onboarding wizard — no login, no app chrome, any session state.
    content = <Routes><Route path="/onboard" element={<Onboard />} /></Routes>
  } else if (!session) {
    content = (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/book" element={<Book />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/login" element={<Login />} />
        <Route path="/owner" element={<OwnerLogin />} />
        <Route path="/franchise" element={<Franchise />} />
        <Route path="*" element={<Navigate to="/" replace state={{ from: location }} />} />
      </Routes>
    )
  } else if (session && !profile) {
    // Authenticated but profile missing — recoverable screen, never the spinner.
    content = <NeedsSetup />
  } else if (profile && (profile.role === 'operator' || profile.role === 'admin')) {
    // ELLE is its own full-screen product — render it bare, never inside the
    // operator shell (which would add the top bar + bottom tab bar).
    content = (onElle && entitlements?.elle) ? (
      <Elle />
    ) : (
      <OperatorShell>
        <Routes>
          <Route path="/admin" element={<AdminHome />} />
          <Route path="/admin/dashboard" element={<Dashboard />} />
          <Route path="/admin/live" element={<GoLive />} />
          <Route path="/admin/bookings" element={<Bookings />} />
          <Route path="/admin/schedule" element={<OpSchedule />} />
          <Route path="/admin/reviews" element={<OpReviews />} />
          <Route path="/admin/corporate" element={<OpCorporate />} />
          <Route path="/admin/customers" element={<OpCustomers />} />
          <Route path="/admin/games" element={<Campaigns />} />
          {profile?.is_superadmin && <Route path="/admin/unrouted" element={<Unrouted />} />}
          {profile?.is_superadmin && <Route path="/admin/franchise" element={<FranDev />} />}
          {entitlements?.elle && <Route path="/elle" element={<Elle />} />}
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </OperatorShell>
    )
  } else {
    content = (
      <AppShell>
        <Routes>
          <Route path="/" element={<Find />} />
          <Route path="/book" element={<Book />} />
          <Route path="/games" element={<Games />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/account" element={<Account />} />
          <Route path="/franchise" element={<Franchise />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    )
  }

  return (<>{!onLanding && !onElle && !onOnboard && <AwningBar />}<Suspense fallback={<Loading />}>{content}</Suspense></>)
}
