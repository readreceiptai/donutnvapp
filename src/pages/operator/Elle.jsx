import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

// ELLE — Event Lead Engine. Its own product, its own skin: dark, cyber-ish but
// restrained, no DonutNV branding. Reads the ELLE project via the elle-dashboard
// Edge Function (service-role stays server-side). Two segments: Public Events
// and Outbound Accounts, each graded + ranked.

const EVENT_TYPES = [
  ['large_public_festival', 'Large festival'], ['medium_public_festival', 'Festival'],
  ['small_public_event', 'Small public event'], ['music_festival', 'Music festival'],
  ['craft_arts_festival', 'Craft/arts fair'], ['farmers_market', 'Farmers market'],
  ['food_truck_rally', 'Food truck rally'], ['sports_pro', 'Pro sports'],
  ['large_corporate', 'Large corporate'], ['medium_corporate', 'Corporate'],
  ['small_corporate', 'Small corporate'], ['school_district', 'School district'],
  ['school_individual', 'School'], ['youth_sports_tournament', 'Youth sports tournament'],
  ['youth_sports_recreational', 'Rec sports'], ['church', 'Church'],
  ['charity_fundraiser', 'Charity / fundraiser'], ['grand_opening', 'Grand opening'],
]

function gradeFor(score) {
  const s = Number(score) || 0
  if (s >= 90) return 'A'; if (s >= 75) return 'B'; if (s >= 60) return 'C'; if (s >= 45) return 'D'; return 'F'
}
function deadlineInfo(d) {
  if (!d) return { label: 'No deadline', soon: false }
  const days = Math.ceil((new Date(d) - new Date()) / 864e5)
  if (days < 0) return { label: 'Closed', soon: false, past: true }
  if (days <= 7) return { label: `${days}d left`, soon: true }
  return { label: new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), soon: false }
}

export default function Elle() {
  const [state, setState] = useState('loading') // loading|configuring|onboard|ready|error
  const [tenant, setTenant] = useState(null)
  const [events, setEvents] = useState([])
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setState('loading'); setErr('')
    const { data, error } = await supabase.functions.invoke('elle-dashboard')
    if (error) { setErr('Could not reach ELLE.'); setState('error'); return }
    if (data?.configured === false) { setState('configuring'); return }
    if (data?.needsOnboarding) { setState('onboard'); return }
    setTenant(data?.tenant || null)
    setEvents(Array.isArray(data?.events) ? data.events : [])
    setState('ready')
  }, [])
  useEffect(() => { load() }, [load])

  async function decide(eventId, decision) {
    setEvents((prev) => prev.map((e) => e.event_id === eventId ? { ...e, decision } : e))
    await supabase.functions.invoke('elle-decision', { body: { event_id: eventId, decision } }).catch(() => {})
  }

  const ev = events.filter((e) => e.segment === 'event')
  const acct = events.filter((e) => e.segment === 'account')

  return (
    <div className="elle">
      <style>{ELLE_CSS}</style>
      <header className="elle-top">
        <div>
          <div className="elle-wordmark">ELLE<span className="elle-cursor">▌</span></div>
          <div className="elle-sub">Event Lead Engine{tenant?.franchise_name ? ` · ${tenant.franchise_name}` : ''}</div>
        </div>
        <Link to="/admin" className="elle-back">← DonutNV app</Link>
      </header>

      {state === 'loading' && <div className="elle-note">Scanning your territory…</div>}
      {state === 'error' && <div className="elle-note elle-err">{err} <button className="elle-link" onClick={load}>retry</button></div>}
      {state === 'configuring' && (
        <div className="elle-note">
          <b>ELLE is almost online.</b> The engine is running and your leads are queued — they’ll appear here the moment the connection key is set.
        </div>
      )}

      {state === 'onboard' && <Onboard onDone={load} />}

      {state === 'ready' && (
        <main className="elle-main">
          <Segment title="Public Events" tag="EVENTS" items={ev} onDecide={decide} />
          <Segment title="Outbound Accounts" tag="ACCOUNTS" items={acct} onDecide={decide} />
          {events.length === 0 && <div className="elle-note">No leads surfaced yet. ELLE runs weekly — check back after the next pull.</div>}
        </main>
      )}
    </div>
  )
}

