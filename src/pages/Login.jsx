import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isConfigured } from '../lib/supabase'

// Passwordless login by email code — no passwords, and no Twilio needed.
// (Marketing texts go through GHL; the login code is the one system message,
// and it's delivered by email.)
export default function Login() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState('enter') // 'enter' | 'verify'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [noAccount, setNoAccount] = useState(false)

  async function sendCode(e) {
    e.preventDefault()
    setErr(''); setNoAccount(false)
    if (!isConfigured) { setErr('App not connected to Supabase yet — add your keys in .env.'); return }
    setBusy(true)
    // Log in only — never create an account here. A brand-new or mistyped email
    // must NOT silently spin up a profile-less auth user; send them to Sign Up.
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } })
    setBusy(false)
    if (error) {
      if (isNoAccountError(error)) setNoAccount(true)
      else setErr(error.message)
    } else setStage('verify')
  }

  async function verify(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) setErr(error.message)
    // On success, AuthContext picks up the session and App routes to the app.
  }

  return (
    <div className="screen pad-top">
      <Link to="/" className="link" style={{ display: 'inline-block', marginBottom: 14 }}>← Back</Link>
      <h1>Welcome back</h1>

      {stage === 'enter' && (
        <form className="card stack" onSubmit={sendCode} style={{ marginTop: 10 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Email address</label>
            <input type="email" inputMode="email" placeholder="you@email.com"
              value={email} onChange={(e) => setEmail(e.target.value)} required />
            <div className="hint">We'll email you a 6-digit code to log in.</div>
          </div>
          {noAccount && (
            <div className="error">
              We couldn't find an account for that email.{' '}
              <Link className="link" to="/signup">Create one here</Link> — it only takes a minute.
            </div>
          )}
          {err && <div className="error">{err}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
        </form>
      )}

      {stage === 'verify' && (
        <form className="card stack" onSubmit={verify} style={{ marginTop: 10 }}>
          <p className="muted" style={{ margin: 0 }}>We emailed a 6-digit code to <b>{email}</b>.</p>
          <div className="field" style={{ margin: 0 }}>
            <label>Enter code</label>
            <input type="text" inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
          {err && <div className="error">{err}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Log in'}</button>
          <button type="button" className="link" onClick={() => setStage('enter')}>Use a different email</button>
        </form>
      )}

      <p className="center muted" style={{ marginTop: 18 }}>
        New here? <Link className="link" to="/signup">Create an account</Link>
      </p>
      <p className="center muted" style={{ marginTop: 6, fontSize: '.85rem' }}>
        Franchise owner or operator? <Link className="link" to="/owner">Sign in here</Link>
      </p>
    </div>
  )
}

// Supabase returns this when shouldCreateUser:false and the email has no account.
// The code/message wording has varied across versions, so match defensively.
function isNoAccountError(error) {
  const code = (error?.code || '').toLowerCase()
  const msg = (error?.message || '').toLowerCase()
  return code === 'otp_disabled'
    || code === 'user_not_found'
    || msg.includes('signups not allowed')
    || msg.includes('user not found')
    || msg.includes('no user')
}

export function normalizePhone(v) {
  const digits = (v || '').replace(/\D/g, '')
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  return v.startsWith('+') ? v : '+' + digits
}
