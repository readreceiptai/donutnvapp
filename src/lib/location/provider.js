// ── The location provider contract ─────────────────────────────────────────
//
// Everything above this line in the app talks to ONE interface:
//   requestPermission() / startTracking() / onLocation() / stopTracking()
//
// Below it there are three implementations. Which one loads is decided at
// runtime by pickProvider() and nothing else in the app knows or cares:
//
//   community  — @capacitor-community/background-geolocation. Free. What we
//                build and prove the pipeline against today.
//   transistor — @transistorsoft/capacitor-background-geolocation. Paid
//                (~$300-400/platform). Best-in-class background reliability.
//                Bought and swapped in before beta, because reliability here
//                IS the moat. See transistorProvider.js.
//   web        — no background capability. Foreground-only, so the PWA does not
//                crash when it hits this code path.
//
// The swap is a one-line change in pickProvider(). That is the entire point of
// this file: we do not pay for the plugin until the pipeline is proven, and
// buying it later costs no rework.

/**
 * A single position fix, already in the shape location-ingest expects.
 * @typedef {Object} LocationFix
 * @property {number} lat
 * @property {number} lng
 * @property {number|null} accuracy_m
 * @property {string} recorded_at ISO-8601
 */

/**
 * @typedef {Object} LocationProvider
 * @property {string} name
 * @property {() => Promise<boolean>} isAvailable
 * @property {() => Promise<'granted'|'denied'|'prompt'>} requestPermission
 * @property {(opts?: {distanceFilter?: number}) => Promise<void>} startTracking
 * @property {(cb: (fix: LocationFix) => void) => (() => void)} onLocation
 * @property {() => Promise<void>} stopTracking
 */

/** True when running inside the Capacitor native shell (iOS/Android app). */
export async function isNativePlatform() {
  try {
    const { Capacitor } = await import('@capacitor/core')
    return Capacitor.isNativePlatform()
  } catch {
    // @capacitor/core is not installed in a pure-web checkout. That is fine.
    return false
  }
}

/**
 * Which provider this build should use.
 *
 * TO SWAP IN THE PAID PLUGIN (after purchase + `npm i
 * @transistorsoft/capacitor-background-geolocation`), change the native branch
 * from `./communityProvider.js` to `./transistorProvider.js`. Nothing else in
 * the app changes.
 *
 * @returns {Promise<LocationProvider>}
 */
export async function pickProvider() {
  if (await isNativePlatform()) {
    const { communityProvider } = await import('./communityProvider.js')
    return communityProvider
  }
  const { webProvider } = await import('./webProvider.js')
  return webProvider
}

// Cached so repeated calls don't re-import.
let cached = null

/** @returns {Promise<LocationProvider>} */
export async function getProvider() {
  if (!cached) cached = await pickProvider()
  return cached
}

/** Test seam: force a provider (used by the dev harness). */
export function __setProvider(p) {
  cached = p
}
