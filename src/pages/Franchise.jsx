import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isConfigured } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import BrandLogo from '../components/BrandLogo'
import { isLikelyBot, honeypotStyle } from '../lib/antibot'
import TurnstileWidget, { TURNSTILE_ENABLED, passesTurnstile } from '../components/Turnstile'

const STATES = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming']
const CAPITAL = ['$50K - $100K', '$100K - $150K', '$150K - $250K', '$250K - $500K', '$500K+']
const CONSENT_VERSION = 'frandev-2026-07'

// Franchise-development interest form. Mirrors donutnvfranchise.com/contact, with
// Liquid Capital as the light-qualification gate to keep junk out. Leads land in
// Kevin's in-app FranDev queue (and will email kevin@donutnv.com once email is live).
export default function Franchise() {
  const { tenant } = useAuth()
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', phone: '', state: '', capital: '', message: '', consent: false, company: '' })
  const startedAt = useRef(Date.now())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  const [tsToken, setTsToken] = useState('')
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (isLikelyBot({ honeypot: f.company, startedAt: startedAt.current })) return
    if (!isConfigured) { setErr('Not connected yet — try again shortly.'); return }
    if (!f.firstName || !f.lastName || !f.email || !f.state || !f.capital) {
      setErr('Please fill in your name, email, state, and liquid capital so we can point you to the right territory.'); return
    }
    if (!f.consent) { setErr('Please agree to be contacted so we can follow up.'); return }
    if (TURNSTILE_ENABLED && !tsToken) { setErr('Please complete the quick "I\'m human" check.'); return }
    setBusy(true)
    if (!(await passesTurnstile(tsToken))) { setBusy(false); setErr('Verification failed — please try the human check again.'); return }
    const { error } = await supabase.rpc('submit_frandev', {
      p_first: f.firstName, p_last: f.lastName, p_email: f.email.trim(), p_phone: f.phone || null,
      p_state: f.state, p_capital: f.capital, p_message: f.message || null,
      p_tenant: tenant?.id || null, p_consent: CONSENT_VERSION,
    })
    setBusy(false)
    if (error) { setErr('Something went wrong — please try again.'); return }
    setDone(true)
  }

  if (done) {
    return (
      <div className="screen pad-top center">
        <div style={{ marginTop: 30 }}><img src="/brand/minidonut.png" alt="" style={{ width: 64, height: 64 }} /></div>
        <h1>You're on the list!</h1>
        <p className="muted">Thanks, {f.firstName}. A DonutNV franchise specialist will reach out within one business day to talk through your market and next steps.</p>
        <Link className="btn btn-primary" to="/" style={{ marginTop: 16 }}>Back to donuts</Link>
      </div>
    )
  }

  return (
    <div className="screen pad-top">
      <div className="topbar"><BrandLogo height={30} /><Link to="/" className="link" style={{ fontSize: '.85rem' }}>Close</Link></div>
      <h1>Own a DonutNV <img src="/brand/minidonut.png" alt="" style={{ height: '0.8em', verticalAlign: '-0.06em' }} /></h1>
      <p className="muted" style={{ marginTop: -6 }}>
        Love what we do? Turn it into your own business. Interactive mobile donut franchise — flat
        $750/mo royalty (never a percentage), turnkey equipment, ~$189K–$273K total investment.
      </p>

      <form className="card stack" onSubmit={submit}>
        <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" style={honeypotStyle} value={f.company} onChange={set('company')} />
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="First name *" grow><input className="fld" value={f.firstName} onChange={set('firstName')} required /></Field>
          <Field label="Last name *" grow><input className="fld" value={f.lastName} onChange={set('lastName')} required /></Field>
        </div>
        <Field label="Email *"><input className="fld" type="email" inputMode="email" value={f.email} onChange={set('email')} required /></Field>
        <Field label="Phone"><input className="fld" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Your state *" grow>
            <select className="fld" value={f.state} onChange={set('state')} required>
              <option value="">Select state…</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Liquid capital *" grow>
            <select className="fld" value={f.capital} onChange={set('capital')} required>
              <option value="">Select range…</option>
              {CAPITAL.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Anything else you'd like us to know?">
          <textarea rows={3} value={f.message} onChange={set('message')}
            style={{ width: '100%', fontSize: '1.05rem', padding: '12px 14px', border: '2px solid var(--line)', borderRadius: 12, fontFamily: 'var(--font-body)' }} />
        </Field>

        <label className="consent">
          <input type="checkbox" checked={f.consent} onChange={set('consent')} />
          <span className="label">I agree to be contacted by DonutNV by phone, email, or text about franchise opportunities. Message/data rates may apply; opt out anytime. My info is kept private and never sold.</span>
        </label>

        <TurnstileWidget onToken={setTsToken} />
        {err && <div className="error">{err}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Request more information'}</button>
        <p className="muted" style={{ fontSize: '.72rem', margin: 0 }}>
          This is a franchise investment opportunity, not a job listing. Informational only; not an offer to sell a franchise.
        </p>
      </form>
    </div>
  )
}

function Field({ label, grow, children }) {
  return (
    <div className="field" style={{ margin: 0, flex: grow ? 1 : undefined }}>
      <label>{label}</label>
      {children}
    </div>
  )
}
