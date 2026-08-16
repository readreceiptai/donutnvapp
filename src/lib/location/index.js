// ── Proximity tracking: the app-facing API ─────────────────────────────────
//
// This is the only module the UI imports. It owns the buffer-and-flush loop
// between the provider (which emits fixes) and location-ingest (which stores
// them). Nothing here knows which plugin is underneath.
//
//   enableProximityAlerts(profile)  — opt in, persist prefs, start tracking
//   disableProximityAlerts(profile) — opt out, stop tracking, flush nothing
//   resumeProximityAlerts(profile)  — on app launch, restart if already opted in
//   getProximityPrefs(profile)      — read current settings

import { supabase } from '../supabase'
import { getProvider } from './provider.js'
import { FLUSH_BATCH_SIZE, FLUSH_INTERVAL_MS, MAX_BUFFER } from './config.js'

let buffer = []
let flushTimer = null
let unsubscribe = null
let running = false

// ── Flush ───────────────────────────────────────────────────────────────────

async function flush() {
  if (buffer.length === 0) return

  // Take the batch out of the buffer BEFORE awaiting, so fixes arriving during
  // the request are not lost or double-sent.
  const batch = buffer
  buffer = []

  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      // Not signed in (token expired). Keep the newest fixes and try later
      // rather than silently dropping the customer's position history.
      buffer = batch.slice(-MAX_BUFFER).concat(buffer)
      return
    }

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/location-ingest`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ positions: batch }),
    })

    if (!res.ok) {
      buffer = batch.slice(-MAX_BUFFER).concat(buffer)
      return
    }

    const out = await res.json().catch(() => ({}))

    // The server is the authority on opt-in state. If the customer turned
    // alerts off on another device, stop burning battery here immediately.
    if (out.tracking_enabled === false) {
      await stopTracking()
    }
  } catch (err) {
    // Offline. Requeue the newest fixes; the next flush retries.
    console.warn('[location] flush failed, requeuing', err)
    buffer = batch.slice(-MAX_BUFFER).concat(buffer)
  }
}

function onFix(fix) {
  buffer.push(fix)
  // Drop OLDEST on overflow: for "where is this customer now", the newest fix
  // is the one that matters.
  if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER)
  if (buffer.length >= FLUSH_BATCH_SIZE) flush()
}

// ── Start / stop ────────────────────────────────────────────────────────────

async function startTracking() {
  if (running) return
  const provider = await getProvider()
  unsubscribe = provider.onLocation(onFix)
  await provider.startTracking()
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS)
  running = true
}

async function stopTracking() {
  if (!running) return
  const provider = await getProvider()
  await provider.stopTracking()
  if (unsubscribe) unsubscribe()
  if (flushTimer) clearInterval(flushTimer)
  unsubscribe = null
  flushTimer = null
  running = false
  buffer = []
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Current provider capabilities, for the opt-in UI. */
export async function getLocationCapability() {
  const provider = await getProvider()
  return {
    name: provider.name,
    supportsBackground: provider.supportsBackground !== false,
    available: await provider.isAvailable(),
  }
}

export async function getProximityPrefs(profile) {
  if (!profile?.id) return null
  const { data } = await supabase
    .from('proximity_prefs')
    .select('*')
    .eq('profile_id', profile.id)
    .maybeSingle()
  return data
}

/**
 * Opt in. Order matters: we ask the OS for permission FIRST and only write the
 * opt-in row if it is granted, so the database never claims a customer is
 * opted in while the OS is refusing to give us location.
 *
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function enableProximityAlerts(profile, opts = {}) {
  if (!profile?.id || !profile?.tenant_id) {
    return { ok: false, reason: 'You need to be signed in.' }
  }

  const provider = await getProvider()
  if (!(await provider.isAvailable())) {
    return { ok: false, reason: 'This device cannot do location alerts.' }
  }

  const perm = await provider.requestPermission()
  if (perm === 'denied') {
    return {
      ok: false,
      reason: 'Location is turned off for DonutNV. You can turn it back on in Settings.',
    }
  }

  const { error } = await supabase.from('proximity_prefs').upsert({
    profile_id: profile.id,
    tenant_id: profile.tenant_id,
    enabled: true,
    radius_miles: opts.radiusMiles ?? 5,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
  }, { onConflict: 'profile_id' })

  if (error) return { ok: false, reason: 'Could not save your settings. Try again.' }

  await startTracking()
  // Send one fix immediately so the customer is matchable right away rather
  // than only after their first 500m of movement.
  setTimeout(flush, 2000)
  return { ok: true }
}

/** Opt out. Stops tracking and flips the DB flag, which also blocks ingest. */
export async function disableProximityAlerts(profile) {
  await stopTracking()
  if (!profile?.id) return { ok: true }
  const { error } = await supabase
    .from('proximity_prefs')
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq('profile_id', profile.id)
  return error ? { ok: false, reason: 'Could not save. Try again.' } : { ok: true }
}

/** Call on app launch: restart tracking only if the customer already opted in. */
export async function resumeProximityAlerts(profile) {
  const prefs = await getProximityPrefs(profile)
  if (!prefs?.enabled) return false
  await startTracking()
  return true
}

/** Update radius without re-running the permission flow. */
export async function setProximityRadius(profile, radiusMiles) {
  if (!profile?.id) return { ok: false }
  const { error } = await supabase
    .from('proximity_prefs')
    .update({ radius_miles: radiusMiles, updated_at: new Date().toISOString() })
    .eq('profile_id', profile.id)
  return { ok: !error }
}

// Exposed for the dev harness / QA.
export const __internals = { flush, startTracking, stopTracking }
