import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

// Corporate-only queue of Franchise-Development interest leads captured in the app.
// Until email routing is live, this is where Kevin sees & works them.
export default function FranDev() {
  const [rows, setRows] = useState([])
  const [state, setState] = useState('loading')

  const load = useCallback(async () => {
    setState('loading')
    const { data, error } = await supabase.rpc('get_frandev_leads')
    if (error) { setState('error'); return }
    setRows(Array.isArray(data) ? data : [])
    setState('ready')
  }, [])
  useEffect(() => { load() }, [load])

  async function handled(id) {
    setRows((r) => r.filter((x) => x.id !== id))
    const { error } = await supabase.rpc('mark_frandev_handled', { p_id: id })
    if (error) load()
  }

  return (
    <div className="pad-top stack">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Link to="/admin" className="link">← Back</Link>
        <h1 style={{ margin: 0 }}>Franchise Leads</h1>
      </div>
      <p className="muted" style={{ marginTop: -6 }}>
        Prospective owners who asked about franchising from inside the app. Liquid capital is shown
        so you can prioritize. These will also email to kevin@donutnv.com once email routing is live.
      </p>

      {state === 'loading' && <p className="muted">Loading…</p>}
      {state === 'error' && <p className="error">Couldn't load the queue.</p>}
      {state === 'ready' && rows.length === 0 && (
        <div className="card"><p className="muted" style={{ margin: 0 }}>No franchise leads yet.</p></div>
      )}

      {rows.map((b) => (
        <div key={b.id} className="card" style={{ borderTop: '4px solid var(--blue)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{b.first_name} {b.last_name}</h2>
            {b.liquid_capital && <span className="pill pill-open" style={{ whiteSpace: 'nowrap' }}>💰 {b.liquid_capital}</span>}
          </div>
          <div style={{ fontSize: '.92rem', marginTop: 4 }}>
            {b.email && <div>✉️ <a className="link" href={`mailto:${b.email}`}>{b.email}</a></div>}
            {b.phone && <div>📞 <a className="link" href={`tel:${b.phone}`}>{b.phone}</a></div>}
            {b.state && <div className="muted" style={{ marginTop: 4 }}>📍 {b.state}</div>}
            {b.message && <div style={{ marginTop: 6 }}>{b.message}</div>}
          </div>
          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => handled(b.id)}>✓ Mark handled</button>
        </div>
      ))}
    </div>
  )
}
