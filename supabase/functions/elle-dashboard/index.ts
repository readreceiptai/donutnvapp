// ── ELLE dashboard — Supabase Edge Function ──
// Surfaces the signed-in franchisee's ranked event leads. Authenticates against
// donutnvapp's own auth, then reads the ELLE project (separate Supabase) with a
// service-role key held ONLY as a secret here (never in the browser).
//
// Deploy:  supabase functions deploy elle-dashboard
// Secrets: ELLE_SUPABASE_URL, ELLE_SERVICE_ROLE_KEY
//   supabase secrets set ELLE_SUPABASE_URL=https://nvxfkzwbiomnswcxiblq.supabase.co ELLE_SERVICE_ROLE_KEY=eyJ...

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ELLE_URL = Deno.env.get('ELLE_SUPABASE_URL') ?? ''
const ELLE_KEY = Deno.env.get('ELLE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey',
  'access-control-allow-methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })
}

// Public-facing festivals/markets vs. outbound B2B accounts (schools, corporate,
// churches, charities, sports). Drives the two dashboard segments.
const PUBLIC_EVENT_TYPES = new Set([
  'large_public_festival', 'medium_public_festival', 'small_public_event',
  'music_festival', 'craft_arts_festival', 'farmers_market', 'food_truck_rally', 'sports_pro',
])

async function callerEmail(req: Request): Promise<string | null> {
  const authz = req.headers.get('Authorization') ?? ''
  if (!authz) return null
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authz } } })
  const { data: { user } } = await asUser.auth.getUser()
  return user?.email ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const email = await callerEmail(req)
  if (!email) return json({ error: 'not signed in' }, 401)
  if (!ELLE_URL || !ELLE_KEY) return json({ configured: false }, 200)

  const elle = createClient(ELLE_URL, ELLE_KEY, { auth: { persistSession: false } })

  const { data: tenant } = await elle.from('elle_tenants')
    .select('id, franchise_name, plan_tier').eq('primary_contact_email', email).maybeSingle()
  if (!tenant) return json({ needsOnboarding: true }, 200) // 200 so the client reads it cleanly

  const { data: rows } = await elle.from('elle_z_dashboard')
    .select('*').eq('tenant_id', tenant.id)
    .order('score', { ascending: false })
    .order('application_deadline', { ascending: true, nullsFirst: false })
    .limit(50)

  const events = (rows ?? []).map((r) => ({
    ...r,
    segment: PUBLIC_EVENT_TYPES.has(r.event_type) ? 'event' : 'account',
  }))

  return json({ tenant, events })
})
