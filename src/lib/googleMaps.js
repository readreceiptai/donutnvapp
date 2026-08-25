// Loads the Google Maps JS SDK once and caches the promise.
//
// Two keys, chosen at runtime:
//   web    VITE_GOOGLE_MAPS_API_KEY     referrer-locked to donutnvapp.com (unchanged)
//   native VITE_GOOGLE_MAPS_NATIVE_KEY  Maps-JS-API-only, no referrer restriction
// The native WebView's origin is capacitor://localhost (iOS) / https://localhost
// (Android), which the web key's referrer allowlist rejects with
// RefererNotAllowedMapError (ROADMAP #70). Referrer restrictions cannot
// meaningfully secure a JS key inside a WebView, so the native key is scoped
// by API + quota instead, and the web key stays tightly locked.
let promise = null

function isNativeShell() {
  // Synchronous and dependency-free on purpose: the loader is called from
  // render paths, and this must not fail on a web-only checkout without
  // @capacitor/core. Capacitor exposes itself on window when native.
  const cap = typeof window !== 'undefined' ? window.Capacitor : null
  if (cap && typeof cap.isNativePlatform === 'function') return cap.isNativePlatform()
  // Fallback for the moment before the bridge is attached: origin scheme.
  const p = typeof window !== 'undefined' ? window.location?.protocol : ''
  const h = typeof window !== 'undefined' ? window.location?.hostname : ''
  return p === 'capacitor:' || (p === 'https:' && h === 'localhost')
}

export function loadGoogleMaps() {
  if (promise) return promise
  const nativeKey = import.meta.env.VITE_GOOGLE_MAPS_NATIVE_KEY
  const webKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  // Native shell uses the native key; falls back to the web key only if the
  // native key is unset (which will then surface RefererNotAllowedMapError,
  // i.e. fail loudly rather than silently).
  const key = (isNativeShell() && nativeKey && !nativeKey.startsWith('your-')) ? nativeKey : webKey
  promise = new Promise((resolve, reject) => {
    if (window.google?.maps) return resolve(window.google.maps)
    if (!key || key.startsWith('your-')) return reject(new Error('no-key'))
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=marker&loading=async`
    s.async = true
    s.onload = () => resolve(window.google.maps)
    s.onerror = () => reject(new Error('load-failed'))
    document.head.appendChild(s)
  })
  return promise
}

// Turn a typed place/address into { lat, lng } using Google's geocoder.
// Used by "pin a fixed spot" on Go Live so a typed location becomes a map dot.
export async function geocodeAddress(address) {
  const maps = await loadGoogleMaps()
  const geocoder = new maps.Geocoder()
  return new Promise((resolve, reject) => {
    geocoder.geocode({ address }, (results, status) => {
      if (status === 'OK' && results && results[0]) {
        const loc = results[0].geometry.location
        resolve({ lat: loc.lat(), lng: loc.lng(), formatted: results[0].formatted_address })
      } else {
        reject(new Error('geocode-failed:' + status))
      }
    })
  })
}
