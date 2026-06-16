// Loads the Google Maps JS SDK once and caches the promise.
let promise = null
export function loadGoogleMaps() {
  if (promise) return promise
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  promise = new Promise((resolve, reject) => {
    if (window.google?.maps) return resolve(window.google.maps)
    if (!key || key.startsWith('your-')) return reject(new Error('no-key'))
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=marker`
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
