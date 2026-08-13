import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { DEMO } from '../../lib/demo'
import FeedbackButton from '../../components/FeedbackButton'

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
// Compact, always-on legend so the grade + point weights speak for themselves.
function ScoreLegend() {
  return (
    <div className="elle-legend">
      <div className="elle-legend-grades">
        <span className="lg g-A">A 90+</span>
        <span className="lg g-B">B 75+</span>
        <span className="lg g-C">C 60+</span>
        <span className="lg g-D">D 45+</span>
        <span className="lg g-F">F &lt;45</span>
      </div>
      <div className="elle-legend-weights">
        <span>/100 =</span>
        <b>Profit 35</b><i>·</i><b>Reachable 25</b><i>·</i><b>Territory 20</b><i>·</i><b>Deadline 10</b><i>·</i><b>Data 10</b>
      </div>
    </div>
  )
}
function deadlineInfo(d) {
  if (!d) return { label: 'No deadline', soon: false }
  const days = Math.ceil((new Date(d) - new Date()) / 864e5)
  if (days < 0) return { label: 'Closed', soon: false, past: true }
  if (days <= 7) return { label: `${days}d left`, soon: true }
  return { label: new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), soon: false }
}

function typeLabel(code) {
  const m = EVENT_TYPES.find(([c]) => c === code)
  return m ? m[1] : (code || 'Other')
}
const STATUSES = [['apply', 'Applying'], ['waitlist', 'Waitlist'], ['booked', 'Won'], ['lost', 'Lost'], ['pass', 'Pass']]
// Territory the superadmin view opens on when nothing else is remembered. Ocala (demo).
const DEFAULT_TENANT_ID = '7c842426-3af1-43e1-b7ac-6311917e9bab'
// Long-term relationship stages for business accounts (they never go away, so
// there is no permanent "lost" — "Revisit later" parks without killing).
const BIZ_STAGES = [['contacted', 'Reached out'], ['talking', 'In conversation'], ['client', 'Active client'], ['revisit', 'Revisit later']]

