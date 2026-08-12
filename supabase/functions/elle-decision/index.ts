// ── ELLE decision — Supabase Edge Function (v4) ──
// Records a franchisee's apply/pass/waitlist/booked/lost decision on a lead.
// A superadmin may pass tenant_id to record a decision on another territory's
// board (used by the admin all-territories view); a normal franchisee is always
// scoped to their own tenant regardless of any tenant_id passed.
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
const VALID = new Set(['apply', 'pass', 'waitlist', 'booked', 'lost'])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!ELLE_URL || !ELLE_KEY) return json({ error: 'ELLE not connected' }, 503)

  const authz = req.headers.get('Authorization') ?? ''
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authz } } })
  const { data: { user } } = await asUser.auth.getUser()
  if (!user?.email) return json({ error: 'not signed in' }, 401)

  const { event_id, decision, notes, tenant_id } = await req.json().catch(() => ({}))
  if (!event_id || !VALID.has(decision)) return json({ error: 'event_id + valid decision required' }, 400)

  const elle = createClient(ELLE_URL, ELLE_KEY, { auth: { persistSession: false } })

  // Superadmins may target a specific tenant; everyone else is scoped to their own.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: prof } = await admin.from('profiles').select('is_superadmin').eq('id', user.id).maybeSingle()
  const isSuper = !!prof?.is_superadmin

  let tenantId: string | null = null
  if (isSuper && tenant_id) {
    tenantId = tenant_id
  } else {
    const { data: tenant } = await elle.from('elle_tenants').select('id').eq('primary_contact_email', user.email).maybeSingle()
    tenantId = tenant?.id ?? null
  }
  if (!tenantId) return json({ error: 'no_elle_tenant' }, 404)

  const { error } = await elle.from('elle_tenant_events')
    .update({ decision, decision_at: new Date().toISOString(), decision_notes: notes ?? null })
    .eq('tenant_id', tenantId).eq('event_id', event_id)
  if (error) return json({ error: error.message }, 500)

  return json({ ok: true, event_id, decision })
})
