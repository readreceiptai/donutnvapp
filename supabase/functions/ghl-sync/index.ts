// ── Book-a-Truck → owning tenant's LeadConnector (v8: strict routing + corporate queue) ──
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const app = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const ELLE_URL = Deno.env.get('ELLE_SUPABASE_URL') ?? ''
const ELLE_KEY = Deno.env.get('ELLE_SERVICE_ROLE_KEY') ?? ''
const LC = 'https://services.leadconnectorhq.com'
const LC_VERSION = '2021-07-28'
const APP_BASE = Deno.env.get('APP_BASE_URL') || 'https://donutnvapp.com'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'access-control-allow-methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })
}
function normPhone(p: unknown): string | undefined {
  if (!p) return undefined
  const raw = String(p).trim()
  if (raw.startsWith('+')) { const k = raw.replace(/[^\d+]/g, ''); return k.length >= 11 ? k : undefined }
  const d = raw.replace(/\D/g, '')
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  return undefined
}
async function fieldMap(loc: string, token: string): Promise<Record<string, string>> {
  const m: Record<string, string> = {}
  try {
    const r = await fetch(`${LC}/locations/${loc}/customFields`, { headers: { Authorization: `Bearer ${token}`, Version: LC_VERSION, Accept: 'application/json' } })
    const j: any = await r.json().catch(() => ({}))
    for (const f of (j?.customFields || [])) if (f?.name && f?.id) m[String(f.name).toLowerCase()] = f.id
  } catch (_) { /* optional */ }
  return m
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const { booking_id, token } = await req.json().catch(() => ({}))
  if (!booking_id) return json({ error: 'booking_id required' }, 400)

  const { data: b } = await app.from('bookings').select('*').eq('id', booking_id).single()
  if (!b) return json({ error: 'booking not found' }, 404)
  if (!token || token !== b.tracking_token) return json({ error: 'unauthorized' }, 403)
  if (b.ghl_contact_id) return json({ ok: true, alreadySynced: true, contactId: b.ghl_contact_id, opportunityId: b.ghl_opportunity_id })

  // Strict routing: only the ASSIGNED owner (from route_booking) receives the lead.
  // Unrouted (off-platform-owned or orphan) leads are held for the corporate queue.
  const ownerId = b.assigned_tenant_id
  if (!ownerId) {
    return json({ ok: true, routed: false, queued: true, reason: b.assignment_reason || 'unrouted',
      message: 'No on-platform Z owns this ZIP; held in corporate queue for manual forwarding.' })
  }
  const { data: t } = await app.from('tenants').select('id, name, ghl_location_id').eq('id', ownerId).maybeSingle()
  const loc = t?.ghl_location_id
  if (!loc) return json({ ok: true, routed: false, reason: 'owning tenant has no LeadConnector location', tenant: t?.name ?? null })
  if (!ELLE_URL || !ELLE_KEY) return json({ error: 'ELLE not configured' }, 503)

  const elle = createClient(ELLE_URL, ELLE_KEY, { auth: { persistSession: false } })
  const { data: creds } = await elle.from('elle_leadconnector').select('token, location_id, pipeline_id, stage_id').eq('location_id', loc).maybeSingle()
  if (!creds?.token) return json({ ok: true, routed: false, reason: 'owning tenant LeadConnector not connected', tenant: t?.name ?? null })

  const headers = { Authorization: `Bearer ${creds.token}`, Version: LC_VERSION, 'Content-Type': 'application/json' }
  const [firstName, ...rest] = (b.contact_name || '').split(' ')
  const map = await fieldMap(loc, creds.token)
  const cf: any[] = []
  const add = (name: string, val: any) => { const id = map[name.toLowerCase()]; if (id && val != null && String(val) !== '') cf.push({ id, field_value: String(val) }) }
  add('Event Date', b.event_date); add('Event Type', b.event_type); add('Start Time', b.start_time)
  add('Guests', b.guests); add('Event Details', b.notes); add('Tracking Link', `${APP_BASE}/track/${b.tracking_token}`)

  const contactRes = await fetch(`${LC}/contacts/upsert`, {
    method: 'POST', headers,
    body: JSON.stringify({
      locationId: loc, firstName, lastName: rest.join(' '),
      email: b.contact_email || undefined, phone: normPhone(b.contact_phone),
      address1: b.address || undefined, city: b.city || undefined, postalCode: b.zip || undefined,
      source: 'DonutNV App — Book a Truck',
      tags: ['donutnv-app', 'book-a-truck', 'hot-lead', 'speed-to-lead',
        b.sms_consent ? 'sms-opt-in' : null, b.marketing_consent ? 'marketing-opt-in' : null].filter(Boolean),
      customFields: cf,
    }),
  })
  const contact = await contactRes.json().catch(() => ({}))
  const contactId = contact?.contact?.id || contact?.id
  if (!contactRes.ok || !contactId) {
    return json({ error: 'LeadConnector rejected the booking', status: contactRes.status, detail: contact?.message ?? contact }, 502)
  }

  const note = ['🔥 BOOK-A-TRUCK LEAD (from the app)',
    `Name: ${b.contact_name || ''}`, `Email: ${b.contact_email || ''}`, `Phone: ${b.contact_phone || ''}`,
    `Event date: ${b.event_date || 'TBD'}`, `Start time: ${b.start_time || 'TBD'}`,
    `Expected attendance: ${b.guests ?? 'n/a'}`, `ZIP: ${b.zip || ''}`,
    ``, `Details: ${b.notes || ''}`,
    ``, `Live tracking: ${APP_BASE}/track/${b.tracking_token}`].join('\n')
  await fetch(`${LC}/contacts/${contactId}/notes`, { method: 'POST', headers, body: JSON.stringify({ body: note }) }).catch(() => {})

  let opportunityId: string | undefined
  if (creds.pipeline_id && creds.stage_id) {
    const oppRes = await fetch(`${LC}/opportunities/`, {
      method: 'POST', headers,
      body: JSON.stringify({
        locationId: loc, pipelineId: creds.pipeline_id, pipelineStageId: creds.stage_id,
        contactId, name: `🔥 Book-a-Truck — ${b.contact_name || 'New'} (${b.event_date || 'date TBD'})`, status: 'open',
      }),
    })
    const opp = await oppRes.json().catch(() => ({}))
    opportunityId = opp?.opportunity?.id || opp?.id
  }

  await app.from('bookings').update({ ghl_contact_id: contactId, ghl_opportunity_id: opportunityId ?? null }).eq('id', booking_id)
  return json({ ok: true, routed: true, tenant: t?.name, contactId, opportunityId, opportunityCreated: !!opportunityId, fieldsSent: cf.length })
})
