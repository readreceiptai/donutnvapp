import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

// Corporate-only queue of Book-a-Truck leads whose ZIP isn't owned by a franchise
// that's on the app. Kevin forwards each to the right owner (an onboarding hook),
// then marks it handled so it clears.
export default function Unrouted() {
  const [rows, setRows] = useState([])
  const [state, setState] = useState('loading')

  const load = useCallback(async () => {
    setState('loading')
    const { data, error } = await supabase.rpc('get_unrouted_bookings')
    if (error) { setState('error'); return }
    setRows(Array.isArray(data) ? data : [])
    setState('ready')
  }, [])
  useEffect(() => { load() }, [load])

  async function forwarded(id) {
    setRows((r) => r.filter((x) => x.id !== id))
    const { error } = await supabase.rpc('mark_booking_forwarded', { p_booking_id: id })
    if (error) load()
  }

  return (
    <div className="pad-top stack">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Link to="/admin" className="link">← Back</Link>
        <h1 style={{ margin: 0 }}>📮 Unrouted Leads</h1>
      </div>
      <p className="muted" style={{ marginTop: -6 }}>
        Book-a-Truck requests whose ZIP isn't owned by a franchise on the app. Forward each to the
        right owner (a great reason to get them onboarded), then mark it handled to clear it.
      </p>

      {state === 'loading' && <p className="muted">Loading…</p>}
      {state === 'error' && <p className="error">Couldn't load the queue.</p>}
      {state === 'ready' && rows.length === 0 && (
        <div className="card"><p className="muted" style={{ margin: 0 }}>Queue's empty — every lead found a home. 🎉</p></div>
      )}

      {rows.map((b) => (
        <div key={b.id} className="card" style={{ borderTop: '4px solid var(--red)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{b.contact_name || 'New lead'}</h2>
            <span className="muted" style={{ fontSize: '.78rem' }}>ZIP {b.zip}</span>
          </div>
          <div style={{ fontSize: '.92rem', marginTop: 4 }}>
            {b.contact_email && <div>✉️ <a className="link" href={`mailto:${b.contact_email}`}>{b.contact_email}</a></div>}
            {b.contact_phone && <div>📞 <a className="link" href={`tel:${b.contact_phone}`}>{b.contact_phone}</a></div>}
            <div className="muted" style={{ marginTop: 4 }}>
              {b.event_date || 'date TBD'}{b.start_time ? ` · ${b.start_time}` : ''}{b.guests ? ` · ~${b.guests} guests` : ''}
            </div>
            {b.notes && <div style={{ marginTop: 6 }}>{b.notes}</div>}
          </div>
          <div className="card" style={{ background: 'var(--cream)', marginTop: 10, padding: '10px 12px' }}>
            {b.assignment_reason === 'off_platform_owned'
              ? <>Owned by <b>{b.owed_franchise || 'another franchise'}</b> (not on the app yet). Forward this lead and pitch them onboarding.</>
              : <>No franchise owns this ZIP — orphan lead. Route it to your nearest Z or handle it directly.</>}
          </div>
          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => forwarded(b.id)}>✓ Mark forwarded</button>
        </div>
      ))}
    </div>
  )
}
