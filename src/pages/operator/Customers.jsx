import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// ── Owned list ──
// Every signup is a customer you own. Search it and export to CSV (handy for the
// GHL contact migration later). Scoped to this operator's territory.
export default function Customers() {
  const { profile } = useAuth()
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!profile?.tenant_id) return
    supabase.from('profiles')
      .select('first_name,last_name,phone,email,zip,birthday,created_at')
      .eq('tenant_id', profile.tenant_id).eq('role', 'customer')
      .order('created_at', { ascending: false })
      .then(({ data }) => setRows(data || []))
  }, [profile])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) => `${r.first_name || ''} ${r.last_name || ''} ${r.phone || ''} ${r.email || ''} ${r.zip || ''}`.toLowerCase().includes(s))
  }, [rows, q])

  function exportCsv() {
    const header = ['First', 'Last', 'Phone', 'Email', 'ZIP', 'Birthday', 'Joined']
    const lines = [header, ...filtered.map((r) => [
      r.first_name || '', r.last_name || '', r.phone || '', r.email || '', r.zip || '',
      r.birthday || '', r.created_at ? new Date(r.created_at).toLocaleDateString() : '',
    ])]
    const csv = lines.map((row) => row.map(csvCell).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = `donutnv-customers-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }

  return (
    <div className="pad-top stack">
      <h1 style={{ marginBottom: 0 }}>Customers</h1>
      <p className="muted" style={{ marginTop: 0 }}>{rows.length} on your owned list — yours to keep.</p>

      <input className="fld" placeholder="Search name, phone, email, ZIP…" value={q} onChange={(e) => setQ(e.target.value)} />
      <button className="btn btn-blue" onClick={exportCsv} disabled={!filtered.length}>⬇️ Export {filtered.length} to CSV</button>

      {filtered.length === 0 && <p className="muted">No customers{q ? ' match that search' : ' yet'}.</p>}
      {filtered.map((r, i) => (
        <div key={i} className="card" style={{ paddingTop: 12, paddingBottom: 12 }}>
          <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700 }}>{`${r.first_name || ''} ${r.last_name || ''}`.trim() || 'No name'}</div>
          <div className="muted" style={{ fontSize: '.88rem' }}>{[r.phone, r.email, r.zip && ('ZIP ' + r.zip)].filter(Boolean).join(' · ') || '—'}</div>
          <div className="muted" style={{ fontSize: '.76rem' }}>Joined {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}{r.birthday ? ` · 🎂 ${r.birthday}` : ''}</div>
        </div>
      ))}
    </div>
  )
}

function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
