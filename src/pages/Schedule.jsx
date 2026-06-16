import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isConfigured } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import BrandLogo from '../components/BrandLogo'
import MiniDonut from '../components/MiniDonut'

// "Catch us this week" — the public schedule. Anyone (logged in or not) can see
// where the truck will be. Public stops show full detail; private events show
// only as a "booked" time block so customers know the truck is busy then.
export default function Schedule() {
  const { tenant } = useAuth()
  const [rows, setRows] = useState(null) // null = loading
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!isConfigured || !tenant?.id) return
    let alive = true
    ;(async () => {
      // Preferred: one RPC that also returns private events as blank time blocks.
      let data, error
      ({ data, error } = await supabase.rpc('get_public_schedule', { p_tenant: tenant.id, p_days: 14 }))
      // Fallback (before the RPC migration is run): public stops only.
      if (error) {
        const res = await supabase.from('scheduled_stops').select('id,starts_at,ends_at,is_public,stop_name,address,lat,lng')
          .eq('tenant_id', tenant.id).eq('is_public', true)
          .gte('ends_at', new Date().toISOString()).order('starts_at').limit(50)
        data = res.data; error = res.error
      }
      if (!alive) return
      if (error) { setErr('Could not load the schedule right now.'); setRows([]) }
      else setRows(data || [])
    })()
    return () => { alive = false }
  }, [tenant?.id])

  const groups = groupByDay(rows || [])

  return (
    <div className="screen pad-top">
      <div className="topbar">
        <BrandLogo height={30} />
        <Link to="/" className="link" style={{ fontSize: '.85rem' }}>Close</Link>
      </div>

      <h1>Catch us this week 🚚</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        Where {tenant?.name || 'the truck'} will be. Tap a stop for directions.
      </p>

      {rows === null && <p className="muted">Loading the schedule…</p>}
      {err && <div className="error">{err}</div>}

      {rows !== null && rows.length === 0 && !err && (
        <div className="card center">
          <div style={{ display: 'flex', justifyContent: 'center' }}><MiniDonut size={48} /></div>
          <h2 style={{ marginTop: 8 }}>No public stops posted yet</h2>
          <p className="muted" style={{ margin: 0 }}>
            Check back soon — or turn on alerts and we'll text you when a truck rolls near you.
          </p>
          <Link className="btn btn-primary" to="/signup" style={{ marginTop: 14 }}>Get truck alerts</Link>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.key} style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 8px' }}>{g.label}</h2>
          <div className="stack">
            {g.items.map((s) => <StopRow key={s.id} s={s} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

function StopRow({ s }) {
  const time = `${fmtTime(s.starts_at)} – ${fmtTime(s.ends_at)}`
  if (!s.is_public) {
    return (
      <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', opacity: 0.75 }}>
        <div style={{ fontSize: 22 }}>🔒</div>
        <div>
          <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700 }}>Private event — booked</div>
          <div className="muted" style={{ fontSize: '.9rem' }}>{time}</div>
        </div>
      </div>
    )
  }
  const q = s.lat && s.lng ? `${s.lat},${s.lng}` : (s.address || s.stop_name || '')
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
  return (
    <a className="card card-accent" href={maps} target="_blank" rel="noreferrer"
      style={{ display: 'flex', gap: 12, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
      <div style={{ flexShrink: 0 }}><MiniDonut size={34} /></div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700 }}>{s.stop_name}</div>
        {s.address && <div className="muted" style={{ fontSize: '.9rem' }}>{s.address}</div>}
        <div className="muted" style={{ fontSize: '.9rem' }}>{time}</div>
      </div>
      <div className="link" style={{ fontSize: '.85rem', whiteSpace: 'nowrap' }}>Directions ›</div>
    </a>
  )
}

// ---- date helpers ----------------------------------------------------------
function dayKey(d) { return new Date(d).toDateString() }
function groupByDay(rows) {
  const map = new Map()
  for (const r of rows) {
    const k = dayKey(r.starts_at)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(r)
  }
  return [...map.entries()].map(([key, items]) => ({ key, label: dayLabel(items[0].starts_at), items }))
}
function dayLabel(d) {
  const date = new Date(d), today = new Date()
  const t = new Date(today); t.setHours(0, 0, 0, 0)
  const diff = Math.round((new Date(date).setHours(0, 0, 0, 0) - t) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}
function fmtTime(d) {
  return new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
