import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isConfigured } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { CONSENT_TEXT, CONSENT_VERSION } from '../lib/consentText'
import { normalizePhone } from './Login'
import { isLikelyBot, honeypotStyle } from '../lib/antibot'
import TurnstileWidget, { TURNSTILE_ENABLED, passesTurnstile } from '../components/Turnstile'

// The owned-list capture. We collect phone + name + email + ZIP + birthday in one
// friendly screen, then verify the phone with a one-time code (which also creates
// the account — no passwords). Birthday is framed as a perk ("free donut!") and
// quietly lets us route under-13 signups to a parent, covering COPPA without a
// clunky age wall.
export default function SignUp() {
  const { tenant, reloadProfile } = useAuth()
  const [f, setF] = useState({
    firstName: '', lastName: '', phone: '', email: '', zip: '',
    bMonth: '', bDay: '', bYear: '',
    parentEmail: '', company: '', // company = honeypot (hidden)
    marketingSms: false, marketingEmail: false, // opt-in only (TCPA/CASL: no pre-check)
  })
  const startedAt = useRef(Date.now())
  const [code, setCode] = useState('')
  const [stage, setStage] = useState('form') // 'form' | 'verify'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [tsToken, setTsToken] = useState('')

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setF((p) => ({ ...p, [k]: v }))
  }

  const age = computeAge(f.bYear, f.bMonth, f.bDay)
  const isMinor = age !== null && age < 13

  async function start(e) {
    e.preventDefault()
    setErr('')
    if (isLikelyBot({ honeypot: f.company, startedAt: startedAt.current })) return // silent
    if (!isConfigured) { setErr('App not connected to Supabase yet — add your keys in .env, then try again.'); return }
    if (!f.firstName || !f.phone || !f.email || !f.zip) { setErr('Please fill in your name, phone, email, and ZIP.'); return }
    if (age === null) { setErr('Please pick your birthday — that\'s how you get your birthday treat 🎂'); return }
    if (isMinor && !f.parentEmail) { setErr('Since you\'re under 13, please add a parent or guardian\'s email so they can approve your account.'); return }
    if (TURNSTILE_ENABLED && !tsToken) { setErr('Please complete the quick "I\'m human" check below.'); return }
    setBusy(true)
    // Server-side bot check (no-op until Turnstile is configured).
    if (!(await passesTurnstile(tsToken))) { setBusy(false); setErr('Verification failed — please try the human check again.'); return }
    // Email a one-time code (no Twilio needed). Creates the auth user on verify.
    const { error } = await supabase.auth.signInWithOtp({ email: f.email.trim() })
    setBusy(false)
    if (error) setErr(error.message)
    else setStage('verify')
  }

  async function verify(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    const { data, error } = await supabase.auth.verifyOtp({
      email: f.email.trim(), token: code.trim(), type: 'email',
    })
    if (error) { setBusy(false); setErr(error.message); return }

    const tenantId = tenant?.id
    const birthday = `${f.bYear}-${String(f.bMonth).padStart(2, '0')}-${String(f.bDay).padStart(2, '0')}`

    // One atomic write: profile + consent records + home area, in a single
    // transaction (so a legally-required consent record can't be silently lost).
    // Minors never get marketing consent. The verified email drives any elevation.
    const { error: sErr } = await supabase.rpc('complete_signup', {
      p_tenant: tenantId,
      p_first_name: f.firstName,
      p_last_name: f.lastName || null,
      p_phone: normalizePhone(f.phone),
      p_email: f.email.trim(),
      p_zip: f.zip.trim(),
      p_birthday: birthday,
      p_parent_email: isMinor ? f.parentEmail.trim() : null,
      p_marketing_sms: !isMinor && !!f.marketingSms,
      p_marketing_email: !isMinor && !!f.marketingEmail,
      p_consent_version: CONSENT_VERSION,
    })
    if (sErr) { setBusy(false); setErr(sErr.message); return }

    await reloadProfile()
    setBusy(false)
    // App routes to the map automatically once the profile loads.
  }

  if (stage === 'verify') {
    return (
      <div className="screen pad-top">
        <h1>Almost there!</h1>
        <form className="card stack" onSubmit={verify} style={{ marginTop: 10 }}>
          <p className="muted" style={{ margin: 0 }}>We emailed a 6-digit code to <b>{f.email}</b>.</p>
          <div className="field" style={{ margin: 0 }}>
            <label>Enter your code</label>
            <input type="text" inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
          {err && <div className="error">{err}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating account…' : 'Create my account 🍩'}</button>
          <button type="button" className="link" onClick={() => setStage('form')}>← Fix my details</button>
        </form>
      </div>
    )
  }

  return (
    <div className="screen pad-top">
      <Link to="/" className="link" style={{ display: 'inline-block', marginBottom: 12 }}>← Back</Link>
      <h1>Join the donut club</h1>
      <p className="muted" style={{ marginTop: -6 }}>Takes about 30 seconds. We'll email you a code to confirm.</p>

      <form className="card stack" onSubmit={start} style={{ marginTop: 12 }}>
        <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true"
          style={honeypotStyle} value={f.company} onChange={set('company')} />
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="field" style={{ flex: 1, margin: 0 }}>
            <label>First name <span className="req">*</span></label>
            <input value={f.firstName} onChange={set('firstName')} required />
          </div>
          <div className="field" style={{ flex: 1, margin: 0 }}>
            <label>Last name</label>
            <input value={f.lastName} onChange={set('lastName')} />
          </div>
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label>Mobile number <span className="req">*</span></label>
          <input type="tel" inputMode="tel" placeholder="(919) 555-1234" value={f.phone} onChange={set('phone')} required />
          <div className="hint">Used for truck text alerts (reply STOP anytime). Your login code comes by email.</div>
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label>Email <span className="req">*</span></label>
          <input type="email" inputMode="email" placeholder="you@email.com" value={f.email} onChange={set('email')} required />
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label>Home ZIP code <span className="req">*</span></label>
          <input inputMode="numeric" maxLength={5} placeholder="27601" value={f.zip} onChange={set('zip')} required />
          <div className="hint">So we can tell you when a truck is near you.</div>
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label>Birthday 🎂 <span className="req">*</span></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={f.bMonth} onChange={set('bMonth')} required>
              <option value="">Month</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select value={f.bDay} onChange={set('bDay')} required style={{ width: 90 }}>
              <option value="">Day</option>
              {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
            </select>
            <select value={f.bYear} onChange={set('bYear')} required style={{ width: 100 }}>
              <option value="">Year</option>
              {years().map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="hint">Get a sweet surprise on your birthday.</div>
        </div>

        {isMinor && (
          <div className="field" style={{ margin: 0 }}>
            <label>Parent or guardian's email <span className="req">*</span></label>
            <input type="email" inputMode="email" placeholder="parent@email.com" value={f.parentEmail} onChange={set('parentEmail')} required />
            <div className="hint">Since you're under 13, we'll ask a parent to approve your account.</div>
          </div>
        )}

        <div>
          <label className="consent">
            <input type="checkbox" checked={f.marketingSms} onChange={set('marketingSms')} />
            <span className="label"><b>Text me deals & flavors.</b> {CONSENT_TEXT.marketing_sms}</span>
          </label>
          <label className="consent">
            <input type="checkbox" checked={f.marketingEmail} onChange={set('marketingEmail')} />
            <span className="label"><b>Email me offers.</b> {CONSENT_TEXT.marketing_email}</span>
          </label>
        </div>

        <p className="muted" style={{ fontSize: '.78rem', margin: 0 }}>
          By creating an account you agree to account & alert texts ({/* transactional */}
          you can reply STOP anytime), our Terms, and Privacy Policy.
        </p>

        <TurnstileWidget onToken={setTsToken} />
        {err && <div className="error">{err}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending code…' : 'Create my account'}</button>
      </form>

      <p className="center muted" style={{ marginTop: 16 }}>
        Already a member? <Link className="link" to="/login">Log in</Link>
      </p>
    </div>
  )
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const years = () => { const now = new Date().getFullYear(); return Array.from({ length: 100 }, (_, i) => now - i) }

function computeAge(y, m, d) {
  if (!y || !m || !d) return null
  const b = new Date(Number(y), Number(m) - 1, Number(d))
  if (isNaN(b)) return null
  const now = new Date()
  let a = now.getFullYear() - b.getFullYear()
  const md = now.getMonth() - b.getMonth() || now.getDate() - b.getDate()
  if (md < 0) a--
  return a
}
