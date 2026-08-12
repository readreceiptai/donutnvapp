// ── ELLE dashboard — Edge Function (v7: + event_url passthrough, info_bad flag, lead_outcome) ──
// Franchisee sees only their territory. Superadmin can pass tenant_id='ALL' to
// see every territory's leads (each tagged with its franchise), and gets the
// territory list for the switcher. Handles preference actions (mute/unmute,
// won-learning), a low-friction bad-info flag, and lead lifecycle outcomes.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const body = await req.json().catch(() => ({}))
  const c = await caller(req)
  if (!c) return json({ error: 'not signed in' }, 401)
  if (!ELLE_URL || !ELLE_KEY) return json({ configured: false }, 200)
  const elle = createClient(ELLE_URL, ELLE_KEY, { auth: { persistSession: false } })

  // Territory list for the superadmin switcher.
  let tenants: any[] | null = null
  if (c.isSuper) {
    const { data: list } = await elle.from('elle_tenants').select('id, franchise_name').eq('enabled', true).order('franchise_name')
    tenants = list ?? []
  }

  // Resolve the tenant to act on (own, chosen-by-superadmin, or ALL).
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

  // ---- Actions (per real tenant only, not ALL) ----
  if (!wantAll && tenant) {
    const et = String(body.event_type ?? '')
    const eid = body.event_id ? String(body.event_id) : ''
    if (body.action === 'mute' && et) {
      await elle.from('elle_event_type_prefs').upsert({ tenant_id: tenant.id, event_type: et, enabled: false }, { onConflict: 'tenant_id,event_type' })
    } else if (body.action === 'unmute' && et) {
      await elle.from('elle_event_type_prefs').upsert({ tenant_id: tenant.id, event_type: et, enabled: true }, { onConflict: 'tenant_id,event_type' })
    } else if (body.action === 'won_learn' && et) {
      // Reinforce: this is a type they win — nudge its weight up (capped), enable it.
      const { data: p } = await elle.from('elle_event_type_prefs').select('weight').eq('tenant_id', tenant.id).eq('event_type', et).maybeSingle()
      const w = Math.min(2.0, (Number(p?.weight) || 1.0) + 0.25)
      await elle.from('elle_event_type_prefs').upsert({ tenant_id: tenant.id, event_type: et, enabled: true, weight: w }, { onConflict: 'tenant_id,event_type' })
      await elle.rpc('elle_recompute_scores').catch(() => {})
    } else if (body.action === 'mark_info_bad' && eid) {
      // Z reached out and the info was bad — low-friction flag, reversible.
      await elle.from('elle_tenant_events').update({ info_bad: true, info_bad_at: new Date().toISOString() }).eq('tenant_id', tenant.id).eq('event_id', eid)
    } else if (body.action === 'clear_info_bad' && eid) {
      await elle.from('elle_tenant_events').update({ info_bad: false, info_bad_at: null }).eq('tenant_id', tenant.id).eq('event_id', eid)
    } else if (body.action === 'lead_outcome' && eid) {
      // Lifecycle: mark a pushed lead won/lost, or reopen (null).
      const oc = body.outcome === 'won' ? 'won' : body.outcome === 'lost' ? 'lost' : null
      await elle.from('elle_tenant_events').update({ outcome: oc }).eq('tenant_id', tenant.id).eq('event_id', eid)
      if (oc === 'won' && et) {
        const { data: p } = await elle.from('elle_event_type_prefs').select('weight').eq('tenant_id', tenant.id).eq('event_type', et).maybeSingle()
        const w = Math.min(2.0, (Number(p?.weight) || 1.0) + 0.25)
        await elle.from('elle_event_type_prefs').upsert({ tenant_id: tenant.id, event_type: et, enabled: true, weight: w }, { onConflict: 'tenant_id,event_type' })
        await elle.rpc('elle_recompute_scores').catch(() => {})
      }
    }
  }

  // ---- Build the board ----
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
