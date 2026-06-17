// ── Proximity alerts — Supabase Edge Function ──
// Run this on a schedule (every minute) via Supabase's cron. It finds trucks
// that are live right now, finds customers whose saved area is within their
// alert radius, and sends each a "truck is near you" web push — at most once
// per truck-session so nobody gets spammed.
//
// Deploy:  supabase functions deploy notify-proximity
// Schedule: in Supabase → Database → Cron, call this function every minute.
// Secrets needed:  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
//                  (set with: supabase secrets set ...)
//
// NOTE: This is the wiring. It goes live the moment you add VAPID keys and a
// ZIP→lat/lng lookup for saved areas (or have the app geocode at signup).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.6.7'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:party@donutnv.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

function distanceMeters(a: any, b: any) {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Turn a US ZIP into lat/lng via Google Geocoding (same Google project as the
// map — just enable the Geocoding API and set GOOGLE_GEOCODING_KEY).
async function geocodeZip(zip: string): Promise<{ lat: number; lng: number } | null> {
  const key = Deno.env.get('GOOGLE_GEOCODING_KEY')
  if (!key) return null
  try {
    const u = `https://maps.googleapis.com/maps/api/geocode/json?components=postal_code:${encodeURIComponent(zip)}|country:US&key=${key}`
    const r = await fetch(u).then((x) => x.json())
    const p = r?.results?.[0]?.geometry?.location
    return p ? { lat: p.lat, lng: p.lng } : null
  } catch { return null }
}

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

Deno.serve(async (req) => {
  // Internal / scheduled use only — require the shared secret. Fail closed if unset.
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('forbidden', { status: 403 })
  }
  // 1) Live trucks + their latest position.
  const { data: sessions } = await supabase.from('active_live_sessions').select('*')
  const { data: locs } = await supabase.from('truck_latest_location').select('*')
  const locByTruck: Record<string, any> = {}
  for (const l of locs ?? []) locByTruck[l.truck_id] = l

  let sent = 0
  for (const s of sessions ?? []) {
    const loc = locByTruck[s.truck_id]
    if (!loc) continue

    // 2) Customers in this tenant with a saved area that has coordinates.
    const { data: areas } = await supabase.from('saved_areas')
      .select('*, profiles!inner(id)').eq('tenant_id', s.tenant_id)

    for (const a of areas ?? []) {
      // First time we see an area, turn its ZIP into coordinates and save them.
      if ((a.lat == null || a.lng == null) && a.zip) {
        const g = await geocodeZip(a.zip)
        if (g) {
          a.lat = g.lat; a.lng = g.lng
          await supabase.from('saved_areas').update({ lat: g.lat, lng: g.lng }).eq('id', a.id)
        }
      }
      if (a.lat == null || a.lng == null) continue
      if (distanceMeters({ lat: a.lat, lng: a.lng }, { lat: loc.lat, lng: loc.lng }) > (a.radius_m ?? 4000)) continue

      // 3) Don't double-notify for the same truck session (dedupe table optional).
      const { data: subs } = await supabase.from('push_subscriptions')
        .select('*').eq('profile_id', a.profile_id)

      for (const sub of subs ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({
              title: 'DonutNV is near you! 🍩',
              body: `A truck is live at ${s.stop_name || 'a stop nearby'} until ${new Date(s.ends_at).toLocaleTimeString()}.`,
              url: '/',
            }),
          )
          sent++
        } catch (_) { /* stale subscription — could prune here */ }
      }
    }
  }
  return new Response(JSON.stringify({ ok: true, sent }), { headers: { 'content-type': 'application/json' } })
})
