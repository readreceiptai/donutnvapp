// ── ELLE enrichment worker (v5 — audit-hardened: attempt cooldown stamping) ──
// Audit fix: the worker was retrying the SAME hosts every week (4 consecutive
// runs burned credits on identical domains). Every attempted host is now
// stamped last_enrich_attempt_at, and elle_enrich_candidates enforces a
// 21-day cooldown + requires a website — so each weekly run works fresh leads.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APOLLO = 'https://api.apollo.io/api/v1'
const TITLES = ['concessions','vendor coordinator','events','operations','general manager','owner','executive director','president']
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } }) }
function toDomain(w: string | null): string | null { return w ? String(w).replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/^www\./,'').trim() : null }

async function apolloSearch(key: string, domain: string) {
  const r = await fetch(`${APOLLO}/mixed_people/api_search`, { method:'POST', headers:{'Content-Type':'application/json','Cache-Control':'no-cache','X-Api-Key':key}, body: JSON.stringify({ q_organization_domains_list:[domain], person_titles:TITLES, page:1, per_page:3 }) })
  const d = await r.json().catch(()=>null) as any
  return { status:r.status, person: d?.people?.[0] ?? null }
}
async function apolloMatch(key: string, id: string) {
  const r = await fetch(`${APOLLO}/people/match`, { method:'POST', headers:{'Content-Type':'application/json','X-Api-Key':key}, body: JSON.stringify({ id, reveal_personal_emails:false }) })
  const d = await r.json().catch(()=>null) as any
  return { status:r.status, person: d?.person ?? null }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error:'POST only' }, 405)
  const body = await req.json().catch(()=>({}))
  const { tenant_id, limit = 10 } = body
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } })
  const token = req.headers.get('x-cron-secret') ?? ''
  const { data: ok } = await db.rpc('elle_check_cron_secret', { p_token: token })
  if (ok !== true) return json({ error:'unauthorized' }, 401)
  if (!tenant_id) return json({ error:'tenant_id required' }, 400)
  const { data: apolloKey } = await db.rpc('elle_get_secret', { p_name:'elle_apollo_key' })
  if (!apolloKey) return json({ ok:true, skipped:'no apollo key' }, 200)
  const key = apolloKey as string

  const { data: leads } = await db.rpc('elle_enrich_candidates', { p_tenant: tenant_id, p_limit: limit })
  let enriched = 0, apolloHits = 0, apolloMiss = 0, noDomain = 0
  const debug: any[] = []
  for (const L of (leads ?? []) as any[]) {
    const domain = toDomain(L.website)
    if (!domain) { noDomain++; continue }
    // Audit fix: stamp the attempt BEFORE calling Apollo so misses cool down too.
    if (L.host_id) await db.from('elle_hosts').update({ last_enrich_attempt_at: new Date().toISOString() }).eq('id', L.host_id)
    const s = await apolloSearch(key, domain)
    if (!s.person) { apolloMiss++; debug.push({domain, searchStatus:s.status, found:false}); continue }
    const m = await apolloMatch(key, s.person.id)
    const email = m.person?.email ?? null
    const phone = m.person?.organization?.phone ?? m.person?.organization?.primary_phone?.number ?? null
    debug.push({domain, searchStatus:s.status, matchStatus:m.status, name:m.person?.name ?? null, email: email?'y':'n', phone: phone?'y':'n'})
    if (!m.person || (!email && !phone)) { apolloMiss++; continue }
    apolloHits++
    if (L.host_id) {
      await db.from('elle_hosts').update({ primary_contact_name:m.person.name, primary_contact_title:m.person.title, primary_contact_email:email, primary_contact_phone:phone, contact_confidence:85, contact_source_url:'apollo:worker' }).eq('id', L.host_id)
    } else {
      const { data: h } = await db.from('elle_hosts').insert({ name:L.host_name ?? domain, website:domain, primary_contact_name:m.person.name, primary_contact_title:m.person.title, primary_contact_email:email, primary_contact_phone:phone, contact_confidence:85, contact_source_url:'apollo:worker', last_enrich_attempt_at: new Date().toISOString() }).select('id').single()
      if (h) await db.from('elle_events').update({ host_id:h.id }).eq('id', L.event_id)
    }
    enriched++
  }
  await db.rpc('elle_recompute_scores')
  const summary = { candidates:(leads??[]).length, enriched, apolloHits, apolloMiss, noDomain, debug }
  await db.from('elle_worker_runs').insert({ worker:'elle-enrich', tenant_id, summary })
  return json({ ok:true, ...summary })
})
