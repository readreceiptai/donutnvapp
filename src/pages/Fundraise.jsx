import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isConfigured } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import BrandLogo from '../components/BrandLogo'
import { BOOKING_CONSENT, CONSENT_VERSION } from '../lib/consentText'
import { normalizePhone } from './Login'
import { isLikelyBot, honeypotStyle } from '../lib/antibot'
import TurnstileWidget, { TURNSTILE_ENABLED, passesTurnstile } from '../components/Turnstile'
import { DEMO } from '../lib/demo'

// Pre-filled demo values so the presenter can just tap submit on camera.
const DEMO_FUND = {
  orgName: 'Blessed Trinity Catholic School', orgType: 'school', cause: 'new playground fund',
  firstName: 'Maria', lastName: 'Alvarez', email: 'kevin@donutnv.com', phone: '(352) 555-0142',
  eventDate: '', attendance: '250', zip: '34471',
  details: 'Family Fun Night this spring — hoping to raise money for our new playground.',
  customerCareSms: true, optionalMarketing: false, company: '',
}

// Non-profit / give-back path. Same entry as Book-A-Truck, but a distinct, mission-forward
// experience for schools, teams, churches and non-profits. We highlight the shared-revenue
// angle WITHOUT quoting a percentage (that's the local owner's call). Submits through
// submit_fundraiser, which routes to the owning Z exactly like a booking AND records the
// fundraiser for the give-back engine.
const ORG_TYPES = [
  ['school', 'School / PTA / PTO'],
  ['sports', 'Sports team or league'],
  ['church', 'Church / faith group'],
  ['nonprofit', 'Non-profit / charity'],
  ['youth', 'Youth program / club'],
  ['other', 'Other cause'],
]

