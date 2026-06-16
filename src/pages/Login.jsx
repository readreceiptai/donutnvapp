import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isConfigured } from '../lib/supabase'

// Passwordless login: enter phone or email, get a one-time code. No passwords
// to forget — the friendliest option for a non-tech-savvy audience.
export default function Login() {
  const [method, setMethod] = useState('phone') // 'phone' | 'email'
  const [value, setValue] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState('enter') // 'enter' | 'verify'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function sendCode(e) {
    e.preventDefault()
    setErr('')
    if (!isConfigured) { setErr('App not connected to Supabase yet — add your keys in .env.'); return }
    setBusy(true)
    const payload = method === 'phone'
      ? { phone: normalizePhone(value) }
      : { email: value.trim() }
    const { error } = await supabase.auth.signInWithOtp(payload)
    setBusy(false)
    if (error) setErr(error.message)
    else setStage('verify')
  }

  async function verify(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    const payload = method === 'phone'
      ? { phone: normalizePhone(value), token: code.trim(), type: 'sms' }
      : { email: value.trim(), token: code.trim(), type: 'email' }
    const { error } = await supabase.auth.verifyOtp(payload)
    setBusy(false)
    if (error) setErr(error.message)
    // On success, AuthContext picks up the session and App routes to the map.
  }

  return (
    <div className="screen pad-top">
      <Link to="/welcome" className="link" style={{ display: 'inline-block', marginBottom: 14 }}>← Back</Link>
      <h1>Welcome back</h1>

      {stage === 'enter' && (
        <form className="card stack" onSubmit={sendCode} style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className={`btn ${method === 'phone' ? 'btn-blue' : 'btn-ghost'}`} onClick={() => setMethod('phone')}>Phone</button>
            <button type="button" className={`btn ${method === 'email' ? 'btn-blue' : 'btn-ghost'}`} onClick={() => setMethod('email')}>Email</button>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>{method === 'phone' ? 'Mobile number' : 'Email address'}</label>
            <input
              type={method === 'phone' ? 'tel' : 'email'}
              inputMode={method === 'phone' ? 'tel' : 'email'}
              placeholder={method === 'phone' ? '(919) 555-1234' : 'you@email.com'}
              value={value} onChange={(e) => setValue(e.target.value)} required
            />
          </div>
          {err && <div className="error">{err}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send me a code'}</button>
        </form>
      )}

      {stage === 'verify' && (
        <form className="card stack" onSubmit={verify} style={{ marginTop: 10 }}>
          <p className="muted" style={{ margin: 0 }}>We sent a 6-digit code to <b>{value}</b>.</p>
          <div className="field" style={{ margin: 0 }}>
            <label>Enter code</label>
            <input type="text" inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
          {err && <div className="error">{err}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Log in'}</button>
          <button type="button" className="link" onClick={() => setStage('enter')}>Use a different number</button>
        </form>
      )}

      <p className="center muted" style={{ marginTop: 18 }}>
        New here? <Link className="link" to="/signup">Create an account</Link>
      </p>
    </div>
  )
}

export function normalizePhone(v) {
  const digits = (v || '').replace(/\D/g, '')
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  return v.startsWith('+') ? v : '+' + digits
}
