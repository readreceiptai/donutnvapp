// ── GHL / LeadConnector sync — Supabase Edge Function ──
// When a booking is created, push the contact + an opportunity into GHL so your
// LeadConnector workflows (confirmations, reminders, review requests) take over.
// Writes the GHL ids back onto the booking.
//
// Deploy:  supabase functions deploy ghl-sync
// Secrets: GHL_API_TOKEN        (Private Integration / OAuth token for LeadConnector v2)
//          GHL_LOCATION_ID      (the sub-account / location id)
//          GHL_PIPELINE_ID      (optional — pipeline to create the opportunity in)
//          GHL_PIPELINE_STAGE_ID(optional — stage for new event leads)
//   supabase secrets set GHL_API_TOKEN=... GHL_LOCATION_ID=... GHL_PIPELINE_ID=... GHL_PIPELINE_STAGE_ID=...
//
// Call with: { "booking_id": "<uuid>" }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const GHL = 'https://services.leadconnectorhq.com'
const TOKEN = Deno.env.get('GHL_API_TOKEN')!
const LOCATION = Deno.env.get('GHL_LOCATION_ID')!
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Version: '2021-07-28',
  'Content-Type': 'application/json',
}

Deno.serve(async (req) => {
  const { booking_id } = await req.json().catch(() => ({}))
  if (!booking_id) return json({ error: 'booking_id required' }, 400)

  const { data: b } = await supabase.from('bookings').select('*').eq('id', booking_id).single()
  if (!b) return json({ error: 'booking not found' }, 404)

  // Idempotency: this function is invoked from the browser right after a booking
  // is created. If it's already been synced, return early so a replay can't
  // create duplicate GHL contacts/opportunities.
  if (b.ghl_contact_id) {
    return json({ ok: true, alreadySynced: true, contactId: b.ghl_contact_id, opportunityId: b.ghl_opportunity_id })
  }

  const [firstName, ...rest] = (b.contact_name || '').split(' ')

  // 1) Upsert the contact in GHL.
  const contactRes = await fetch(`${GHL}/contacts/upsert`, {
    method: 'POST', headers,
    body: JSON.stringify({
      locationId: LOCATION,
      firstName, lastName: rest.join(' '),
      phone: b.contact_phone, email: b.contact_email,
      address1: b.address, city: b.city, postalCode: b.zip,
      source: 'DonutNV App — Book a Truck',
      tags: [
        'donutnv-app', 'event-lead', b.event_type,
        b.sms_consent ? 'sms-opt-in' : null,
        b.marketing_consent ? 'marketing-opt-in' : null,
      ].filter(Boolean),
      customFields: [
        { key: 'event_date', field_value: b.event_date },
        { key: 'event_type', field_value: b.event_type },
        { key: 'guests', field_value: String(b.guests ?? '') },         // expected attendance
        { key: 'event_details', field_value: b.notes ?? '' },           // "tell us about your event"
        { key: 'tracking_link', field_value: trackingLink(b) },
      ],
    }),
  })
  const contact = await contactRes.json().catch(() => ({}))
  const contactId = contact?.contact?.id || contact?.id

  // 2) Create an opportunity in the events pipeline (if configured).
  let opportunityId: string | undefined
  const pipelineId = Deno.env.get('GHL_PIPELINE_ID')
  if (pipelineId && contactId) {
    const oppRes = await fetch(`${GHL}/opportunities/`, {
      method: 'POST', headers,
      body: JSON.stringify({
        locationId: LOCATION, pipelineId,
        pipelineStageId: Deno.env.get('GHL_PIPELINE_STAGE_ID'),
        contactId, name: `${b.contact_name} — ${b.event_type || 'Event'} ${b.event_date || ''}`.trim(),
        status: 'open',
      }),
    })
    const opp = await oppRes.json().catch(() => ({}))
    opportunityId = opp?.opportunity?.id || opp?.id
  }

  // 3) Write the GHL ids back onto the booking.
  await supabase.from('bookings').update({
    ghl_contact_id: contactId ?? null,
    ghl_opportunity_id: opportunityId ?? null,
  }).eq('id', booking_id)

  return json({ ok: true, contactId, opportunityId })
})

function trackingLink(b: any) {
  const base = Deno.env.get('APP_BASE_URL') || 'https://donutnvapp.com'
  return `${base}/track/${b.tracking_token}`
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
