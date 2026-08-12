// ── Square Loyalty sync — Supabase Edge Function (audit-hardened) ──
// Verifies the Square HMAC signature, parses, dedupes (idempotency), marks
// event deposits paid (with amount + currency check), records buzz, stamps the card.
//
// verify_jwt=false is intentional: Square can't send a Supabase JWT; requests
// are authenticated by the HMAC signature below (fail closed if key unset).
//
// Secrets: SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL (exact subscription URL)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const SIG_KEY = Deno.env.get('SQUARE_WEBHOOK_SIGNATURE_KEY') ?? ''

// Square signs: base64( HMAC-SHA256( signatureKey, notificationUrl + rawBody ) )
async function verifySquare(req: Request, rawBody: string): Promise<boolean> {
  if (!SIG_KEY) return false // fail closed: no key configured = reject
  const sent = req.headers.get('x-square-hmacsha256-signature') ?? ''
  if (!sent) return false
  const url = Deno.env.get('SQUARE_WEBHOOK_URL') || req.url
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(SIG_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(url + rawBody))
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)))
  return timingSafeEqual(expected, sent)
}

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

  // 1b) Idempotency: Square delivers at-least-once — skip duplicates.
  const eventId: string | undefined = event?.event_id
  if (eventId) {
    const { error: dupErr } = await supabase.from('processed_square_events').insert({ event_id: eventId })
    if (dupErr && (dupErr as { code?: string }).code === '23505') {
      return new Response(JSON.stringify({ ok: true, duplicate: true }), { headers: { 'content-type': 'application/json' } })
    }
  }

  // 2) Pull what we need from the Square event.
  const payment = event?.data?.object?.payment ?? {}
  const phone: string | undefined = payment.buyer_phone_number
  const squareLocationId: string | undefined = payment.location_id
  const orderId: string | undefined = payment.order_id
  const amountCents: number | null = Number.isFinite(payment?.amount_money?.amount)
    ? Number(payment.amount_money.amount) : null
  // Audit fix: check the currency too — a 500 of another currency isn't $5.00.
  const currency: string = String(payment?.amount_money?.currency ?? 'USD').toUpperCase()

  // 2b) Deposit payment for a booking we created? Match by stored Square order id,
  //     only when completed/approved, amount covers the deposit, and currency is USD.
  const paymentDone = ['COMPLETED', 'APPROVED', 'CAPTURED'].includes(String(payment.status || '').toUpperCase())
  if (orderId && paymentDone && currency === 'USD') {
    const { data: dep } = await supabase.from('bookings')
      .select('id, deposit_status, deposit_amount_cents').eq('square_order_id', orderId).maybeSingle()
    if (dep && dep.deposit_status !== 'paid'
        && amountCents != null
        && (dep.deposit_amount_cents == null || amountCents >= dep.deposit_amount_cents)) {
      await supabase.from('bookings').update({
        deposit_status: 'paid', deposit_paid_at: new Date().toISOString(),
      }).eq('id', dep.id)
    }
  }

  // 3) Which tenant owns this Square location?
  const { data: tenant } = await supabase.from('tenants')
    .select('id').eq('square_location_id', squareLocationId).maybeSingle()
  if (!tenant) return new Response(JSON.stringify({ ok: true, skipped: 'unknown location', depositMatched: !!orderId }), { status: 200 })

  // 4) Count EVERY sale as a customer served (anonymous).
  const { data: live } = await supabase.from('live_sessions')
    .select('id').eq('tenant_id', tenant.id).eq('is_live', true)
    .gt('ends_at', new Date().toISOString()).limit(1).maybeSingle()
  await supabase.from('sales_events').insert({
    tenant_id: tenant.id, session_id: live?.id ?? null, source: 'square', amount_cents: amountCents,
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
        campaign_id: campaign?.id ?? null, source: 'square', amount_cents: amountCents,
      })
      await supabase.from('wallet_passes')
        .update({ needs_push: true, updated_at: new Date().toISOString() })
        .eq('profile_id', profile.id)
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
