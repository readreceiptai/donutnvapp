import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { CONSENT_TEXT, CONSENT_VERSION } from '../lib/consentText'
import { enablePushAlerts } from '../lib/push'
import ProximityAlerts from '../components/ProximityAlerts'

export default function Account() {
  const { profile, signOut, reloadProfile } = useAuth()
  const [prefs, setPrefs] = useState({ marketing_sms: false, marketing_email: false })
  const [note, setNote] = useState(null) // { text, ok } | null

  // Read the latest consent state per kind.
  useEffect(() => {
    if (!profile) return
    supabase.from('consents')
      .select('kind, granted, created_at')
      .eq('profile_id', profile.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const latest = {}
        ;(data || []).forEach((c) => { if (!(c.kind in latest)) latest[c.kind] = c.granted })
        setPrefs({ marketing_sms: !!latest.marketing_sms, marketing_email: !!latest.marketing_email })
      })
  }, [profile])

  async function toggle(kind) {
    const next = !prefs[kind]
    setPrefs((p) => ({ ...p, [kind]: next }))
    // Append a new consent row (we keep history rather than overwriting).
    // Consent is compliance-sensitive, so never claim "Saved" without confirming
    // the write landed — on failure, revert the toggle and tell the user.
    const { error } = await supabase.from('consents').insert({
      profile_id: profile.id, tenant_id: profile.tenant_id,
      kind, granted: next, text_version: CONSENT_VERSION, source: 'account',
    })
    if (error) {
      setPrefs((p) => ({ ...p, [kind]: !next }))
      setNote({ text: "Couldn't save — try again", ok: false }); setTimeout(() => setNote(null), 2500)
      return
    }
    setNote({ text: 'Saved', ok: true }); setTimeout(() => setNote(null), 1500)
  }

  async function turnOnAlerts() {
    const r = await enablePushAlerts(profile)
    setNote({ text: r.ok ? 'Alerts on' : r.reason, ok: !!r.ok })
    setTimeout(() => setNote(null), 2500)
  }

  if (!profile) return <div className="pad-top muted">Loading your account…</div>

  return (
    <div className="pad-top stack">
      <h1>Hi, {profile.first_name || 'friend'} 👋</h1>

      <div className="card stack">
        <Row label="Name" value={[profile.first_name, profile.last_name].filter(Boolean).join(' ') || '—'} />
        <Row label="Mobile" value={profile.phone || '—'} />
        <Row label="Email" value={profile.email || '—'} />
        <Row label="Home ZIP" value={profile.zip || '—'} />
        <Row label="Birthday" value={profile.birthday ? formatBday(profile.birthday) : '—'} />
      </div>

      <h2 style={{ marginBottom: 4 }}>Notifications</h2>
      <div className="card">
        <label className="consent">
          <input type="checkbox" checked={prefs.marketing_sms} onChange={() => toggle('marketing_sms')} />
          <span className="label"><b>Text me deals & flavors.</b> {CONSENT_TEXT.marketing_sms}</span>
        </label>
        <label className="consent">
          <input type="checkbox" checked={prefs.marketing_email} onChange={() => toggle('marketing_email')} />
          <span className="label"><b>Email me offers.</b> {CONSENT_TEXT.marketing_email}</span>
        </label>
        {note && <div className={note.ok ? 'success' : 'error'} style={{ marginTop: 6 }}>{note.text}{note.ok ? ' ✓' : ''}</div>}
      </div>

      <button className="btn btn-blue" onClick={turnOnAlerts} style={{ marginTop: 6 }}>🔔 Turn on truck alerts</button>

      {/* Option B: live proximity alerts. On web this renders an honest "get the
          app" message, because no browser can do background location. */}
      <ProximityAlerts profile={profile} />
      <button className="btn btn-ghost" onClick={signOut}>Log out</button>
      <p className="center muted" style={{ fontSize: '.75rem' }}>DonutNV • Make Your Next Party Sweet!®</p>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
      <span className="muted">{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function formatBday(d) {
  const [y, m, day] = d.split('-').map(Number)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${M[m - 1]} ${day}, ${y}`
}
