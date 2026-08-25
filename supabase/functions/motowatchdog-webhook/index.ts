// ============================================================================
// DonutNV — MotoWatchdog puck webhook receiver
// ----------------------------------------------------------------------------
// Inbound webhook: MotoWatchdog POSTs a puck's GPS position here; we plot it on
// the live customer map. Public (no JWT) — authenticated by a shared ?key=
// secret. Deployed to the APP Supabase project with --no-verify-jwt.
//
// Write path mirrors puck-ingest (truck_latest_location is a VIEW, not writable):
//   1) resolve external_id -> truck (trucks.motowatchdog_external_id)
//   2) keep a rolling PUBLIC live_session open (so the truck shows as "live")
//   3) insert a truck_locations row (the map's truck_latest_location view reads
//      the newest row per truck)
//
// Configure the webhook URL in MotoWatchdog as:
//   https://<project-ref>.supabase.co/functions/v1/motowatchdog-webhook?key=<MW_WEBHOOK_SECRET>
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)
const WEBHOOK_SECRET = Deno.env.get('MW_WEBHOOK_SECRET') ?? ''
const SESSION_MINUTES = 30 // keep a truck "live" this long after each ping

// Pull the newest TripLocation out of whatever shape MotoWatchdog sends.
// Handles a single point, { trip_location }, { location }, or a
// { data: { trip_locations: [...] } } array (the last element is newest).
function latestLocation(body: any) {
  const arr = body?.data?.trip_locations ?? body?.trip_locations
  const loc = Array.isArray(arr) && arr.length ? arr[arr.length - 1]
    : (body?.trip_location ?? body?.location ?? body)
  if (loc?.latitude == null || loc?.longitude == null) return null
  return {
    lat: Number(loc.latitude),
    lng: Number(loc.longitude),
    occurred_at: loc.occurred_at ?? loc.timestamp ?? null,
    speed: loc.speed ?? null,
    address: loc.address ?? null,
  }
}

// The device reference; we assume external_id (raw log confirms on first POST).
function deviceRef(body: any) {
  return body?.external_id ?? body?.device_id ?? body?.imei
    ?? body?.device?.external_id ?? body?.device?.id ?? null
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  // Fail-closed: require the shared secret AND that it is configured.
  if (!WEBHOOK_SECRET || url.searchParams.get('key') !== WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 })
  }

  let body: any
  try { body = await req.json() } catch { body = {} }

  // 1) Always capture the raw payload first (best-effort; never block on it).
  try { await supabase.from('motowatchdog_webhook_log').insert({ body }) } catch { /* noop */ }

  // 2) Parse device + newest position.
  const ext = deviceRef(body)
  const loc = latestLocation(body)
  if (!ext || !loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
    return new Response('ok (no position)', { status: 200 })
  }
  // Reject implausible coordinates (out of range / 0,0 null island).
  if (loc.lat < -90 || loc.lat > 90 || loc.lng < -180 || loc.lng > 180 || (loc.lat === 0 && loc.lng === 0)) {
    return new Response('ok (bad coordinates)', { status: 200 })
  }

  // 3) Resolve external_id -> truck.
  const { data: truck } = await supabase.from('trucks')
    .select('id, tenant_id')
    .eq('motowatchdog_external_id', String(ext))
    .maybeSingle()
  if (!truck) return new Response('ok (unregistered device)', { status: 200 })

  const recordedAt = loc.occurred_at ?? new Date().toISOString()
  const nowIso = new Date().toISOString()
  const endsAt = new Date(Date.now() + SESSION_MINUTES * 60000).toISOString()

  // 4) Keep a rolling PUBLIC live session open for this truck.
  const { data: live } = await supabase.from('live_sessions')
    .select('id').eq('truck_id', truck.id).eq('is_live', true)
    .gt('ends_at', nowIso).limit(1).maybeSingle()

  let sessionId = live?.id
  if (sessionId) {
    await supabase.from('live_sessions').update({ ends_at: endsAt }).eq('id', sessionId)
  } else {
    const { data: created } = await supabase.from('live_sessions').insert({
      tenant_id: truck.tenant_id, truck_id: truck.id,
      stop_name: 'On the move', is_live: true, visibility: 'public',
      started_at: nowIso, ends_at: endsAt, source: 'manual', // live_sessions.source CHECK: manual|schedule
    }).select('id').single()
    sessionId = created?.id
  }

  // 5) Record the position (truck_latest_location view = newest row per truck).
  await supabase.from('truck_locations').insert({
    tenant_id: truck.tenant_id, truck_id: truck.id, session_id: sessionId,
    lat: loc.lat, lng: loc.lng, recorded_at: recordedAt,
  })

  return new Response('ok', { status: 200 })
})
