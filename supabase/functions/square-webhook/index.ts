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
//           SQUARE_WEBHOOK_URL            (the EXACT subscription URL from Square's
//                                          dashboard — used in the signature base)
//   supabase secrets set SQUARE_WEBHOOK_SIGNATURE_KEY=... SQUARE_WEBHOOK_URL=...
//
// This verifies the Square HMAC signature, parses, matches the customer by
// phone, records an anonymous sale (buzz), and stamps the card if a member.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const SIG_KEY = Deno.env.get('SQUARE_WEBHOOK_SIGNATURE_KEY') ?? ''

// Square signs: base64( HMAC-SHA256( signatureKey, notificationUrl + rawBody ) )
// and sends it in the x-square-hmacsha256-signature header. We must hash the
// RAW request body (not re-serialized JSON) for the signature to match.
async function verifySquare(req: Request, rawBody: string): Promise<boolean> {
  if (!SIG_KEY) return false // fail closed: no key configured = reject
  const sent = req.headers.get('x-square-hmacsha256-signature') ?? ''
  if (!sent) return false
  // Use the exact configured URL if provided, else the request URL.
  const url = Deno.env.get('SQUARE_WEBHOOK_URL') || req.url
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(SIG_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(url + rawBody))
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)))
  return timingSafeEqual(expected, sent)
}

// Constant-time string compare so we don't leak the signature via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  // 1) Verify the Square signature BEFORE trusting anything in the body.
  const rawBody = await req.text()
  if (!(await verifySquare(req, rawBody))) {
    return new Response('invalid signature', { status: 401 })
  }
  const event = (() => { try { return JSON.parse(rawBody) } catch { return null } })()
  if (!event) return new Response('bad request', { status: 400 })

  // 2) Pull what we need from the Square event. Field paths depend on the event
  //    type you subscribe to; payment.created carries buyer + location info.
  const payment = event?.data?.object?.payment ?? {}
  const phone: string | undefined = payment.buyer_phone_number
  const squareLocationId: string | undefined = payment.location_id
  const orderId: string | undefined = payment.order_id

  // 2b) Is this the payment for an event deposit we requested? Match by the
  //     Square order id we stored when creating the payment link, and only when
  //     Square reports the payment completed/approved.
  const paymentDone = ['COMPLETED', 'APPROVED', 'CAPTURED'].includes(String(payment.status || '').toUpperCase())
  if (orderId && paymentDone) {
    const { data: dep } = await supabase.from('bookings')
      .select('id, deposit_status').eq('square_order_id', orderId).maybeSingle()
    if (dep && dep.deposit_status !== 'paid') {
      await supabase.from('bookings').update({
        deposit_status: 'paid', deposit_paid_at: new Date().toISOString(),
      }).eq('id', dep.id)
    }
  }

  // 3) Which tenant owns this Square location?
  const { data: tenant } = await supabase.from('tenants')
    .select('id').eq('square_location_id', squareLocationId).maybeSingle()
  if (!tenant) return new Response(JSON.stringify({ ok: true, skipped: 'unknown location', depositMatched: !!orderId }), { status: 200 })

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
