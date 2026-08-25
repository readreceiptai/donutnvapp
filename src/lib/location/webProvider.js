// ── web provider — no background capability ────────────────────────────────
//
// The PWA cannot track location in the background; no browser offers it. This
// exists so the shared code path does not explode on web, and so the opt-in UI
// can honestly tell a web user "install the app to get this" instead of showing
// a switch that silently does nothing.
//
// It does emit foreground fixes while the tab is open, which is enough for the
// dev harness and for a web user who happens to have the app open near a truck.

let watchId = null
const listeners = new Set()

function emit(fix) {
  for (const cb of listeners) {
    try { cb(fix) } catch (err) { console.error('[location] listener threw', err) }
  }
}

/** @type {import('./provider.js').LocationProvider} */
export const webProvider = {
  name: 'web',

  async isAvailable() {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator
  },

  async requestPermission() {
    if (typeof navigator === 'undefined' || !('permissions' in navigator)) return 'prompt'
    try {
      const s = await navigator.permissions.query({ name: 'geolocation' })
      return s.state === 'granted' ? 'granted' : s.state === 'denied' ? 'denied' : 'prompt'
    } catch {
      return 'prompt'
    }
  },

  async startTracking() {
    if (watchId != null) return
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return

    watchId = navigator.geolocation.watchPosition(
      (pos) => emit({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy ?? null,
        recorded_at: new Date(pos.timestamp).toISOString(),
      }),
      (err) => console.warn('[location] web watch error', err.message),
      // Low power on web too: no high accuracy, and a cached fix up to 5 min old
      // is perfectly good for a 5-mile decision.
      { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 30_000 },
    )
  },

  onLocation(cb) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },

  async stopTracking() {
    if (watchId == null) return
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  },

  // Lets the opt-in UI explain the limitation instead of lying to the user.
  supportsBackground: false,
}
