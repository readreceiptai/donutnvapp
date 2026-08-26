import { NavLink, Link } from 'react-router-dom'
import BrandLogo from './BrandLogo'
import FeedbackButton from './FeedbackButton'
import { useAuth } from '../context/AuthContext'

// Operator app wrapper: same shape as the customer shell, different tabs.
// Three tabs, big targets — a zee can run the whole truck from this.
export default function OperatorShell({ children }) {
  const { isSuperadmin } = useAuth()
  return (
    <div className="screen">
      <div className="topbar">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BrandLogo height={24} />
          <span style={{ color: 'var(--ink)', fontSize: '.75rem', fontWeight: 600 }}>OWNER</span>
        </span>
        {isSuperadmin && (
          <Link to="/admin/godmode" style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--navy)', textDecoration: 'none' }}>⚡ God Mode</Link>
        )}
      </div>
      {children}
      <FeedbackButton role="franchisee" />
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
