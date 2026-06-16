import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// ── Corporate dashboard (HQ super-admin) ──
// Cross-territory rollup. The RPC returns rows only to an 'admin' profile, so
// operators see the access note instead of another territory's numbers.
export default function Corporate() {
  const { profile } = useAuth()
  const [rows, setRows] = useState(null) // null = loading
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.rpc('get_corporate_metrics')
      .then(({ data, error }) => { if (error) setErr(error.message); setRows(data || []) })
  }, [])

  const totals = (rows || []).reduce((a, r) => ({
    customers: a.customers + Number(r.customers || 0),
    bookings: a.bookings + Number(r.bookings || 0),
    reviews: a.reviews + Number(r.reviews || 0),
    live: a.live + Number(r.live_now || 0),
  }), { customers: 0, bookings: 0, reviews: 0, live: 0 })

  const active = (rows || []).filter((r) => r.app_active).length

  return (
    <div className="pad-top stack">
      <h1 style={{ marginBottom: 0 }}>Corporate 🏢</h1>
      <p className="muted" style={{ marginTop: 0 }}>Network-wide metrics across every territory.</p>

      {rows === null && <p className="muted">Loading…</p>}

      {rows !== null && rows.length === 0 && (
        <div className="card center">
          <div style={{ fontSize: 40 }}>🔒</div>
          <h2 style={{ marginTop: 8 }}>Admin only</h2>
          <p className="muted" style={{ margin: 0 }}>
            This network view is for corporate (admin) accounts. To enable it for your login, set your
            profile <b>role</b> to <b>admin</b> in Supabase → Table Editor → profiles.
          </p>
          {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Stat label="Territories" value={rows.length} />
            <Stat label="On the app" value={active} />
            <Stat label="Customers" value={totals.customers} />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Stat label="Events booked" value={totals.bookings} />
            <Stat label="Reviews" value={totals.reviews} />
            <Stat label="Live now" value={totals.live} />
          </div>

          <h2 style={{ fontSize: '1.05rem', marginBottom: 0 }}>By territory</h2>
          {rows.map((r) => (
            <div key={r.tenant_id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700 }}>{r.tenant_name}</div>
                <span className={`pill ${r.app_active ? 'pill-open' : 'pill-closed'}`}>{r.app_active ? 'On app' : 'Not on app'}</span>
              </div>
              <div className="muted" style={{ fontSize: '.9rem', marginTop: 6 }}>
                {r.customers} customers · {r.bookings} events · {r.reviews} reviews · {Number(r.live_now) > 0 ? '🟢 live now' : 'idle'}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 90, textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: '1.8rem', color: 'var(--red)' }}>{value}</div>
      <div className="muted" style={{ fontSize: '.82rem' }}>{label}</div>
    </div>
  )
}
