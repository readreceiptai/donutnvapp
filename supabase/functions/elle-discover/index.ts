// ── ELLE discovery worker (v6 — territory-scoped, contamination-proof) ──
// v6 FIX (critical): discovery is now scoped to the requesting tenant's real
// territory. An event is linked to a tenant ONLY if the event's zip is in that
// tenant's territory_zips, or (for zip-less sources) the event's city is one of
// the tenant's cities. No more global 'surrounding' dumping of Tampa events onto
// every board. runsignup is centered on the tenant's own zip; eventeny slugs may
// be passed per-tenant via body.city_slugs. territory_match is derived from the
// tenant's zip_type, never hardcoded.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const SOURCE_IDS: Record<string, number> = { eventeny: 9, runsignup: 21 }
const PUBLIC_TYPES = new Set(['large_public_festival','medium_public_festival','small_public_event','music_festival','craft_arts_festival','farmers_market','food_truck_rally','sports_pro'])

type Candidate = { name: string; city: string; zip: string | null; state: string | null; vendors: boolean; event_type: string; start_date: string | null; url: string | null }
type Territory = { owned: Set<string>; surrounding: Set<string>; all: Set<string>; cities: Set<string>; firstZip: string | null }

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) }
function guessType(title: string): string {
  const t = title.toLowerCase()
  if (/(farmers|growers).*market|farmers market/.test(t)) return 'farmers_market'
  if (/craft|art(s)? (fair|festival|show)/.test(t)) return 'craft_arts_festival'
  if (/music fest|concert|jazz|blues/.test(t)) return 'music_festival'
  if (/food truck|truck rally|food fest/.test(t)) return 'food_truck_rally'
  if (/\b(5k|10k|run|marathon|race)\b/.test(t)) return 'small_public_event'
  if (/festival|fest\b|pride|parade|fair/.test(t)) return 'large_public_festival'
  if (/market|pop-?up|bazaar/.test(t)) return 'small_public_event'
  return 'small_public_event'
}

async function loadTerritory(db: any, tenant_id: string): Promise<Territory> {
  const { data: tz } = await db.from('elle_territory_zips').select('zip, zip_type').eq('tenant_id', tenant_id)
  const owned = new Set<string>(), surrounding = new Set<string>(), all = new Set<string>()
  for (const r of tz ?? []) { all.add(r.zip); if (r.zip_type === 'owned') owned.add(r.zip); else surrounding.add(r.zip) }
  const cities = new Set<string>()
  if (all.size) {
    const { data: zc } = await db.from('elle_zip_cities').select('city').in('zip', [...all])
    for (const r of zc ?? []) if (r.city) cities.add(String(r.city).toLowerCase())
  }
  const firstZip = [...owned][0] ?? [...all][0] ?? null
  return { owned, surrounding, all, cities, firstZip }
}

// Returns the territory_match for an in-territory candidate, or null if the
// candidate is outside this tenant's territory (and must NOT be linked).
function matchFor(c: Candidate, terr: Territory): 'owned' | 'surrounding' | null {
  if (c.zip && terr.owned.has(c.zip)) return 'owned'
  if (c.zip && terr.surrounding.has(c.zip)) return 'surrounding'
  // zip-less source (eventeny): fall back to a city match against the territory
  if (!c.zip && c.city && terr.cities.has(c.city.toLowerCase())) return 'owned'
  return null
}

async function fetchEventenySlug(slug: string, seen: Set<string>): Promise<Candidate[]> {
  const out: Candidate[] = []
  try {
    const res = await fetch(`https://www.eventeny.com/events/${slug}`, { headers: { 'user-agent': 'Mozilla/5.0 ELLE' } })
    if (!res.ok) return out
    const html = await res.text()
    const re = /href="https:\/\/www\.eventeny\.com\/events\/([a-z0-9'.\-]+?-\d+)\/?[^"]*"[^>]*>([\s\S]{0,600}?)<\/a>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) {
      if (seen.has(m[1])) continue; seen.add(m[1])
      const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      const cityM = text.match(/([A-Za-z .'-]+?),\s*([A-Z]{2}|Florida|Nevada|North Carolina)\b/)
      if (!/\bVendors\b/.test(text) || !cityM) continue
      const title = (text.split(/\s+share:/)[0] || text).slice(0, 120).trim()
      out.push({ name: title, city: cityM[1].trim(), zip: null, state: null, vendors: true, event_type: guessType(title), start_date: null, url: null })
    }
  } catch (_) { /* one bad city page shouldn't kill the run */ }
  return out
}
async function fetchEventeny(slugs: string[]): Promise<Candidate[]> {
  const seen = new Set<string>()
  const batches = await Promise.all(slugs.map((s) => fetchEventenySlug(s, seen)))
  return batches.flat()
}
function mdyToISO(d: string | null): string | null { if (!d) return null; const m = d.match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[1]}-${m[2]}` : null }
async function fetchRunSignup(zip: string, radius: number, startDate: string): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (let page = 1; page <= 4; page++) {
    const u = `https://runsignup.com/rest/races?format=json&events=T&race_headings=F&race_links=F&include_event_days=F&start_date=${startDate}&zipcode=${zip}&radius=${radius}&results_per_page=25&page=${page}`
    const res = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 ELLE' } })
    if (!res.ok) break
    const data = await res.json().catch(() => null) as any
    const races = data?.races ?? []
    if (!races.length) break
    for (const wrap of races) {
      const r = wrap.race ?? wrap; const a = r.address ?? {}
      out.push({ name: r.name, city: a.city ?? '', zip: a.zipcode ?? null, state: a.state ?? null, vendors: true, event_type: 'small_public_event', start_date: mdyToISO(r.next_date), url: r.url ?? null })
    }
  }
  return out
}

