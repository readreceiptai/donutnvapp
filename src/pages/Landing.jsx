import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import CurtainIntro from '../components/CurtainIntro'
import BrandLogo from '../components/BrandLogo'
import MiniDonut from '../components/MiniDonut'

const EVENT_TYPES = [
  'Birthday parties', 'Corporate events', 'Graduations', 'Weddings', 'School functions',
  'Fundraisers', 'Festivals', 'HOA & block parties', 'Holiday parties', 'Grand openings',
  'Bar & Bat Mitzvahs', 'Teacher appreciation',
]

export default function Landing() {
  const { tenant } = useAuth()
  const [installEvt, setInstallEvt] = useState(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setInstallEvt(e) }
    const onInstalled = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function install() {
    if (!installEvt) { alert('To install: tap your browser\'s Share button, then "Add to Home Screen."'); return }
    installEvt.prompt(); await installEvt.userChoice; setInstallEvt(null)
  }

  const area = tenant?.name || 'your area'
  const fb = tenant?.brand?.facebook || 'https://www.facebook.com/DonutNVCompany/'

  return (
    <div className="mk">
      <CurtainIntro />

      <div className="mk-awning">
        <img src="/brand/awning.png" alt="" onError={(e) => { e.currentTarget.parentElement.style.display = 'none' }} />
      </div>

      <div className="mk-wrap">
        <nav className="mk-nav">
          <BrandLogo height={42} />
          <div className="links">
            <Link to="/signup">Find donuts</Link>
            <Link to="/book">Book a truck</Link>
            <a href={fb} target="_blank" rel="noreferrer">Facebook</a>
          </div>
        </nav>

        {/* Hero — customer first */}
        <section className="mk-hero">
          <div>
            <span className="pill pill-open">📍 Serving {area}</span>
            <h1>Find your favorite<br />donuts.</h1>
            <p className="sub">Hot mini donuts, headed your way.</p>
            <p className="lead muted">
              See where the trucks are right now, sign up to earn loyalty rewards,
              and play for free donuts and prizes.
            </p>
            <div className="ctas">
              <Link className="btn btn-primary" to="/signup">Find donuts near me</Link>
              {!installed && <button className="btn btn-ghost" onClick={install}>⬇️ Add to home screen</button>}
            </div>
          </div>
          <div className="mk-hero-art">
            <img src="/brand/donut.png" alt="A bucket of DonutNV mini donuts"
                 onError={(e) => { e.currentTarget.style.display = 'none' }} />
          </div>
        </section>
      </div>

      {/* Sign up & win */}
      <div className="mk-wrap mk-section">
        <h2 className="mk-section-title">Sign up & start winning</h2>
        <p className="mk-sub">A free account unlocks loyalty rewards and all the fun — it only takes a few seconds.</p>
        <div className="mk-features">
          <Feature ico={<MiniDonut size={34} />} title="Loyalty rewards" text="Earn toward free donuts every single visit. Your phone number is your card." />
          <Feature ico="🗺️" title="Donut Passport" text="Visit different stops, collect stamps, and unlock special rewards along the way." />
          <Feature ico="🎁" title="Win prizes" text="Play for free donuts, branded swag, and DonutNV T-shirts. New games every week." />
          <Feature ico="🎂" title="Birthday treat" text="Tell us your birthday and we'll make your day a little sweeter." />
        </div>
      </div>

      {/* Catch us / schedule + Facebook */}
      <div className="mk-band cream">
        <div className="mk-wrap">
          <h2>Catch us this week 🚚</h2>
          <p>See where we'll be ahead of time, get a text when a truck is near you, and follow your local truck for updates.</p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link className="btn btn-primary" to="/signup" style={{ width: 'auto', padding: '14px 28px' }}>See where we'll be</Link>
            <a className="mk-fb" href={fb} target="_blank" rel="noreferrer"><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 22v-8h3l1-4h-4V8c0-1.1.9-2 2-2h2V2h-3a5 5 0 0 0-5 5v3H6v4h3v8h4z"/></svg>Follow on Facebook</a>
          </div>
        </div>
      </div>

      {/* Private events — clearly separated */}
      <div className="mk-wrap mk-section" style={{ paddingTop: 48 }}>
        <h2 className="mk-section-title">Book the truck for your event</h2>
        <p className="mk-sub">Bring the donut truck — and the show — straight to your party. We cater all kinds of events:</p>
        <div className="mk-chips">
          {EVENT_TYPES.map((e) => <span className="mk-chip" key={e}>{e}</span>)}
          <span className="mk-chip more">…and many more!</span>
        </div>
        <p className="mk-sub" style={{ marginBottom: 18 }}>Tell us about your event and we'll tailor it to you.</p>
        <div style={{ textAlign: 'center' }}>
          <Link className="btn btn-primary" to="/book" style={{ width: 'auto', padding: '14px 32px', display: 'inline-flex' }}>Get a quote</Link>
        </div>
      </div>

      <div className="mk-wrap mk-footer">
        <a className="mk-fb" href={fb} target="_blank" rel="noreferrer" style={{ marginBottom: 14 }}><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 22v-8h3l1-4h-4V8c0-1.1.9-2 2-2h2V2h-3a5 5 0 0 0-5 5v3H6v4h3v8h4z"/></svg>Follow {tenant?.name || 'DonutNV'} on Facebook</a>
        <div>{tenant?.name || 'DonutNV'} • Make Your Next Party Sweet!®</div>
        <div style={{ marginTop: 4 }}>By continuing you agree to our Terms & Privacy Policy.</div>
        {/* Discreet franchisee entry — not meant to catch a customer's eye */}
        <div style={{ marginTop: 18 }}><Link to="/owner" className="mk-owner-link">DonutNV franchisee?</Link></div>
      </div>
    </div>
  )
}

function Feature({ ico, title, text }) {
  return (
    <div className="mk-feature">
      <div className="ico">{ico}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  )
}
