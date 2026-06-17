// ── ELLE onboard — Supabase Edge Function ──
// Creates an ELLE tenant for a franchisee (called once when they activate ELLE).
// NOTE: the franchisee never picks sources here (those stay internal); we only
// take territory ZIPs, event-type interests, plan tier, and an optional
// free-text "events/sources to watch" suggestion (routed to an internal queue).
//
// Deploy:  supabase functions deploy elle-onboard
// Secrets: ELLE_SUPABASE_URL, ELLE_SERVICE_ROLE_KEY
//
// Call (authenticated): POST {
//   franchise_name, franchise_id?, zips[], surrounding_zips?[], event_types[],
//   plan_tier ('basic'|'pro'|'agency'), suggestion?
// }

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!ELLE_URL || !ELLE_KEY) return json({ error: 'ELLE not connected' }, 503)

  const authz = req.headers.get('Authorization') ?? ''
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authz } } })
  const { data: { user } } = await asUser.auth.getUser()
  if (!user?.email) return json({ error: 'not signed in' }, 401)

  const body = await req.json().catch(() => ({}))
  const { franchise_name, franchise_id, zips = [], surrounding_zips = [], event_types = [], plan_tier = 'basic', suggestion } = body
  if (!franchise_name || !Array.isArray(zips) || zips.length === 0) {
    return json({ error: 'franchise_name and at least one owned ZIP required' }, 400)
  }

  const elle = createClient(ELLE_URL, ELLE_KEY, { auth: { persistSession: false } })

  // Don't double-create.
  const { data: existing } = await elle.from('elle_tenants')
    .select('id').eq('primary_contact_email', user.email).maybeSingle()
  if (existing) return json({ ok: true, tenant_id: existing.id, alreadyOnboarded: true })

  const { data: tenant, error: tErr } = await elle.from('elle_tenants').insert({
    franchise_name, franchise_id: franchise_id ?? null,
    primary_contact_email: user.email, plan_tier, enabled: true,
  }).select('id').single()
  if (tErr || !tenant) return json({ error: tErr?.message ?? 'could not create tenant' }, 500)

  const zipRows = [
    ...zips.map((z: string) => ({ tenant_id: tenant.id, zip: String(z).trim(), zip_type: 'owned' })),
    ...surrounding_zips.map((z: string) => ({ tenant_id: tenant.id, zip: String(z).trim(), zip_type: 'surrounding' })),
  ].filter((r) => r.zip)
  if (zipRows.length) await elle.from('elle_territory_zips').insert(zipRows)

  if (Array.isArray(event_types) && event_types.length) {
    await elle.from('elle_event_type_prefs').insert(
      event_types.map((t: string) => ({ tenant_id: tenant.id, event_type: t, enabled: true })),
    )
  }

  // REQUIRED: default scoring params, or ranking runs on NULLs.
  await elle.from('elle_tenant_params').insert({ tenant_id: tenant.id, email_for_digest: user.email })

  // Optional franchisee suggestion → internal notes (never shown back as a source list).
  if (suggestion && String(suggestion).trim()) {
    await elle.from('elle_tenant_params').update({ notes: `Onboarding suggestion: ${String(suggestion).trim()}` }).eq('tenant_id', tenant.id)
  }

  return json({ ok: true, tenant_id: tenant.id })
})
