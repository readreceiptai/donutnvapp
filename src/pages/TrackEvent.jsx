import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadGoogleMaps } from '../lib/googleMaps'
import { distanceMeters } from '../lib/geo'
import BrandLogo from '../components/BrandLogo'
import DonutPhoto from '../components/DonutPhoto'
import MiniDonut from '../components/MiniDonut'

// PUBLIC client event portal (no login). Reads only safe fields via the secure
// get_event_tracking() function and walks the client through the whole event:
// booked → on the way → here (feedback) → wrapping → we've left → review → coupon.
export default function TrackEvent() {
  const { token } = useParams()
  const DEMO = token === 'demo'                 // staging preview with a stage switcher
  const [demoStatus, setDemoStatus] = useState('confirmed')
  const [t, setT] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const markers = useRef({})

  const pull = async () => {
    const { data, error } = await supabase.rpc('get_event_tracking', { p_token: token })
    if (error || data == null) { setNotFound(true); return }
    setT(data)
  }
  useEffect(() => {
    if (DEMO) { setT(demoData(demoStatus)); return }
    pull(); const id = setInterval(pull, 15000); return () => clearInterval(id)
  }, [token, demoStatus]) // eslint-disable-line

  // Truck → event map (only while en route).
  useEffect(() => {
    if (!t || t.status !== 'enroute' || t.truck_lat == null || t.event_lat == null) return
    loadGoogleMaps().then((maps) => {
      if (!mapRef.current && mapEl.current) {
        mapRef.current = new maps.Map(mapEl.current, { zoom: 12, disableDefaultUI: true, zoomControl: true })
      }
      const m = window.google.maps
      const truck = { lat: t.truck_lat, lng: t.truck_lng }, event = { lat: t.event_lat, lng: t.event_lng }
      place('truck', truck, m, '#DD1B22'); place('event', event, m, '#003C77')
      const bnd = new m.LatLngBounds(); bnd.extend(truck); bnd.extend(event); mapRef.current.fitBounds(bnd, 70)
    }).catch(() => {})
  }, [t])

  function place(key, pos, maps, color) {
    if (markers.current[key]) { markers.current[key].setPosition(pos); return }
    markers.current[key] = new maps.Marker({ position: pos, map: mapRef.current,
      icon: { path: maps.SymbolPath.CIRCLE, scale: 9, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 } })
  }

  if (notFound) return <Centered emoji="🔌">This tracking link isn't active.</Centered>
  if (!t) return <Centered emoji={<MiniDonut size={64} />}>Loading…</Centered>

  const s = t.status
  const name = first(t.contact_name)

  return (
    <div className="screen pad-top">
      <div className="center" style={{ marginTop: 6 }}><BrandLogo height={34} /></div>
      {DEMO && <DemoSwitcher value={demoStatus} onChange={setDemoStatus} />}

      {/* ── Booked, not yet rolling ── */}
      {['new', 'quoted', 'confirmed'].includes(s) && (
        <>
          <Hero photo title="Your event is booked! 🎉"
            sub={`We can't wait, ${name || 'friend'}! We'll text you here the moment the truck heads your way.`} />
          <EventDetails t={t} />
        </>
      )}

      {/* ── On the way ── */}
      {s === 'enroute' && (
        <>
          <div className="card card-accent center">
            <div style={{ fontSize: 46 }}>🚚💨</div>
            <h1 style={{ margin: '8px 0 2px' }}>We're on the way!</h1>
            <p className="muted" style={{ margin: 0 }}>{t.tenant} is heading to {name ? name + "'s" : 'your'} event.</p>
            {etaMin(t) && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: '2.4rem', color: 'var(--red)' }}>~{etaMin(t)} min</div>
                <div className="muted" style={{ fontSize: '.85rem' }}>estimated arrival</div>
              </div>
            )}
          </div>
          {t.truck_lat != null && t.event_lat != null && <div ref={mapEl} className="map" style={{ marginTop: 14 }} />}
        </>
      )}

      {/* ── Here & serving ── */}
      {['arrived', 'serving'].includes(s) && (
        <>
          <Hero photo title="We're here! 🍩" sub={`Enjoy your hot mini donuts, ${name || 'friend'}!`} />
          <FeedbackCard token={token} phase="during" prompt="How's everything going? Let us know in real time." />
        </>
      )}

      {/* ── Wrapping up ── */}
      {s === 'wrapping' && (
        <>
          <Hero emoji="✨" title="Wrapping up" sub="Thanks so much for having us — we're packing up the truck." />
          <FeedbackCard token={token} phase="wrapping" prompt="Anything we should know before we go?" />
        </>
      )}

      {/* ── We've left → thank you + review request ── */}
      {s === 'departed' && (
        <>
          <Hero emoji="🎉" title="Thanks for having us!" sub={`It was sweet serving your event, ${name || 'friend'}. We've packed up and hit the road.`} />
          <ReviewCard token={token} windowOpen={t.review_window_open} onDone={pull} />
        </>
      )}

      {/* ── Reviewed → coupon ── */}
      {s === 'reviewed' && (
        <div className="card card-accent center">
          <div style={{ fontSize: 46 }}>💛</div>
          <h1 style={{ margin: '8px 0 2px' }}>Thank you!</h1>
          <p className="muted">Your review means the world to us.</p>
          {t.coupon_code
            ? <div className="success" style={{ marginTop: 10 }}>
                🎁 Here's a treat for your next event:<br />
                <span style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: '1.4rem', letterSpacing: '1px' }}>{t.coupon_code}</span><br />
                <span style={{ fontSize: '.8rem' }}>Mention this code when you book again.</span>
              </div>
            : <p className="muted" style={{ fontSize: '.9rem' }}>We'll be in touch with a little thank-you soon.</p>}
        </div>
      )}

      {(s === 'completed' || s === 'cancelled') && (
        <Hero emoji={<MiniDonut size={52} />} title="See you next time!" sub="This event has wrapped. Thanks for choosing DonutNV." />
      )}

      <p className="center muted" style={{ fontSize: '.78rem', marginTop: 16 }}>
        {t.tenant} • Make Your Next Party Sweet!®
      </p>
    </div>
  )
}

