// Platform dashboard metrics: merges The Window (customer app) + ELLE (lead engine),
// per territory and network-wide. Superadmin sees all; a franchisee sees their own.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ELLE_URL = Deno.env.get('ELLE_SUPABASE_URL') ?? ''
const ELLE_KEY = Deno.env.get('ELLE_SERVICE_ROLE_KEY') ?? ''
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info, x-supabase-api-version', 'access-control-allow-methods': 'POST, OPTIONS' }
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'content-type': 'application/json' } }) }
const one = (v: any) => Array.isArray(v) ? (v[0] ?? {}) : (v ?? {})
const num = (v: any) => Number(v) || 0

async function caller(req: Request) {
  const authz = req.headers.get('Authorization') ?? ''
  if (!authz) return null
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authz } } })
  const { data: { user } } = await asUser.auth.getUser()
  if (!user?.id) return null
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: prof } = await admin.from('profiles').select('is_superadmin, tenant_id').eq('id', user.id).maybeSingle()
  return { id: user.id, email: user.email, isSuper: !!prof?.is_superadmin, tenantId: prof?.tenant_id }
}

async function windowFor(admin: any, t: any) {
  const { count: customers } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('tenant_id', t.id).eq('role', 'customer')
  const { data: p } = await admin.rpc('get_territory_pulse', { p_tenant: t.id }).catch(() => ({ data: null }))
  const { data: w } = await admin.rpc('get_wallet_metrics', { p_tenant: t.id }).catch(() => ({ data: null }))
  const pulse = one(p), wallet = one(w)
  return {
    name: t.name, slug: t.slug, has_app: t.has_app !== false, has_elle: !!t.has_elle,
    customers: customers ?? 0, signups_week: num(pulse.signups_week), signups_today: num(pulse.signups_today),
    served_week: num(pulse.served_week), bookings_week: num(pulse.bookings_week), reviews_week: num(pulse.reviews_week),
    sales_week: Math.round(num(pulse.revenue_week_cents) / 100),
    passes_installed: num(wallet.passes_installed), wallet_members: num(wallet.wallet_members),
    wallet_revenue: Math.round(num(wallet.wallet_member_revenue_cents) / 100),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const c = await caller(req)
  if (!c) return json({ error: 'not signed in' }, 401)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const elle = ELLE_URL && ELLE_KEY ? createClient(ELLE_URL, ELLE_KEY, { auth: { persistSession: false } }) : null

  // ELLE side (per elle tenant)
  let elleByTenant: Record<string, any> = {}
  let elleTenants: any[] = []
  if (elle) {
    const { data: em } = await elle.rpc('elle_metrics').catch(() => ({ data: {} }))
    elleByTenant = em || {}
    const { data: et } = await elle.from('elle_tenants').select('id, franchise_name').eq('enabled', true).order('franchise_name')
    elleTenants = et || []
  }

  // Window side (per app tenant)
  let appTenants: any[] = []
  if (c.isSuper) { const { data } = await admin.from('tenants').select('id, name, slug, has_app, has_elle'); appTenants = data || [] }
  else if (c.tenantId) { const { data } = await admin.from('tenants').select('id, name, slug, has_app, has_elle').eq('id', c.tenantId).maybeSingle(); if (data) appTenants = [data] }

  const windowByTenant: Record<string, any> = {}
  for (const t of appTenants) windowByTenant[t.id] = await windowFor(admin, t)

  // Network rollups
  const sumKeys = (obj: Record<string, any>, keys: string[]) => {
    const out: Record<string, number> = {}
    for (const k of keys) out[k] = Object.values(obj).reduce((a: number, r: any) => a + num(r[k]), 0)
    return out
  }
  const windowNetwork = sumKeys(windowByTenant, ['customers','signups_week','served_week','bookings_week','reviews_week','sales_week','passes_installed','wallet_members','wallet_revenue'])
  const elleNetwork = sumKeys(elleByTenant, ['leads','contactable','sent_lc','won','lost','booked_revenue','pipeline','turned_down','rebook','recycle','businesses','biz_contactable','active_clients'])

  return json({
    isSuper: c.isSuper,
    window: { byTenant: windowByTenant, network: windowNetwork, tenants: appTenants },
    elle: { byTenant: elleByTenant, network: elleNetwork, tenants: elleTenants },
  })
})
