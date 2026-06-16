import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { loadGoogleMaps } from '../../lib/googleMaps'

// Operator bookings + the full event-day flow that drives the client portal:
// Start driving → Arrived → Serving → Wrapping up → We've left (review request).
const STATUS_LABEL = {
  new: 'New', quoted: 'Quoted', confirmed: 'Confirmed', enroute: 'On the way',
  arrived: 'Arrived', serving: 'Serving', wrapping: 'Wrapping up', departed: 'Left',
  completed: 'Done', reviewed: 'Reviewed', cancelled: 'Cancelled',
}
const ACTIVE = new Set(['enroute', 'arrived', 'serving', 'wrapping', 'departed', 'reviewed'])

export default function Bookings() {
  const { profile, tenant } = useAuth()
  const [rows, setRows] = useState([])
  const [msg, setMsg] = useState('')
  const watch = useRef(null)

  const load = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase.from('bookings').select('*')
      .eq('tenant_id', profile.tenant_id).order('event_date', { ascending: true })
    setRows(data || [])
  }, [profile])
  useEffect(() => { load() }, [load])
  useEffect(() => () => { if (watch.current != null) navigator.geolocation.clearWatch(watch.current) }, [])

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  async function geocode(b) {
    const maps = await loadGoogleMaps()
    const q = [b.address, b.city, b.zip].filter(Boolean).join(', ')
    return new Promise((resolve) => {
      new maps.Geocoder().geocode({ address: q }, (res, status) =>
        resolve(status === 'OK' && res[0] ? { lat: res[0].geometry.location.lat(), lng: res[0].geometry.location.lng() } : null))
    })
  }

  async function startDriving(b) {
    setMsg('Getting directions ready…')
    let { lat, lng } = b
    if (lat == null) { const g = await geocode(b); if (g) { lat = g.lat; lng = g.lng } }
    let truckId = b.truck_id
    if (!truckId) {
      const { data: trucks } = await supabase.from('trucks').select('id').eq('tenant_id', b.tenant_id).eq('is_active', true).limit(1)
      truckId = trucks?.[0]?.id
    }
    const { data: sess } = await supabase.from('live_sessions').insert({
      tenant_id: b.tenant_id, truck_id: truckId, booking_id: b.id,
      stop_name: `${b.contact_name}'s event`, is_live: true, visibility: 'private',
      started_at: new Date().toISOString(), ends_at: new Date(Date.now() + 4 * 3600000).toISOString(), source: 'manual',
    }).select().single()
    await supabase.from('bookings').update({ status: 'enroute', truck_id: truckId, lat, lng, enroute_session_id: sess?.id }).eq('id', b.id)
    if ('geolocation' in navigator && sess) {
      if (watch.current != null) navigator.geolocation.clearWatch(watch.current)
      watch.current = navigator.geolocation.watchPosition((p) => {
        supabase.from('truck_locations').insert({ tenant_id: b.tenant_id, truck_id: truckId, session_id: sess.id, lat: p.coords.latitude, lng: p.coords.longitude })
      }, () => {}, { enableHighAccuracy: true, maximumAge: 10000 })
    }
    supabase.functions.invoke('send-enroute-sms', { body: { booking_id: b.id, kind: 'enroute' } }).catch(() => {})
    flash(`On the way to ${b.contact_name}! Client texted their live link.`)
    load()
  }

  // Advance through the event-day stages; each one updates the client's portal.
  async function advance(b, next) {
    const patch = { status: next }
    if (next === 'departed') {
      patch.departed_at = new Date().toISOString()
      if (watch.current != null) { navigator.geolocation.clearWatch(watch.current); watch.current = null }
      if (b.enroute_session_id) await supabase.from('live_sessions').update({ is_live: false, ends_at: new Date().toISOString() }).eq('id', b.enroute_session_id)
      supabase.functions.invoke('send-enroute-sms', { body: { booking_id: b.id, kind: 'review' } }).catch(() => {})
    }
    await supabase.from('bookings').update(patch).eq('id', b.id)
    flash(next === 'departed' ? 'Marked as left — review request sent to the client. 🌟' : `Updated to "${STATUS_LABEL[next]}".`)
    load()
  }

  function copyLink(b) {
    navigator.clipboard?.writeText(`${window.location.origin}/track/${b.tracking_token}`)
    flash('Tracking link copied.')
  }

  // Request a Square deposit: ask for a dollar amount, create the hosted payment
  // link, and (if GHL is connected) let GHL text/email it to the client.
  async function requestDeposit(b) {
    const raw = window.prompt(`Deposit amount for ${b.contact_name}'s event? (USD)`, '50')
    if (raw == null) return
    const dollars = parseFloat(String(raw).replace(/[^0-9.]/g, ''))
    if (!Number.isFinite(dollars) || dollars < 1) { flash('Enter an amount of at least $1.'); return }
    setMsg('Creating Square deposit link…')
    const { data, error } = await supabase.functions.invoke('square-deposit', {
      body: { booking_id: b.id, amount_cents: Math.round(dollars * 100) },
    })
    if (error || data?.error) { flash(data?.error || 'Could not create the deposit link (is Square connected?).'); return }
    if (data?.url) navigator.clipboard?.writeText(data.url).catch(() => {})
    flash(data?.pushedToGhl ? 'Deposit link created — GHL will send it. (Copied too.)' : 'Deposit link created & copied to clipboard.')
    load()
  }

  function copyDeposit(b) {
    if (b.deposit_url) { navigator.clipboard?.writeText(b.deposit_url); flash('Deposit link copied.') }
  }

  const Btn = ({ onClick, color, children }) => (
    <button className={`btn ${color || 'btn-primary'}`} style={{ width: 'auto', padding: '10px 14px' }} onClick={onClick}>{children}</button>
  )

  return (
    <div className="pad-top stack">
      <h1>Bookings</h1>
      {msg && <div className="success">{msg}</div>}
      {rows.length === 0 && <div className="card center"><div style={{ fontSize: 40 }}>📅</div><p className="muted" style={{ margin: '8px 0 0' }}>No bookings yet. Requests from the book-a-truck form land here.</p></div>}

      {rows.map((b) => (
        <div key={b.id} className="card card-accent">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 700, fontFamily: 'var(--font-head)', fontSize: '1.05rem' }}>{b.contact_name}</div>
              <div className="muted" style={{ fontSize: '.88rem' }}>{b.event_type || 'Event'} · {b.event_date || 'date TBD'}{b.start_time ? ` · ${b.start_time}` : ''}</div>
              <div className="muted" style={{ fontSize: '.85rem' }}>{[b.address, b.city].filter(Boolean).join(', ') || (b.zip ? `ZIP ${b.zip}` : 'no address yet')}{b.guests ? ` · ${b.guests} guests` : ''}</div>
            </div>
            <span className={`pill ${ACTIVE.has(b.status) ? 'pill-open' : 'pill-closed'}`}>{STATUS_LABEL[b.status] || b.status}</span>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <a className="btn btn-blue" style={{ width: 'auto', padding: '10px 14px' }} href={`tel:${b.contact_phone}`}>Call</a>
            {['new', 'quoted', 'confirmed'].includes(b.status) && <Btn onClick={() => startDriving(b)}>🚚 Start driving</Btn>}
            {b.status === 'enroute' && <><Btn color="btn-blue" onClick={() => copyLink(b)}>Copy live link</Btn><Btn onClick={() => advance(b, 'arrived')}>Arrived</Btn></>}
            {b.status === 'arrived' && <Btn onClick={() => advance(b, 'serving')}>Start serving</Btn>}
            {b.status === 'serving' && <Btn onClick={() => advance(b, 'wrapping')}>Wrapping up</Btn>}
            {b.status === 'wrapping' && <Btn color="btn-primary" onClick={() => advance(b, 'departed')}>🚚 We've left</Btn>}
            {['departed', 'reviewed'].includes(b.status) && <Btn color="btn-ghost" onClick={() => advance(b, 'completed')}>Close out</Btn>}
            {(!b.deposit_status || b.deposit_status === 'none') && !['cancelled', 'completed'].includes(b.status) &&
              <Btn color="btn-blue" onClick={() => requestDeposit(b)}>💳 Request deposit</Btn>}
            {b.deposit_status === 'requested' && <Btn color="btn-ghost" onClick={() => copyDeposit(b)}>Copy deposit link</Btn>}
          </div>

          {b.deposit_status && b.deposit_status !== 'none' && (
            <div className="muted" style={{ fontSize: '.82rem', marginTop: 8 }}>
              💳 Deposit {b.deposit_amount_cents ? `$${(b.deposit_amount_cents / 100).toFixed(2)} ` : ''}
              {b.deposit_status === 'paid'
                ? <b style={{ color: 'var(--ok, #1a9e5f)' }}>paid ✓</b>
                : <b>requested — awaiting payment</b>}
            </div>
          )}

          {b.review_rating && (
            <div className="muted" style={{ fontSize: '.82rem', marginTop: 8 }}>
              ⭐ {b.review_rating}/5{b.review_comment ? ` — "${b.review_comment}"` : ''}{b.coupon_code ? ` · coupon ${b.coupon_code}` : ''}
            </div>
          )}
          {b.ghl_contact_id
            ? <div className="muted" style={{ fontSize: '.75rem', marginTop: 8 }}>✓ Synced to GHL</div>
            : <button className="link" style={{ fontSize: '.8rem', marginTop: 8 }} onClick={() => supabase.functions.invoke('ghl-sync', { body: { booking_id: b.id } }).then(() => { flash('Pushed to GHL.'); load() })}>Push to GHL</button>}
        </div>
      ))}
      <p className="center muted" style={{ fontSize: '.75rem' }}>{tenant?.name}</p>
    </div>
  )
}
