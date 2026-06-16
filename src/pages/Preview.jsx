import { Link } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'

// Staging-only index of every screen, so you can click through them all with no
// login. Enabled by the VITE_PREVIEW_MODE flag (or ?preview=1). See App.jsx.
const GROUPS = [
  { title: 'Public / customer-facing', items: [
    ['/', 'Landing — curtain intro, awning, hero'],
    ['/signup', 'Customer sign-up'],
    ['/login', 'Customer login (phone/email code)'],
    ['/book', 'Book-a-truck form'],
  ] },
  { title: 'Customer app', items: [
    ['/find', 'Find — live truck map'],
    ['/rewards', 'Rewards — stamp card'],
    ['/account', 'Account — profile & alerts'],
  ] },
  { title: 'Owner / operator', items: [
    ['/owner', 'Owner login (@donutnv.com + password)'],
    ['/admin', 'Operator home + kill switch'],
    ['/admin/live', 'Go Live — broadcast + GPS fail-safes'],
    ['/admin/bookings', 'Bookings — event-day controls'],
    ['/admin/games', 'Games — weekly rewards admin'],
  ] },
  { title: 'Booked-client event portal', items: [
    ['/track/demo', 'Client portal — with a stage switcher'],
  ] },
]

export default function Preview() {
  return (
    <div className="screen pad-top">
      <div className="center"><BrandLogo height={32} /></div>
      <h1 style={{ marginTop: 10 }}>Staging preview</h1>
      <p className="muted" style={{ marginTop: -6 }}>Every screen, no login needed. Tap to view. (Screens are empty without live data — that's expected on staging.)</p>

      {GROUPS.map((g) => (
        <div className="card" key={g.title} style={{ marginTop: 14 }}>
          <h2 style={{ marginBottom: 8 }}>{g.title}</h2>
          <div className="stack">
            {g.items.map(([to, label]) => (
              <Link key={to} to={to} className="btn btn-ghost" style={{ justifyContent: 'space-between', textAlign: 'left' }}>
                <span>{label}</span><span style={{ color: 'var(--blue)' }}>→</span>
              </Link>
            ))}
          </div>
        </div>
      ))}

      <p className="center muted" style={{ fontSize: '.75rem', marginTop: 16 }}>
        Preview mode is on. Remove VITE_PREVIEW_MODE before production to re-lock the app.
      </p>
    </div>
  )
}