function Segment({ title, tag, items, onDecide }) {
  if (!items.length) return null
  return (
    <section className="elle-seg">
      <div className="elle-seg-head"><span className="elle-eyebrow">{tag}</span><h2>{title}</h2><span className="elle-count">{items.length}</span></div>
      <div className="elle-grid">{items.map((e) => <Card key={e.event_id} e={e} onDecide={onDecide} />)}</div>
    </section>
  )
}

function Card({ e, onDecide }) {
  const grade = gradeFor(e.score)
  const dl = deadlineInfo(e.application_deadline)
  const place = [e.city, e.zip].filter(Boolean).join(' · ')
  return (
    <article className={`elle-card grade-${grade}`}>
      <div className="elle-card-top">
        <span className={`elle-grade g-${grade}`}>{grade}</span>
        <div className="elle-score">{Number(e.score) || 0}<span>/100</span></div>
        {e.territory_match && <span className={`elle-pill ${e.territory_match === 'owned' ? 'owned' : ''}`}>{e.territory_match}</span>}
        {dl.label && <span className={`elle-pill ${dl.soon ? 'soon' : ''} ${dl.past ? 'past' : ''}`}>{dl.label}</span>}
      </div>
      <h3 className="elle-name">{e.name}</h3>
      <div className="elle-meta">
        {e.start_date && <span>{new Date(e.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
        {place && <span>{place}</span>}
        {e.estimated_attendance ? <span>~{Number(e.estimated_attendance).toLocaleString()} ppl</span> : null}
        {e.vendor_fee != null ? <span>fee ${Number(e.vendor_fee).toLocaleString()}</span> : null}
      </div>
      <div className="elle-contact">
        {e.host_name ? <span className="elle-host">{e.host_name}</span> : <span className="elle-host muted">Contact pending</span>}
        {e.host_phone && <a className="elle-link" href={`tel:${e.host_phone}`}>{e.host_phone}</a>}
        {e.host_email && <a className="elle-link" href={`mailto:${e.host_email}`}>{e.host_email}</a>}
      </div>
      <div className="elle-actions">
        {['apply', 'waitlist', 'pass'].map((d) => (
          <button key={d} className={`elle-btn ${e.decision === d ? 'on ' + d : ''}`} onClick={() => onDecide(e.event_id, d)}>
            {d === 'apply' ? 'Apply' : d === 'waitlist' ? 'Waitlist' : 'Pass'}
          </button>
        ))}
      </div>
    </article>
  )
}

function Onboard({ onDone }) {
  const [f, setF] = useState({ franchise_name: '', zips: '', surrounding_zips: '', plan_tier: 'basic', suggestion: '' })
  const [types, setTypes] = useState(() => new Set(EVENT_TYPES.map(([c]) => c)))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const toggle = (c) => setTypes((p) => { const n = new Set(p); n.has(c) ? n.delete(c) : n.add(c); return n })

  async function submit(e) {
    e.preventDefault(); setErr('')
    const zips = f.zips.split(',').map((z) => z.trim()).filter(Boolean)
    if (!f.franchise_name || zips.length === 0) { setErr('Add your franchise name and at least one ZIP you own.'); return }
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('elle-onboard', {
      body: {
        franchise_name: f.franchise_name,
        zips,
        surrounding_zips: f.surrounding_zips.split(',').map((z) => z.trim()).filter(Boolean),
        event_types: [...types],
        plan_tier: f.plan_tier,
        suggestion: f.suggestion,
      },
    })
    setBusy(false)
    if (error || data?.error) { setErr(data?.error || 'Could not set up ELLE — try again.'); return }
    onDone()
  }

  return (
    <form className="elle-onboard" onSubmit={submit}>
      <h2>Activate ELLE for your territory</h2>
      <p className="elle-sub">Tell us where you work and what you’ll take the truck to. We handle finding the leads.</p>

      <label className="elle-field"><span>Franchise name</span>
        <input value={f.franchise_name} onChange={set('franchise_name')} placeholder="DonutNV Palm Harbor" /></label>
      <label className="elle-field"><span>ZIP codes you own <em>(comma-separated)</em></span>
        <input value={f.zips} onChange={set('zips')} placeholder="34683, 34684, 34685" /></label>
      <label className="elle-field"><span>Nearby ZIPs to watch <em>(optional)</em></span>
        <input value={f.surrounding_zips} onChange={set('surrounding_zips')} placeholder="34689, 33761" /></label>

      <div className="elle-field"><span>What will you book?</span>
        <div className="elle-types">
          {EVENT_TYPES.map(([c, label]) => (
            <button type="button" key={c} className={`elle-chip ${types.has(c) ? 'on' : ''}`} onClick={() => toggle(c)}>{label}</button>
          ))}
        </div>
      </div>

      <label className="elle-field"><span>Plan</span>
        <select value={f.plan_tier} onChange={set('plan_tier')}>
          <option value="basic">Basic</option><option value="pro">Pro</option><option value="agency">Agency</option>
        </select></label>
      <label className="elle-field"><span>Any local event or organization we should watch? <em>(optional)</em></span>
        <input value={f.suggestion} onChange={set('suggestion')} placeholder="e.g. the county fair board" /></label>

      {err && <div className="elle-note elle-err">{err}</div>}
      <button className="elle-cta" disabled={busy}>{busy ? 'Activating…' : 'Activate ELLE'}</button>
    </form>
  )
}

const ELLE_CSS = `
.elle{position:fixed;inset:0;overflow:auto;background:#0b0f14;color:#e6edf3;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  background-image:radial-gradient(900px 400px at 80% -10%,rgba(34,211,238,.10),transparent 60%);}
.elle *{box-sizing:border-box}
.elle-top{display:flex;justify-content:space-between;align-items:flex-start;
  padding:22px 20px 16px;border-bottom:1px solid #1b2531;position:sticky;top:0;
  background:rgba(11,15,20,.82);backdrop-filter:blur(8px);z-index:5}
.elle-wordmark{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;
  font-size:1.5rem;letter-spacing:.18em;color:#eafdfb}
.elle-cursor{color:#22d3ee;animation:elleblink 1.1s steps(1) infinite;margin-left:2px}
@keyframes elleblink{50%{opacity:0}}
.elle-sub{color:#8b9bb0;font-size:.82rem;margin-top:3px}
.elle-back{color:#8b9bb0;text-decoration:none;font-size:.8rem;border:1px solid #1f2a37;
  padding:7px 12px;border-radius:8px}
.elle-back:hover{color:#22d3ee;border-color:#22d3ee}
.elle-main{padding:18px 20px 60px;max-width:1100px;margin:0 auto}
.elle-note{margin:30px 20px;color:#9fb0c4;background:#111824;border:1px solid #1f2a37;
  border-radius:12px;padding:18px 20px;max-width:680px;line-height:1.55}
.elle-note.elle-err{border-color:#7f1d1d;color:#fca5a5}
.elle-seg{margin-top:26px}
.elle-seg-head{display:flex;align-items:baseline;gap:10px;border-bottom:1px solid #1b2531;padding-bottom:8px}
.elle-eyebrow{font-family:ui-monospace,monospace;font-size:.66rem;letter-spacing:.22em;
  color:#22d3ee;background:rgba(34,211,238,.08);border:1px solid rgba(34,211,238,.25);
  padding:3px 7px;border-radius:5px}
.elle-seg-head h2{font-size:1.05rem;margin:0;font-weight:650}
.elle-count{margin-left:auto;color:#5e7188;font-family:ui-monospace,monospace;font-size:.85rem}
.elle-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin-top:14px}
.elle-card{background:#111824;border:1px solid #1f2a37;border-radius:14px;padding:15px 16px;
  transition:border-color .15s,transform .15s}
.elle-card:hover{border-color:#2b3a4d;transform:translateY(-1px)}
.elle-card.grade-A{box-shadow:inset 0 0 0 1px rgba(34,211,238,.18)}
.elle-card-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.elle-grade{font-family:ui-monospace,monospace;font-weight:700;width:26px;height:26px;
  display:grid;place-items:center;border-radius:7px;font-size:.9rem}
.g-A{background:rgba(34,211,238,.16);color:#5eead4;border:1px solid rgba(34,211,238,.45)}
.g-B{background:rgba(52,211,153,.14);color:#6ee7b7;border:1px solid rgba(52,211,153,.4)}
.g-C{background:rgba(251,191,36,.14);color:#fcd34d;border:1px solid rgba(251,191,36,.4)}
.g-D,.g-F{background:rgba(148,163,184,.12);color:#94a3b8;border:1px solid #334155}
.elle-score{font-family:ui-monospace,monospace;font-size:1.1rem;color:#eafdfb}
.elle-score span{color:#5e7188;font-size:.7rem}
.elle-pill{margin-left:auto;font-size:.66rem;letter-spacing:.05em;text-transform:uppercase;
  color:#8b9bb0;border:1px solid #28384a;border-radius:20px;padding:3px 9px}
.elle-pill.owned{color:#5eead4;border-color:rgba(34,211,238,.4)}
.elle-pill.soon{color:#fcd34d;border-color:rgba(251,191,36,.45)}
.elle-pill.past{color:#fca5a5;border-color:#7f1d1d}
.elle-pill+.elle-pill{margin-left:6px}
.elle-name{font-size:1rem;margin:11px 0 7px;line-height:1.3}
.elle-meta{display:flex;flex-wrap:wrap;gap:5px 12px;color:#8b9bb0;font-size:.8rem}
.elle-contact{display:flex;flex-direction:column;gap:2px;margin-top:11px;padding-top:11px;border-top:1px solid #1b2531}
.elle-host{font-size:.84rem;color:#cbd5e1}.elle-host.muted{color:#64748b;font-style:italic}
.elle-link{color:#22d3ee;text-decoration:none;font-size:.8rem;background:none;border:none;cursor:pointer;padding:0}
.elle-link:hover{text-decoration:underline}
.elle-actions{display:flex;gap:7px;margin-top:13px}
.elle-btn{flex:1;background:#0e151e;border:1px solid #28384a;color:#aebccf;border-radius:8px;
  padding:8px;font-size:.82rem;cursor:pointer;transition:.12s}
.elle-btn:hover{border-color:#3a4d63;color:#e6edf3}
.elle-btn.on.apply{background:rgba(34,211,238,.16);border-color:#22d3ee;color:#a5f3ef}
.elle-btn.on.waitlist{background:rgba(251,191,36,.14);border-color:#fbbf24;color:#fde68a}
.elle-btn.on.pass{background:rgba(148,163,184,.1);border-color:#475569;color:#cbd5e1}
.elle-onboard{max-width:560px;margin:30px auto;padding:0 20px 60px}
.elle-onboard h2{font-size:1.3rem;margin:0 0 4px}
.elle-field{display:block;margin-top:16px}
.elle-field>span{display:block;font-size:.8rem;color:#aebccf;margin-bottom:6px}
.elle-field em{color:#64748b;font-style:normal}
.elle-field input,.elle-field select{width:100%;background:#0e151e;border:1px solid #28384a;
  color:#e6edf3;border-radius:9px;padding:11px 12px;font-size:.95rem;font-family:inherit}
.elle-field input:focus,.elle-field select:focus{outline:none;border-color:#22d3ee}
.elle-types{display:flex;flex-wrap:wrap;gap:7px}
.elle-chip{background:#0e151e;border:1px solid #28384a;color:#8b9bb0;border-radius:20px;
  padding:7px 12px;font-size:.8rem;cursor:pointer}
.elle-chip.on{background:rgba(34,211,238,.12);border-color:#22d3ee;color:#a5f3ef}
.elle-cta{margin-top:22px;width:100%;background:#22d3ee;color:#06222a;border:none;border-radius:10px;
  padding:13px;font-weight:700;font-size:1rem;cursor:pointer}
.elle-cta:hover{background:#5eead4}.elle-cta:disabled{opacity:.6;cursor:default}
`
