import { NavLink } from 'react-router-dom'
import BrandLogo from './BrandLogo'
import MiniDonut from './MiniDonut'

// Wraps the signed-in app: branded top bar + big bottom nav.
// Three tabs only — deliberately simple for non-tech-savvy users.
export default function AppShell({ children }) {
  return (
    <div className="screen">
      <div className="topbar">
        <BrandLogo height={26} />
        <span className="fun" style={{ fontSize: '1.1rem', color: 'var(--blue)' }}>Make it sweet!</span>
      </div>
      {children}
      <nav className="tabbar">
        <NavLink to="/" end>{({ isActive }) => <Tab active={isActive} ico="📍" label="Find" />}</NavLink>
        <NavLink to="/rewards">{({ isActive }) => <Tab active={isActive} ico={<MiniDonut size={24} />} label="Rewards" />}</NavLink>
        <NavLink to="/account">{({ isActive }) => <Tab active={isActive} ico="👤" label="Account" />}</NavLink>
      </nav>
    </div>
  )
}

function Tab({ active, ico, label }) {
  return (
    <span className={active ? 'active' : ''} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: active ? 'var(--red)' : 'var(--muted)' }}>
      <span className="ico">{ico}</span>
      <span>{label}</span>
    </span>
  )
}
