import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// ── Weekly game admin ──
// The campaign engine: a library of game templates the operator switches on and
// schedules — no developer needed. Only one of each kind needs to be active;
// activating a game here is what makes it appear on every customer's Rewards tab.

const TEMPLATES = [
  { kind: 'checkin_stamp', emoji: '🍩', name: 'Stamp Card', blurb: 'Visit N times, earn a free treat.', fields: [['goal', 'Visits needed', 5], ['reward', 'Reward', 'A free bag of mini donuts']] },
  { kind: 'passport', emoji: '🗺️', name: 'Donut Passport', blurb: 'Visit N different stops to unlock a reward.', fields: [['goal', 'Different stops', 4], ['reward', 'Reward', 'A free lemonade']] },
  { kind: 'catch_the_truck', emoji: '🚚', name: 'Catch the Truck', blurb: 'Secret stop revealed at a set time — first N win.', fields: [['winners', 'Winners', 10], ['reward', 'Prize', 'Free donuts for a week']] },
  { kind: 'bonus_day', emoji: '✨', name: 'Bonus Day', blurb: 'Points multiplier on chosen days.', fields: [['multiplier', 'Multiplier', 2], ['reward', 'Note', 'Double points all day']] },
]

export default function Campaigns() {
  const { profile } = useAuth()
  const [campaigns, setCampaigns] = useState([])
  const [editing, setEditing] = useState(null) // template kind being configured
  const [form, setForm] = useState({})
  const [msg, setMsg] = useState('')

  const load = () => supabase.from('campaigns').select('*')
    .eq('tenant_id', profile.tenant_id).order('created_at', { ascending: false })
    .then(({ data }) => setCampaigns(data || []))

  useEffect(() => { if (profile) load() }, [profile]) // eslint-disable-line

  function startNew(tpl) {
    setEditing(tpl)
    const f = { name: tpl.name }
    tpl.fields.forEach(([k, , def]) => { f[k] = def })
    setForm(f)
  }

  async function save() {
    const tpl = editing
    const config = {}
    tpl.fields.forEach(([k]) => { config[k] = isNaN(Number(form[k])) ? form[k] : Number(form[k]) })
    // Activating this game deactivates any other active game of the same kind.
    await supabase.from('campaigns').update({ is_active: false })
      .eq('tenant_id', profile.tenant_id).eq('kind', tpl.kind).eq('is_active', true)
    const { error } = await supabase.from('campaigns').insert({
      tenant_id: profile.tenant_id, kind: tpl.kind, name: form.name || tpl.name,
      config, is_active: true, starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    })
    setMsg(error ? error.message : `“${form.name}” is live for customers 🎉`)
    setEditing(null); load(); setTimeout(() => setMsg(''), 2500)
  }

  async function toggle(c) {
    await supabase.from('campaigns').update({ is_active: !c.is_active }).eq('id', c.id)
    load()
  }

  return (
    <div className="pad-top stack">
      <h1>Games & rewards</h1>
      <p className="muted" style={{ marginTop: -6 }}>Switch on a game for the week. It shows up instantly on every customer's Rewards tab.</p>

      {msg && <div className="success">{msg}</div>}

      {editing ? (
        <div className="card card-accent stack">
          <h2 style={{ margin: 0 }}>{editing.emoji} {editing.name}</h2>
          <div className="field" style={{ margin: 0 }}>
            <label>Name customers see</label>
            <input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          {editing.fields.map(([k, label]) => (
            <div className="field" style={{ margin: 0 }} key={k}>
              <label>{label}</label>
              <input value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
          <button className="btn btn-primary" onClick={save}>Turn this game on</button>
          <button className="link" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      ) : (
        <>
          <h2 style={{ marginBottom: 2 }}>Start a new game</h2>
          <div className="stack">
            {TEMPLATES.map((t) => (
              <button key={t.kind} className="card" onClick={() => startNew(t)} style={{ textAlign: 'left', border: 'none', cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'center' }}>
                <div style={{ fontSize: 30 }}>{t.emoji}</div>
                <div>
                  <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700 }}>{t.name}</div>
                  <div className="muted" style={{ fontSize: '.88rem' }}>{t.blurb}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {campaigns.length > 0 && (
        <>
          <h2 style={{ marginBottom: 2, marginTop: 8 }}>Your games</h2>
          <div className="stack">
            {campaigns.map((c) => (
              <div key={c.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--font-head)' }}>{c.name}</div>
                  <span className={`pill ${c.is_active ? 'pill-open' : 'pill-closed'}`} style={{ marginTop: 4 }}>
                    {c.is_active ? 'Live now' : 'Off'}
                  </span>
                </div>
                <button className={`btn ${c.is_active ? 'btn-ghost' : 'btn-blue'}`} style={{ width: 'auto', padding: '10px 16px' }} onClick={() => toggle(c)}>
                  {c.is_active ? 'Turn off' : 'Turn on'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
