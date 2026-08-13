import { NavLink } from 'react-router-dom'
import BrandLogo from './BrandLogo'
import MiniDonut from './MiniDonut'
import FeedbackButton from './FeedbackButton'
import { useAuth } from '../context/AuthContext'

// Wraps the signed-in app: branded top bar + big bottom nav.
// Five tabs: find the truck, book one, earn rewards, play, manage the account.
export default function AppShell({ children }) {
  const { signOut } = useAuth()
  return (
    <div className="screen">
      <div className="topbar">
        <BrandLogo height={26} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="fun" style={{ fontSize: '1.1rem', color: 'var(--blue)' }}>Make it sweet!</span>
          <button onClick={signOut} style={{ fontSize: '.78rem', fontWeight: 700, fontFamily: 'var(--font-head)', color: 'var(--muted)', background: 'none', border: 0, cursor: 'pointer', padding: 4 }}>Log out</button>
        </div>
      </div>
      {children}
      <FeedbackButton role="customer" />
      <nav className="tabbar">
        <NavLink to="/" end>{({ isActive }) => <Tab active={isActive} ico="📍" label="Find" />}</NavLink>
        <NavLink to="/rewards">{({ isActive }) => <Tab active={isActive} ico={<MiniDonut size={24} />} label="Rewards" />}</NavLink>
        <NavLink to="/games">{({ isActive }) => <Tab active={isActive} ico="🎮" label="Games" />}</NavLink>
        <NavLink to="/book">{({ isActive }) => <Tab active={isActive} ico="🚚" label="Book" />}</NavLink>
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