async function ingest(db: any, tenant_id: string, sourceId: number, cands: Candidate[], terr: Territory, blockedZips: Set<string>, blockedCities: Set<string>, today: string) {
  let inserted = 0, linked = 0, skippedOutside = 0, skippedBlocked = 0, skippedDupe = 0, skippedPast = 0
  for (const c of cands) {
    if (!c.name || !c.city) continue
    if (c.start_date && c.start_date < today) { skippedPast++; continue }
    if ((c.zip && blockedZips.has(c.zip)) || blockedCities.has(c.city.toLowerCase())) { skippedBlocked++; continue }

    // HARD GATE: only in-territory candidates are inserted/linked for this tenant.
    const match = matchFor(c, terr)
    if (!match) { skippedOutside++; continue }

    let eventId: string | null = null
    const { data: existing } = await db.from('elle_events').select('id').eq('name', c.name).maybeSingle()
    if (existing) {
      eventId = existing.id; skippedDupe++
    } else {
      const { data: e } = await db.from('elle_events').insert({ name: c.name, city: c.city, state: c.state ?? 'FL', zip: c.zip, event_type: c.event_type, start_date: c.start_date, application_url: c.url, primary_source_id: sourceId, enrichment_status: 'partial', enrichment_confidence: 30, is_recurring: true, recurrence_pattern: 'annual' }).select('id').single()
      if (!e) continue
      eventId = e.id; inserted++
    }

    const { data: teExisting } = await db.from('elle_tenant_events').select('id').eq('tenant_id', tenant_id).eq('event_id', eventId).maybeSingle()
    if (!teExisting) {
      await db.from('elle_tenant_events').insert({ tenant_id, event_id: eventId, territory_match: match, type_match: PUBLIC_TYPES.has(c.event_type), surfaced_at: new Date().toISOString(), decision: 'backlog' })
      linked++
    }
  }
  return { inserted, linked, skippedOutside, skippedBlocked, skippedDupe, skippedPast }
}

async function runDiscovery(db: any, tenant_id: string, source: string, body: any) {
  const today = new Date().toISOString().slice(0, 10)
  try {
    const terr = await loadTerritory(db, tenant_id)
    if (terr.all.size === 0) {
      await db.from('elle_worker_runs').insert({ worker: 'elle-discover', tenant_id, summary: { source, error: 'no territory zips configured', ran_at: today } })
      return
    }
    const { data: blocks } = await db.from('elle_territory_blocks').select('zip, owner_franchise').eq('tenant_id', tenant_id)
    const blockedZips = new Set((blocks ?? []).map((b: any) => b.zip))
    const blockedCities = new Set((blocks ?? []).map((b: any) => (b.owner_franchise ?? '').split(',')[0].trim().toLowerCase()))

    let cands: Candidate[] = []
    if (source === 'eventeny') {
      // Only crawl slugs supplied for this tenant; no global default (that was the
      // Tampa-contamination source). Territory gate still applies as a backstop.
      const slugs: string[] = body.city_slugs ?? []
      cands = slugs.length ? await fetchEventeny(slugs) : []
    }
    if (source === 'runsignup') {
      const zip = body.zip ?? terr.firstZip
      if (zip) cands = await fetchRunSignup(zip, body.radius ?? 25, today)
    }
    const res = await ingest(db, tenant_id, SOURCE_IDS[source], cands, terr, blockedZips, blockedCities, today)
    await db.rpc('elle_recompute_scores')
    await db.from('elle_worker_runs').insert({ worker: 'elle-discover', tenant_id, summary: { source, candidates: cands.length, ...res, ran_at: today } })
  } catch (err) {
    await db.from('elle_worker_runs').insert({ worker: 'elle-discover', tenant_id, summary: { source, error: String(err), ran_at: today } }).catch(() => {})
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const body = await req.json().catch(() => ({}))
  const { tenant_id, source = 'runsignup' } = body
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const token = req.headers.get('x-cron-secret') ?? ''
  const { data: ok } = await db.rpc('elle_check_cron_secret', { p_token: token })
  if (ok !== true) return json({ error: 'unauthorized' }, 401)
  if (!tenant_id) return json({ error: 'tenant_id required' }, 400)
  if (!(source in SOURCE_IDS)) return json({ error: `unknown source '${source}'` }, 400)

  const work = runDiscovery(db, tenant_id, source, body)
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime
  if (rt?.waitUntil) { rt.waitUntil(work); return json({ ok: true, accepted: true, source }, 202) }
  await work
  return json({ ok: true, accepted: true, source, mode: 'sync' })
})
