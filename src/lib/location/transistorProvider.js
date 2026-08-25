// ── transistor provider — @transistorsoft/capacitor-background-geolocation ──
//
// THE PRODUCTION PROVIDER. Not active yet: the plugin is licensed software
// (~$300-400 per platform) and has not been purchased. This file is written
// against the real API so the swap is a package install plus one line, not a
// rewrite.
//
// TO ACTIVATE:
//   1. Buy the license (iOS and Android are separate purchases).
//   2. npm i @transistorsoft/capacitor-background-geolocation
//   3. In provider.js -> pickProvider(), import './transistorProvider.js'
//      instead of './communityProvider.js'.
//   4. Add the license key to capacitor.config.json under the plugin's config.
//   5. npx cap sync
//
// WHY IT REPLACES THE FREE PLUGIN BEFORE BETA: the free plugin loses its
// watcher across OS process kills, aggressive Android battery optimisers, and
// reboots. Every one of those is a customer who opted in, believes alerts are
// on, and silently never hears from us again. The moat is only a moat if the
// pings actually arrive.

import { DEFAULT_DISTANCE_FILTER } from './config.js'

let started = false
const listeners = new Set()
let unsubscribeNative = null

function emit(fix) {
  for (const cb of listeners) {
    try { cb(fix) } catch (err) { console.error('[location] listener threw', err) }
  }
}

// The package name is held in a variable and the import is marked
// @vite-ignore ON PURPOSE. This is licensed software that is not installed yet,
// and a statically analysable import of a missing package fails `vite build` at
// resolve time, which would break the web deploy for a file we are not even
// using. Keeping it opaque to the bundler means this provider sits here inert
// until the license is bought and the package installed.
const PKG = '@transistorsoft/capacitor-background-geolocation'

async function plugin() {
  const mod = await import(/* @vite-ignore */ PKG)
  return mod.default ?? mod
}

/** @type {import('./provider.js').LocationProvider} */
export const transistorProvider = {
  name: 'transistor',

  async isAvailable() {
    try { await plugin(); return true } catch { return false }
  },

  async requestPermission() {
    try {
      const BG = await plugin()
      // 3 = ALWAYS on both platforms in this plugin's enum.
      const status = await BG.requestPermission()
      if (status === 3) return 'granted'
      return status === 0 ? 'prompt' : 'denied'
    } catch {
      return 'denied'
    }
  },

  async startTracking(opts = {}) {
    if (started) return
    const BG = await plugin()

    const sub = BG.onLocation(
      (location) => {
        emit({
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          accuracy_m: location.coords.accuracy ?? null,
          recorded_at: location.timestamp ?? new Date().toISOString(),
        })
      },
      (err) => console.error('[location] onLocation error', err),
    )
    unsubscribeNative = () => sub.remove()

    await BG.ready({
      // Significant-change semantics, not a continuous GPS trace.
      desiredAccuracy: BG.DESIRED_ACCURACY_LOW,
      distanceFilter: opts.distanceFilter ?? DEFAULT_DISTANCE_FILTER,
      // Survive process kill and reboot. This is the whole reason we pay.
      stopOnTerminate: false,
      startOnBoot: true,
      // We flush to our own endpoint from JS, so the plugin's built-in HTTP
      // uploader stays off. One ingest path, one place to debug.
      autoSync: false,
      batchSync: false,
      debug: false,
      logLevel: BG.LOG_LEVEL_ERROR,
      backgroundPermissionRationale: {
        title: 'Let DonutNV tell you when a truck is nearby?',
        message: 'Choose "Allow all the time" so we can let you know when a truck '
               + 'is close, even when the app is closed.',
        positiveAction: 'Change to Allow all the time',
        negativeAction: 'Cancel',
      },
    })
    await BG.start()
    started = true
  },

  onLocation(cb) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },

  async stopTracking() {
    if (!started) return
    try {
      const BG = await plugin()
      await BG.stop()
      if (unsubscribeNative) unsubscribeNative()
    } catch (err) {
      console.error('[location] stop failed', err)
    } finally {
      unsubscribeNative = null
      started = false
    }
  },
}
