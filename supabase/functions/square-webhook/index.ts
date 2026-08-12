// ── Square Loyalty sync — Supabase Edge Function (audit-hardened) ──
// Verifies the Square HMAC signature, then processes the event ATOMICALLY via the
// process_square_sale RPC (dedup + deposit + sale + loyalty stamp in ONE transaction),
// so a crash mid-way can never lose or double a loyalty stamp.
//
// verify_jwt=false is intentional: Square can't send a Supabase JWT; requests are
// authenticated by the HMAC signature below (fail closed if key unset).
// Secrets: SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL (exact subscription URL)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const SIG_KEY = Deno.env.get('SQUARE_WEBHOOK_SIGNATURE_KEY') ?? ''

async function verifySquare(req: Request, rawBody: string): Promise<boolean> {
  if (!SIG_KEY) return false
  const sent = req.headers.get('x-square-hmacsha256-signature') ?? ''
  if (!sent) return false
  const url = Deno.env.get('SQUARE_WEBHOOK_URL') || req.url
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(SIG_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
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
function normalize(v: string) {
  const d = (v || '').replace(/\D/g, '')
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  return v.startsWith('+') ? v : '+' + d
}

Deno.serve(async (req) => {
  const rawBody = await req.text()
  if (!(await verifySquare(req, rawBody))) return new Response('invalid signature', { status: 401 })
  const event = (() => { try { return JSON.parse(rawBody) } catch { return null } })()
  if (!event) return new Response('bad request', { status: 400 })

  const payment = event?.data?.object?.payment ?? {}
  const phone = payment.buyer_phone_number ? normalize(payment.buyer_phone_number) : null
  const amountCents = Number.isFinite(payment?.amount_money?.amount) ? Number(payment.amount_money.amount) : null
  const currency = String(payment?.amount_money?.currency ?? 'USD').toUpperCase()
  const paymentDone = ['COMPLETED', 'APPROVED', 'CAPTURED'].includes(String(payment.status || '').toUpperCase()) && currency === 'USD'

  // All DB work happens atomically inside the RPC (dedup + deposit + sale + stamp).
  const { data, error } = await supabase.rpc('process_square_sale', {
    p_event_id: event?.event_id ?? null,
    p_square_location: payment.location_id ?? null,
    p_order_id: payment.order_id ?? null,
    p_payment_done: paymentDone,
    p_phone: phone,
    p_amount_cents: amountCents,
  })
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { 'content-type': 'application/json' } })
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
})
