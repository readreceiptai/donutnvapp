import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { loadGoogleMaps } from '../lib/googleMaps'
import MiniDonut from '../components/MiniDonut'

// The "Find & Follow" map. Shows every truck that's currently LIVE (flagged on
// and not past its auto-expire time), with its latest GPS position. Reads from
// the public views in the database, so no login is needed to see trucks.
export default function Find() {
  const { tenant } = useAuth()
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const markers = useRef({})
  const [trucks, setTrucks] = useState([])
  const [mapError, setMapError] = useState('')

  // Pull live trucks + their positions every 20s.
  useEffect(() => {
    let timer
    async function pull() {
      // active_live_sessions = live & not expired. Join to latest location.
      const { data: sessions } = await supabase.from('active_live_sessions').select('*')
      const { data: locs } = await supabase.from('truck_latest_location').select('*')
      const locByTruck = Object.fromEntries((locs || []).map((l) => [l.truck_id, l]))
      const live = (sessions || [])
        .map((s) => ({ ...s, loc: locByTruck[s.truck_id] }))
        .filter((s) => s.loc)
      setTrucks(live)
    }
    pull()
    timer = setInterval(pull, 20000)
    return () => clearInterval(timer)
  }, [])

  // Init the map.
  useEffect(() => {
    loadGoogleMaps().then((maps) => {
      if (!mapEl.current || mapRef.current) return
      mapRef.current = new maps.Map(mapEl.current, {
        center: { lat: 28.0764, lng: -82.7637 }, // Palm Harbor, FL default view
        zoom: 12,
        disableDefaultUI: true,
        zoomControl: true,
        styles: MAP_STYLE,
      })
    }).catch((e) => setMapError(e.message))
  }, [])

  // Draw / move markers when truck data changes.
  useEffect(() => {
    const maps = window.google?.maps
    if (!maps || !mapRef.current) return
    const bounds = new maps.LatLngBounds()
    trucks.forEach((t) => {
      const pos = { lat: t.loc.lat, lng: t.loc.lng }
      bounds.extend(pos)
      if (markers.current[t.truck_id]) {
        markers.current[t.truck_id].setPosition(pos)
      } else {
        markers.current[t.truck_id] = new maps.Marker({
          position: pos, map: mapRef.current, title: t.stop_name || 'DonutNV',
          icon: donutIcon(maps),
        })
      }
    })
    if (trucks.length) mapRef.current.fitBounds(bounds, 80)
    if (trucks.length === 1) mapRef.current.setZoom(14)
  }, [trucks])

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

      {mapError && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>🗺️</div>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            {mapError === 'no-key'
              ? 'Add your Google Maps key to .env to see the live map. The truck list below still works.'
              : 'Map could not load right now.'}
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
                <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: '1.1rem' }}>
                  {t.stop_name || 'On the move'}
                </div>
                <div className="muted" style={{ fontSize: '.9rem' }}>
                  Open until {t.ends_at ? formatTime(t.ends_at) : 'later today'}
                </div>
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
    <circle cx="22" cy="20" r="14" fill="#0A7BC1"/><circle cx="22" cy="20" r="10" fill="#DD1B22"/>
    <circle cx="22" cy="20" r="3.5" fill="#FFF7F0"/>
    <path d="M22 36 L16 40 L28 40 Z" fill="#0A7BC1"/></svg>`
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: new maps.Size(44, 44), anchor: new maps.Point(22, 40) }
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// Soft, brand-friendly map styling (de-emphasized so the red markers pop).
const MAP_STYLE = [
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'water', stylers: [{ color: '#cfe6f3' }] },
]
