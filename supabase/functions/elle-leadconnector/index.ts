// ── ELLE → LeadConnector — Edge Function (v7: store opp id on push + sync_outcomes w/ name-match backfill) ──
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ELLE_URL = Deno.env.get('ELLE_SUPABASE_URL') ?? ''
const ELLE_KEY = Deno.env.get('ELLE_SERVICE_ROLE_KEY') ?? ''
const LC = 'https://services.leadconnectorhq.com'
const LC_VERSION = '2021-07-28'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info, x-supabase-api-version',
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
async function caller(req: Request) {
  const authz = req.headers.get('Authorization') ?? ''
  if (!authz) return null
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authz } } })
  const { data: { user } } = await asUser.auth.getUser()
  if (!user?.email) return null
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: prof } = await admin.from('profiles').select('is_superadmin').eq('id', user.id).maybeSingle()
  return { email: user.email, isSuper: !!prof?.is_superadmin }
}

async function pushLead(elle: any, creds: any, tenantId: string, lead: any, map: Record<string,string>) {
  const hostName: string = lead.host_name || lead.name || 'Event organizer'
  const [firstName, ...rest] = String(hostName).split(' ')
  const email = lead.host_email || undefined
  const phone = normPhone(lead.host_phone)
  if (!email && !phone) return { ok: false, skipped: 'no_contact', event_id: lead.event_id }
  const headers = { Authorization: `Bearer ${creds.token}`, Version: LC_VERSION, 'Content-Type': 'application/json' }
  const cf: any[] = []
  const add = (name: string, val: any) => { const id = map[name.toLowerCase()]; if (id && val != null && String(val) !== '') cf.push({ id, field_value: String(val) }) }
  add('ELLE Event', lead.name); add('ELLE Event Date', lead.start_date); add('ELLE Score', lead.score)
  add('ELLE Attendance', lead.estimated_attendance); add('ELLE Deadline', lead.application_deadline); add('ELLE Apply URL', lead.application_url)
  const cRes = await fetch(`${LC}/contacts/upsert`, { method: 'POST', headers, body: JSON.stringify({
    locationId: creds.location_id, firstName: firstName || hostName, lastName: rest.join(' '), email, phone,
    source: 'ELLE — Event Lead', tags: ['elle-lead', lead.event_type, lead.city].filter(Boolean), customFields: cf }) })
  const contact = await cRes.json().catch(() => ({}))
  const contactId = contact?.contact?.id || contact?.id
  if (!cRes.ok || !contactId) return { ok: false, error: 'rejected', status: cRes.status, detail: contact?.message ?? contact, event_id: lead.event_id }
  const note = [`ELLE Event Lead`, `Event: ${lead.name ?? ''}`, `Date: ${lead.start_date ?? 'TBD'}`, `Est. attendance: ${lead.estimated_attendance ?? 'n/a'}`, `Score: ${lead.score ?? 'n/a'}`, lead.application_deadline ? `Apply by: ${lead.application_deadline}` : null, lead.application_url ? `Apply: ${lead.application_url}` : null].filter(Boolean).join('\n')
  await fetch(`${LC}/contacts/${contactId}/notes`, { method: 'POST', headers, body: JSON.stringify({ body: note }) }).catch(() => {})
  let opportunityId: string | undefined
  if (creds.pipeline_id && creds.stage_id) {
    const oRes = await fetch(`${LC}/opportunities/`, { method: 'POST', headers, body: JSON.stringify({ locationId: creds.location_id, pipelineId: creds.pipeline_id, pipelineStageId: creds.stage_id, contactId, name: `${lead.name} — ${lead.city ?? ''}`.trim(), status: 'open', monetaryValue: Number(lead.expected_revenue) || undefined }) })
    const opp = await oRes.json().catch(() => ({})); opportunityId = opp?.opportunity?.id || opp?.id
  }
  await elle.from('elle_tenant_events').update({ pushed_at: new Date().toISOString(), ghl_opportunity_id: opportunityId ?? null, ghl_contact_id: contactId, ghl_synced_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('event_id', lead.event_id)
  return { ok: true, contactId, opportunityId, event_id: lead.event_id }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!ELLE_URL || !ELLE_KEY) return json({ error: 'ELLE not connected' }, 503)
  const c = await caller(req)
  if (!c) return json({ error: 'not signed in' }, 401)
  const body = await req.json().catch(() => ({}))
  const elle = createClient(ELLE_URL, ELLE_KEY, { auth: { persistSession: false } })

  let tenantId: string | null = null
  if (c.isSuper && body.tenant_id && body.tenant_id !== 'ALL') tenantId = body.tenant_id
  else { const { data: t } = await elle.from('elle_tenants').select('id').eq('primary_contact_email', c.email).maybeSingle(); tenantId = t?.id ?? null }
  if (!tenantId) return json({ error: 'no_elle_tenant' }, 404)
  const action = body.action ?? 'status'

  if (action === 'status') {
    const { data } = await elle.from('elle_leadconnector').select('location_id, connected_at, push_count, pipeline_id, stage_id').eq('tenant_id', tenantId).maybeSingle()
    return json({ connected: !!data, location_id: data?.location_id ? maskId(data.location_id) : null, push_count: data?.push_count ?? 0, pipeline_ready: !!(data?.pipeline_id && data?.stage_id) })
  }
  if (action === 'disconnect') { await elle.from('elle_leadconnector').delete().eq('tenant_id', tenantId); return json({ connected: false }) }

  if (action === 'connect') {
    const token = String(body.token ?? '').trim(); const location_id = String(body.location_id ?? '').trim()
    if (!token || !location_id) return json({ error: 'Paste your LeadConnector token and Location ID.' }, 400)
    const test = await fetch(`${LC}/locations/${location_id}`, { headers: { Authorization: `Bearer ${token}`, Version: LC_VERSION, Accept: 'application/json' } }).catch(() => null)
    if (!test || !test.ok) return json({ error: 'That token or Location ID was rejected by LeadConnector. Double-check both and try again.', status: test?.status ?? 0 }, 400)
    await elle.from('elle_leadconnector').upsert({ tenant_id: tenantId, token, location_id, connected_at: new Date().toISOString() }, { onConflict: 'tenant_id' })
    return json({ connected: true, location_id: maskId(location_id) })
  }

  if (action === 'setup') {
    if (!c.isSuper) return json({ error: 'superadmin only' }, 403)
    const { data: creds } = await elle.from('elle_leadconnector').select('*').eq('tenant_id', tenantId).maybeSingle()
    if (!creds) return json({ error: 'not_connected' }, 400)
    const loc = creds.location_id; const h = { Authorization: `Bearer ${creds.token}`, Version: LC_VERSION, Accept: 'application/json' }; const hp = { ...h, 'Content-Type': 'application/json' }
    const pRes = await fetch(`${LC}/opportunities/pipelines?locationId=${loc}`, { headers: h }); const pJson: any = await pRes.json().catch(() => ({}))
    const pipelines = Array.isArray(pJson?.pipelines) ? pJson.pipelines : []
    const bookPipe = pipelines.find((p: any) => /book|donut|event|lead/i.test(p.name || '')) || pipelines[0]
    const entryStage = (bookPipe?.stages || []).find((s: any) => /new|lead|inbound|book/i.test(s.name || '')) || (bookPipe?.stages || [])[0]
    const cfRes = await fetch(`${LC}/locations/${loc}/customFields`, { headers: h }); const cfJson: any = await cfRes.json().catch(() => ({}))
    const existing = (cfJson?.customFields || []).map((f: any) => ({ id: f.id, name: f.name }))
    const want: Array<[string, string]> = [['ELLE Event','TEXT'],['ELLE Event Date','TEXT'],['ELLE Score','TEXT'],['ELLE Attendance','TEXT'],['ELLE Deadline','TEXT'],['ELLE Apply URL','TEXT'],['Event Date','TEXT'],['Event Type','TEXT'],['Start Time','TEXT'],['Guests','TEXT'],['Event Details','LARGE_TEXT'],['Tracking Link','TEXT']]
    const created: any[] = []; const errs: any[] = []
    for (const [name, dataType] of want) { if (existing.some((e: any) => (e.name || '').toLowerCase() === name.toLowerCase())) continue; const r = await fetch(`${LC}/locations/${loc}/customFields`, { method: 'POST', headers: hp, body: JSON.stringify({ name, dataType, model: 'contact' }) }); const j: any = await r.json().catch(() => ({})); if (r.ok) created.push(name); else errs.push({ name, status: r.status, detail: j?.message ?? j }) }
    if (bookPipe?.id && entryStage?.id) await elle.from('elle_leadconnector').update({ pipeline_id: bookPipe.id, stage_id: entryStage.id }).eq('tenant_id', tenantId)
    return json({ pipelineChosen: bookPipe ? { name: bookPipe.name, entryStage: entryStage?.name } : null, createdFields: created, fieldErrors: errs })
  }

  if (action === 'push') {
    const event_id = body.event_id; if (!event_id) return json({ error: 'event_id required' }, 400)
    const { data: creds } = await elle.from('elle_leadconnector').select('*').eq('tenant_id', tenantId).maybeSingle()
    if (!creds) return json({ error: 'not_connected' }, 400)
    const { data: lead } = await elle.from('elle_z_dashboard').select('*').eq('tenant_id', tenantId).eq('event_id', event_id).maybeSingle()
    if (!lead) return json({ error: 'lead not found' }, 404)
    const map = await fieldMap(creds.location_id, creds.token)
    const r = await pushLead(elle, creds, tenantId, lead, map)
    if (!r.ok) return json({ error: r.skipped === 'no_contact' ? 'no_contact_info' : 'LeadConnector rejected the lead', detail: r.detail }, r.skipped === 'no_contact' ? 422 : 502)
    await elle.from('elle_leadconnector').update({ last_push_at: new Date().toISOString(), push_count: (creds.push_count ?? 0) + 1 }).eq('tenant_id', tenantId)
    return json({ ok: true, contactId: r.contactId, opportunityId: r.opportunityId, opportunityCreated: !!r.opportunityId })
  }

  if (action === 'push_bulk') {
    const { data: creds } = await elle.from('elle_leadconnector').select('*').eq('tenant_id', tenantId).maybeSingle()
    if (!creds) return json({ error: 'not_connected' }, 400)
    const { data: leads } = await elle.from('elle_z_dashboard').select('*').eq('tenant_id', tenantId).order('score', { ascending: false })
    const { data: donerows } = await elle.from('elle_tenant_events').select('event_id').eq('tenant_id', tenantId).not('pushed_at', 'is', null)
    const done = new Set((donerows || []).map((d: any) => d.event_id))
    const todo = (leads || []).filter((l: any) => (l.host_email || l.host_phone) && !done.has(l.event_id)).slice(0, 75)
    const map = await fieldMap(creds.location_id, creds.token)
    let sent = 0, failed = 0, skipped = 0
    for (const lead of todo) { const r = await pushLead(elle, creds, tenantId, lead, map); if (r.ok) sent++; else if (r.skipped) skipped++; else failed++ }
    if (sent > 0) await elle.from('elle_leadconnector').update({ last_push_at: new Date().toISOString(), push_count: (creds.push_count ?? 0) + sent }).eq('tenant_id', tenantId)
    return json({ ok: true, considered: todo.length, sent, failed, skipped })
  }

  if (action === 'sync_outcomes') {
    const { data: creds } = await elle.from('elle_leadconnector').select('*').eq('tenant_id', tenantId).maybeSingle()
    if (!creds) return json({ error: 'not_connected' }, 400)
    const h = { Authorization: `Bearer ${creds.token}`, Version: LC_VERSION, Accept: 'application/json' }
    const pRes = await fetch(`${LC}/opportunities/pipelines?locationId=${creds.location_id}`, { headers: h })
    const pJson: any = await pRes.json().catch(() => ({}))
    const pipelines = Array.isArray(pJson?.pipelines) ? pJson.pipelines : []
    const stageName: Record<string, string> = {}; const stageKind: Record<string, string> = {}
    for (const p of pipelines) for (const s of (p.stages || [])) {
      stageName[s.id] = s.name
      stageKind[s.id] = /won|booked/i.test(s.name || '') ? 'won' : /lost/i.test(s.name || '') ? 'lost' : 'open'
    }
    const oRes = await fetch(`${LC}/opportunities/search?location_id=${creds.location_id}&limit=100`, { headers: h })
    const oJson: any = await oRes.json().catch(() => ({}))
    const opps = Array.isArray(oJson?.opportunities) ? oJson.opportunities : []
    const norm = (s: string) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
    const byId: Record<string, any> = {}; const byName: Record<string, any> = {}
    for (const o of opps) { if (o?.id) byId[o.id] = o; if (o?.name) byName[norm(o.name)] = o }
    const { data: pushed } = await elle.from('elle_tenant_events').select('event_id, ghl_opportunity_id').eq('tenant_id', tenantId).not('pushed_at', 'is', null)
    const { data: named } = await elle.from('elle_z_dashboard').select('event_id, name, city').eq('tenant_id', tenantId)
    const nameById: Record<string, any> = {}
    for (const n of (named || [])) nameById[n.event_id] = n
    let synced = 0, won = 0, lost = 0, backfilled = 0
    for (const row of (pushed || [])) {
      let opp: any = row.ghl_opportunity_id ? byId[row.ghl_opportunity_id] : null
      if (!opp) {
        const meta = nameById[row.event_id]
        if (meta) {
          const cand = norm(`${meta.name} — ${meta.city ?? ''}`)
          opp = byName[cand] || opps.find((o: any) => norm(o.name).startsWith(norm(meta.name)))
        }
      }
      if (!opp) continue
      const sid = opp?.pipelineStageId
      const kind = stageKind[sid] || 'open'
      const nm = stageName[sid] || null
      const st = String(opp?.status || '').toLowerCase()
      let outcome: string | null = null
      if (kind === 'won' || st === 'won') outcome = 'won'
      else if (kind === 'lost' || st === 'lost' || st === 'abandoned') outcome = 'lost'
      const patch: any = { lc_stage: nm, ghl_synced_at: new Date().toISOString(), outcome }
      if (!row.ghl_opportunity_id && opp?.id) { patch.ghl_opportunity_id = opp.id; backfilled++ }
      if (outcome === 'won') patch.booking_revenue = Number(opp?.monetaryValue) || null
      await elle.from('elle_tenant_events').update(patch).eq('tenant_id', tenantId).eq('event_id', row.event_id)
      synced++; if (outcome === 'won') won++; else if (outcome === 'lost') lost++
    }
    return json({ ok: true, opps_seen: opps.length, synced, backfilled, won, lost })
  }

  return json({ error: 'unknown action' }, 400)
})

function maskId(id: string) { if (id.length <= 6) return '•••'; return id.slice(0, 4) + '•••' + id.slice(-3) }
