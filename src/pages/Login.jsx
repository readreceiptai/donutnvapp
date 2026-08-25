import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isConfigured } from '../lib/supabase'

// Returning members log in with email + password — no code, no email, no rate
// limit. "Email me a code" stays only as a fallback for anyone who hasn't set a
// password yet or forgot it.
export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState('password') // 'password' | 'code' | 'verify'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [noAccount, setNoAccount] = useState(false)

  async function loginPassword(e) {
    e.preventDefault()
    setErr(''); setNoAccount(false)
    if (!isConfigured) { setErr('App not connected to Supabase yet — add your keys in .env.'); return }
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    // On success, AuthContext picks up the session and App routes to the app.
    if (error) setErr("That email and password don't match. Try again, or use a login code below.")
  }

  async function sendCode(e) {
    e.preventDefault()
    setErr(''); setNoAccount(false)
    if (!isConfigured) { setErr('App not connected to Supabase yet — add your keys in .env.'); return }
    setBusy(true)
    // Log in only — never create an account here (a mistyped email must go to Sign Up).
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } })
    setBusy(false)
    if (error) {
      if (isNoAccountError(error)) setNoAccount(true)
      else setErr(error.message)
    } else setStage('verify')
  }

  async function verify(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) setErr(error.message)
  }

  return (
    <div className="screen pad-top">
      <Link to="/" className="link" style={{ display: 'inline-block', marginBottom: 14 }}>← Back</Link>
      <h1>Welcome back</h1>

      {stage === 'password' && (
        <form className="card stack" onSubmit={loginPassword} style={{ marginTop: 10 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Email address</label>
            <input type="email" inputMode="email" placeholder="you@email.com" autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Password</label>
            <input type="password" placeholder="Your password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {noAccount && (
            <div className="error">We couldn't find an account for that email.{' '}
              <Link className="link" to="/signup">Create one</Link>.</div>
          )}
          {err && <div className="error">{err}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
          <button type="button" className="link" onClick={() => { setErr(''); setStage('code') }}>
            Forgot password, or no password yet? Email me a code
          </button>
        </form>
      )}

      {stage === 'code' && (
        <form className="card stack" onSubmit={sendCode} style={{ marginTop: 10 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Email address</label>
            <input type="email" inputMode="email" placeholder="you@email.com"
              value={email} onChange={(e) => setEmail(e.target.value)} required />
            <div className="hint">We'll email you a code to log in this time.</div>
          </div>
          {noAccount && (
            <div className="error">We couldn't find an account for that email.{' '}
              <Link className="link" to="/signup">Create one</Link>.</div>
          )}
          {err && <div className="error">{err}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
          <button type="button" className="link" onClick={() => { setErr(''); setStage('password') }}>← Back to password login</button>
        </form>
      )}

      {stage === 'verify' && (
        <form className="card stack" onSubmit={verify} style={{ marginTop: 10 }}>
          <p className="muted" style={{ margin: 0 }}>We emailed a code to <b>{email}</b>.</p>
          <div className="field" style={{ margin: 0 }}>
            <label>Enter code</label>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={10}
              placeholder="Enter your code" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          </div>
          {err && <div className="error">{err}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Log in'}</button>
          <button type="button" className="link" onClick={() => { setErr(''); setStage('password') }}>← Back</button>
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
