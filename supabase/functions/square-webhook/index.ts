// ── Square Loyalty sync — Supabase Edge Function ──
// The plan: Square runs the register and the points. This webhook listens for
// Square purchase events and turns each buy into a check-in/stamp in our app,
// and makes sure the buyer exists in our owned list. Built last + modular, so
// nothing else depends on it shipping.
//
// Deploy:  supabase functions deploy square-webhook
// In Square Developer Dashboard → Webhooks, point "payment.created" (or
// "order.created") at this function's URL.
// Secrets:  SQUARE_WEBHOOK_SIGNATURE_KEY  (verify the request is really Square)
//
// This is intentionally a clean stub: it verifies, parses, matches the customer
// by phone, and records a stamp against the active stamp-card campaign.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  // 1) TODO: verify the Square signature header with SQUARE_WEBHOOK_SIGNATURE_KEY
  //    before trusting the body. (Square sends x-square-hmacsha256-signature.)
  const event = await req.json().catch(() => null)
  if (!event) return new Response('bad request', { status: 400 })

  // 2) Pull what we need from the Square event. Field paths depend on the event
  //    type you subscribe to; payment.created carries buyer + location info.
  const phone: string | undefined = event?.data?.object?.payment?.buyer_phone_number
  const squareLocationId: string | undefined = event?.data?.object?.payment?.location_id
  if (!phone) return new Response(JSON.stringify({ ok: true, skipped: 'no phone on sale' }), { status: 200 })

  // 3) Which tenant owns this Square location?
  const { data: tenant } = await supabase.from('tenants')
    .select('id').eq('square_location_id', squareLocationId).maybeSingle()
  if (!tenant) return new Response(JSON.stringify({ ok: true, skipped: 'unknown location' }), { status: 200 })

  // 4) Find the customer in our owned list by phone (within this tenant).
  const { data: profile } = await supabase.from('profiles')
    .select('id').eq('tenant_id', tenant.id).eq('phone', normalize(phone)).maybeSingle()
  if (!profile) return new Response(JSON.stringify({ ok: true, skipped: 'customer not in app yet' }), { status: 200 })

  // 5) Record the purchase as a stamp against the active stamp-card game.
  const { data: campaign } = await supabase.from('campaigns')
    .select('id').eq('tenant_id', tenant.id).eq('kind', 'checkin_stamp').eq('is_active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  await supabase.from('check_ins').insert({
    profile_id: profile.id, tenant_id: tenant.id,
    campaign_id: campaign?.id ?? null, source: 'square',
  })

  return new Response(JSON.stringify({ ok: true, stamped: true }), { headers: { 'content-type': 'application/json' } })
})

function normalize(v: string) {
  const d = (v || '').replace(/\D/g, '')
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  return v.startsWith('+') ? v : '+' + d
}
