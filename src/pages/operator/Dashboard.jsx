import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Performance dashboard. One layout: admin sees the full superset (network +
// territory scorecard + admin-only panel); a franchisee gets their own numbers
// only. The Window and ELLE render as separate modules. Metrics we don't capture
// yet show "coming online" rather than a fake number.
export default function Dashboard() {
  const { entitlements } = useAuth()
  const [m, setM] = useState(null)
  const [state, setState] = useState('loading')

  const load = useCallback(async () => {
    setState('loading')
    const { data, error } = await supabase.functions.invoke('platform-metrics', { body: {} })
    if (error || !data || data.error) { setState('error'); return }
    setM(data); setState('ready')
  }, [])
  useEffect(() => { load() }, [load])

  if (state === 'loading') return <div className="pad-top center"><p className="muted" style={{ marginTop: '30vh' }}>Loading performance…</p></div>
  if (state === 'error' || !m) return <div className="pad-top stack"><Link to="/admin" className="link">← Back</Link><p className="error">Couldn't load metrics. <button className="btn btn-ghost" onClick={load}>Retry</button></p></div>

  const isSuper = !!m.isSuper
  const wn = m.window?.network || {}
  const en = m.elle?.network || {}
  const showWindow = isSuper || entitlements?.app !== false
  const showElle = isSuper || !!entitlements?.elle
  const winRate = (en.won + en.lost) > 0 ? Math.round((en.won / (en.won + en.lost)) * 100) : null
  const elleRows = Object.entries(m.elle?.byTenant || {}).map(([id, v]) => ({ id, ...v }))
    .filter((r) => (r.leads || 0) > 0 || (r.businesses || 0) > 0)
    .sort((a, b) => (b.leads || 0) - (a.leads || 0))

  return (
    <div className="pad-top stack">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Link to="/admin" className="link">← Back</Link>
        <h1 style={{ margin: 0 }}>📊 Performance</h1>
      </div>
      <p className="muted" style={{ marginTop: -6 }}>{isSuper ? 'Network-wide, every territory.' : 'Your territory.'}</p>

      {showWindow && (
        <div className="card" style={{ borderTop: '4px solid var(--brand, #e91e63)' }}>
          <h2 style={{ marginBottom: 2 }}>🪟 The Window <span className="muted" style={{ fontSize: '.8rem', fontWeight: 400 }}>customer side</span></h2>
          <Grid stats={[
            ['Customers', wn.customers],
            ['New this week', wn.signups_week],
            ['Served (7d)', wn.served_week],
            ['Bookings (7d)', wn.bookings_week],
            ['Reviews (7d)', wn.reviews_week],
            ['Sales (7d)', money(wn.sales_week)],
            ['Wallet members', wn.wallet_members],
            ['Wallet spend', money(wn.wallet_revenue)],
          ]} />
          <p className="muted" style={{ fontSize: '.74rem', marginTop: 8 }}>Per-customer visit frequency, repeat rate, and order-ahead value come online once visit events and Square orders are flowing.</p>
        </div>
      )}

      {showElle && (
        <div className="card" style={{ borderTop: '4px solid var(--blue)' }}>
          <h2 style={{ marginBottom: 2 }}>🎯 ELLE <span className="muted" style={{ fontSize: '.8rem', fontWeight: 400 }}>lead engine</span></h2>
          <Grid stats={[
            ['Leads sourced', en.leads],
            ['Contactable', en.contactable],
            ['Sent to LC', en.sent_lc],
            ['Accounts won', en.won],
            ['Win rate', winRate == null ? 'coming online' : winRate + '%'],
            ['Booked revenue', money(en.booked_revenue)],
            ['Open pipeline', money(en.pipeline)],
            ['Businesses', en.businesses],
            ['Contactable biz', en.biz_contactable],
            ['Active clients', en.active_clients],
            ['Rebook queue', en.rebook],
            ['Recycle queue', en.recycle],
          ]} />
        </div>
      )}

      {isSuper && elleRows.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>🗺️ Territory scorecard</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="dash-table">
              <thead><tr><th>Territory</th><th>Leads</th><th>Contact</th><th>Sent</th><th>Won</th><th>Pipeline</th><th>Biz</th></tr></thead>
              <tbody>
                {elleRows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.franchise}</td><td>{r.leads}</td><td>{r.contactable}</td><td>{r.sent_lc}</td>
                    <td>{r.won}</td><td>{money(r.booked_revenue)}</td><td>{r.businesses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isSuper && (
        <div className="card" style={{ borderTop: '4px solid var(--red-deep, #a32d2d)' }}>
          <h2 style={{ marginBottom: 2 }}>🔒 Admin only</h2>
          <Grid stats={[
            ['Leads turned down', en.turned_down],
            ['Territories live', elleRows.length],
            ['ELLE AI cost / mo', 'coming online'],
          ]} />
          <p className="muted" style={{ fontSize: '.74rem', marginTop: 8 }}>Per-Z turned-down detail lives in ELLE → ⚑ Turned down. AI spend wires to the Anthropic usage feed next.</p>
        </div>
      )}

      <button className="btn btn-ghost" onClick={load}>↻ Refresh</button>
      <style>{DASH_CSS}</style>
    </div>
  )
}

function money(v) { return v == null ? '—' : '$' + Number(v || 0).toLocaleString() }

function Grid({ stats }) {
  return (
    <div className="dash-grid">
      {stats.map(([l, v], i) => (
        <div key={i} className="dash-stat">
          <div className={`dash-val ${typeof v === 'string' && v === 'coming online' ? 'soon' : ''}`}>{v == null ? '—' : v}</div>
          <div className="dash-lbl">{l}</div>
        </div>
      ))}
    </div>
  )
}

const DASH_CSS = `
.dash-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(108px,1fr));gap:10px;margin-top:10px}
.dash-stat{background:var(--cream,#faf4ec);border-radius:10px;padding:10px 8px;text-align:center}
.dash-val{font-family:var(--font-head);font-weight:800;font-size:1.25rem;color:var(--red);line-height:1.1}
.dash-val.soon{font-size:.72rem;font-weight:600;color:var(--muted);font-family:inherit}
.dash-lbl{font-size:.71rem;color:var(--muted);margin-top:4px}
.dash-table{width:100%;border-collapse:collapse;font-size:.82rem}
.dash-table th{text-align:left;color:var(--muted);font-weight:600;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
.dash-table td{padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
.dash-table tr:last-child td{border-bottom:none}
`
