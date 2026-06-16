import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { CONSENT_TEXT, CONSENT_VERSION } from '../lib/consentText'
import { enablePushAlerts } from '../lib/push'

export default function Account() {
  const { profile, signOut, reloadProfile } = useAuth()
  const [prefs, setPrefs] = useState({ marketing_sms: false, marketing_email: false })
  const [saved, setSaved] = useState('')

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
    await supabase.from('consents').insert({
      profile_id: profile.id, tenant_id: profile.tenant_id,
      kind, granted: next, text_version: CONSENT_VERSION, source: 'account',
    })
    setSaved('Saved'); setTimeout(() => setSaved(''), 1500)
  }

  async function turnOnAlerts() {
    const r = await enablePushAlerts(profile)
    setSaved(r.ok ? 'Alerts on ✓' : r.reason)
    setTimeout(() => setSaved(''), 2500)
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
        {saved && <div className="success" style={{ marginTop: 6 }}>{saved} ✓</div>}
      </div>

      <button className="btn btn-blue" onClick={turnOnAlerts} style={{ marginTop: 6 }}>🔔 Turn on truck alerts</button>
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