function EventDetails({ t }) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2 style={{ marginBottom: 8 }}>Your event</h2>
      <Row label="Date" value={t.event_date || 'TBD'} />
      <Row label="Start time" value={t.start_time || 'TBD'} />
      <Row label="Guests" value={t.guests ? `~${t.guests}` : '—'} />
      {t.notes && <Row label="Notes" value={t.notes} />}
    </div>
  )
}
function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderTop: '1px solid var(--line)', padding: '8px 0' }}>
      <span className="muted">{label}</span><span style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function Hero({ title, sub, emoji, photo }) {
  return (
    <div className="card card-accent center" style={{ marginTop: 16 }}>
      {photo ? <div style={{ display: 'flex', justifyContent: 'center' }}><DonutPhoto size={84} /></div>
             : <div style={{ fontSize: 46 }}>{emoji}</div>}
      <h1 style={{ margin: '10px 0 2px' }}>{title}</h1>
      <p className="muted" style={{ margin: 0 }}>{sub}</p>
    </div>
  )
}

function FeedbackCard({ token, phase, prompt }) {
  const [msg, setMsg] = useState('')
  const [sent, setSent] = useState(false)
  async function send() {
    if (!msg.trim()) return
    await supabase.rpc('submit_event_feedback', { p_token: token, p_message: msg.trim(), p_phase: phase })
    setSent(true)
  }
  if (sent) return <div className="success" style={{ marginTop: 14 }}>Got it — thank you! Our team sees this right away. 🙌</div>
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2 style={{ marginBottom: 6 }}>Share feedback</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: '.9rem' }}>{prompt}</p>
      <textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Tell us anything…"
        style={{ width: '100%', fontSize: '1.05rem', padding: '12px 14px', border: '2px solid var(--line)', borderRadius: 12, fontFamily: 'var(--font-body)' }} />
      <button className="btn btn-blue" style={{ marginTop: 10 }} onClick={send}>Send to the team</button>
    </div>
  )
}

function ReviewCard({ token, windowOpen, onDone }) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  async function submit() {
    if (!rating) return
    setBusy(true)
    const { data } = await supabase.rpc('submit_event_review', { p_token: token, p_rating: rating, p_comment: comment.trim() })
    setBusy(false); setResult(data || { ok: true })
    setTimeout(onDone, 800)
  }
  if (result?.ok) {
    return <div className="success" style={{ marginTop: 14 }}>
      Thank you! {result.coupon ? <>Your bonus code: <b>{result.coupon}</b> 🎁</> : 'We appreciate you!'}
    </div>
  }
  return (
    <div className="card card-accent" style={{ marginTop: 14 }}>
      <h2 style={{ marginBottom: 4 }}>How did we do?</h2>
      {windowOpen && (
        <div className="success" style={{ marginBottom: 10 }}>
          ⏱️ Review in the next hour and we'll send you a <b>coupon for your next event!</b>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', margin: '6px 0 12px' }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} aria-label={`${n} stars`}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 34, lineHeight: 1, filter: n <= rating ? 'none' : 'grayscale(1) opacity(.35)' }}>⭐</button>
        ))}
      </div>
      <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Tell us about your experience (optional)…"
        style={{ width: '100%', fontSize: '1.05rem', padding: '12px 14px', border: '2px solid var(--line)', borderRadius: 12, fontFamily: 'var(--font-body)' }} />
      <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy || !rating} onClick={submit}>
        {busy ? 'Sending…' : 'Submit my review'}
      </button>
    </div>
  )
}

function etaMin(t) {
  if (t.truck_lat == null || t.event_lat == null) return null
  const meters = distanceMeters({ lat: t.truck_lat, lng: t.truck_lng }, { lat: t.event_lat, lng: t.event_lng })
  return Math.max(1, Math.round((meters / 1609.34) / 28 * 60))
}
const first = (n) => (n || '').split(' ')[0]

// ── Staging preview helpers (token === 'demo') ──
function demoData(status) {
  const base = {
    status, contact_name: 'Taylor Smith', tenant: 'DonutNV Palm Harbor',
    event_date: '2026-07-04', start_time: '2:00 PM', guests: 60, notes: 'Backyard 4th of July party!',
    event_lat: 28.0764, event_lng: -82.7637, truck_lat: 28.095, truck_lng: -82.74,
    departed_at: null, reviewed_at: null, coupon_code: null, review_window_open: false,
  }
  if (status === 'departed') return { ...base, departed_at: new Date().toISOString(), review_window_open: true }
  if (status === 'reviewed') return { ...base, reviewed_at: new Date().toISOString(), coupon_code: 'SWEET-7F3A2B' }
  return base
}
function DemoSwitcher({ value, onChange }) {
  const opts = ['confirmed', 'enroute', 'arrived', 'serving', 'wrapping', 'departed', 'reviewed']
  return (
    <div className="card" style={{ margin: '10px 0 4px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontWeight: 700, fontFamily: 'var(--font-head)', fontSize: '.85rem' }}>Preview stage</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: '2px solid var(--line)', fontSize: '1rem' }}>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}
function Centered({ emoji, children }) {
  return <div className="screen pad-top center"><div style={{ fontSize: 60, marginTop: '30vh' }}>{emoji}</div><p className="muted">{children}</p></div>
}
