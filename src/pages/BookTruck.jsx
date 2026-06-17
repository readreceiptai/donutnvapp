import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isConfigured } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import BrandLogo from '../components/BrandLogo'
import { BOOKING_CONSENT, CONSENT_VERSION } from '../lib/consentText'
import { normalizePhone } from './Login'
import { isLikelyBot, honeypotStyle } from '../lib/antibot'
import TurnstileWidget, { TURNSTILE_ENABLED, passesTurnstile } from '../components/Turnstile'

// Book-a-truck form. Fields mirror donutnv.com/book-a-truck exactly so the app
// collects the same information as the website. On submit it saves the booking
// AND pushes it to GHL/LeadConnector so your workflows kick in.
// Required (matching the website): First, Last, Email, Zip, "Tell us about your event".
export default function BookTruck() {
  const { tenant, profile } = useAuth()
  const [f, setF] = useState({
    firstName: profile?.first_name || '', lastName: profile?.last_name || '',
    email: profile?.email || '', phone: profile?.phone || '',
    eventDate: '', startTime: '', attendance: '', zip: profile?.zip || '', details: '',
    customerCareSms: false, optionalMarketing: false, company: '', // company = honeypot
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
    if (isLikelyBot({ honeypot: f.company, startedAt: startedAt.current })) return // silent
    if (!isConfigured) { setErr('Not connected to Supabase yet — add your keys in .env.'); return }
    if (!f.firstName || !f.lastName || !f.email || !f.zip || !f.details) {
      setErr('Please fill in your name, email, ZIP code, and a little about your event.'); return
    }
    if (TURNSTILE_ENABLED && !tsToken) { setErr('Please complete the quick "I\'m human" check below.'); return }
    setBusy(true)
    if (!(await passesTurnstile(tsToken))) { setBusy(false); setErr('Verification failed — please try the human check again.'); return }
    // One secure server call: inserts the booking AND routes it to the right
    // app-active franchisee by event ZIP, returning the id + tracking token.
    const { data, error } = await supabase.rpc('submit_booking', {
      p_tenant: tenant?.id,
      p_contact_name: `${f.firstName} ${f.lastName}`.trim(),
      p_contact_phone: f.phone ? normalizePhone(f.phone) : null,
      p_contact_email: f.email.trim(),
      p_event_date: f.eventDate || null,
      p_start_time: f.startTime || null,
      p_guests: f.attendance ? parseInt(f.attendance, 10) || null : null,
      p_zip: f.zip.trim(),
      p_notes: f.details,
      p_sms_consent: !!f.customerCareSms,
      p_marketing_consent: !!f.optionalMarketing,
      p_consent_text_version: CONSENT_VERSION,
    })
    if (error) { setBusy(false); setErr(error.message); return }
    const row = Array.isArray(data) ? data[0] : data
    // Push to GHL (speed-to-lead). The tracking token authorizes this one call.
    if (row?.id && row?.tracking_token) {
      supabase.functions.invoke('ghl-sync', { body: { booking_id: row.id, token: row.tracking_token } }).catch(() => {})
    }
    setBusy(false); setDone(true)
  }

  if (done) {
    return (
      <div className="screen pad-top center">
        <div style={{ fontSize: 64, marginTop: 30 }}>🎉</div>
        <h1>Request received!</h1>
        <p className="muted">Thanks, {f.firstName}! We'll be in touch shortly to lock in the details and make your event sweet.</p>
        <Link className="btn btn-primary" to="/" style={{ marginTop: 16 }}>Done</Link>
      </div>
    )
  }

  return (
    <div className="screen pad-top">
      <div className="topbar"><BrandLogo height={30} /><Link to="/" className="link" style={{ fontSize: '.85rem' }}>Close</Link></div>
      <h1>Book the truck 🚚</h1>
      <p className="muted" style={{ marginTop: -6 }}>Tell us about your event and we'll get right back to you.</p>

      <form className="card stack" onSubmit={submit}>
        <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true"
          style={honeypotStyle} value={f.company} onChange={set('company')} />
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="First name *" grow><input className="fld" value={f.firstName} onChange={set('firstName')} required /></Field>
          <Field label="Last name *" grow><input className="fld" value={f.lastName} onChange={set('lastName')} required /></Field>
        </div>

        <Field label="Email *"><input className="fld" type="email" inputMode="email" value={f.email} onChange={set('email')} required /></Field>

        <Field label="Phone number">
          <input className="fld" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} />
          <div className="hint">Optional. If provided, we'll use it to coordinate your event (and send a live "on the way" link).</div>
        </Field>

        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Event date" grow><input className="fld" type="date" value={f.eventDate} onChange={set('eventDate')} /></Field>
          <Field label="Start time" grow><input className="fld" type="time" value={f.startTime} onChange={set('startTime')} /></Field>
        </div>

        <Field label="Expected attendance"><input className="fld" inputMode="numeric" placeholder="e.g. 75" value={f.attendance} onChange={set('attendance')} /></Field>

        <Field label="Zip code *"><input className="fld" inputMode="numeric" maxLength={5} value={f.zip} onChange={set('zip')} required /></Field>

        <Field label="Tell us about your event *">
          <textarea rows={4} value={f.details} onChange={set('details')} required
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
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Request my date'}</button>
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