export default function Fundraise({ onBack }) {
  const { tenant, profile } = useAuth()
  const [f, setF] = useState(DEMO ? { ...DEMO_FUND } : {
    orgName: '', orgType: '', cause: '',
    firstName: profile?.first_name || '', lastName: profile?.last_name || '',
    email: profile?.email || '', phone: profile?.phone || '',
    eventDate: '', attendance: '', zip: profile?.zip || '', details: '',
    customerCareSms: false, optionalMarketing: false, company: '',
  })
  const startedAt = useRef(Date.now())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  const [tsToken, setTsToken] = useState('')
  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setF((p) => ({ ...p, [k]: v }))
  }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (isLikelyBot({ honeypot: f.company, startedAt: startedAt.current })) return
    if (!isConfigured) { setErr('Not connected to Supabase yet — add your keys in .env.'); return }
    if (!f.orgName || !f.orgType || !f.firstName || !f.lastName || !f.email || !f.zip) {
      setErr('Please fill in your organization, name, email, and ZIP code.'); return
    }
    if (TURNSTILE_ENABLED && !tsToken) { setErr('Please complete the quick "I\'m human" check below.'); return }
    setBusy(true)
    if (!(await passesTurnstile(tsToken))) { setBusy(false); setErr('Verification failed — please try the human check again.'); return }
    const { data, error } = await supabase.rpc('submit_fundraiser', {
      p_tenant: tenant?.id,
      p_org_name: f.orgName.trim(),
      p_org_type: f.orgType,
      p_cause: f.cause.trim() || null,
      p_contact_name: `${f.firstName} ${f.lastName}`.trim(),
      p_contact_phone: f.phone ? normalizePhone(f.phone) : null,
      p_contact_email: f.email.trim(),
      p_event_date: f.eventDate || null,
      p_guests: f.attendance ? parseInt(f.attendance, 10) || null : null,
      p_zip: f.zip.trim(),
      p_notes: f.details || null,
      p_sms_consent: !!f.customerCareSms,
      p_marketing_consent: !!f.optionalMarketing,
      p_consent_text_version: CONSENT_VERSION,
    })
    if (error) { setBusy(false); setErr(error.message); return }
    const row = Array.isArray(data) ? data[0] : data
    if (row?.id && row?.tracking_token) {
      supabase.functions.invoke('ghl-sync', { body: { booking_id: row.id, token: row.tracking_token } }).catch(() => {})
    }
    setBusy(false); setDone(true)
  }

  if (done) {
    return (
      <div className="screen pad-top center">
        <div style={{ marginTop: 30, fontSize: 56 }}>💛 <img src="/brand/minidonut.png" alt="" style={{ width: 52, height: 52, verticalAlign: '-10px' }} /></div>
        <h1>Let's raise some dough!</h1>
        <p className="muted">Thanks, {f.firstName}! We got your fundraiser request for {f.orgName}. Your local DonutNV owner will reach out to lock in the details and set up your give-back.</p>
        <Link className="btn btn-primary" to="/" style={{ marginTop: 16 }}>Done</Link>
      </div>
    )
  }

  return (
    <div className="screen pad-top">
      <div className="topbar">
        <BrandLogo height={30} />
        {onBack ? <button className="link" style={{ fontSize: '.85rem', background: 'none', border: 0, cursor: 'pointer' }} onClick={onBack}>← Back</button>
                : <Link to="/" className="link" style={{ fontSize: '.85rem' }}>Close</Link>}
      </div>

      <h1>Raise some dough for your cause <img src="/brand/minidonut.png" alt="" style={{ height: '0.8em', verticalAlign: '-0.06em' }} /></h1>
      <p className="muted" style={{ marginTop: -6 }}>
        Partner with DonutNV — turn hot, fresh mini donuts into real support for your school, team, or non-profit.
      </p>

      <div className="card" style={{ background: 'linear-gradient(135deg,rgba(233,17,106,.06),rgba(233,166,59,.08))', borderTop: '4px solid var(--brand, #e91e63)' }}>
        <h2 style={{ marginTop: 0, marginBottom: 6 }}>Giving back is who we are 💛</h2>
        <p className="muted" style={{ margin: 0 }}>
          Our local owners team up with schools, youth programs, churches, and non-profits — and a portion of every
          sale at your event comes right back to your cause. In 2025 alone, DonutNV owners raised over $635,000 for
          local communities. Tell us about your group and we'll bring the truck, the fun, and the fundraising.
        </p>
      </div>

      <form className="card stack" onSubmit={submit} style={{ marginTop: 12 }}>
        <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" style={honeypotStyle} value={f.company} onChange={set('company')} />

        <Field label="Organization name *"><input className="fld" placeholder="e.g. Lincoln Elementary PTO" value={f.orgName} onChange={set('orgName')} required /></Field>

        <Field label="Type of organization *">
          <select className="fld" value={f.orgType} onChange={set('orgType')} required>
            <option value="">Choose one…</option>
            {ORG_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>

        <Field label="What are you raising money for?">
          <input className="fld" placeholder="e.g. new playground, team uniforms, mission trip" value={f.cause} onChange={set('cause')} />
        </Field>

        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="First name *" grow><input className="fld" value={f.firstName} onChange={set('firstName')} required /></Field>
          <Field label="Last name *" grow><input className="fld" value={f.lastName} onChange={set('lastName')} required /></Field>
        </div>

        <Field label="Email *"><input className="fld" type="email" inputMode="email" value={f.email} onChange={set('email')} required /></Field>
        <Field label="Phone number">
          <input className="fld" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} />
          <div className="hint">Optional, but the fastest way for your local owner to coordinate.</div>
        </Field>

        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Ideal date" grow><input className="fld" type="date" value={f.eventDate} onChange={set('eventDate')} /></Field>
          <Field label="Expected turnout" grow><input className="fld" inputMode="numeric" placeholder="e.g. 200" value={f.attendance} onChange={set('attendance')} /></Field>
        </div>

        <Field label="Zip code *"><input className="fld" inputMode="numeric" maxLength={5} value={f.zip} onChange={set('zip')} required /></Field>

        <Field label="Anything else we should know?">
          <textarea rows={3} value={f.details} onChange={set('details')}
            style={{ width: '100%', fontSize: '1.05rem', padding: '12px 14px', border: '2px solid var(--line)', borderRadius: 12, fontFamily: 'var(--font-body)' }} />
        </Field>

        <div>
          <label className="consent">
            <input type="checkbox" checked={f.customerCareSms} onChange={set('customerCareSms')} />
            <span className="label">{BOOKING_CONSENT.customer_care_sms}</span>
          </label>
          <label className="consent">
            <input type="checkbox" checked={f.optionalMarketing} onChange={set('optionalMarketing')} />
            <span className="label">{BOOKING_CONSENT.optional_marketing}</span>
          </label>
        </div>

        <p className="muted" style={{ fontSize: '.76rem', margin: 0 }}>
          By submitting you agree to our <a className="link" href="https://donutnv.com/terms-of-service/" target="_blank" rel="noreferrer">Terms of Service</a> & <a className="link" href="https://donutnv.com/privacy-policy/" target="_blank" rel="noreferrer">Privacy Policy</a>.
        </p>

        <TurnstileWidget onToken={setTsToken} />
        {err && <div className="error">{err}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Start our fundraiser'}</button>
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
