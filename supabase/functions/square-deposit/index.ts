// ── Square event deposit — Supabase Edge Function ──
// We use SQUARE (not Stripe) for deposits. The operator taps "Request deposit"
// on a booking; this creates a Square hosted payment link (Quick Pay) for the
// deposit amount, saves it on the booking, and pushes the link into GHL so a
// LeadConnector workflow texts/emails it (GHL stays the only sender).
//
// When the customer pays, Square fires payment.created → the square-webhook
// matches payment.order_id to the booking's square_order_id and marks it paid.
//
// Deploy:  supabase functions deploy square-deposit
// Secrets: SQUARE_ACCESS_TOKEN   (Square API access token — production)
//          SQUARE_API_BASE       (optional; default https://connect.squareup.com,
//                                  use https://connect.squareupsandbox.com to test)
//          SQUARE_LOCATION_ID    (fallback if the tenant has none on file)
//          GHL_API_TOKEN, GHL_LOCATION_ID  (to push the link for GHL to send)
//   supabase secrets set SQUARE_ACCESS_TOKEN=... SQUARE_LOCATION_ID=...
//
// Call with: { "booking_id": "<uuid>", "amount_cents": 5000 }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const SQUARE_BASE = Deno.env.get('SQUARE_API_BASE') || 'https://connect.squareup.com'
const SQUARE_TOKEN = Deno.env.get('SQUARE_ACCESS_TOKEN') ?? ''
const SQUARE_VERSION = '2024-10-17'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (!SQUARE_TOKEN) return json({ error: 'Square not connected yet (set SQUARE_ACCESS_TOKEN).' }, 503)

  const { booking_id, amount_cents } = await req.json().catch(() => ({}))
  if (!booking_id) return json({ error: 'booking_id required' }, 400)
  const amount = Math.round(Number(amount_cents))
  if (!Number.isFinite(amount) || amount < 100) return json({ error: 'amount_cents must be at least 100 ($1.00)' }, 400)

  const { data: b } = await supabase.from('bookings').select('*').eq('id', booking_id).single()
  if (!b) return json({ error: 'booking not found' }, 404)

  // If a deposit was already requested and is unpaid, return the existing link
  // (idempotent — don't spawn duplicate Square links / GHL messages).
  if (b.deposit_status === 'requested' && b.deposit_url) {
    return json({ ok: true, alreadyRequested: true, url: b.deposit_url })
  }
  if (b.deposit_status === 'paid') return json({ ok: true, alreadyPaid: true })

  // Which Square location collects this deposit?
  const { data: tenant } = await supabase.from('tenants')
    .select('square_location_id, name').eq('id', b.tenant_id).maybeSingle()
  const locationId = tenant?.square_location_id || Deno.env.get('SQUARE_LOCATION_ID')
  if (!locationId) return json({ error: 'No Square location on file for this territory.' }, 400)

  const appBase = Deno.env.get('APP_BASE_URL') || 'https://donutnvapp.com'

  // 1) Create the Square hosted payment link (Quick Pay).
  const linkRes = await fetch(`${SQUARE_BASE}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SQUARE_TOKEN}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotency_key: `dep-${booking_id}-${amount}`,
      quick_pay: {
        name: `DonutNV deposit — ${b.event_type || 'event'}${b.event_date ? ` ${b.event_date}` : ''}`,
        price_money: { amount, currency: 'USD' },
        location_id: locationId,
      },
      checkout_options: { redirect_url: `${appBase}/track/${b.tracking_token}` },
      pre_populated_data: {
        buyer_email: b.contact_email || undefined,
        buyer_phone_number: b.contact_phone || undefined,
      },
      payment_note: `DonutNV booking ${booking_id}`,
    }),
  })
  const linkJson = await linkRes.json().catch(() => ({}))
  if (!linkRes.ok) {
    return json({ error: 'Square rejected the request', detail: linkJson?.errors ?? linkJson }, 502)
  }
  const link = linkJson?.payment_link ?? {}
  const url: string | undefined = link.url
  if (!url) return json({ error: 'Square returned no payment link URL', detail: linkJson }, 502)

  // 2) Save the deposit on the booking.
  await supabase.from('bookings').update({
    deposit_amount_cents: amount,
    deposit_status: 'requested',
    deposit_url: url,
    deposit_link_id: link.id ?? null,
    square_order_id: link.order_id ?? null,
    deposit_requested_at: new Date().toISOString(),
  }).eq('id', booking_id)

  // 3) Push the link to GHL so a workflow sends it (GHL is the only sender).
  const ghlToken = Deno.env.get('GHL_API_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
  if (ghlToken && ghlLocation && b.ghl_contact_id) {
    await fetch(`https://services.leadconnectorhq.com/contacts/${b.ghl_contact_id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customFields: [
          { key: 'deposit_link', field_value: url },
          { key: 'deposit_amount', field_value: (amount / 100).toFixed(2) },
        ],
        tags: ['deposit-requested'],
      }),
    }).catch(() => {})
  }

  return json({ ok: true, url, amount_cents: amount, pushedToGhl: !!(ghlToken && b.ghl_contact_id) })
})
