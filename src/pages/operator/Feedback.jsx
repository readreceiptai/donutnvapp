import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Tester feedback inbox (superadmin). Reads public.feedback (RLS lets superadmin
// see all), with quick triage (new → seen → resolved). This closes the pilot loop:
// testers submit from the widget, Kevin reviews here.
const CAT_LABEL = { bug: '🐞 Bug', bad_lead: '⚑ Bad lead', idea: '💡 Idea', question: '❓ Question', praise: '💛 Praise', other: '• Other' }
const STATUSES = ['new', 'seen', 'resolved']

export default function Feedback() {
  const { profile } = useAuth()
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState('open') // open | all

  const load = useCallback(async () => {
    let q = supabase.from('feedback').select('*').order('created_at', { ascending: false }).limit(200)
    if (filter === 'open') q = q.neq('status', 'resolved')
    const { data } = await q
    setRows(data || [])
  }, [filter])

  useEffect(() => { load() }, [load])

  async function setStatus(id, status) {
    await supabase.from('feedback').update({ status }).eq('id', id)
    load()
  }

  if (profile && !profile.is_superadmin) {
    return <div className="pad-top"><p className="muted">This inbox is for admins.</p></div>
  }

  return (
    <div className="pad-top stack">
      <h1 style={{ marginBottom: 0 }}>🗣️ Tester feedback</h1>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className={`btn ${filter === 'open' ? 'btn-primary' : 'btn-ghost'}`} style={{ width: 'auto', padding: '8px 14px' }} onClick={() => setFilter('open')}>Open</button>
        <button className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-ghost'}`} style={{ width: 'auto', padding: '8px 14px' }} onClick={() => setFilter('all')}>All</button>
      </div>

      {rows === null && <p className="muted">Loading…</p>}
      {rows && rows.length === 0 && <p className="muted">No feedback yet. It’ll show up here the moment a tester sends some.</p>}

      {rows && rows.map((r) => (
        <div key={r.id} className="card" style={{ borderLeft: `4px solid ${r.status === 'resolved' ? 'var(--line,#ddd)' : r.role === 'franchisee' ? 'var(--red)' : 'var(--blue)'}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: '.85rem' }}>{CAT_LABEL[r.category] || r.category}</span>
            <span className="muted" style={{ fontSize: '.72rem' }}>{r.role} · {fmt(r.created_at)}</span>
          </div>
          <p style={{ margin: '8px 0', fontSize: '.95rem', whiteSpace: 'pre-wrap' }}>{r.message}</p>
          <div className="muted" style={{ fontSize: '.72rem' }}>{r.context?.page || ''}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            {STATUSES.map((s) => (
              <button key={s} onClick={() => setStatus(r.id, s)}
                style={{ border: '1px solid var(--line,#e2d7cc)', background: r.status === s ? 'var(--ink,#231F20)' : '#fff', color: r.status === s ? '#fff' : 'var(--muted,#8a827c)', borderRadius: 999, padding: '4px 11px', fontSize: '.75rem', fontWeight: 700, cursor: 'pointer' }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

const fmt = (iso) => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
