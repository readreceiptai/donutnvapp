import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { loadGoogleMaps } from '../lib/googleMaps'
import MiniDonut from '../components/MiniDonut'

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
      else if (testPinOn()) { setTrucks([DEMO_TRUCK]); setBuzz(buzzCount || 23) } // demo buzz
      else { setTrucks([]); setBuzz(0) }
    }
    pull()
    timer = setInterval(pull, 20000)
    return () => clearInterval(timer)
  }, [tenant?.id])

  // Init the map.
  useEffect(() => {
    loadGoogleMaps().then((maps) => {
      if (!mapEl.current || mapRef.current) return
      mapRef.current = new maps.Map(mapEl.current, {
        center: { lat: 28.0764, lng: -82.7637 },
        zoom: 12, disableDefaultUI: true, zoomControl: true, styles: MAP_STYLE,
      })
    }).catch((e) => setMapError(e.message))
  }, [])

  // Truck markers + fit view (skip the auto-fit while a route is shown).
  useEffect(() => {
    const maps = window.google?.maps
    if (!maps || !mapRef.current) return
    const bounds = new maps.LatLngBounds()
    trucks.forEach((t) => {
      const pos = { lat: t.loc.lat, lng: t.loc.lng }
      bounds.extend(pos)
      if (markers.current[t.truck_id]) markers.current[t.truck_id].setPosition(pos)
      else markers.current[t.truck_id] = new maps.Marker({
        position: pos, map: mapRef.current, title: t.stop_name || 'DonutNV',
        icon: donutIcon(maps), zIndex: 50,
      })
    })
    if (trucks.length && !routed) {
      mapRef.current.fitBounds(bounds, 80)
      if (trucks.length === 1) mapRef.current.setZoom(14)
    }
  }, [trucks, routed])

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
  }, [trucks, buzz])

  async function showRoute() {
    if (!trucks[0]) return
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Find a truck</h1>
        <span className={`pill ${isOpen ? 'pill-open' : 'pill-closed'}`}>
          <span className={`dot ${isOpen ? 'dot-live' : ''}`} />
          {isOpen ? 'Open now' : 'No trucks live'}
        </span>
      </div>

      {!mapError && <div ref={mapEl} className="map" />}

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
                {buzz > 0 && <div style={{ fontSize: '.9rem', fontWeight: 700, color: 'var(--red)', marginTop: 2 }}>🍩 {buzz} served today</div>}
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

function donutIcon(maps) {
  // The real DonutNV mini-donut as the map pin, bottom-center anchored.
  return { url: '/brand/minidonut.png', scaledSize: new maps.Size(52, 52), anchor: new maps.Point(26, 50) }
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
  stop_name: '🍩 Test pin — DonutNV (demo)',
  ends_at: null,
  loc: { lat: 28.0764, lng: -82.7637 },
}
function testPinOn() {
  try {
    if (import.meta.env.VITE_PREVIEW_MODE === '1') return true
    return new URLSearchParams(window.location.search).get('testpin') === '1'
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
