import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// #127 God Mode launcher (superadmin only). Search any territory and jump in AS that
// tenant: customer storefront, operator dashboard, or ELLE. Access is server-verified —
// set_acting_tenant() raises for non-superadmins — so this page is a convenience, not
// the security boundary. Every change made while acting is written to superadmin_audit_log.
export default function GodMode() {
  const { isSuperadmin, setActingTenant } = useAuth()
  const [tenants, setTenants] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('tenants').select('id, name, slug, has_app, has_elle').eq('is_active', true).order('name')
      .then(({ data }) => setTenants(data || []))
  }, [])

  if (!isSuperadmin) return <div className="pad-top muted">Not authorized.</div>

  const filtered = tenants.filter((t) =>
    !q || `${t.name} ${t.slug}`.toLowerCase().includes(q.toLowerCase()))

  async function go(t, dest) {
    setErr(''); setBusy(t.id + dest)
    try { await setActingTenant(t.id) } catch (e) { setErr(e.message || 'Failed to switch'); setBusy(''); return }
    if (dest === 'customer') window.location.href = `/${t.slug}/find`
    else if (dest === 'ops') window.location.href = '/admin'
    else if (dest === 'elle') window.location.href = '/elle'
  }

  return (
    <div className="pad-top stack">
      <h1>⚡ God Mode</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        Jump into any territory as that tenant. Superadmin-only and server-verified; every change
        you make while acting is audited. Exit any time from the banner to return here.
      </p>
      <div className="field" style={{ margin: 0 }}>
        <input
          placeholder="Search territories…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {err && <div className="error">{err}</div>}
      <div className="stack">
        {filtered.map((t) => (
          <div key={t.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700 }}>{t.name}</div>
              <div className="muted" style={{ fontSize: '.78rem' }}>/{t.slug}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {t.has_app !== false && <button className="btn btn-blue" style={{ width: 'auto', padding: '8px 14px' }} disabled={!!busy} onClick={() => go(t, 'customer')}>Customer</button>}
              {t.has_app !== false && <button className="btn btn-ghost" style={{ width: 'auto', padding: '8px 14px' }} disabled={!!busy} onClick={() => go(t, 'ops')}>Operator</button>}
              {t.has_elle && <button className="btn btn-ghost" style={{ width: 'auto', padding: '8px 14px' }} disabled={!!busy} onClick={() => go(t, 'elle')}>ELLE</button>}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="muted">No territories match “{q}”.</div>}
      </div>
    </div>
  )
}
