import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// ── Schedule manager ──
// The operator posts upcoming stops here. Public stops show on the customer
// "Catch us this week" page with full detail; private ones show only as a
// "booked" time block (no details). This is also what feeds schedule-driven
// Go Live later.
export default function Schedule() {
  const { profile } = useAuth()
  const [stops, setStops] = useState([])
  const [f, setF] = useState(blank())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  function blank() {
    return { stop_name: '', address: '', date: '', start: '', end: '', is_public: true }
  }
  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setF((p) => ({ ...p, [k]: v }))
  }

  const load = () => supabase.from('scheduled_stops').select('*')
    .eq('tenant_id', profile.tenant_id).gte('ends_at', new Date().toISOString())
    .order('starts_at').then(({ data }) => setStops(data || []))

  useEffect(() => { if (profile) load() }, [profile]) // eslint-disable-line

  async function add(e) {
    e.preventDefault()
    setErr(''); setMsg('')
    if (!profile?.tenant_id) { setErr('Sign in as an operator to add stops.'); return }
    if (!f.stop_name || !f.date || !f.start || !f.end) { setErr('Add a name, date, start and end time.'); return }
    const starts = new Date(`${f.date}T${f.start}`)
    const ends = new Date(`${f.date}T${f.end}`)
    if (!(ends > starts)) { setErr('End time must be after start time.'); return }
    setBusy(true)
    const { error } = await supabase.from('scheduled_stops').insert({
      tenant_id: profile.tenant_id,
      stop_name: f.stop_name.trim(),
      address: f.address.trim() || null,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      is_public: !!f.is_public,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setF(blank()); setMsg('Stop added.'); load()
  }

  async function remove(id) {
    const { error } = await supabase.from('scheduled_stops').delete().eq('id', id)
    if (!error) load()
  }

  return (
    <div className="pad-top stack">
      <h1>Schedule 📆</h1>
      <p className="muted" style={{ marginTop: -8 }}>
        Post where you'll be. Public stops appear on the customer schedule; private ones show only as a booked time block.
      </p>

      <form className="card stack" onSubmit={add}>
        <Field label="Stop name *"><input className="fld" placeholder="Pop Stroke" value={f.stop_name} onChange={set('stop_name')} /></Field>
        <Field label="Address / area"><input className="fld" placeholder="123 Main St, Palm Harbor" value={f.address} onChange={set('address')} /></Field>
        <Field label="Date *"><input className="fld" type="date" value={f.date} onChange={set('date')} /></Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Start *" grow><input className="fld" type="time" value={f.start} onChange={set('start')} /></Field>
          <Field label="End *" grow><input className="fld" type="time" value={f.end} onChange={set('end')} /></Field>
        </div>
        <label className="consent">
          <input type="checkbox" checked={f.is_public} onChange={set('is_public')} />
          <span className="label">Show this stop publicly (uncheck for a private event — customers will only see the time as booked).</span>
        </label>
        {err && <div className="error">{err}</div>}
        {msg && <div className="success">{msg}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add stop'}</button>
      </form>

      <h2 style={{ fontSize: '1.05rem', marginBottom: 0 }}>Upcoming</h2>
      {stops.length === 0 && <p className="muted">No upcoming stops yet.</p>}
      {stops.map((s) => (
        <div key={s.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700 }}>
              {s.stop_name} {!s.is_public && <span className="muted" style={{ fontSize: '.8rem' }}>· private</span>}
            </div>
            {s.address && <div className="muted" style={{ fontSize: '.9rem' }}>{s.address}</div>}
            <div className="muted" style={{ fontSize: '.9rem' }}>{fmt(s.starts_at)} – {fmtTime(s.ends_at)}</div>
          </div>
          <button className="link" style={{ color: 'var(--red)' }} onClick={() => remove(s.id)}>Remove</button>
        </div>
      ))}
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
function fmt(d) {
  return new Date(d).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
function fmtTime(d) {
  return new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
