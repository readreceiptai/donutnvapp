import { NavLink } from 'react-router-dom'
import BrandLogo from './BrandLogo'

// Operator app wrapper: same shape as the customer shell, different tabs.
// Three tabs, big targets — a zee can run the whole truck from this.
export default function OperatorShell({ children }) {
  return (
    <div className="screen">
      <div className="topbar">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BrandLogo height={24} />
          <span style={{ color: 'var(--ink)', fontSize: '.75rem', fontWeight: 600 }}>OWNER</span>
        </span>
      </div>
      {children}
      <nav className="tabbar">
        <NavLink to="/admin" end>{({ isActive }) => <Tab active={isActive} ico="🏠" label="Home" />}</NavLink>
        <NavLink to="/admin/live">{({ isActive }) => <Tab active={isActive} ico="🟢" label="Go Live" />}</NavLink>
        <NavLink to="/admin/bookings">{({ isActive }) => <Tab active={isActive} ico="📅" label="Bookings" />}</NavLink>
        <NavLink to="/admin/schedule">{({ isActive }) => <Tab active={isActive} ico="📆" label="Schedule" />}</NavLink>
        <NavLink to="/admin/games">{({ isActive }) => <Tab active={isActive} ico="🎮" label="Games" />}</NavLink>
      </nav>
    </div>
  )
}

function Tab({ active, ico, label }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: active ? 'var(--red)' : 'var(--muted)' }}>
      <span className="ico">{ico}</span>
      <span>{label}</span>
    </span>
  )
}
