// ── community provider — @capacitor-community/background-geolocation ────────
//
// The free implementation. Good enough to build and prove the whole pipeline
// end to end; less dependable than Transistorsoft at surviving OS process
// kills, aggressive battery optimisers, and reboots, which is exactly why the
// paid plugin replaces it before beta (see transistorProvider.js).
//
// Battery contract: distanceFilter 500m. We want "significant location change"
// semantics, not a continuous GPS trace. This single number is the biggest
// lever on both battery drain and how the app is perceived, so it is set here
// once and read from config rather than sprinkled around call sites.

import { DEFAULT_DISTANCE_FILTER } from './config.js'

let watcherId = null
const listeners = new Set()

function emit(fix) {
  for (const cb of listeners) {
    try { cb(fix) } catch (err) { console.error('[location] listener threw', err) }
  }
}

// IMPORTANT: this must NOT be an async function and callers must NOT `await`
// its result. Capacitor's registerPlugin() returns a Proxy that turns EVERY
// property read into a native bridge call. `await proxy` makes JS read
// `proxy.then` to test for a thenable, which the Proxy forwards to native as a
// method call and iOS throws: '"BackgroundGeolocation.then()" is not
// implemented on ios'. Found via Sentry during the iOS Simulator test.
// Cached in a plain variable so the proxy is created once.
let _plugin = null
async function loadPlugin() {
  if (_plugin) return { p: _plugin }          // wrapped so awaiting never touches the proxy
  const { registerPlugin } = await import('@capacitor/core')
  _plugin = registerPlugin('BackgroundGeolocation')
  return { p: _plugin }
}

/** @type {import('./provider.js').LocationProvider} */
export const communityProvider = {
  name: 'community',

  async isAvailable() {
    try { await loadPlugin(); return true } catch { return false }
  },

  // The plugin asks for permission as part of addWatcher (requestPermissions:
  // true). There is no separate permission call, so we report 'prompt' and let
  // startTracking surface the real answer. The priming UI runs BEFORE this is
  // ever called, which is what protects the opt-in rate.
  async requestPermission() {
    return 'prompt'
  },

  async startTracking(opts = {}) {
    if (watcherId) return // already running

    const { p: BackgroundGeolocation } = await loadPlugin()

    watcherId = await BackgroundGeolocation.addWatcher(
      {
        // Shown in the Android foreground-service notification. iOS ignores it.
        // Wording matters for trust: say plainly why the app is using location.
        backgroundTitle: 'Watching for DonutNV trucks nearby',
        backgroundMessage: 'We only use this to tell you when a truck is close.',
        requestPermissions: true,
        // Do not hand us a cached fix from hours ago on startup.
        stale: false,
        distanceFilter: opts.distanceFilter ?? DEFAULT_DISTANCE_FILTER,
      },
      (location, error) => {
        if (error) console.warn('[location] watcher error', error.code)
        if (error) {
          // NOT_AUTHORIZED means the user declined or revoked "Always". Stop
          // rather than retry forever, so we neither drain battery nor nag.
          if (error.code === 'NOT_AUTHORIZED') {
            console.warn('[location] permission denied or revoked; stopping')
            stopInternal()
          }
          return
        }
        if (!location) return
        emit({
          lat: location.latitude,
          lng: location.longitude,
          accuracy_m: location.accuracy ?? null,
          recorded_at: new Date(location.time ?? Date.now()).toISOString(),
        })
      },
    )
  },

  onLocation(cb) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },

  async stopTracking() {
    await stopInternal()
  },
}

async function stopInternal() {
  if (!watcherId) return
  try {
    const { p: BackgroundGeolocation } = await loadPlugin()
    await BackgroundGeolocation.removeWatcher({ id: watcherId })
  } catch (err) {
    console.error('[location] removeWatcher failed', err)
  } finally {
    watcherId = null
  }
}
