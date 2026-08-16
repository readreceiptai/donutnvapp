// ── Option B: location-ingest — Supabase Edge Function ──────────────────────
//
// Receives batched device positions from the native app's background-geolocation
// plugin and writes them to customer_positions / customer_latest_position via
// the ingest_customer_position RPC.
//
// verify_jwt is intentionally ON for this function (deploy WITHOUT --no-verify-jwt).
// Unlike the cron functions, this is called by real signed-in users, and the
// caller's identity is the whole security model: we take profile_id from the
// verified JWT and NEVER from the request body. A client cannot report a
// position on behalf of another user.
//
// The battery contract: the plugin buffers "significant location change" pings
// and flushes them in batches. Accepting batches is what lets the app stay off
// the radio between flushes, so this endpoint takes an array, not a single fix.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}

// Service-role client: the RPCs are service_role-only by design.
const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// A background plugin that has been offline can flush a large backlog. Cap it so
// one client cannot turn a flush into a write storm.
const MAX_BATCH = 100

type Fix = {
  lat?: number
  lng?: number
  latitude?: number
  longitude?: number
  accuracy?: number
  accuracy_m?: number
  recorded_at?: string
  timestamp?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  // ── Identify the caller from the JWT. This is the only source of profile_id. ──
  const authz = req.headers.get('Authorization') ?? ''
  if (!authz) return json({ error: 'unauthorized' }, 401)

  const asUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authz } } },
  )
  const { data: { user } } = await asUser.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = await req.json().catch(() => null)
  if (!body) return json({ error: 'invalid json' }, 400)

  // Accept either a single fix or a batch.
  const raw: Fix[] = Array.isArray(body?.positions)
    ? body.positions
    : (body?.lat != null || body?.latitude != null) ? [body] : []

  if (raw.length === 0) return json({ error: 'no positions supplied' }, 400)
  if (raw.length > MAX_BATCH) return json({ error: `batch too large (max ${MAX_BATCH})` }, 413)

  // ── Opt-in check, once per request rather than once per fix. ────────────────
  // The RPC re-checks this per row (it is the real enforcement point), but
  // short-circuiting here lets us tell the app to stop tracking immediately
  // instead of burning battery on writes that will all be rejected.
  const { data: prefs } = await admin
    .from('proximity_prefs')
    .select('enabled')
    .eq('profile_id', user.id)
    .maybeSingle()

  if (!prefs?.enabled) {
    // 200, not 403: this is a normal state (user turned it off on another
    // device), and the app should treat it as "stop", not as an error to retry.
    return json({ ok: true, accepted: 0, rejected: raw.length, tracking_enabled: false })
  }

  let accepted = 0
  let rejected = 0

  for (const f of raw) {
    const lat = f.lat ?? f.latitude
    const lng = f.lng ?? f.longitude
    const acc = f.accuracy_m ?? f.accuracy ?? null
    const at = f.recorded_at ?? f.timestamp ?? new Date().toISOString()

    if (typeof lat !== 'number' || typeof lng !== 'number') { rejected++; continue }

    const { data, error } = await admin.rpc('ingest_customer_position', {
      p_profile_id: user.id,
      p_lat: lat,
      p_lng: lng,
      p_accuracy_m: acc,
      p_recorded_at: at,
    })

    // The RPC returns false for coordinates it refuses (null island, bad
    // accuracy, opted out). That is a rejection, not a failure.
    if (error || data !== true) rejected++
    else accepted++
  }

  return json({ ok: true, accepted, rejected, tracking_enabled: true })
})
