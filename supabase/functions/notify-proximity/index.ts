// ── Proximity alerts — Supabase Edge Function (audit-hardened) ──
// Runs on a schedule (every minute). Finds live trucks, finds customers whose
// saved area is within their alert radius, and sends a "truck is near you" web
// push — AT MOST ONCE per member per truck session (enforced via the
// proximity_pushes table), pruning dead push subscriptions as it goes.
//
// verify_jwt=false is intentional: cron can't send a JWT; access is gated by
// CRON_SECRET below (fail closed).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.6.7'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const VAPID_PUB = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIV = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
if (VAPID_PUB && VAPID_PRIV) {
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:party@donutnv.com', VAPID_PUB, VAPID_PRIV)
}

function distanceMeters(a: any, b: any) {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

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
  // Audit fix: don't attempt pushes without VAPID keys configured.
  if (!VAPID_PUB || !VAPID_PRIV) {
    return new Response(JSON.stringify({ ok: true, skipped: 'VAPID not configured', sent: 0 }), { headers: { 'content-type': 'application/json' } })
  }

  const { data: sessions } = await supabase.from('active_live_sessions').select('*')
  const { data: locs } = await supabase.from('truck_latest_location').select('*')
  const locByTruck: Record<string, any> = {}
  for (const l of locs ?? []) locByTruck[l.truck_id] = l

  let sent = 0
  for (const s of sessions ?? []) {
    const loc = locByTruck[s.truck_id]
    if (!loc) continue

    const { data: areas } = await supabase.from('saved_areas')
      .select('*, profiles!inner(id)').eq('tenant_id', s.tenant_id)

    for (const a of areas ?? []) {
      if ((a.lat == null || a.lng == null) && a.zip) {
        const g = await geocodeZip(a.zip)
        if (g) {
          a.lat = g.lat; a.lng = g.lng
          await supabase.from('saved_areas').update({ lat: g.lat, lng: g.lng }).eq('id', a.id)
        }
      }
      if (a.lat == null || a.lng == null) continue
      if (distanceMeters({ lat: a.lat, lng: a.lng }, { lat: loc.lat, lng: loc.lng }) > (a.radius_m ?? 4000)) continue

      // Audit fix: the "once per truck-session" promise is now actually enforced.
      // Claim the (session, profile) pair first; a duplicate-key error means we
      // already notified this member for this session — skip.
      const { error: claimErr } = await supabase.from('proximity_pushes')
        .insert({ session_id: s.id, profile_id: a.profile_id })
      if (claimErr) continue // 23505 duplicate (already notified) or transient — either way, don't spam

      const { data: subs } = await supabase.from('push_subscriptions')
        .select('*').eq('profile_id', a.profile_id)

      for (const sub of subs ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({
              title: 'DonutNV is near you!',
              body: `A truck is live at ${s.stop_name || 'a stop nearby'} until ${new Date(s.ends_at).toLocaleTimeString()}.`,
              url: '/',
            }),
          )
          sent++
        } catch (err) {
          // Audit fix: prune dead subscriptions (endpoint gone) instead of retrying forever.
          const sc = (err as any)?.statusCode
          if (sc === 404 || sc === 410) {
            await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          }
        }
      }
    }
  }
  return new Response(JSON.stringify({ ok: true, sent }), { headers: { 'content-type': 'application/json' } })
})
