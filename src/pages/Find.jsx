import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { loadGoogleMaps } from '../lib/googleMaps'
import MiniDonut from '../components/MiniDonut'
import { DEMO } from '../lib/demo'

// World Equestrian Center, Ocala — the demo's live-truck stop (on the grounds).
const WEC = { lat: 29.2048, lng: -82.2596 }

// The "Find & Follow" map. Shows every truck that's currently LIVE, with its
// latest position, a branded donut pin, a "buzz" crowd of anonymous fans, and
// an opt-in route from the customer to the truck. No login needed to view.
export default function Find() {
  const { tenant } = useAuth()
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const markers = useRef({})
  const crowd = useRef([])
  const dirRenderer = useRef(null)
  const [trucks, setTrucks] = useState([])
  const [buzz, setBuzz] = useState(0)
  const [route, setRoute] = useState(null)   // { dur, dist }
  const [routeMsg, setRouteMsg] = useState('')
  const [routed, setRouted] = useState(false)
  const [mapError, setMapError] = useState('')
  const [pushAlert, setPushAlert] = useState(false)   // demo-only proximity push
  // Cost control: every Google Maps mount is a billable map load. The map is
  // NOT created on mount; the truck list is the default view and the map only
  // mounts when the customer taps "Show map". The demo build keeps the old
  // behaviour (map first) because the demo's opening beat is the spinning pin.
  const [showMap, setShowMap] = useState(DEMO)

  // Demo: fire a "truck is near you" push a few seconds after landing on Find,
  // as if the customer just walked into range. Stays up until tapped.
  useEffect(() => {
    if (!DEMO) return
    const t = setTimeout(() => setPushAlert(true), 5000)
    return () => clearTimeout(t)
  }, [])

  // Pull live trucks + positions + today's buzz every 20s.
  useEffect(() => {
    let timer
    async function pull() {
      const { data: sessions } = await supabase.from('active_live_sessions').select('*')
      const { data: locs } = await supabase.from('truck_latest_location').select('*')
      const locByTruck = Object.fromEntries((locs || []).map((l) => [l.truck_id, l]))
      const live = (sessions || [])
        .map((s) => ({ ...s, loc: locByTruck[s.truck_id] }))
        .filter((s) => s.loc)

      // Buzz = today's customers served for this territory — an anonymous count
      // from real Square sales (get_buzz RPC). No names, no locations.
      let buzzCount = 0
      if (tenant?.id) {
        const { data: b } = await supabase.rpc('get_buzz', { p_tenant: tenant.id })
        buzzCount = b || 0
      }

      if (live.length) { setTrucks(live); setBuzz(buzzCount) }
      else if (DEMO || testPinOn()) { setTrucks([DEMO_TRUCK]); setBuzz(buzzCount || 23) } // demo buzz
      else { setTrucks([]); setBuzz(0) }
    }
    pull()
    timer = setInterval(pull, 20000)
    return () => clearInterval(timer)
  }, [tenant?.id])

  // Init the map. Runs ONLY once the customer has asked for it (showMap), so
  // no Maps JS request is made on page load.
  useEffect(() => {
    if (!showMap) return
    loadGoogleMaps().then((maps) => {
      // Center on this territory's centroid so a customer with no live truck
      // sees their own area, not Florida. Falls back to Palm Harbor only until
      // corporate loads each tenant's coordinates (tenants.lat/lng).
      const hasCoords = Number.isFinite(tenant?.lat) && Number.isFinite(tenant?.lng)
      const center = DEMO ? WEC : hasCoords ? { lat: tenant.lat, lng: tenant.lng } : { lat: 28.0764, lng: -82.7637 }
      // Map already built (tenant coords arrived after init): recenter once, but
      // only if no live truck has taken over the view.
      if (mapRef.current) { if (!DEMO && hasCoords && !trucks.length) mapRef.current.setCenter(center); return }
      if (!mapEl.current) return
      mapRef.current = new maps.Map(mapEl.current, {
        center,
        zoom: DEMO ? 15 : 12, disableDefaultUI: true, zoomControl: true,
        styles: DEMO ? MAP_STYLE_DEMO : MAP_STYLE,
      })
    }).catch((e) => setMapError(e.message))
  }, [showMap, tenant?.lat, tenant?.lng])

  // Truck markers + fit view (skip the auto-fit while a route is shown).
  useEffect(() => {
    const maps = window.google?.maps
    if (!maps || !mapRef.current) return
    const bounds = new maps.LatLngBounds()
    trucks.forEach((t) => {
      const pos = { lat: t.loc.lat, lng: t.loc.lng }
      bounds.extend(pos)
      if (markers.current[t.truck_id]) markers.current[t.truck_id].setPosition(pos)
      else {
        const ov = donutOverlay(maps, pos, t.stop_name || 'DonutNV')
        ov.setMap(mapRef.current)
        markers.current[t.truck_id] = ov
      }
    })
    if (trucks.length && !routed) {
      mapRef.current.fitBounds(bounds, 80)
      if (trucks.length === 1) mapRef.current.setZoom(DEMO ? 15 : 14)
    }
  }, [trucks, routed, showMap])

  // Buzz crowd: stylized fans scattered near the truck (decorative — NOT real
  // customer locations). Count scales with today's check-ins, capped so it reads.
  useEffect(() => {
    const maps = window.google?.maps
    if (!maps || !mapRef.current) return
    crowd.current.forEach((m) => m.setMap(null))
    crowd.current = []
    const t = trucks[0]
    if (!t) return
    const n = Math.min(buzz, 10)
    for (let i = 0; i < n; i++) {
      const ang = (i / Math.max(n, 1)) * Math.PI * 2 + i * 1.7
      const r = 0.0004 + (i % 3) * 0.00018 // ~40–90m ring, stable per index
      const pos = { lat: t.loc.lat + r * Math.cos(ang), lng: t.loc.lng + r * Math.sin(ang) }
      crowd.current.push(new maps.Marker({
        position: pos, map: mapRef.current, icon: fanIcon(maps, i), clickable: false, zIndex: 5,
      }))
    }
  }, [trucks, buzz, showMap])

  async function showRoute() {
    if (!trucks[0]) return
    if (!showMap) setShowMap(true)   // the route draws onto the map
    setRouteMsg('Getting your location…')
    if (!('geolocation' in navigator)) { setRouteMsg('Location isn’t available on this device.'); return }
    navigator.geolocation.getCurrentPosition(async (p) => {
      try {
        const maps = await loadGoogleMaps()
        const origin = { lat: p.coords.latitude, lng: p.coords.longitude }
        const dest = { lat: trucks[0].loc.lat, lng: trucks[0].loc.lng }
        const svc = new maps.DirectionsService()
        const res = await svc.route({ origin, destination: dest, travelMode: maps.TravelMode.DRIVING })
        if (!dirRenderer.current) dirRenderer.current = new maps.DirectionsRenderer({
          suppressMarkers: true, preserveViewport: false,
          polylineOptions: { strokeColor: '#DD1B22', strokeWeight: 5, strokeOpacity: 0.9 },
        })
        // If the map was lazily shown by this very tap, its init effect may not
        // have run yet; wait for mapRef rather than drawing the route onto null.
        for (let i = 0; i < 40 && !mapRef.current; i++) await new Promise((r) => setTimeout(r, 50))
        if (!mapRef.current) throw new Error('map-not-ready')
        dirRenderer.current.setMap(mapRef.current)
        dirRenderer.current.setDirections(res)
        const leg = res.routes[0].legs[0]
        setRoute({ dur: leg.duration.text, dist: leg.distance.text })
        setRouted(true); setRouteMsg('')
      } catch { setRouteMsg('Couldn’t build a route right now — tap Directions to use your maps app.') }
    }, () => setRouteMsg('Allow location to see your route here, or tap Directions.'),
      { enableHighAccuracy: true, timeout: 15000 })
  }

  function clearRoute() {
    if (dirRenderer.current) dirRenderer.current.setMap(null)
    setRoute(null); setRouted(false); setRouteMsg('')
  }

  const isOpen = trucks.length > 0

  return (
    <div className="pad-top stack">
      <style>{`
        .dnv-donut-pin { position: absolute; transform: translate(-50%, -50%); pointer-events: none; z-index: 50; }
        .dnv-donut-spin { width: 34px; height: 34px; display: block;
          animation: dnvDonutSpin 3.5s linear infinite;
          filter: drop-shadow(0 3px 4px rgba(0,0,0,.35)); }
        @keyframes dnvDonutSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
      {pushAlert && (
        <>
          <style>{`@keyframes dnvPushIn{from{opacity:0;transform:translateY(-18px)}to{opacity:1;transform:translateY(0)}}`}</style>
          <div onClick={() => setPushAlert(false)} style={{
            position: 'fixed', top: 12, left: 12, right: 12, zIndex: 1000,
            background: 'rgba(255,255,255,0.98)', borderRadius: 18,
            boxShadow: '0 10px 34px rgba(0,0,0,.28)', padding: '12px 14px',
            display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
            backdropFilter: 'saturate(180%) blur(8px)', animation: 'dnvPushIn .35s ease-out',
          }}>
            <img src="/brand/minidonut.png" alt="" style={{ width: 42, height: 42, borderRadius: 10, flexShrink: 0 }} />
            <div style={{ flex: 1, lineHeight: 1.28 }}>
              <div style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.04em', color: '#8a8a8e', fontWeight: 700 }}>DonutNV · now</div>
              <div style={{ fontWeight: 700, fontSize: '.95rem', color: '#1c1c1e' }}>A truck just rolled up near you</div>
              <div style={{ fontSize: '.86rem', color: '#3a3a3c' }}>We're live at the World Equestrian Center — 0.4 mi away. Tap for directions.</div>
            </div>
            <span style={{ color: '#c7c7cc', fontSize: 20, alignSelf: 'flex-start', lineHeight: 1 }}>×</span>
          </div>
        </>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Find a truck</h1>
        <span className={`pill ${isOpen ? 'pill-open' : 'pill-closed'}`}>
          <span className={`dot ${isOpen ? 'dot-live' : ''}`} />
          {isOpen ? 'Open now' : 'No trucks live'}
        </span>
      </div>

      {showMap && !mapError && <div ref={mapEl} className="map" />}
      {!showMap && !mapError && (
        <button className="btn btn-blue" onClick={() => setShowMap(true)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <span aria-hidden="true">🗺️</span> Show map
        </button>
      )}

      {isOpen && (
        route ? (
          <div className="card card-accent" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700 }}>🚗 {route.dur} away · {route.dist}</span>
            <button className="link" onClick={clearRoute}>Clear route</button>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={showRoute}>🚗 Show me the fastest way</button>
        )
      )}
      {routeMsg && <div className="muted" style={{ fontSize: '.85rem' }}>{routeMsg}</div>}

      <Link to="/schedule" className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
        <span style={{ fontSize: 22 }}>📆</span>
        <span style={{ flex: 1, fontWeight: 600 }}>See where we'll be this week</span>
        <span className="link" style={{ fontSize: '.85rem' }}>View ›</span>
      </Link>

      {mapError && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>🗺️</div>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            {mapError === 'no-key' ? 'Add your Google Maps key to .env to see the live map. The truck list below still works.' : 'Map could not load right now.'}
          </p>
        </div>
      )}

      {trucks.length === 0 ? (
        <div className="card center">
          <div style={{ display: 'flex', justifyContent: 'center' }}><MiniDonut size={48} /></div>
          <h2 style={{ marginTop: 8 }}>No trucks are out right now</h2>
          <p className="muted" style={{ margin: 0 }}>
            Turn on alerts and we'll text you the moment one rolls into {tenant?.name || 'your area'}.
          </p>
        </div>
      ) : (
        trucks.map((t) => (
          <div key={t.truck_id} className="card card-accent">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: '1.1rem' }}>{t.stop_name || 'On the move'}</div>
                <div className="muted" style={{ fontSize: '.9rem' }}>Open until {t.ends_at ? formatTime(t.ends_at) : 'later today'}</div>
                {buzz > 0 && <div style={{ fontSize: '.9rem', fontWeight: 700, color: 'var(--red)', marginTop: 2 }}><img src="/brand/minidonut.png" alt="" style={{ height: '1em', verticalAlign: '-0.15em', marginRight: 4 }} />{buzz} served today</div>}
              </div>
              <a className="btn btn-blue" style={{ width: 'auto', padding: '10px 16px' }}
                 href={`https://www.google.com/maps/dir/?api=1&destination=${t.loc.lat},${t.loc.lng}`}
                 target="_blank" rel="noreferrer">Directions</a>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// The truck pin is a custom overlay (not a canvas Marker) so the real mini-donut
// image can spin via CSS. Centered on the exact location and shrunk down.
let _DonutOverlay = null
function donutOverlay(maps, position, title) {
  if (!_DonutOverlay) {
    _DonutOverlay = class extends maps.OverlayView {
      constructor(pos, label) { super(); this.pos = pos; this.label = label; this.div = null }
      onAdd() {
        const div = document.createElement('div')
        div.className = 'dnv-donut-pin'
        div.title = this.label || 'DonutNV'
        div.innerHTML = '<img src="/brand/minidonut.png" alt="" class="dnv-donut-spin" />'
        this.div = div
        this.getPanes().floatPane.appendChild(div)
      }
      draw() {
        const proj = this.getProjection()
        if (!proj || !this.div) return
        const p = proj.fromLatLngToDivPixel(new maps.LatLng(this.pos.lat, this.pos.lng))
        this.div.style.left = p.x + 'px'
        this.div.style.top = p.y + 'px'
      }
      setPosition(pos) { this.pos = pos; this.draw() }
      onRemove() { if (this.div) { this.div.remove(); this.div = null } }
    }
  }
  return new _DonutOverlay(position, title)
}

// A little stylized "fan" figure (NOT a real person's location) for the buzz
// crowd. Brand-colored, cycles a few colors so the cluster looks lively.
function fanIcon(maps, i) {
  const colors = ['#DD1B22', '#0A7BC1', '#911A1D', '#FFC83D']
  const c = colors[i % colors.length]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="26" viewBox="0 0 22 26">
    <circle cx="11" cy="7" r="5" fill="${c}" stroke="#fff" stroke-width="1.5"/>
    <path d="M2 25 C2 16 20 16 20 25 Z" fill="${c}" stroke="#fff" stroke-width="1.5"/></svg>`
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: new maps.Size(22, 26), anchor: new maps.Point(11, 26) }
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// A demo pin so you can see the branded donut marker + buzz crowd without a live
// truck. Shows in preview mode, or on any /find?testpin=1 link. Never in prod.
const DEMO_TRUCK = {
  truck_id: 'demo-pin',
  stop_name: 'World Equestrian Center — Winter Festival',
  ends_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  loc: WEC,
}
function testPinOn() {
  // Preview/staging only. Previously a ?testpin=1 link surfaced the fake truck in
  // production too; that backdoor is removed — the demo pin now shows solely in
  // preview builds.
  try {
    return import.meta.env.VITE_PREVIEW_MODE === '1'
  } catch { return false }
}

// Soft, brand-friendly map styling (de-emphasized so the markers pop).
const MAP_STYLE = [
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'water', stylers: [{ color: '#cfe6f3' }] },
]

// Demo style: same soft look, but let place NAMES through (POI text on, POI
// icons off) so the map renders "World Equestrian Center" itself — no manual
// label needed, just Google's own map data.
const MAP_STYLE_DEMO = [
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'water', stylers: [{ color: '#cfe6f3' }] },
]
