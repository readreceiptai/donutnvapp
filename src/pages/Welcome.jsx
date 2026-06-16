import { Link } from 'react-router-dom'
import MiniDonut from '../components/MiniDonut'

export default function Welcome() {
  return (
    <div className="screen pad-top">
      <div className="center" style={{ marginTop: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}><MiniDonut size={84} /></div>
        <h1 style={{ marginTop: 14 }}>
          Donut<span style={{ color: 'var(--blue)' }}>NV</span>
        </h1>
        <p className="fun" style={{ fontSize: '1.5rem', color: 'var(--red)', margin: '2px 0 0' }}>
          Find the truck. Earn free donuts.
        </p>
      </div>

      <div className="card card-accent stack" style={{ marginTop: 30 }}>
        <Feature ico="📍" title="See where the trucks are" text="A live map shows you exactly where to find hot, fresh mini donuts right now." />
        <Feature ico="🔔" title="Get a heads-up" text="We'll ping you when a truck is near your neighborhood." />
        <Feature ico="🎂" title="Rewards & birthday treats" text="Earn toward free donuts every visit — plus a little something on your birthday." />
      </div>

      <div className="stack" style={{ marginTop: 26 }}>
        <Link className="btn btn-primary" to="/signup">Get started — it's free</Link>
        <Link className="btn btn-ghost" to="/login">I already have an account</Link>
      </div>

      <p className="center muted" style={{ fontSize: '.78rem', marginTop: 18 }}>
        By continuing you agree to our Terms & Privacy Policy.
      </p>
    </div>
  )
}

function Feature({ ico, title, text }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div style={{ fontSize: 30, lineHeight: 1 }}>{ico}</div>
      <div>
        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700 }}>{title}</div>
        <div className="muted" style={{ fontSize: '.9rem' }}>{text}</div>
      </div>
    </div>
  )
}
