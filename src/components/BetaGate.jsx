import { useState } from 'react'

// Private-beta gate. When VITE_BETA_PASSWORD is set, NOTHING renders until the
// visitor enters the shared password. It's remembered on this device so they
// only type it once. Leave VITE_BETA_PASSWORD empty to turn the gate off (e.g.
// when the app goes fully public). This keeps the public + search engines out
// during beta; operator/ELLE data is separately protected by login + RLS.
const PASSWORD = import.meta.env.VITE_BETA_PASSWORD || ''
const OK_KEY = 'dnv_beta_ok'

export default function BetaGate({ children }) {
  // No password configured -> gate is off, app renders normally.
  const gateOn = PASSWORD.length > 0
  const [ok, setOk] = useState(() => !gateOn || localStorage.getItem(OK_KEY) === '1')
  const [val, setVal] = useState('')
  const [err, setErr] = useState(false)

  if (ok) return children

  function submit(e) {
    e.preventDefault()
    if (val.trim() === PASSWORD) {
      try { localStorage.setItem(OK_KEY, '1') } catch { /* private mode */ }
      setOk(true)
    } else {
      setErr(true)
    }
  }

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.awning} aria-hidden="true">
          {['#e5133b', '#fff', '#e5133b', '#fff', '#e5133b', '#fff', '#e5133b'].map((c, i) => (
            <span key={i} style={{ ...S.stripe, background: c }} />
          ))}
        </div>
        <div style={S.donut} aria-hidden="true"><img src="/brand/minidonut.png" alt="" style={{ width: 44, height: 44 }} /></div>
        <h1 style={S.h1}>Private preview</h1>
        <p style={S.sub}>This app is in private beta. Enter the password to continue.</p>
        <form onSubmit={submit} style={S.form}>
          <input
            type="password"
            value={val}
            onChange={(e) => { setVal(e.target.value); setErr(false) }}
            placeholder="Password"
            autoFocus
            style={{ ...S.input, borderColor: err ? '#e5133b' : '#e2d9cf' }}
          />
          {err && <div style={S.err}>That's not it. Try again.</div>}
          <button type="submit" style={S.btn}>Enter</button>
        </form>
        <div style={S.foot}>DonutNV • Make Your Next Party Sweet!®</div>
      </div>
    </div>
  )
}

const S = {
  wrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#faf4ec', padding: 20, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
  card: { width: '100%', maxWidth: 380, background: '#fff', borderRadius: 20, boxShadow: '0 12px 40px rgba(0,0,0,.12)', padding: '0 28px 28px', overflow: 'hidden', textAlign: 'center' },
  awning: { display: 'flex', margin: '0 -28px 22px', height: 18 },
  stripe: { flex: 1 },
  donut: { fontSize: 46, marginTop: 6 },
  h1: { fontSize: '1.5rem', fontWeight: 800, color: '#1f2937', margin: '6px 0 4px' },
  sub: { color: '#6b7280', fontSize: '.92rem', margin: '0 0 20px', lineHeight: 1.5 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  input: { width: '100%', padding: '13px 14px', fontSize: '1rem', border: '2px solid #e2d9cf', borderRadius: 12, outline: 'none', boxSizing: 'border-box' },
  err: { color: '#e5133b', fontSize: '.85rem', textAlign: 'left' },
  btn: { width: '100%', padding: '13px', fontSize: '1rem', fontWeight: 700, color: '#fff', background: '#e5133b', border: 'none', borderRadius: 12, cursor: 'pointer' },
  foot: { marginTop: 22, color: '#9ca3af', fontSize: '.72rem' },
}
