// ── ELLE dashboard — Edge Function (v14: business feed carries org_type / fundraiser-target fields) ──
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ELLE_URL = Deno.env.get('ELLE_SUPABASE_URL') ?? ''
const ELLE_KEY = Deno.env.get('ELLE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info, x-supabase-api-version',
  'access-control-allow-methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })
}

const PUBLIC_EVENT_TYPES = new Set([
  'large_public_festival', 'medium_public_festival', 'small_public_event',
  'music_festival', 'craft_arts_festival', 'farmers_market', 'food_truck_rally', 'sports_pro',
])

async function caller(req: Request): Promise<{ id: string; email: string; isSuper: boolean } | null> {
  const authz = req.headers.get('Authorization') ?? ''
  if (!authz) return null
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authz } } })
  const { data: { user } } = await asUser.auth.getUser()
  if (!user?.email) return null
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: prof } = await admin.from('profiles').select('is_superadmin').eq('id', user.id).maybeSingle()
  return { id: user.id, email: user.email, isSuper: !!prof?.is_superadmin }
}

function tag(r: any, franchise?: string) {
  return { ...r, segment: PUBLIC_EVENT_TYPES.has(r.event_type) ? 'event' : 'account', territory: franchise ?? null }
}

async function elleFn(name: string, payload: unknown) {
  const r = await fetch(`${ELLE_URL}/functions/v1/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${ELLE_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, result: j }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const body = await req.json().catch(() => ({}))
  const c = await caller(req)
  if (!c) return json({ error: 'not signed in' }, 401)
  if (!ELLE_URL || !ELLE_KEY) return json({ configured: false }, 200)
  const elle = createClient(ELLE_URL, ELLE_KEY, { auth: { persistSession: false } })

  let tenants: any[] | null = null
  if (c.isSuper) {
    const { data: list } = await elle.from('elle_tenants').select('id, franchise_name').eq('enabled', true).order('franchise_name')
    tenants = list ?? []
  }

  const wantAll = c.isSuper && body.tenant_id === 'ALL'
  let tenant: any = null
  if (!wantAll) {
    if (c.isSuper && body.tenant_id) {
      const { data } = await elle.from('elle_tenants').select('id, franchise_name, plan_tier').eq('id', body.tenant_id).maybeSingle()
      tenant = data
    } else {
      const { data } = await elle.from('elle_tenants').select('id, franchise_name, plan_tier').eq('primary_contact_email', c.email).maybeSingle()
      tenant = data
    }
    if (!tenant && c.isSuper && tenants && tenants.length) {
      const { data } = await elle.from('elle_tenants').select('id, franchise_name, plan_tier').eq('id', tenants[0].id).maybeSingle()
      tenant = data
    }
    if (!tenant) return json({ needsOnboarding: true, isSuperadmin: c.isSuper, tenants }, 200)
  }

  if (body.view === 'turned_down' && c.isSuper) {
    let q = elle.from('elle_tenant_events')
      .select('tenant_id, event_id, dismissed_at, decision, prior_outcome, score, elle_events(name, city, event_type, start_date, estimated_attendance)')
      .eq('dismissed', true).order('dismissed_at', { ascending: false }).limit(500)
    if (!wantAll && tenant) q = q.eq('tenant_id', tenant.id)
    const { data } = await q
    const nameById: Record<string, string> = {}
    for (const t of tenants ?? []) nameById[t.id] = t.franchise_name
    const rows = (data ?? []).map((r: any) => ({
      tenant_id: r.tenant_id, franchise: nameById[r.tenant_id] ?? 'Unknown', event_id: r.event_id,
      dismissed_at: r.dismissed_at, decision: r.decision, prior_outcome: r.prior_outcome, score: r.score,
      name: r.elle_events?.name, city: r.elle_events?.city, event_type: r.elle_events?.event_type,
      start_date: r.elle_events?.start_date, estimated_attendance: r.elle_events?.estimated_attendance,
    }))
    return json({ turned_down: rows, tenant: wantAll ? { id: 'ALL', franchise_name: 'All Territories' } : tenant, isSuperadmin: true, tenants })
  }

  if (body.action === 'biz_decision' && !wantAll && tenant && body.business_id) {
    const dec = body.decision ?? null
    await elle.from('elle_tenant_businesses').update({ decision: dec }).eq('tenant_id', tenant.id).eq('business_id', body.business_id)
    return json({ ok: true })
  }

  if ((body.action === 'find_linkedin' || body.action === 'find_press') && !wantAll && tenant && body.business_id) {
    // Paid enrichment (Apify/Apollo). Two guards, both required:
    // 1) Never spend for an unconfirmed tenant — enforce the confirm switch here,
    //    not just in the SQL orchestrators (this path reaches the paid fn directly).
    // 2) Never enrich a business that isn't on the caller's own board (ownership).
    const { data: t2 } = await elle.from('elle_tenants').select('paid_apis_enabled').eq('id', tenant.id).maybeSingle()
    if (!t2?.paid_apis_enabled) return json({ error: 'not_enabled', message: 'Paid enrichment is not enabled for this territory yet.' }, 403)
    const { data: owns } = await elle.from('elle_tenant_businesses').select('business_id').eq('tenant_id', tenant.id).eq('business_id', body.business_id).maybeSingle()
    if (!owns) return json({ error: 'not_found', message: 'That business is not on your board.' }, 404)
    const out = body.action === 'find_linkedin'
      ? await elleFn('elle-enrich-linkedin', { business_id: body.business_id, max_contacts: 6 })
      : await elleFn('elle-press-gm', { business_id: body.business_id })
    return json(out)
  }

  if (body.view === 'market' && !wantAll && tenant) {
    const { data: mr } = await elle.from('elle_market_reports').select('report, generated_at, next_refresh_at').eq('tenant_id', tenant.id).maybeSingle()
    return json({ tenant, market: mr?.report ?? null, generated_at: mr?.generated_at ?? null, next_refresh_at: mr?.next_refresh_at ?? null, isSuperadmin: c.isSuper, tenants })
  }

  // ---- Businesses view ----
  if (body.view === 'businesses' && !wantAll && tenant) {
    const { data: links } = await elle.from('elle_tenant_businesses')
      .select('business_id, decision, business:elle_businesses(id, name, city, zip, phone, website, industry, employee_count, size_bucket, enrichment_status, linkedin_company_url, org_type, is_fundraiser_target, review_count)')
      .eq('tenant_id', tenant.id)
    const rows = links ?? []
    const bizIds = rows.map((r: any) => r.business_id)
    const pocsByBiz: Record<string, any[]> = {}
    if (bizIds.length) {
      const { data: pocs } = await elle.from('elle_business_pocs').select('business_id, name, title, seniority, email, phone, source, linkedin_url, confidence').eq('is_bad', false).in('business_id', bizIds)
      for (const p of pocs ?? []) { (pocsByBiz[p.business_id] ??= []).push({ name: p.name, title: p.title, seniority: p.seniority, email: p.email, phone: p.phone, source: p.source, linkedin_url: p.linkedin_url, confidence: p.confidence }) }
      for (const k of Object.keys(pocsByBiz)) pocsByBiz[k].sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0))
    }
    const businesses = rows.map((r: any) => ({ ...(r.business ?? {}), decision: r.decision ?? null, pocs: pocsByBiz[r.business_id] ?? [] })).filter((b: any) => b.id)
    businesses.sort((a: any, b: any) => (Number(b.employee_count) || 0) - (Number(a.employee_count) || 0))
    return json({ tenant, businesses, isSuperadmin: c.isSuper, tenants })
  }

  if (!wantAll && tenant) {
    const et = String(body.event_type ?? '')
    if (body.action === 'mute' && et) {
      await elle.from('elle_event_type_prefs').upsert({ tenant_id: tenant.id, event_type: et, enabled: false }, { onConflict: 'tenant_id,event_type' })
    } else if (body.action === 'unmute' && et) {
      await elle.from('elle_event_type_prefs').upsert({ tenant_id: tenant.id, event_type: et, enabled: true }, { onConflict: 'tenant_id,event_type' })
    } else if (body.action === 'won_learn' && et) {
      const { data: p } = await elle.from('elle_event_type_prefs').select('weight').eq('tenant_id', tenant.id).eq('event_type', et).maybeSingle()
      const w = Math.min(2.0, (Number(p?.weight) || 1.0) + 0.25)
      await elle.from('elle_event_type_prefs').upsert({ tenant_id: tenant.id, event_type: et, enabled: true, weight: w }, { onConflict: 'tenant_id,event_type' })
      await elle.rpc('elle_recompute_scores').catch(() => {})
    } else if (body.action === 'lead_outcome' && body.event_id) {
      const oc = (body.outcome === 'won' || body.outcome === 'lost') ? body.outcome : null
      await elle.from('elle_tenant_events').update({ outcome: oc }).eq('tenant_id', tenant.id).eq('event_id', body.event_id)
      if (oc === 'won' && et) {
        const { data: p } = await elle.from('elle_event_type_prefs').select('weight').eq('tenant_id', tenant.id).eq('event_type', et).maybeSingle()
        const w = Math.min(2.0, (Number(p?.weight) || 1.0) + 0.25)
        await elle.from('elle_event_type_prefs').upsert({ tenant_id: tenant.id, event_type: et, enabled: true, weight: w }, { onConflict: 'tenant_id,event_type' })
        await elle.rpc('elle_recompute_scores').catch(() => {})
      }
    } else if (body.action === 'mark_info_bad' && body.event_id) {
      await elle.from('elle_tenant_events').update({ info_bad: true, info_bad_at: new Date().toISOString() }).eq('tenant_id', tenant.id).eq('event_id', body.event_id)
    } else if (body.action === 'clear_info_bad' && body.event_id) {
      await elle.from('elle_tenant_events').update({ info_bad: false, info_bad_at: null }).eq('tenant_id', tenant.id).eq('event_id', body.event_id)
    } else if (body.action === 'dismiss_lead' && body.event_id) {
      const dis = body.dismissed !== false
      await elle.from('elle_tenant_events').update({ dismissed: dis, dismissed_at: dis ? new Date().toISOString() : null }).eq('tenant_id', tenant.id).eq('event_id', body.event_id)
    }
  }

  if (wantAll) {
    const { data: rows } = await elle.from('elle_z_dashboard').select('*').order('score', { ascending: false }).limit(400)
    const nameById: Record<string, string> = {}
    for (const t of tenants ?? []) nameById[t.id] = t.franchise_name
    const events = (rows ?? []).map((r: any) => tag(r, nameById[r.tenant_id] ?? 'Unknown'))
    return json({ tenant: { id: 'ALL', franchise_name: 'All Territories' }, events, isSuperadmin: true, tenants, muted_types: [] })
  }

  const { data: rows } = await elle.from('elle_z_dashboard')
    .select('*').eq('tenant_id', tenant.id)
    .order('score', { ascending: false })
    .order('application_deadline', { ascending: true, nullsFirst: false })
    .limit(200)
  const events = (rows ?? []).map((r: any) => tag(r))

  const { data: prefs } = await elle.from('elle_event_type_prefs').select('event_type').eq('tenant_id', tenant.id).eq('enabled', false)
  const muted_types = (prefs ?? []).map((p: any) => p.event_type)

  return json({ tenant, events, isSuperadmin: c.isSuper, tenants, muted_types })
})