export default function Elle() {
  const [state, setState] = useState('loading') // loading|configuring|onboard|ready|error
  const [tenant, setTenant] = useState(null)
  const [events, setEvents] = useState([])
  const [err, setErr] = useState('')
  const [tenants, setTenants] = useState([])   // superadmin-only territory list
  const [isSuper, setIsSuper] = useState(false)
  const [selected, setSelected] = useState('') // selected tenant id (superadmin switcher)
  const [sort, setSort] = useState('score')
  const [seg, setSeg] = useState('all')
  const [stage, setStage] = useState('new')        // all | event | account
  const [muted, setMuted] = useState([])       // event types this Z has hidden
  const [showTypes, setShowTypes] = useState(false)
  const [lc, setLc] = useState({ connected: false, location_id: null, push_count: 0 })
  const [showLC, setShowLC] = useState(false)
  const [lcMsg, setLcMsg] = useState('')
  const [view, setView] = useState('events')     // events | businesses
  const [businesses, setBusinesses] = useState([])
  const [bizBucket, setBizBucket] = useState('all')
  const [npKind, setNpKind] = useState('all')   // non-profit type sub-filter: all | school | church | charity
  const [npStage, setNpStage] = useState('all') // non-profit relationship stage: all | new | contacted | talking | client | revisit
  const [market, setMarket] = useState(null)
  const [turnedDown, setTurnedDown] = useState([])

  const FLOOR = 12 // never drop a Z below this many leads, even with mutes

  const load = useCallback(async (tenantId) => {
    setState('loading'); setErr('')
    const { data, error } = await supabase.functions.invoke('elle-dashboard', {
      body: tenantId ? { tenant_id: tenantId } : {},
    })
    if (error) { setErr('Could not reach ELLE.'); setState('error'); return }
    if (data?.configured === false) { setState('configuring'); return }
    setIsSuper(!!data?.isSuperadmin)
    setTenants(Array.isArray(data?.tenants) ? data.tenants : [])
    if (data?.needsOnboarding) { setState('onboard'); return }
    setTenant(data?.tenant || null)
    if (data?.tenant?.id) setSelected(data.tenant.id)
    setMuted(Array.isArray(data?.muted_types) ? data.muted_types : [])
    setEvents(Array.isArray(data?.events) ? data.events : [])
    setState('ready')
    // LeadConnector status (per real tenant only)
    if (tenantId !== 'ALL') {
      const b = tenantId ? { action: 'status', tenant_id: tenantId } : { action: 'status' }
      supabase.functions.invoke('elle-leadconnector', { body: b })
        .then(({ data: s }) => setLc(s && !s.error ? s : { connected: false }))
        .catch(() => setLc({ connected: false }))
    } else setLc({ connected: false })
  }, [])
  // Default to Ocala until further notice, regardless of any territory left in storage from a
  // previous session (that stale value was pinning the board to Las Vegas). We overwrite storage
  // to Ocala on load; the switcher still lets a superadmin change territory within the session.
  useEffect(() => {
    try { localStorage.setItem('elle_tenant', DEFAULT_TENANT_ID) } catch (_) { /* private mode */ }
    load(DEFAULT_TENANT_ID)
  }, [load])
  // Auto-pull LeadConnector outcomes once per board open, so Won/Lost reflect LC
  // without the Z doing anything. Manual "Sync" button re-runs it on demand.
  const syncedRef = useRef(false)
  useEffect(() => {
    if (lc.connected && selected && selected !== 'ALL' && !syncedRef.current) {
      syncedRef.current = true
      syncLC()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lc.connected, selected])

  const loadBiz = useCallback(async (tenantId) => {
    const { data } = await supabase.functions
      .invoke('elle-dashboard', { body: { ...(tenantId ? { tenant_id: tenantId } : {}), view: 'businesses' } })
      .catch(() => ({ data: null }))
    setBusinesses(Array.isArray(data?.businesses) ? data.businesses : [])
  }, [])
  useEffect(() => {
    if ((view === 'businesses' || view === 'nonprofits') && selected && selected !== 'ALL') loadBiz(selected)
  }, [view, selected, loadBiz])

  const loadMarket = useCallback(async (tenantId) => {
    const { data } = await supabase.functions
      .invoke('elle-dashboard', { body: { ...(tenantId ? { tenant_id: tenantId } : {}), view: 'market' } })
      .catch(() => ({ data: null }))
    setMarket(data?.market ?? null)
  }, [])
  useEffect(() => {
    if (view === 'market' && selected && selected !== 'ALL') loadMarket(selected)
  }, [view, selected, loadMarket])

  const loadTurnedDown = useCallback(async (tenantId) => {
    const b = tenantId ? { view: 'turned_down', tenant_id: tenantId } : { view: 'turned_down' }
    const { data } = await supabase.functions.invoke('elle-dashboard', { body: b }).catch(() => ({ data: null }))
    setTurnedDown(Array.isArray(data?.turned_down) ? data.turned_down : [])
  }, [])
  useEffect(() => { if (view === 'turned_down') loadTurnedDown(selected) }, [view, selected, loadTurnedDown])

  const viewingAll = selected === 'ALL'
  const tenantParam = selected || undefined

  async function decide(eventId, decision, eventType) {
    setEvents((prev) => prev.map((e) => e.event_id === eventId ? { ...e, decision } : e))
    const body = { event_id: eventId, decision }
    if (tenantParam && tenantParam !== 'ALL') body.tenant_id = tenantParam
    await supabase.functions.invoke('elle-decision', { body }).catch(() => {})
    if (decision === 'booked' && eventType && tenantParam && tenantParam !== 'ALL') {
      // Learn: a won lead reinforces more of this event type.
      await supabase.functions.invoke('elle-dashboard', { body: { tenant_id: tenantParam, action: 'won_learn', event_type: eventType } }).catch(() => {})
    }
  }

  async function toggleMute(eventType, mute) {
    setMuted((prev) => mute ? [...new Set([...prev, eventType])] : prev.filter((t) => t !== eventType))
    if (tenantParam && tenantParam !== 'ALL') {
      await supabase.functions.invoke('elle-dashboard', { body: { tenant_id: tenantParam, action: mute ? 'mute' : 'unmute', event_type: eventType } }).catch(() => {})
    }
  }

  async function pushToLC(eventId) {
    setLcMsg('Sending to LeadConnector…')
    const body = { action: 'push', event_id: eventId }
    if (tenantParam && tenantParam !== 'ALL') body.tenant_id = tenantParam
    const { data } = await supabase.functions.invoke('elle-leadconnector', { body }).catch(() => ({ data: { error: 'failed' } }))
    setLcMsg(data?.ok ? 'Sent to LeadConnector ✓' : (data?.error === 'not_connected' ? 'Connect LeadConnector first.' : 'Could not send that lead.'))
    if (data?.ok) load(selected)
    setTimeout(() => setLcMsg(''), 3500)
  }
  async function pushAllToLC() {
    if (!confirm('Send every contactable lead not already in LeadConnector? Each becomes an opportunity in your pipeline.')) return
    setLcMsg('Sending all to LeadConnector…')
    const b = { action: 'push_bulk' }
    if (tenantParam && tenantParam !== 'ALL') b.tenant_id = tenantParam
    const { data } = await supabase.functions.invoke('elle-leadconnector', { body: b }).catch(() => ({ data: { error: 'failed' } }))
    setLcMsg(data?.ok ? `Sent ${data.sent} new lead${data.sent === 1 ? '' : 's'} to LeadConnector${data.skipped ? ` · ${data.skipped} skipped` : ''}.` : 'Bulk send failed.')
    if (data?.ok) load(selected)
    setTimeout(() => setLcMsg(''), 6000)
  }
  async function setOutcome(eventId, outcome, eventType) {
    const b = { action: 'lead_outcome', event_id: eventId, outcome, event_type: eventType }
    if (tenantParam && tenantParam !== 'ALL') b.tenant_id = tenantParam
    await supabase.functions.invoke('elle-dashboard', { body: b }).catch(() => {})
    load(selected)
  }
  async function markInfoBad(eventId, bad) {
    const b = { action: bad ? 'mark_info_bad' : 'clear_info_bad', event_id: eventId }
    if (tenantParam && tenantParam !== 'ALL') b.tenant_id = tenantParam
    await supabase.functions.invoke('elle-dashboard', { body: b }).catch(() => {})
    load(selected)
  }
  const [syncing, setSyncing] = useState(false)
  async function syncLC() {
    // Pull each pushed opportunity's real stage back from LeadConnector.
    setSyncing(true)
    const b = { action: 'sync_outcomes' }
    if (tenantParam && tenantParam !== 'ALL') b.tenant_id = tenantParam
    await supabase.functions.invoke('elle-leadconnector', { body: b }).catch(() => {})
    setSyncing(false)
    load(selected)
  }
  async function setBizDecision(businessId, decision) {
    const b = { action: 'biz_decision', business_id: businessId, decision }
    if (tenantParam && tenantParam !== 'ALL') b.tenant_id = tenantParam
    await supabase.functions.invoke('elle-dashboard', { body: b }).catch(() => {})
    loadBiz(selected)
  }
  // On-demand contact sourcing for a business: LinkedIn (facility staff) or local press (site GM).
  // Runs the server-side scraper, then reloads the board so new POCs appear on the card.
  async function findContacts(businessId, kind) {
    const b = { action: kind === 'press' ? 'find_press' : 'find_linkedin', business_id: businessId }
    if (tenantParam && tenantParam !== 'ALL') b.tenant_id = tenantParam
    const { data } = await supabase.functions.invoke('elle-dashboard', { body: b }).catch(() => ({ data: null }))
    await loadBiz(selected)
    return data
  }
  async function dismissLead(eventId) {
    // Z isn't interested — pull it off the board AND stop enriching it going forward.
    // It lands only in the admin turned-down ledger.
    setEvents((prev) => prev.filter((e) => e.event_id !== eventId))
    const b = { action: 'dismiss_lead', event_id: eventId, dismissed: true }
    if (tenantParam && tenantParam !== 'ALL') b.tenant_id = tenantParam
    await supabase.functions.invoke('elle-dashboard', { body: b }).catch(() => {})
  }
  async function lcConnect(token, location_id) {
    setLcMsg('Checking your connection…')
    const b = { action: 'connect', token, location_id }
    if (tenantParam && tenantParam !== 'ALL') b.tenant_id = tenantParam
    const { data } = await supabase.functions.invoke('elle-leadconnector', { body: b }).catch(() => ({ data: { error: 'failed' } }))
    if (data?.connected) { setLc(data); setShowLC(false); setLcMsg('') } else setLcMsg(data?.error || 'Could not connect.')
  }
  async function lcDisconnect() {
    const b = { action: 'disconnect' }
    if (tenantParam && tenantParam !== 'ALL') b.tenant_id = tenantParam
    await supabase.functions.invoke('elle-leadconnector', { body: b }).catch(() => {})
    setLc({ connected: false })
  }

  const sortItems = (arr) => {
    const a = [...arr]
    const t = (v) => (v ? new Date(v).getTime() : Infinity)          // soonest first, blanks last
    const n = (v) => (v == null ? -1 : Number(v))                     // largest first, blanks last
    if (sort === 'event') a.sort((x, y) => t(x.start_date) - t(y.start_date))
    else if (sort === 'deadline') a.sort((x, y) => t(x.application_deadline) - t(y.application_deadline))
    else if (sort === 'attendance') a.sort((x, y) => n(y.estimated_attendance) - n(x.estimated_attendance))
    else a.sort((x, y) => (Number(y.score) || 0) - (Number(x.score) || 0))
    return a
  }

  // lifecycle stage: new (unworked) -> working (in LC) -> done (won/lost)
  const stageOf = (e) => (e.outcome ? 'done' : (e.pushed_at ? 'working' : 'new'))
  // Recurring/recycle: a rolled-forward event waits in the Recurring tab until its
  // registration window nears, then rejoins the main board as a fresh cycle.
  const daysUntil = (d) => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : Infinity
  const isRecycled = (e) => (Number(e.cycle_count) || 0) > 0 || !!e.recycled_at
  const regSoon = (e) => e.application_opens_date ? daysUntil(e.application_opens_date) <= 45 : (e.start_date ? daysUntil(e.start_date) <= 150 : true)
  const parked = (e) => isRecycled(e) && !regSoon(e)
  const boardEvents = events.filter((e) => !parked(e))
  const recurringEvents = events.filter(parked)
  const stageCounts = { new: 0, working: 0, done: 0 }
  for (const e of boardEvents) stageCounts[stageOf(e)]++
  const activeStage = lc.connected && !viewingAll ? stage : 'new'
  const stageEvents = boardEvents.filter((e) => stageOf(e) === activeStage)

  // segment filter + mutes, but keep at least FLOOR leads on the New view (muted ones return, dimmed)
  const mutedSet = new Set(muted)
  const segEvents = stageEvents.filter((e) => seg === 'all' || e.segment === seg)
  const shown = segEvents.filter((e) => !mutedSet.has(e.event_type))
  let floored = shown
  if (activeStage === 'new' && shown.length < FLOOR) {
    const extra = sortItems(segEvents.filter((e) => mutedSet.has(e.event_type)))
      .slice(0, FLOOR - shown.length).map((e) => ({ ...e, _dim: true }))
    floored = [...shown, ...extra]
  }
  const ev = sortItems(floored.filter((e) => e.segment === 'event'))
  const acct = sortItems(floored.filter((e) => e.segment === 'account'))
  const presentTypes = [...new Set(events.map((e) => e.event_type).filter(Boolean))].sort()

  return (
    <div className="elle">
      <style>{ELLE_CSS}</style>
      <FeedbackButton role="franchisee" />
      <header className="elle-top">
        <div>
          <div className="elle-wordmark">ELLE<span className="elle-cursor">▌</span></div>
          <div className="elle-sub">Event Lead Engine{tenant?.franchise_name ? ` · ${tenant.franchise_name}` : ''}</div>
        </div>
        <div className="elle-top-right">
          {!viewingAll && (
            <button className={`elle-lc-chip ${lc.connected ? 'on' : ''}`} onClick={() => setShowLC(true)}>
              {lc.connected ? 'LeadConnector ✓' : 'Connect LeadConnector'}
            </button>
          )}
          {!viewingAll && lc.connected && (
            <button className="elle-lc-chip" onClick={pushAllToLC} title="Send every contactable lead not yet in LeadConnector">⇪ Send all to LC</button>
          )}
          {!DEMO && isSuper && tenants.length >= 1 && (
            <select className="elle-switch" value={selected} aria-label="Territory"
              onChange={(e) => { try { localStorage.setItem('elle_tenant', e.target.value) } catch (_) { /* private mode */ } setSelected(e.target.value); load(e.target.value) }}>
              <option value="ALL">◆ All Territories</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.franchise_name}</option>)}
            </select>
          )}
          <Link to="/admin" className="elle-back">← DonutNV app</Link>
        </div>
      </header>

      {showLC && <LCConnect current={lc} onConnect={lcConnect} onDisconnect={lcDisconnect} onClose={() => setShowLC(false)} msg={lcMsg} />}
      {lcMsg && !showLC && <div className="elle-toast">{lcMsg}</div>}

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
          {!viewingAll && (
            <div className="elle-ctl-row" style={{ marginBottom: 6 }}>
              <span className="elle-sortlabel">View</span>
              <button className={`elle-sortbtn ${view === 'events' ? 'on' : ''}`} onClick={() => setView('events')}>Events</button>
              <button className={`elle-sortbtn ${view === 'recurring' ? 'on' : ''}`} onClick={() => setView('recurring')}>Recurring{recurringEvents.length ? ` (${recurringEvents.length})` : ''}</button>
              <button className={`elle-sortbtn ${view === 'businesses' ? 'on' : ''}`} onClick={() => setView('businesses')}>Businesses</button>
              <button className={`elle-sortbtn ${view === 'nonprofits' ? 'on' : ''}`} onClick={() => setView('nonprofits')}>Non-Profits</button>
              <button className={`elle-sortbtn ${view === 'market' ? 'on' : ''}`} onClick={() => setView('market')}>Market Report</button>
              {isSuper && <button className={`elle-sortbtn ${view === 'turned_down' ? 'on' : ''}`} style={{ marginLeft: 'auto' }} onClick={() => setView('turned_down')}>⚑ Turned down</button>}
            </div>
          )}
          {(view === 'events' || viewingAll) ? (
          <>
          <ScoreLegend />
          <div className="elle-controls">
            {lc.connected && !viewingAll && (
              <div className="elle-ctl-row">
                <span className="elle-sortlabel">Stage</span>
                {[['new', 'New'], ['working', 'Working'], ['done', 'Done']].map(([v, l]) => (
                  <button key={v} className={`elle-sortbtn ${stage === v ? 'on' : ''}`} onClick={() => setStage(v)}>{l}{stageCounts[v] ? ` (${stageCounts[v]})` : ''}</button>
                ))}
                <button className="elle-sortbtn" style={{ marginLeft: 'auto' }} onClick={syncLC} disabled={syncing} title="Pull Won/Lost status from LeadConnector">{syncing ? '↻ Syncing…' : '↻ Sync from LeadConnector'}</button>
              </div>
            )}
            <div className="elle-ctl-row">
              <span className="elle-sortlabel">Show</span>
              {[['all', 'All'], ['event', 'Public Events'], ['account', 'Outbound Accounts']].map(([v, l]) => (
                <button key={v} className={`elle-sortbtn ${seg === v ? 'on' : ''}`} onClick={() => setSeg(v)}>{l}</button>
              ))}
            </div>
            <div className="elle-ctl-row">
              <span className="elle-sortlabel">Sort</span>
              {[['score', 'Best match'], ['event', 'Soonest'], ['deadline', 'Deadline'], ['attendance', 'Most attendance']].map(([v, l]) => (
                <button key={v} className={`elle-sortbtn ${sort === v ? 'on' : ''}`} onClick={() => setSort(v)}>{l}</button>
              ))}
              {!viewingAll && presentTypes.length > 1 && (
                <button className={`elle-sortbtn ${showTypes ? 'on' : ''}`} style={{ marginLeft: 'auto' }} onClick={() => setShowTypes((s) => !s)}>
                  ⚙ Lead types{muted.length ? ` (${muted.length} hidden)` : ''}
                </button>
              )}
            </div>
            {showTypes && !viewingAll && (
              <div className="elle-types-panel">
                <div className="elle-types-hint">Uncheck a type to stop seeing it. We’ll always keep your board full.</div>
                {presentTypes.map((ty) => (
                  <label key={ty} className="elle-type-row">
                    <input type="checkbox" checked={!mutedSet.has(ty)} onChange={(e) => toggleMute(ty, !e.target.checked)} />
                    <span>{typeLabel(ty)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <Segment title="Public Events" tag="EVENTS" items={ev} onDecide={decide} showTerritory={viewingAll} onMute={toggleMute} readOnly={viewingAll} lcConnected={lc.connected && !viewingAll} onPush={pushToLC} onOutcome={setOutcome} onInfoBad={markInfoBad} onDismiss={viewingAll ? null : dismissLead} />
          <Segment title="Outbound Accounts" tag="ACCOUNTS" items={acct} onDecide={decide} showTerritory={viewingAll} onMute={toggleMute} readOnly={viewingAll} lcConnected={lc.connected && !viewingAll} onPush={pushToLC} onOutcome={setOutcome} onInfoBad={markInfoBad} onDismiss={viewingAll ? null : dismissLead} />
          {ev.length === 0 && acct.length === 0 && (
            <div className="elle-note">
              {events.length === 0
                ? 'No leads surfaced yet. ELLE re-scans your territory regularly, check back soon.'
                : activeStage === 'new'
                  ? `You're all caught up. Every lead is in progress or closed. ELLE keeps scanning ${tenant?.franchise_name || 'your territory'} for new events and they'll appear here.`
                  : activeStage === 'working'
                    ? 'Nothing in progress. Send leads from New to start working them in LeadConnector.'
                    : 'No closed leads yet. As you mark leads Won or Not reached, they land here.'}
            </div>
          )}
          </>
          ) : view === 'recurring' ? (
            <RecurringBoard items={recurringEvents} onDismiss={viewingAll ? null : dismissLead} />
          ) : view === 'turned_down' ? (
            <TurnedDownBoard rows={turnedDown} showTerritory={selected === 'ALL'} />
          ) : view === 'businesses' ? (
            <BusinessBoard businesses={businesses} bucket={bizBucket} setBucket={setBizBucket} onDecision={viewingAll ? null : setBizDecision} onFind={viewingAll ? null : findContacts} />
          ) : view === 'nonprofits' ? (
            <NonProfitBoard businesses={businesses} kind={npKind} setKind={setNpKind} stage={npStage} setStage={setNpStage} onDecision={viewingAll ? null : setBizDecision} onFind={viewingAll ? null : findContacts} />
          ) : (
            <MarketReport market={market} />
          )}
        </main>
      )}
    </div>
  )
}

function BusinessBoard({ businesses, bucket, setBucket, onDecision, onFind }) {
  const BUCKETS = [['all', 'All'], ['100-200', '100–200'], ['200-500', '200–500'], ['500-1000', '500–1,000'], ['1000+', '1,000+']]
  // Non-profits live in their own tab now — keep this board to real catering businesses.
  const list = businesses.filter((b) => !b.is_fundraiser_target)
  const filtered = list.filter((b) => bucket === 'all' || b.size_bucket === bucket)
  return (
    <>
      <div className="elle-ctl-row" style={{ margin: '2px 0 6px' }}>
        <span className="elle-sortlabel">Size</span>
        {BUCKETS.map(([v, l]) => (
          <button key={v} className={`elle-sortbtn ${bucket === v ? 'on' : ''}`} onClick={() => setBucket(v)}>{l}</button>
        ))}
      </div>
      <section className="elle-seg">
        <div className="elle-seg-head"><span className="elle-eyebrow">BUSINESSES</span><h2>Catering accounts</h2><span className="elle-count">{filtered.length}</span></div>
        <div className="elle-grid">{filtered.map((b) => <BizCard key={b.id} b={b} onDecision={onDecision} onFind={onFind} />)}</div>
      </section>
      {list.length === 0 && <div className="elle-note">No businesses surfaced yet for this territory.</div>}
    </>
  )
}

const NP_KINDS = [['all', 'All'], ['school', '🏫 Schools'], ['church', '⛪ Churches'], ['charity', '💛 Charities']]
const NP_STAGES = [['all', 'All'], ['new', 'Not contacted'], ['contacted', 'Reached out'], ['talking', 'In conversation'], ['client', 'Active client'], ['revisit', 'Revisit']]
function NonProfitBoard({ businesses, kind, setKind, stage, setStage, onDecision, onFind }) {
  const orgs = businesses.filter((b) => b.is_fundraiser_target)
  const counts = { school: 0, church: 0, charity: 0 }
  for (const o of orgs) if (counts[o.org_type] != null) counts[o.org_type]++
  const inStage = (b) => stage === 'all' ? true : stage === 'new' ? !b.decision : b.decision === stage
  const newCount = orgs.filter((b) => !b.decision).length
  const filtered = orgs.filter((b) => (kind === 'all' || b.org_type === kind) && inStage(b))
    .sort((a, b) => (Number(b.review_count) || 0) - (Number(a.review_count) || 0))
  return (
    <>
      <div className="elle-note" style={{ marginTop: 0, marginBottom: 8 }}>
        💛 Schools, churches &amp; non-profits ELLE surfaced for FUNraising — pitch a give-back event and turn every sale into support for their cause.
      </div>
      <div className="elle-ctl-row" style={{ margin: '2px 0 6px' }}>
        <span className="elle-sortlabel">Type</span>
        {NP_KINDS.map(([v, l]) => (
          <button key={v} className={`elle-sortbtn ${kind === v ? 'on' : ''}`} onClick={() => setKind(v)}>{l}{v !== 'all' && counts[v] ? ` (${counts[v]})` : ''}</button>
        ))}
      </div>
      <div className="elle-ctl-row" style={{ margin: '2px 0 6px' }}>
        <span className="elle-sortlabel">Stage</span>
        {NP_STAGES.map(([v, l]) => (
          <button key={v} className={`elle-sortbtn ${stage === v ? 'on' : ''}`} onClick={() => setStage(v)}>{l}{v === 'new' && newCount ? ` (${newCount})` : ''}</button>
        ))}
      </div>
      <section className="elle-seg">
        <div className="elle-seg-head"><span className="elle-eyebrow">FUNRAISING</span><h2>Give-back targets</h2><span className="elle-count">{filtered.length}</span></div>
        <div className="elle-grid">{filtered.map((b) => <BizCard key={b.id} b={b} onDecision={onDecision} onFind={onFind} />)}</div>
      </section>
      {orgs.length === 0 && <div className="elle-note">No non-profits sourced yet for this territory. ELLE scans schools, churches &amp; charities as it runs.</div>}
    </>
  )
}

const SRC_LABEL = { apollo: 'Apollo', linkedin: 'LinkedIn', press: 'press · confirm' }
const ORG_BADGE = { school: '🏫 School', church: '⛪ Church', charity: '💛 Charity' }
function BizCard({ b, onDecision, onFind }) {
  const [busy, setBusy] = useState(null)
  const place = [b.city, b.zip].filter(Boolean).join(' · ')
  const dec = b.decision || null
  const decLabel = (BIZ_STAGES.find(([v]) => v === dec) || [])[1]
  const isBranch = b.enrichment_status === 'national_branch'
  async function run(kind) {
    if (busy) return
    setBusy(kind)
    try { await onFind(b.id, kind) } finally { setBusy(null) }
  }
  return (
    <article className={`elle-card ${dec ? 'st-' + dec : ''}`}>
      <div className="elle-card-top">
        {b.org_type
          ? <span className="elle-pill give-pill">{ORG_BADGE[b.org_type] || 'Org'}</span>
          : <span className="elle-pill owned">{b.size_bucket || '—'}</span>}
        {b.org_type
          ? (b.review_count ? <div className="elle-score">{Number(b.review_count).toLocaleString()}<span> reviews</span></div> : null)
          : (b.employee_count != null && <div className="elle-score">{Number(b.employee_count).toLocaleString()}<span> staff</span></div>)}
        {dec && <span className="elle-pill st-pill st-client">{decLabel}</span>}
      </div>
      <h3 className="elle-name has-site">
        {b.website
          ? <a href={b.website} target="_blank" rel="noreferrer" title="Open company website">{b.name}<span className="elle-name-ext"> ↗</span></a>
          : b.name}
      </h3>
      <div className="elle-meta">
        {b.industry && <span>{b.industry}</span>}
        {place && <span>{place}</span>}
      </div>
      <div className="elle-contact">
        {b.phone && <a className="elle-link" href={`tel:${b.phone}`}>{b.phone} (main)</a>}
        {(b.pocs || []).length ? (
          <div className="elle-pocs">
            {b.pocs.map((p, i) => (
              <div key={i} className={`elle-poc ${p.source === 'press' ? 'poc-press' : ''}`}>
                <div className="elle-poc-name">
                  {p.name}{p.title && <span className="elle-poc-title"> · {p.title}</span>}
                  {p.source && <span className={`elle-src src-${p.source}`}>{SRC_LABEL[p.source] || p.source}</span>}
                </div>
                {(p.email || p.phone || p.linkedin_url) && (
                  <div className="elle-poc-lines">
                    {p.email && <a className="elle-link" href={`mailto:${p.email}`}>{p.email}</a>}
                    {p.phone && <a className="elle-link" href={`tel:${p.phone}`}>{p.phone}</a>}
                    {p.linkedin_url && <a className="elle-link" href={p.linkedin_url} target="_blank" rel="noreferrer">{p.source === 'press' ? 'source ↗' : 'LinkedIn ↗'}</a>}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : <span className="elle-host muted">Contacts pending</span>}
      </div>
      {isBranch && (
        <div className="elle-branch-note">
          National employer — the on-site decision-maker often isn't in a database. Best moves: the Ocala CEP (Chamber) or the facility front desk. Or pull site staff below.
        </div>
      )}
      {onFind && (
        <div className="elle-find">
          <button className="elle-btn" disabled={!!busy} onClick={() => run('linkedin')}>{busy === 'linkedin' ? 'Searching…' : '🔎 Find on LinkedIn'}</button>
          <button className="elle-btn" disabled={!!busy} onClick={() => run('press')}>{busy === 'press' ? 'Searching…' : '📰 Find in press'}</button>
        </div>
      )}
      {onDecision && (
        <div className="elle-actions">
          {BIZ_STAGES.map(([v, l]) => (
            <button key={v} className={`elle-btn ${dec === v ? 'on ' + v : ''}`} onClick={() => onDecision(b.id, dec === v ? null : v)}>{l}</button>
          ))}
        </div>
      )}
    </article>
  )
}

function Segment({ title, tag, items, onDecide, showTerritory, onMute, readOnly, lcConnected, onPush, onOutcome, onInfoBad, onDismiss }) {
  if (!items.length) return null
  return (
    <section className="elle-seg">
      <div className="elle-seg-head"><span className="elle-eyebrow">{tag}</span><h2>{title}</h2><span className="elle-count">{items.length}</span></div>
      <div className="elle-grid">{items.map((e) => (
        <Card key={`${e.tenant_id || ''}-${e.event_id}`} e={e} onDecide={onDecide} showTerritory={showTerritory} onMute={onMute} readOnly={readOnly} lcConnected={lcConnected} onPush={onPush} onOutcome={onOutcome} onInfoBad={onInfoBad} onDismiss={onDismiss} />
      ))}</div>
    </section>
  )
}

function Card({ e, onDecide, showTerritory, onMute, readOnly, lcConnected, onPush, onOutcome, onInfoBad, onDismiss }) {
  const [showWhy, setShowWhy] = useState(false)
  const grade = gradeFor(e.score)
  const sc = e.score_components || null
  const dl = deadlineInfo(e.application_deadline)
  const place = [e.city, e.zip].filter(Boolean).join(' · ')
  const status = e.decision || null
  // Title links to the event's own page when we have one (application URL, else
  // the page ELLE discovered it on). When we have neither, we still link — to a
  // web search — because something beats nothing. Color signals which is which.
  const hasSite = !!(e.event_url && String(e.event_url).trim())
  const titleHref = hasSite
    ? e.event_url
    : `https://www.google.com/search?q=${encodeURIComponent([e.name, e.city, e.zip].filter(Boolean).join(' '))}`
  const titleCls = `elle-name ${hasSite ? 'has-site' : 'search-only'}${e.info_bad ? ' bad-info' : ''}`
  return (
    <article className={`elle-card grade-${grade} ${status ? 'st-' + status : ''} ${e._dim ? 'dim' : ''}`}>
      <div className="elle-card-top">
        <span className={`elle-grade g-${grade}`}>{grade}</span>
        <div className="elle-score">{Number(e.score) || 0}<span>/100</span></div>
        {sc && <button className="elle-why-toggle" onClick={() => setShowWhy((s) => !s)}>{showWhy ? 'hide' : 'why?'}</button>}
        {showTerritory && e.territory && <span className="elle-pill terr">{e.territory}</span>}
        {status && <span className={`elle-pill st-pill st-${status}`}>{STATUSES.find(([s]) => s === status)?.[1]}</span>}
        {e.territory_match && <span className={`elle-pill ${e.territory_match === 'owned' ? 'owned' : ''}`}>{e.territory_match}</span>}
        {dl.label && <span className={`elle-pill ${dl.soon ? 'soon' : ''} ${dl.past ? 'past' : ''}`}>{dl.label}</span>}
        {Number(e.cycle_count) > 0 && <span className="elle-pill returning" title="Recurring — back for a new cycle">↻ Returning</span>}
      </div>
      {Number(e.cycle_count) > 0 && e.prior_outcome === 'won' && (
        <div className="elle-rebook">🏆 You won this last year — get registered now for this year.</div>
      )}
      <h3 className={titleCls}>
        <a href={titleHref} target="_blank" rel="noreferrer"
           title={hasSite ? 'Open event website' : 'No website on file — search the web'}>
          {e.name}{hasSite ? <span className="elle-name-ext"> ↗</span> : <span className="elle-name-srch"> ⌕</span>}
        </a>
      </h3>
      <div className="elle-meta">
        {e.start_date && <span>{new Date(e.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
        {place && <span>{place}</span>}
        {e.estimated_attendance ? <span>~{Number(e.estimated_attendance).toLocaleString()} ppl</span> : null}
        {e.vendor_fee != null ? <span>fee ${Number(e.vendor_fee).toLocaleString()}</span> : null}
        {e.event_type ? <span>{typeLabel(e.event_type)}</span> : null}
      </div>
      {showWhy && sc && (
        <div className="elle-why">
          {(e.expected_bags != null || sc.expected_net != null) && (
            <div className="elle-why-econ">
              {e.expected_bags != null && <b>≈{Number(e.expected_bags).toLocaleString()} bags</b>}
              {sc.expected_net != null && <b>~${Number(sc.expected_net).toLocaleString()} net</b>}
              <span>projected for your truck</span>
            </div>
          )}
          <div className="elle-why-grid">
            {[['Profit', sc.economics, 35], ['Reachable', sc.actionability, 25], ['Territory', sc.territory, 20], ['Deadline', sc.deadline, 10], ['Data', sc.quality, 10]].map(([l, v, m]) => (
              <div key={l} className="elle-why-cell"><span>{l}</span><b>{v == null ? '—' : Math.round(Number(v))}/{m}</b></div>
            ))}
          </div>
        </div>
      )}
      <div className="elle-contact">
        {e.host_name ? <span className="elle-host">{e.host_name}</span> : <span className="elle-host muted">Contact pending</span>}
        {e.host_phone && <a className="elle-link" href={`tel:${e.host_phone}`}>{e.host_phone}</a>}
        {e.host_email && <a className="elle-link" href={`mailto:${e.host_email}`}>{e.host_email}</a>}
      </div>
      {e.apollo_contact_name && (
        <div className="elle-verified">
          <div className="elle-verified-head">✓ Verified contact · Apollo</div>
          <div className="elle-verified-name">{e.apollo_contact_name}{e.apollo_contact_title ? <span className="elle-verified-title"> · {e.apollo_contact_title}</span> : null}</div>
          <div className="elle-verified-lines">
            {e.apollo_contact_email && <a className="elle-link" href={`mailto:${e.apollo_contact_email}`}>{e.apollo_contact_email}</a>}
            {e.apollo_contact_phone && <a className="elle-link" href={`tel:${e.apollo_contact_phone}`}>{e.apollo_contact_phone}</a>}
            {e.apollo_linkedin_url && <a className="elle-link" href={e.apollo_linkedin_url} target="_blank" rel="noreferrer">LinkedIn ↗</a>}
          </div>
        </div>
      )}
      {!readOnly && (
        <>
          {/* Triage buttons only before a lead is worked in LeadConnector. */}
          {!e.pushed_at && !e.outcome && (
            <div className="elle-actions">
              {STATUSES.filter(([d]) => d !== 'booked' && d !== 'lost').map(([d, label]) => (
                <button key={d} className={`elle-btn ${status === d ? 'on ' + d : ''}`} onClick={() => onDecide(e.event_id, d, e.event_type)}>{label}</button>
              ))}
            </div>
          )}
          {/* Outcome is READ from LeadConnector, never set here. "Won" = the
              opportunity reached your Event Booked (Won) stage in LC. */}
          {lcConnected && onPush && (
            e.outcome === 'won'
              ? <span className="elle-lc-sent won" title={e.lc_stage || 'Event Booked (Won) in LeadConnector'}>🏆 Booked in LeadConnector{e.booking_revenue ? ` · $${Number(e.booking_revenue).toLocaleString()}` : ''}</span>
              : e.outcome === 'lost'
                ? <span className="elle-lc-sent lost" title={e.lc_stage || 'Event Lost in LeadConnector'}>✗ Event lost in LeadConnector</span>
                : e.pushed_at
                  ? <div className="elle-lc-working">
                      <span className="elle-lc-sent" title="Being worked in LeadConnector">✓ In LeadConnector{e.lc_stage ? ` · ${e.lc_stage}` : ''}</span>
                      <span className="elle-lc-note">Status syncs from LeadConnector</span>
                    </div>
                  : <button className="elle-lc-send" onClick={() => onPush(e.event_id)}>→ Send to LeadConnector</button>
          )}
          {onInfoBad && (
            e.info_bad
              ? <div className="elle-badinfo-row"><span className="elle-badinfo on">⚑ Marked bad info</span><button className="elle-mini" onClick={() => onInfoBad(e.event_id, false)}>undo</button></div>
              : <button className="elle-badinfo-btn" onClick={() => onInfoBad(e.event_id, true)} title="I reached out and this info was wrong">⚑ Info was bad</button>
          )}
          {onDismiss && (
            <button className="elle-dismiss" onClick={() => onDismiss(e.event_id)} title="Not interested — removes this lead and stops ELLE from enriching it going forward">✕ Not interested</button>
          )}
          {e.event_type && onMute && (
            <button className="elle-mute" onClick={() => onMute(e.event_type, true)}>Show me fewer {typeLabel(e.event_type)} leads</button>
          )}
        </>
      )}
    </article>
  )
}

function RecurringBoard({ items, onDismiss }) {
  const rebook = items.filter((e) => e.prior_outcome === 'won')
  const recycle = items.filter((e) => e.prior_outcome !== 'won')
  return (
    <>
      <div className="elle-note" style={{ marginTop: 2 }}>
        Recurring leads waiting for their next cycle. ELLE holds them here with everything it already learned, then moves them back to your board as registration opens.
      </div>
      <RecurSection title="Rebook — you won these before" tag="HIGH PRIORITY" items={rebook} onDismiss={onDismiss} won />
      <RecurSection title="Recycle — didn't land last time" tag="WATCH" items={recycle} onDismiss={onDismiss} />
      {items.length === 0 && <div className="elle-note">Nothing recurring yet. As events pass, the ones worth another shot collect here automatically.</div>}
    </>
  )
}

function RecurSection({ title, tag, items, onDismiss, won }) {
  if (!items.length) return null
  return (
    <section className="elle-seg">
      <div className="elle-seg-head"><span className="elle-eyebrow">{tag}</span><h2>{title}</h2><span className="elle-count">{items.length}</span></div>
      <div className="elle-grid">{items.map((e) => (
        <article key={e.event_id} className={`elle-card ${won ? 'grade-A' : ''}`}>
          <div className="elle-card-top">
            <span className="elle-pill returning">↻ {won ? 'Rebook' : 'Recycle'}</span>
            {e.start_date && <span className="elle-pill">next ~{new Date(e.start_date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>}
          </div>
          <h3 className="elle-name has-site">{e.event_url ? <a href={e.event_url} target="_blank" rel="noreferrer">{e.name}</a> : e.name}</h3>
          <div className="elle-meta">
            {e.city && <span>{e.city}</span>}
            {e.event_type && <span>{typeLabel(e.event_type)}</span>}
            {e.estimated_attendance ? <span>~{Number(e.estimated_attendance).toLocaleString()} ppl</span> : null}
          </div>
          {won && <div className="elle-rebook">🏆 You won this last year — ELLE will resurface it on your board when registration opens.</div>}
          <div className="elle-contact">
            {e.host_name ? <span className="elle-host">{e.host_name}</span> : null}
            {e.host_email && <a className="elle-link" href={`mailto:${e.host_email}`}>{e.host_email}</a>}
            {e.host_phone && <a className="elle-link" href={`tel:${e.host_phone}`}>{e.host_phone}</a>}
          </div>
          {onDismiss && <button className="elle-dismiss" onClick={() => onDismiss(e.event_id)} title="Stop recycling this one">✕ Don't recycle</button>}
        </article>
      ))}</div>
    </section>
  )
}

function TurnedDownBoard({ rows, showTerritory }) {
  return (
    <>
      <div className="elle-note" style={{ marginTop: 2 }}>
        Every lead this territory turned down. Admin-only. If a Z says ELLE isn't delivering, this is what they passed on.
      </div>
      {rows.length === 0 ? <div className="elle-note">No leads have been dismissed here.</div> : (
        <section className="elle-seg">
          <div className="elle-seg-head"><span className="elle-eyebrow">TURNED DOWN</span><h2>Dismissed leads</h2><span className="elle-count">{rows.length}</span></div>
          <div className="elle-grid">{rows.map((r) => (
            <article key={`${r.tenant_id}-${r.event_id}`} className="elle-card dim">
              <div className="elle-card-top">
                {r.score != null && <div className="elle-score">{Number(r.score) || 0}<span>/100</span></div>}
                {showTerritory && r.franchise && <span className="elle-pill terr">{r.franchise}</span>}
                {r.prior_outcome === 'won' && <span className="elle-pill st-won">was won</span>}
              </div>
              <h3 className="elle-name">{r.name || 'Event'}</h3>
              <div className="elle-meta">
                {r.city && <span>{r.city}</span>}
                {r.event_type && <span>{typeLabel(r.event_type)}</span>}
                {r.estimated_attendance ? <span>~{Number(r.estimated_attendance).toLocaleString()} ppl</span> : null}
                {r.dismissed_at && <span>dropped {new Date(r.dismissed_at).toLocaleDateString()}</span>}
              </div>
            </article>
          ))}</div>
        </section>
      )}
    </>
  )
}

function MarketReport({ market }) {
  if (!market) return <div className="elle-note">No market report yet for this territory. ELLE builds one on setup and refreshes it every 6 months.</div>
  const ov = market.overview || {}
  return (
    <div className="elle-market">
      <div className="elle-mkt-head">
        <span className="elle-eyebrow">MARKET REPORT</span>
        <h2>{market.territory || 'Territory'}</h2>
      </div>
      {(ov.population || ov.median_income || ov.character) && (
        <div className="elle-mkt-stats">
          {ov.population && <div className="elle-mkt-stat"><span>Population</span><b>{ov.population}</b></div>}
          {ov.median_income && <div className="elle-mkt-stat"><span>Median income</span><b>{ov.median_income}</b></div>}
          {ov.character && <div className="elle-mkt-stat wide"><span>Character</span><b>{ov.character}</b></div>}
        </div>
      )}
      {market.summary && <p className="elle-mkt-summary">{market.summary}</p>}

      {Array.isArray(market.employers) && market.employers.length > 0 && (
        <section className="elle-seg">
          <div className="elle-seg-head"><span className="elle-eyebrow">EMPLOYERS</span><h2>Major employers (100+)</h2><span className="elle-count">{market.employers.length}</span></div>
          <div className="elle-mkt-emps">
            {market.employers.map((e, i) => (
              <div className="elle-mkt-emp" key={i}>
                <div className="elle-mkt-emp-top"><span className="elle-mkt-emp-name">{e.name}</span>{e.employees != null && <span className="elle-pill owned">{typeof e.employees === 'number' ? Number(e.employees).toLocaleString() : e.employees} staff</span>}</div>
                <div className="elle-mkt-emp-meta">{[e.sector, e.note].filter(Boolean).join(' · ')}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {Array.isArray(market.nonprofits) && market.nonprofits.length > 0 && (
        <section className="elle-seg">
          <div className="elle-seg-head"><span className="elle-eyebrow">FUNRAISING</span><h2>Schools, churches &amp; non-profits</h2><span className="elle-count">{market.nonprofits.length}</span></div>
          <div className="elle-mkt-emps">
            {market.nonprofits.map((o, i) => (
              <div className="elle-mkt-emp" key={i}>
                <div className="elle-mkt-emp-top"><span className="elle-mkt-emp-name">{o.name}</span>{o.type && <span className="elle-pill give-pill">{o.type}</span>}</div>
                {o.note && <div className="elle-mkt-emp-meta">{o.note}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="elle-mkt-cols">
        {Array.isArray(market.venues) && market.venues.length > 0 && (
          <section className="elle-mkt-col">
            <div className="elle-seg-head"><span className="elle-eyebrow">VENUES</span><h2>Key venues</h2></div>
            {market.venues.map((v, i) => (
              <div className="elle-mkt-line" key={i}><span className="elle-mkt-line-name">{v.name}</span>{v.type && <span className="elle-mkt-line-sub">{v.type}</span>}</div>
            ))}
          </section>
        )}
        {Array.isArray(market.event_hosts) && market.event_hosts.length > 0 && (
          <section className="elle-mkt-col">
            <div className="elle-seg-head"><span className="elle-eyebrow">EVENT HOSTS</span><h2>Recurring events</h2></div>
            {market.event_hosts.map((h, i) => (
              <div className="elle-mkt-line" key={i}><span className="elle-mkt-line-name">{h.name}</span>{h.timing && <span className="elle-mkt-line-sub">{h.timing}</span>}</div>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}

function LCConnect({ current, onConnect, onDisconnect, onClose, msg }) {
  const [token, setToken] = useState('')
  const [loc, setLoc] = useState('')
  return (
    <div className="elle-modal-bg" onClick={onClose}>
      <div className="elle-modal" onClick={(e) => e.stopPropagation()}>
        <button className="elle-modal-x" onClick={onClose}>×</button>
        <h2>Connect LeadConnector</h2>
        {current.connected ? (
          <>
            <div className="elle-lc-ok">Connected ✓{current.push_count ? ` · ${current.push_count} leads sent` : ''}</div>
            <p className="elle-modal-p">Leads you send land in your LeadConnector as contacts tagged <b>elle-lead</b>{current.location_id ? `, on location ${current.location_id}` : ''}. Use the “→ Send to LeadConnector” button on any lead.</p>
            <button className="elle-modal-danger" onClick={onDisconnect}>Disconnect</button>
          </>
        ) : (
          <>
            <p className="elle-modal-p">Paste your LeadConnector details and we’ll push event leads straight into your account. Your token is stored securely and never shown again.</p>
            <ol className="elle-lc-steps">
              <li>In LeadConnector: <b>Settings → Private Integrations → Create</b>.</li>
              <li>Give it access to Contacts and Opportunities, then copy the <b>token</b>.</li>
              <li>Grab your <b>Location ID</b> from Settings → Business Profile.</li>
            </ol>
            <label className="elle-field"><span>LeadConnector token</span>
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="pit-..." autoComplete="off" /></label>
            <label className="elle-field"><span>Location ID</span>
              <input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="e.g. abcd1234EFGH" autoComplete="off" /></label>
            {msg && <div className="elle-note elle-err" style={{ margin: '10px 0' }}>{msg}</div>}
            <button className="elle-cta" disabled={!token || !loc} onClick={() => onConnect(token.trim(), loc.trim())}>Connect</button>
          </>
        )}
      </div>
    </div>
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
.elle-top-right{display:flex;align-items:center;gap:10px}
.elle-switch{background:#0e151e;border:1px solid #1f2a37;color:#e6edf3;border-radius:8px;
  padding:7px 10px;font-size:.8rem;font-family:inherit;cursor:pointer;max-width:220px}
.elle-switch:focus{outline:none;border-color:#22d3ee}
.elle-switch:hover{border-color:#2b3a4d}
.elle-main{padding:18px 20px 60px;max-width:1100px;margin:0 auto}
.elle-sortbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:2px 0 4px}
.elle-sortlabel{color:#5e7188;font-size:.7rem;text-transform:uppercase;letter-spacing:.14em;margin-right:2px}
.elle-sortbtn{background:#0e151e;border:1px solid #1f2a37;color:#8b9bb0;border-radius:20px;
  padding:6px 13px;font-size:.78rem;cursor:pointer;font-family:inherit}
.elle-sortbtn:hover{border-color:#2b3a4d;color:#e6edf3}
.elle-sortbtn.on{background:rgba(34,211,238,.12);border-color:#22d3ee;color:#a5f3ef}
.elle-controls{display:flex;flex-direction:column;gap:8px;margin:2px 0 6px}
.elle-legend{display:flex;flex-wrap:wrap;align-items:center;gap:7px 14px;background:#111824;
  border:1px solid #1f2a37;border-radius:12px;padding:9px 13px;margin:0 0 10px}
.elle-legend-grades{display:flex;gap:6px;flex-wrap:wrap}
.elle-legend .lg{font-size:.72rem;font-weight:800;border-radius:6px;padding:2px 7px;border:1px solid}
.elle-legend .g-A{color:#22d3ee;border-color:#22d3ee;background:rgba(34,211,238,.10)}
.elle-legend .g-B{color:#86efac;border-color:#22c55e;background:rgba(34,197,94,.10)}
.elle-legend .g-C{color:#fde68a;border-color:#f59e0b;background:rgba(245,158,11,.10)}
.elle-legend .g-D{color:#fdba74;border-color:#fb923c;background:rgba(251,146,60,.08)}
.elle-legend .g-F{color:#94a3b8;border-color:#475569;background:rgba(148,163,184,.06)}
.elle-legend-weights{display:flex;flex-wrap:wrap;align-items:center;gap:5px;color:#8b9bb0;font-size:.74rem}
.elle-legend-weights b{color:#cbd5e1;font-weight:700}
.elle-legend-weights i{color:#43536a;font-style:normal}
.elle-legend-weights span{color:#5e7188;text-transform:uppercase;letter-spacing:.08em;font-size:.68rem}
.elle-pill.give-pill{color:#fbbf24;border-color:rgba(251,191,36,.55);background:rgba(251,191,36,.12)}
.elle-ctl-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.elle-types-panel{background:#111824;border:1px solid #1f2a37;border-radius:12px;padding:12px 14px;
  display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px 14px}
.elle-types-hint{grid-column:1/-1;color:#8b9bb0;font-size:.78rem;margin-bottom:2px}
.elle-type-row{display:flex;align-items:center;gap:8px;color:#cbd5e1;font-size:.82rem;cursor:pointer}
.elle-type-row input{accent-color:#22d3ee}
.elle-pill.terr{margin-left:auto;color:#a5b4fc;border-color:#4453a8;background:rgba(99,102,241,.12)}
.st-pill{margin-left:6px}
.st-pill.st-apply{color:#a5f3ef;border-color:#22d3ee}
.st-pill.st-waitlist{color:#fde68a;border-color:#fbbf24}
.st-pill.st-booked{color:#86efac;border-color:#22c55e;background:rgba(34,197,94,.12)}
.st-pill.st-lost,.st-pill.st-pass{color:#94a3b8;border-color:#475569}
.elle-card.st-booked{box-shadow:inset 0 0 0 1px rgba(34,197,94,.45)}
.elle-card.st-apply{box-shadow:inset 0 0 0 1px rgba(34,211,238,.35)}
.elle-card.st-lost,.elle-card.st-pass{opacity:.72}
.elle-card.dim{opacity:.5}
.elle-actions{flex-wrap:wrap}
.elle-actions .elle-btn{padding:7px 5px;font-size:.75rem}
.elle-btn.on.booked{background:rgba(34,197,94,.16);border-color:#22c55e;color:#86efac}
.elle-btn.on.lost{background:rgba(148,163,184,.12);border-color:#64748b;color:#cbd5e1}
.elle-mute{margin-top:8px;width:100%;background:none;border:none;color:#5e7188;font-size:.74rem;
  cursor:pointer;text-align:center;padding:4px}
.elle-mute:hover{color:#8b9bb0;text-decoration:underline}
.elle-lc-chip{background:#0e151e;border:1px solid #1f2a37;color:#8b9bb0;border-radius:8px;
  padding:7px 12px;font-size:.8rem;cursor:pointer;font-family:inherit}
.elle-lc-chip:hover{border-color:#2b3a4d;color:#e6edf3}
.elle-lc-chip.on{color:#86efac;border-color:#22c55e;background:rgba(34,197,94,.1)}
.elle-lc-send{margin-top:8px;width:100%;background:rgba(34,197,94,.12);border:1px solid #22c55e;
  color:#86efac;border-radius:8px;padding:8px;font-size:.8rem;cursor:pointer}
.elle-lc-send:hover{background:rgba(34,197,94,.2)}
.elle-lc-sent{margin-top:8px;width:100%;box-sizing:border-box;display:block;text-align:center;
  background:rgba(139,155,176,.1);border:1px dashed #2b3a4d;color:#86efac;border-radius:8px;
  padding:8px;font-size:.8rem;font-weight:600}
.elle-lc-sent.won{color:#fde68a;border-color:#f59e0b;background:rgba(245,158,11,.14);border-style:solid}
.elle-lc-sent.lost{color:#cbd5e1;background:rgba(139,155,176,.08);flex:1}
.elle-lc-outcome{display:flex;gap:6px;margin-top:6px;align-items:stretch}
.elle-mini{flex:1;background:#0e151e;border:1px solid #1f2a37;color:#8b9bb0;border-radius:6px;
  padding:6px;font-size:.72rem;font-weight:600;cursor:pointer}
.elle-mini:hover{border-color:#2b3a4d;color:#e6edf3}
.elle-mini.won{color:#86efac;border-color:#22c55e;background:rgba(34,197,94,.1)}
.elle-toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:20;
  background:#111824;border:1px solid #2b3a4d;color:#e6edf3;padding:11px 18px;border-radius:10px;font-size:.85rem}
.elle-modal-bg{position:fixed;inset:0;z-index:30;background:rgba(4,7,10,.72);
  display:flex;align-items:center;justify-content:center;padding:20px}
.elle-modal{background:#0e151e;border:1px solid #1f2a37;border-radius:16px;padding:26px 24px;
  max-width:440px;width:100%;position:relative}
.elle-modal h2{margin:0 0 12px;font-size:1.2rem}
.elle-modal-x{position:absolute;top:12px;right:14px;background:none;border:none;color:#5e7188;
  font-size:1.4rem;cursor:pointer;line-height:1}
.elle-modal-p{color:#aebccf;font-size:.88rem;line-height:1.5;margin:0 0 14px}
.elle-lc-steps{color:#aebccf;font-size:.82rem;line-height:1.6;margin:0 0 16px;padding-left:20px}
.elle-lc-ok{color:#86efac;background:rgba(34,197,94,.1);border:1px solid #22c55e;border-radius:10px;
  padding:10px 14px;font-size:.9rem;margin-bottom:12px}
.elle-modal-danger{margin-top:14px;background:none;border:1px solid #7f1d1d;color:#fca5a5;
  border-radius:9px;padding:9px 14px;font-size:.85rem;cursor:pointer}
.elle-modal-danger:hover{background:rgba(127,29,29,.2)}
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
.elle-why-toggle{background:none;border:1px solid #2b3a4d;color:#8b9bb0;border-radius:6px;font-size:.68rem;padding:2px 7px;cursor:pointer;font-family:inherit}
.elle-why-toggle:hover{border-color:#22d3ee;color:#a5f3ef}
.elle-why{margin:8px 0 2px;background:#0e151e;border:1px solid #1f2a37;border-radius:10px;padding:9px 11px}
.elle-why-econ{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;margin-bottom:8px}
.elle-why-econ b{color:#86efac;font-size:.95rem;font-family:ui-monospace,monospace}
.elle-why-econ span{color:#5e7188;font-size:.72rem}
.elle-why-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
.elle-why-cell{text-align:center;background:#111824;border-radius:7px;padding:6px 3px}
.elle-why-cell span{display:block;color:#5e7188;font-size:.62rem;text-transform:uppercase;letter-spacing:.03em}
.elle-why-cell b{display:block;color:#cbd5e1;font-size:.82rem;margin-top:2px;font-family:ui-monospace,monospace}
@media (max-width:640px){.elle-why-grid{grid-template-columns:repeat(3,1fr)}}
.elle-pill{margin-left:auto;font-size:.66rem;letter-spacing:.05em;text-transform:uppercase;
  color:#8b9bb0;border:1px solid #28384a;border-radius:20px;padding:3px 9px}
.elle-pill.owned{color:#5eead4;border-color:rgba(34,211,238,.4)}
.elle-pill.soon{color:#fcd34d;border-color:rgba(251,191,36,.45)}
.elle-pill.past{color:#fca5a5;border-color:#7f1d1d}
.elle-pill+.elle-pill{margin-left:6px}
.elle-name{font-size:1rem;margin:11px 0 7px;line-height:1.3}
.elle-name a{text-decoration:none;color:inherit}
.elle-name a:hover{text-decoration:underline}
.elle-name.has-site a{color:#38bdf8}
.elle-name.search-only a{color:#d9a441}
.elle-name.bad-info a{color:#f2647a;text-decoration:line-through}
.elle-name-ext{font-size:.72rem;opacity:.7}
.elle-name-srch{font-size:.78rem;opacity:.6}
.elle-badinfo-btn{margin-top:8px;width:100%;background:none;border:1px dashed #3a2732;color:#b06b7d;font-size:.74rem;border-radius:7px;padding:6px 8px;cursor:pointer}
.elle-badinfo-btn:hover{border-color:#6b3b48;color:#e0899c;background:#1a1014}
.elle-badinfo-row{display:flex;align-items:center;gap:8px;margin-top:8px}
.elle-badinfo{flex:1;font-size:.74rem;color:#f2647a;background:#241017;border:1px solid #4a2530;border-radius:7px;padding:6px 8px;text-align:center}
.elle-verified{margin-top:9px;padding:9px 10px;background:#0c1a14;border:1px solid #1f4535;border-radius:8px}
.elle-verified-head{font-size:.66rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#34d399;margin-bottom:3px}
.elle-verified-name{font-size:.86rem;color:#e8f2ee;font-weight:600}
.elle-verified-title{color:#8fb3a5;font-weight:400}
.elle-verified-lines{display:flex;flex-direction:column;gap:2px;margin-top:4px}
.elle-verified-lines .elle-link{color:#6ee7b7}
.elle-lc-working{display:flex;flex-direction:column;gap:2px;margin-top:8px}
.elle-lc-note{font-size:.68rem;color:#5e7188}
.elle-poc{margin-top:7px}
.elle-poc-lines{display:flex;flex-direction:column;gap:1px;margin-top:2px}
.elle-poc-lines .elle-link{font-size:.78rem}
.elle-src{margin-left:6px;font-size:.62rem;text-transform:uppercase;letter-spacing:.04em;padding:1px 5px;border-radius:6px;vertical-align:middle;font-weight:700}
.src-apollo{background:rgba(56,189,248,.14);color:#38bdf8}
.src-linkedin{background:rgba(45,120,255,.16);color:#5b8dff}
.src-press{background:rgba(217,164,65,.16);color:#d9a441}
.elle-poc.poc-press .elle-poc-name{opacity:.85}
.elle-branch-note{margin-top:8px;font-size:.76rem;line-height:1.35;color:#c9b48a;background:rgba(217,164,65,.08);border:1px solid rgba(217,164,65,.22);border-radius:8px;padding:7px 9px}
.elle-find{display:flex;gap:6px;margin-top:8px}
.elle-find .elle-btn{flex:1;font-size:.76rem}
.elle-find .elle-btn:disabled{opacity:.55;cursor:default}
.elle-rebook{margin:6px 0 2px;padding:6px 9px;background:#0f1a10;border:1px solid #2f5a37;border-radius:8px;color:#7ee0a0;font-size:.76rem;font-weight:600}
.elle-pill.returning{background:#12261c;color:#5fd28c;border:1px solid #2f5a37}
.elle-dismiss{margin-top:8px;width:100%;background:none;border:1px solid #3a2732;color:#9a7080;font-size:.72rem;border-radius:7px;padding:6px 8px;cursor:pointer}
.elle-dismiss:hover{border-color:#6b3b48;color:#d089a0;background:#160f13}
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
.elle-pocs{display:flex;flex-direction:column;gap:5px;margin-top:4px}
.elle-poc{display:flex;flex-direction:column;line-height:1.25}
.elle-poc-name{color:#cbd5e1;font-size:.82rem;font-weight:600}
.elle-poc-title{color:#8b9bb0;font-size:.74rem}
.elle-market{margin-top:6px}
.elle-mkt-head h2{font-size:1.25rem;margin:6px 0 12px}
.elle-mkt-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:14px}
.elle-mkt-stat{background:#111824;border:1px solid #1f2a37;border-radius:12px;padding:12px 14px}
.elle-mkt-stat.wide{grid-column:1/-1}
.elle-mkt-stat span{display:block;color:#5e7188;font-size:.68rem;text-transform:uppercase;letter-spacing:.12em;margin-bottom:4px}
.elle-mkt-stat b{color:#e6edf3;font-size:.95rem;font-weight:600}
.elle-mkt-summary{color:#aebccf;font-size:.9rem;line-height:1.55;background:#111824;border:1px solid #1f2a37;border-radius:12px;padding:14px 16px;margin:0 0 8px}
.elle-mkt-emps{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;margin-top:12px}
.elle-mkt-emp{background:#111824;border:1px solid #1f2a37;border-radius:12px;padding:12px 14px}
.elle-mkt-emp-top{display:flex;align-items:center;gap:8px}
.elle-mkt-emp-name{color:#e6edf3;font-size:.92rem;font-weight:600;flex:1}
.elle-mkt-emp-meta{color:#8b9bb0;font-size:.78rem;margin-top:5px;line-height:1.4}
.elle-mkt-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px;margin-top:8px}
.elle-mkt-line{padding:8px 0;border-bottom:1px solid #1b2531}
.elle-mkt-line-name{display:block;color:#cbd5e1;font-size:.86rem;font-weight:600}
.elle-mkt-line-sub{display:block;color:#8b9bb0;font-size:.76rem;margin-top:1px}
/* ── Phone layout: kill the horizontal slide, shrink + stack the header ── */
@media (max-width:640px){
  .elle{overflow-x:hidden}
  .elle *{min-width:0}
  .elle-top{flex-direction:column;align-items:stretch;gap:9px;padding:11px 13px}
  .elle-wordmark{font-size:1.12rem;letter-spacing:.1em}
  .elle-sub{font-size:.72rem}
  .elle-top-right{flex-wrap:wrap;gap:8px}
  .elle-top-right .elle-switch{flex:1 1 140px;max-width:none}
  .elle-back{margin-left:auto}
  .elle-main{padding:14px 13px 64px}
  .elle-grid{grid-template-columns:1fr;gap:12px}
  .elle-mkt-emps,.elle-mkt-cols{grid-template-columns:1fr;gap:12px}
  .elle a,.elle-link,.elle-poc-name,.elle-name{overflow-wrap:anywhere}
}
`
