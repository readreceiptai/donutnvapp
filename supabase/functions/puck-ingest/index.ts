// ============================================================================
// DonutNV — Hardware GPS puck ingestion
// ----------------------------------------------------------------------------
// Accepts location pings from a hardware tracker and writes them to the live
// map, with NO phone involved. Works with the common Traccar "OsmAnd" client
// (sends GET ?id=TOKEN&lat=..&lon=..) and with plain JSON POST {token,lat,lng}.
//
// How a ping becomes a live dot:
//   1. Look up the truck by its puck_token (see schema_puck.sql).
//   2. Insert a truck_locations row (what the customer map reads).
//   3. Keep a rolling live_session open (ends_at = now + 30 min) so the truck
//      shows as live while it's reporting, and auto-drops if the puck goes quiet.
//
// DEPLOY (when you have a puck):
//   supabase functions deploy puck-ingest --no-verify-jwt
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
//   (SUPABASE_URL is provided automatically.)
//
// POINT THE TRACKER AT IT:
//   Traccar OsmAnd server URL:
//     https://<project-ref>.functions.supabase.co/puck-ingest
//   Device identifier = the truck's puck_token.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SESSION_MINUTES = 30 // keep the truck "live" this long after each ping

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    const q = url.searchParams

    // Accept token+coords from query (Traccar/OsmAnd) or JSON body.
    let token = q.get('id') || q.get('token') || ''
    let lat = parseFloat(q.get('lat') || '')
    let lng = parseFloat(q.get('lon') || q.get('lng') || '')
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      token = body.token || body.id || token
      lat = Number.isFinite(lat) ? lat : parseFloat(body.lat)
      lng = Number.isFinite(lng) ? lng : parseFloat(body.lng ?? body.lon)
    }

    if (!token || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return new Response('missing token/lat/lng', { status: 400 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1. Which truck owns this token?
    const { data: truck } = await supabase.from('trucks')
      .select('id, tenant_id').eq('puck_token', token).maybeSingle()
    if (!truck) return new Response('unknown device', { status: 404 })

    // 2. Keep a rolling live session open for this truck.
    const endsAt = new Date(Date.now() + SESSION_MINUTES * 60000).toISOString()
    const { data: live } = await supabase.from('live_sessions')
      .select('id').eq('truck_id', truck.id).eq('is_live', true)
      .gt('ends_at', new Date().toISOString()).limit(1).maybeSingle()

    let sessionId = live?.id
    if (sessionId) {
      await supabase.from('live_sessions').update({ ends_at: endsAt }).eq('id', sessionId)
    } else {
      const { data: created } = await supabase.from('live_sessions').insert({
        tenant_id: truck.tenant_id, truck_id: truck.id,
        stop_name: 'On the move', is_live: true,
        started_at: new Date().toISOString(), ends_at: endsAt, source: 'manual',
      }).select('id').single()
      sessionId = created?.id
    }

    // 3. Record the position.
    await supabase.from('truck_locations').insert({
      tenant_id: truck.tenant_id, truck_id: truck.id, session_id: sessionId,
      lat, lng,
    })

    return new Response('ok', { status: 200 })
  } catch (e) {
    return new Response('error: ' + (e?.message || e), { status: 500 })
  }
})
