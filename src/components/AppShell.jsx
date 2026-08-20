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
        <NavLink to="/find">{({ isActive }) => <Tab active={isActive} ico={<IconPin />} label="Find" />}</NavLink>
        <NavLink to="/rewards">{({ isActive }) => <Tab active={isActive} ico={<MiniDonut size={24} />} label="Rewards" />}</NavLink>
        <NavLink to="/games">{({ isActive }) => <Tab active={isActive} ico={<IconGame />} label="Games" />}</NavLink>
        <NavLink to="/book">{({ isActive }) => <Tab active={isActive} ico={<IconTruck />} label="Book" />}</NavLink>
        <NavLink to="/account">{({ isActive }) => <Tab active={isActive} ico={<IconUser />} label="Account" />}</NavLink>
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

// Clean stroke icons — inherit color from the active/inactive tab state.
const svg = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
function IconPin() {
  return <svg {...svg}><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10Z" /><circle cx="12" cy="11" r="2.3" /></svg>
}
function IconGame() {
  return (
    <svg {...svg}>
      <rect x="3" y="8" width="18" height="10" rx="5" />
      <line x1="8" y1="12" x2="8" y2="15" /><line x1="6.5" y1="13.5" x2="9.5" y2="13.5" />
      <circle cx="15.6" cy="12.6" r=".9" fill="currentColor" stroke="none" />
      <circle cx="17.6" cy="14.4" r=".9" fill="currentColor" stroke="none" />
    </svg>
  )
}
function IconTruck() {
  return (
    <svg {...svg}>
      <path d="M3 7.5h10.5v8H3z" /><path d="M13.5 10.5H17l3.5 3.5v1.5h-7z" />
      <circle cx="7" cy="17.5" r="1.7" /><circle cx="17.5" cy="17.5" r="1.7" />
    </svg>
  )
}
function IconUser() {
  return <svg {...svg}><circle cx="12" cy="8" r="3.2" /><path d="M5.5 19a6.5 6.5 0 0 1 13 0" /></svg>
}
