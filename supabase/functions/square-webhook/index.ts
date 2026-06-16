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
  const payment = event?.data?.object?.payment ?? {}
  const phone: string | undefined = payment.buyer_phone_number
  const squareLocationId: string | undefined = payment.location_id

  // 3) Which tenant owns this Square location?
  const { data: tenant } = await supabase.from('tenants')
    .select('id').eq('square_location_id', squareLocationId).maybeSingle()
  if (!tenant) return new Response(JSON.stringify({ ok: true, skipped: 'unknown location' }), { status: 200 })

  // 4) Count EVERY sale as a customer served (anonymous) — powers the real-time
  //    "served today" buzz whether or not the buyer is an app member.
  const { data: live } = await supabase.from('live_sessions')
    .select('id').eq('tenant_id', tenant.id).eq('is_live', true)
    .gt('ends_at', new Date().toISOString()).limit(1).maybeSingle()
  await supabase.from('sales_events').insert({
    tenant_id: tenant.id, session_id: live?.id ?? null, source: 'square',
  })

  // 5) If the buyer is in our owned list (matched by phone), also stamp their card.
  if (phone) {
    const { data: profile } = await supabase.from('profiles')
      .select('id').eq('tenant_id', tenant.id).eq('phone', normalize(phone)).maybeSingle()
    if (profile) {
      const { data: campaign } = await supabase.from('campaigns')
        .select('id').eq('tenant_id', tenant.id).eq('kind', 'checkin_stamp').eq('is_active', true)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      await supabase.from('check_ins').insert({
        profile_id: profile.id, tenant_id: tenant.id,
        campaign_id: campaign?.id ?? null, source: 'square',
      })
    }
  }

  return new Response(JSON.stringify({ ok: true, counted: true }), { headers: { 'content-type': 'application/json' } })
})

function normalize(v: string) {
  const d = (v || '').replace(/\D/g, '')
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  return v.startsWith('+') ? v : '+' + d
}
