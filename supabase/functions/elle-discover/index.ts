// ── ELLE discovery worker (v2) ──────────────────────────────────────────────
// The automated engine behind the "full run." For a tenant's territory it pulls
// one or more sources, keeps vendor-relevant events, filters to open ground
// (skips other franchises' owned ZIPs/cities), de-dupes, inserts, and re-scores.
// Designed for the Sunday cron; each source is a pluggable fetcher behind one
// shared ingest pipeline.
//
// Sources implemented: 'eventeny' (HTML), 'runsignup' (JSON API). More plug in
// by adding a fetcher that returns Candidate[] and a case in the dispatch.
//
// Deploy:  supabase functions deploy elle-discover   (ELLE project)
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto), CRON_SECRET
// Invoke:  POST { tenant_id, source: 'eventeny'|'runsignup', ...opts }
//          header x-cron-secret: <CRON_SECRET>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET  = Deno.env.get('CRON_SECRET') ?? ''

const SOURCE_IDS: Record<string, number> = { eventeny: 9, runsignup: 21 }

const DEFAULT_EVENTENY_SLUGS = [
  'tampa-fl','st-petersburg-fl','clearwater-fl','dunedin-fl','tarpon-springs-fl',
  'safety-harbor-fl','largo-fl','oldsmar-fl','palm-harbor-fl','plant-city-fl',
]

const PUBLIC_TYPES = new Set([
  'large_public_festival','medium_public_festival','small_public_event',
  'music_festival','craft_arts_festival','farmers_market','food_truck_rally','sports_pro',
])

type Candidate = {
  name: string; city: string; zip: string | null; vendors: boolean;
  event_type: string; start_date: string | null; url: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

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

// ── Source: Eventeny (HTML listing per city) ────────────────────────────────
async function fetchEventeny(slugs: string[]): Promise<Candidate[]> {
  const out: Candidate[] = []
  const seen = new Set<string>()
  for (const slug of slugs) {
    const res = await fetch(`https://www.eventeny.com/events/${slug}`, { headers: { 'user-agent': 'Mozilla/5.0 ELLE' } })
    if (!res.ok) continue
    const html = await res.text()
    const re = /href="https:\/\/www\.eventeny\.com\/events\/([a-z0-9'.\-]+?-\d+)\/?[^"]*"[^>]*>([\s\S]{0,600}?)<\/a>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) {
      if (seen.has(m[1])) continue
      seen.add(m[1])
      const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      const cityM = text.match(/([A-Za-z .'-]+?),\s*(Florida|FL)\b/)
      if (!/\bVendors\b/.test(text) || !cityM) continue
      const title = (text.split(/\s+share:/)[0] || text).slice(0, 120).trim()
      out.push({ name: title, city: cityM[1].trim(), zip: null, vendors: true, event_type: guessType(title), start_date: null, url: null })
    }
  }
  return out
}

// ── Source: RunSignup (JSON API, paginated) ─────────────────────────────────
function mdyToISO(d: string | null): string | null {
  if (!d) return null
  const m = d.match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[1]}-${m[2]}` : null
}
async function fetchRunSignup(zip: string, radius: number, startDate: string): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (let page = 1; page <= 4; page++) {
    const u = `https://runsignup.com/rest/races?format=json&events=T&race_headings=F&race_links=F&include_event_days=F`
      + `&start_date=${startDate}&zipcode=${zip}&radius=${radius}&results_per_page=25&page=${page}`
    const res = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 ELLE' } })
    if (!res.ok) break
    const data = await res.json().catch(() => null) as any
    const races = data?.races ?? []
    if (!races.length) break
    for (const wrap of races) {
      const r = wrap.race ?? wrap
      const a = r.address ?? {}
      out.push({
        name: r.name, city: a.city ?? '', zip: a.zipcode ?? null, vendors: true, // races broadly allow vendors; verify on enrich
        event_type: 'small_public_event', start_date: mdyToISO(r.next_date), url: r.url ?? null,
      })
    }
  }
  return out
}

// ── Shared ingest: blocklist → de-dupe → insert ─────────────────────────────
async function ingest(db: any, tenant_id: string, sourceId: number, cands: Candidate[],
                      blockedZips: Set<string>, blockedCities: Set<string>) {
  let inserted = 0, skippedBlocked = 0, skippedDupe = 0
  for (const c of cands) {
    if (!c.name || !c.city) continue
    if ((c.zip && blockedZips.has(c.zip)) || blockedCities.has(c.city.toLowerCase())) { skippedBlocked++; continue }
    const { data: dupe } = await db.from('elle_events').select('id').eq('name', c.name).maybeSingle()
    if (dupe) { skippedDupe++; continue }
    const { data: e } = await db.from('elle_events').insert({
      name: c.name, city: c.city, state: 'FL', zip: c.zip,
      event_type: c.event_type, start_date: c.start_date, application_url: c.url,
      primary_source_id: sourceId, enrichment_status: 'partial', enrichment_confidence: 30,
      is_recurring: true, recurrence_pattern: 'annual',
    }).select('id').single()
    if (!e) continue
    await db.from('elle_tenant_events').insert({
      tenant_id, event_id: e.id,
      territory_match: c.city.toLowerCase() === 'palm harbor' ? 'owned' : 'surrounding',
      type_match: PUBLIC_TYPES.has(c.event_type), surfaced_at: new Date().toISOString(), decision: 'backlog',
    })
    inserted++
  }
  return { inserted, skippedBlocked, skippedDupe }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ error: 'unauthorized' }, 401)

  const body = await req.json().catch(() => ({}))
  const { tenant_id, source = 'eventeny' } = body
  if (!tenant_id) return json({ error: 'tenant_id required' }, 400)
  if (!(source in SOURCE_IDS)) return json({ error: `unknown source '${source}'` }, 400)

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const { data: blocks } = await db.from('elle_territory_blocks').select('zip, owner_franchise').eq('tenant_id', tenant_id)
  const blockedZips = new Set((blocks ?? []).map((b: any) => b.zip))
  const blockedCities = new Set((blocks ?? []).map((b: any) => (b.owner_franchise ?? '').split(',')[0].trim().toLowerCase()))

  const today = new Date().toISOString().slice(0, 10)
  let cands: Candidate[] = []
  if (source === 'eventeny')  cands = await fetchEventeny(body.city_slugs ?? DEFAULT_EVENTENY_SLUGS)
  if (source === 'runsignup') cands = await fetchRunSignup(body.zip ?? '33626', body.radius ?? 50, today)

  const res = await ingest(db, tenant_id, SOURCE_IDS[source], cands, blockedZips, blockedCities)
  await db.rpc('elle_recompute_scores')

  return json({ ok: true, source, candidates: cands.length, ...res, ran_at: today })
})
