// ── ELLE enrichment worker (v1 — Apollo-first) ──────────────────────────────
// Runs after discovery (Sunday cron). For a tenant's high-fit leads that are
// missing a contact, it finds the organizer decision-maker via Apollo and writes
// it back to elle_hosts, then re-scores. Vault-gated (same x-cron-secret as
// elle-discover). Apollo API key is read from Vault ('elle_apollo_key').
//
// Capped to `limit` leads/run (default 10) → metered credit spend.
// v1 enriches leads whose host already has a website/domain. Resolving a domain
// for bare-event leads (name → org → domain) is the next iteration (web step).
//
// Deploy:  supabase functions deploy elle-enrich   (ELLE project)
// Vault:   elle_apollo_key  ← drop your Apollo API key here to turn it on.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APOLLO = 'https://api.apollo.io/api/v1'
const TITLES = ['concessions','vendor coordinator','events','operations','general manager','owner','executive director','president']

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } }) }
function toDomain(w: string | null): string | null {
  return w ? String(w).replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/^www\./,'').trim() : null
}

async function apolloSearch(key: string, domain: string) {
  const r = await fetch(`${APOLLO}/mixed_people/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': key },
    body: JSON.stringify({ q_organization_domains_list: [domain], person_titles: TITLES, page: 1, per_page: 3 }),
  })
  if (!r.ok) return null
  const d = await r.json().catch(() => null) as any
  return d?.people?.[0] ?? null
}
async function apolloMatch(key: string, id: string) {
  const r = await fetch(`${APOLLO}/people/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
    body: JSON.stringify({ id, reveal_personal_emails: false }),
  })
  if (!r.ok) return null
  const d = await r.json().catch(() => null) as any
  return d?.person ?? null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const body = await req.json().catch(() => ({}))
  const { tenant_id, limit = 10 } = body
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const token = req.headers.get('x-cron-secret') ?? ''
  const { data: ok } = await db.rpc('elle_check_cron_secret', { p_token: token })
  if (ok !== true) return json({ error: 'unauthorized' }, 401)
  if (!tenant_id) return json({ error: 'tenant_id required' }, 400)

  const { data: apolloKey } = await db.rpc('elle_get_secret', { p_name: 'elle_apollo_key' })
  if (!apolloKey) return json({ ok: true, skipped: 'apollo key not set — add elle_apollo_key to Vault' }, 200)

  const { data: leads } = await db.rpc('elle_enrich_candidates', { p_tenant: tenant_id, p_limit: limit })
  let enriched = 0, apolloHits = 0, apolloMiss = 0, noDomain = 0

  for (const L of (leads ?? []) as any[]) {
    const domain = toDomain(L.website)
    if (!domain) { noDomain++; continue }                 // → web org-resolution (next iteration)
    const person = await apolloSearch(apolloKey as string, domain)
    if (!person) { apolloMiss++; continue }
    const full = await apolloMatch(apolloKey as string, person.id) // 1 credit
    const email = full?.email ?? null
    const phone = full?.organization?.phone ?? null
    if (!full || (!email && !phone)) { apolloMiss++; continue }
    apolloHits++

    if (L.host_id) {
      await db.from('elle_hosts').update({
        primary_contact_name: full.name, primary_contact_title: full.title,
        primary_contact_email: email, primary_contact_phone: phone,
        contact_confidence: 85, contact_source_url: 'apollo:worker',
      }).eq('id', L.host_id)
    } else {
      const { data: h } = await db.from('elle_hosts').insert({
        name: L.host_name ?? domain, website: domain,
        primary_contact_name: full.name, primary_contact_title: full.title,
        primary_contact_email: email, primary_contact_phone: phone,
        contact_confidence: 85, contact_source_url: 'apollo:worker',
      }).select('id').single()
      if (h) await db.from('elle_events').update({ host_id: h.id }).eq('id', L.event_id)
    }
    enriched++
  }

  await db.rpc('elle_recompute_scores')
  return json({ ok: true, candidates: (leads ?? []).length, enriched, apolloHits, apolloMiss, noDomain })
})
