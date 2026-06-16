// ── "On the way" text — Supabase Edge Function ──
// Per the plan, the APP fires the live on-the-way text (GHL handles the rest:
// confirmations, reminders, review requests). This sends one SMS to the booked
// client with their live tracking link the moment the truck heads out.
//
// Deploy:  supabase functions deploy send-enroute-sms
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM  (your DonutNV number)
//   supabase secrets set TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM=+1...
//
// Call with: { "booking_id": "<uuid>" }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  const { booking_id, kind = 'enroute' } = await req.json().catch(() => ({}))
  if (!booking_id) return json({ error: 'booking_id required' }, 400)

  const { data: b } = await supabase.from('bookings').select('*').eq('id', booking_id).single()
  if (!b) return json({ error: 'booking not found' }, 404)

  const base = Deno.env.get('APP_BASE_URL') || 'https://donutnvapp.com'
  const link = `${base}/track/${b.tracking_token}`
  // The app fires the live touchpoints; GHL handles the rest of the sequence.
  const messages: Record<string, string> = {
    enroute: `🍩 DonutNV is on the way to your event! Track us live & see our ETA: ${link}`,
    review:  `Thanks for having DonutNV! 🍩 How'd we do? Leave a quick review in the next hour for a sweet bonus toward your next event: ${link}`,
  }
  const body = messages[kind] ?? messages.enroute

  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')!
  const auth = Deno.env.get('TWILIO_AUTH_TOKEN')!
  const from = Deno.env.get('TWILIO_FROM')!

  const form = new URLSearchParams({ To: b.contact_phone, From: from, Body: body })
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${sid}:${auth}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  })
  const out = await res.json().catch(() => ({}))
  return json({ ok: res.ok, sid: out?.sid, link })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
