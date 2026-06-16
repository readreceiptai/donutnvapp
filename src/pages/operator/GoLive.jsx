import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { blacklistedZone } from '../../lib/geo'

// ── Operator "Go Live" — the truck's broadcast control ──
// Built around one principle from the plan: tie broadcasting to a deliberate
// action + auto-expiry + geofences, never to the operator's memory.
//
//   • DEFAULT OFF — nothing broadcasts until the operator taps Open.
//   • AUTO-EXPIRE — every session has an end time and shuts itself off.
//   • BLACKLISTED ZONES — inside home/commissary, location is NOT posted.
//   • PRIVATE EVENT GO-DARK — one tap pauses public broadcast.
//   • LOUD LIVE INDICATOR + NUDGE — hard to forget you're live.
//   • KILL — stop instantly (admins can also stop any truck from the dashboard).

const POST_EVERY_MS = 20000      // push GPS every 20s
const DEFAULT_HOURS = 3          // default auto-expire window
const NUDGE_AFTER_MS = 45 * 60000 // remind after 45 min live

export default function GoLive() {
  const { profile, tenant } = useAuth()
  const [truck, setTruck] = useState(null)
  const [stops, setStops] = useState([])
  const [zones, setZones] = useState([])
  const [session, setSession] = useState(null)   // current live session row
  const [stopName, setStopName] = useState('')
  const [hours, setHours] = useState(DEFAULT_HOURS)
  const [paused, setPaused] = useState(false)     // private-event go-dark
  const [status, setStatus] = useState('')        // ticker line
  const [suppressed, setSuppressed] = useState(false) // inside a blacklist zone
  const [startedAt, setStartedAt] = useState(null)
  const [now, setNow] = useState(Date.now())
  const watchId = useRef(null)
  const lastPost = useRef(0)
  const wakeLock = useRef(null)

  // Load this operator's truck, today's stops, and blacklist zones.
  useEffect(() => {
    if (!profile) return
    ;(async () => {
      const { data: trucks } = await supabase.from('trucks').select('*')
        .eq('tenant_id', profile.tenant_id).eq('is_active', true).limit(1)
      setTruck(trucks?.[0] || null)
      const { data: sched } = await supabase.from('scheduled_stops').select('*')
        .eq('tenant_id', profile.tenant_id).gte('ends_at', new Date().toISOString())
        .order('starts_at').limit(10)
      setStops(sched || [])
      const { data: bl } = await supabase.from('geofence_blacklist').select('*')
        .eq('tenant_id', profile.tenant_id)
      setZones(bl || [])
      // Resume an already-open session if the operator reloads the page.
      const { data: live } = await supabase.from('active_live_sessions').select('*')
        .eq('tenant_id', profile.tenant_id).limit(1)
      if (live?.[0]) { setSession(live[0]); setStartedAt(new Date(live[0].started_at).getTime()); startWatch(live[0]); acquireWakeLock() }
    })()
    return stopWatch
  }, [profile]) // eslint-disable-line

  // 1-second clock for the live timer + auto-expire check.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Auto-expire: if we pass ends_at, shut it off.
  useEffect(() => {
    if (session?.ends_at && Date.now() > new Date(session.ends_at).getTime()) {
      stop('Session ended automatically (auto-expire).')
    }
  }, [now]) // eslint-disable-line

  // Wake Lock releases itself whenever the tab is hidden; re-grab it when the
  // operator comes back to the screen so the phone stays awake again.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && session) acquireWakeLock() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [session]) // eslint-disable-line

  const postLocation = useCallback(async (sess, coords) => {
    const pos = { lat: coords.latitude, lng: coords.longitude }
    const zone = blacklistedZone(pos, zones)
    if (zone) {
      setSuppressed(true)
      setStatus(`🛑 Hidden — you're inside "${zone.label}". Location is NOT being shared.`)
      return
    }
    setSuppressed(false)
    if (paused) { setStatus('⏸️ Private mode — broadcast paused.'); return }
    const t = Date.now()
    if (t - lastPost.current < POST_EVERY_MS) return
    lastPost.current = t
    await supabase.from('truck_locations').insert({
      tenant_id: sess.tenant_id, truck_id: sess.truck_id, session_id: sess.id,
      lat: pos.lat, lng: pos.lng,
    })
    setStatus(`📍 Sharing your location • updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)
  }, [zones, paused])

  function startWatch(sess) {
    if (!('geolocation' in navigator)) { setStatus('This device has no GPS.'); return }
    stopWatch()
    watchId.current = navigator.geolocation.watchPosition(
      (p) => postLocation(sess, p.coords),
      (e) => setStatus('Location error: ' + e.message),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    )
  }
  function stopWatch() {
    if (watchId.current != null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null }
  }

  // Keep the screen awake while live so a mounted/plugged-in phone never
  // auto-locks (the #1 cause of dropped tracking). Released on Close.
  async function acquireWakeLock() {
    try { if ('wakeLock' in navigator) wakeLock.current = await navigator.wakeLock.request('screen') } catch { /* unsupported or denied */ }
  }
  function releaseWakeLock() {
    try { wakeLock.current && wakeLock.current.release() } catch { /* noop */ }
    wakeLock.current = null
  }

  async function open() {
    if (!truck) { setStatus('No truck set up for this territory yet.'); return }
    const ends = new Date(Date.now() + hours * 3600000).toISOString()
    const { data, error } = await supabase.from('live_sessions').insert({
      tenant_id: profile.tenant_id, truck_id: truck.id,
      stop_name: stopName || 'On location', is_live: true,
      started_at: new Date().toISOString(), ends_at: ends, source: 'manual',
    }).select().single()
    if (error) { setStatus(error.message); return }
    setSession(data); setStartedAt(Date.now()); setPaused(false)
    startWatch(data)
    acquireWakeLock()
  }

  async function stop(msg) {
    if (session) {
      await supabase.from('live_sessions').update({ is_live: false, ends_at: new Date().toISOString() }).eq('id', session.id)
    }
    stopWatch()
    releaseWakeLock()
    setSession(null); setStartedAt(null); setPaused(false); setSuppressed(false)
    setStatus(msg || 'You are closed. Nothing is broadcasting.')
  }

  async function togglePause() {
    const next = !paused
    setPaused(next)
    if (session) await supabase.from('live_sessions').update({ is_live: !next }).eq('id', session.id)
    setStatus(next ? '⏸️ Private mode ON — you are hidden from customers.' : '▶️ Back live.')
  }

  const isLive = !!session
  const elapsed = startedAt ? Math.floor((now - startedAt) / 1000) : 0
  const remaining = session?.ends_at ? Math.max(0, Math.floor((new Date(session.ends_at).getTime() - now) / 1000)) : 0
  const showNudge = isLive && elapsed * 1000 > NUDGE_AFTER_MS

  return (
    <div className="pad-top stack">
      <h1>Go live</h1>

      {!isLive ? (
        <div className="card card-accent stack">
          <p className="muted" style={{ margin: 0 }}>
            You're <b>closed</b>. Nothing is shared with customers until you tap Open.
          </p>
          <div className="field" style={{ margin: 0 }}>
            <label>Where are you?</label>
            {stops.length > 0 && (
              <select value={stopName} onChange={(e) => setStopName(e.target.value)}>
                <option value="">Type below, or pick a scheduled stop…</option>
                {stops.map((s) => <option key={s.id} value={s.stop_name}>{s.stop_name}</option>)}
              </select>
            )}
            <input style={{ marginTop: 8 }} placeholder="e.g. Pop Stansell Park" value={stopName} onChange={(e) => setStopName(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Auto-close after</label>
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((h) => <option key={h} value={h}>{h} hour{h > 1 ? 's' : ''}</option>)}
            </select>
            <div className="hint">It shuts off by itself — nothing ever broadcasts overnight.</div>
          </div>
          <button className="btn btn-primary" onClick={open} style={{ fontSize: '1.2rem', minHeight: 60 }}>🟢 Open — start sharing</button>
          {zones.length > 0 && <div className="success">🛡️ {zones.length} no-broadcast zone{zones.length > 1 ? 's' : ''} active (home/commissary stay hidden automatically).</div>}
        </div>
      ) : (
        <>
          <div className="card" style={{ background: suppressed ? '#fff4e5' : 'var(--red)', color: suppressed ? 'var(--ink)' : '#fff', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: '1.4rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <span className="dot dot-live" style={{ width: 14, height: 14 }} />
              {suppressed ? 'HIDDEN (no-broadcast zone)' : paused ? 'PRIVATE MODE' : 'YOU ARE LIVE'}
            </div>
            <div style={{ marginTop: 6, opacity: .95 }}>{session.stop_name}</div>
            <div style={{ marginTop: 6, fontSize: '.9rem', opacity: .9 }}>
              Live {fmt(elapsed)} • auto-closes in {fmt(remaining)}
            </div>
          </div>

          {status && <div className={suppressed ? 'error' : 'success'}>{status}</div>}
          {showNudge && <div className="error">🔔 Still serving? You're still live. Tap Close when you leave.</div>}
          <p className="muted" style={{ fontSize: '.8rem', textAlign: 'center', margin: 0 }}>
            📱 The screen stays awake while you're live — mount &amp; plug in the truck phone and tracking runs hands-free.
          </p>

          <button className="btn btn-blue" onClick={togglePause}>{paused ? '▶️ Resume broadcast' : '⏸️ Go dark (private event)'}</button>
          <button className="btn btn-primary" onClick={() => stop()} style={{ background: 'var(--red-deep)' }}>🔴 Close — stop sharing</button>
        </>
      )}

      <p className="center muted" style={{ fontSize: '.78rem' }}>{tenant?.name} • broadcasting only happens while this screen says LIVE.</p>
    </div>
  )
}

function fmt(s) {
  const m = Math.floor(s / 60), sec = s % 60
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${m}m ${String(sec).padStart(2, '0')}s`
}
