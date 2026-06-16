import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isConfigured } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import BrandLogo from '../components/BrandLogo'

// Franchisee / owner login: a @donutnv.com email + password.
// Owner accounts are created by DonutNV (with a temporary password) — this
// screen just authenticates. Any non-@donutnv.com email is denied here, and the
// database also blocks anyone from self-assigning the operator role.
const ALLOWED_DOMAIN = '@donutnv.com'

export default function OwnerLogin() {
  const { reloadProfile } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    setErr('')
    const em = email.trim().toLowerCase()
    if (!em.endsWith(ALLOWED_DOMAIN)) {
      setErr('Owner accounts must use a @donutnv.com email address.'); return
    }
    if (!isConfigured) { setErr('Not connected to Supabase yet — add your keys in .env.'); return }
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: em, password })
    setBusy(false)
    if (error) { setErr('That email or password didn\'t work. Check with DonutNV if you need a reset.'); return }
    await reloadProfile()
    // App routes to the operator app once the profile (role = operator) loads.
  }

  return (
    <div className="screen pad-top">
      <Link to="/" className="link" style={{ display: 'inline-block', marginBottom: 12 }}>← Back</Link>
      <div className="center"><BrandLogo height={30} /></div>
      <h1 style={{ marginTop: 12 }}>Owner login</h1>
      <p className="muted" style={{ marginTop: -6 }}>For DonutNV franchisees. Sign in with your <b>@donutnv.com</b> email.</p>

      <form className="card stack" onSubmit={submit}>
        <div className="field" style={{ margin: 0 }}>
          <label>DonutNV email</label>
          <input type="email" inputMode="email" autoComplete="username"
                 placeholder="you@donutnv.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Password</label>
          <input type="password" autoComplete="current-password"
                 placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <div className="hint">New franchisee? Use the temporary password DonutNV sent you.</div>
        </div>
        {err && <div className="error">{err}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Log in'}</button>
      </form>

      <p className="center muted" style={{ marginTop: 14, fontSize: '.85rem' }}>
        Customer looking for donuts? <Link className="link" to="/login">Log in here</Link>
      </p>
    </div>
  )
}
