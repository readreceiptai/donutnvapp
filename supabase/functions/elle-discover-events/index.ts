import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// v5 — anchor-aware + zip-bounded.
//  • Injects the tenant's watched anchors (venues/event hosts) into the prompt so
//    ELLE specifically checks known high-value venues (e.g. WEC).
//  • Passes the territory's exact ZIP list and instructs the model to ONLY return
//    events inside those ZIPs, and to populate the real zip.
//  • Zip-strict storage: an event with no confirmed zip is stored with zip=null and
//    will be blocked at the tenant-link zip-wall (never inherits the searched zip).
function isServiceRole(req: Request): boolean {
  try {
    const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role";
  } catch { return false; }
}

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = Deno.env.get("ELLE_CLAUDE_MODEL") ?? "claude-haiku-4-5-20251001";

interface DiscoverRequest { tenant_id?: string; city?: string; zip?: string; lookback_days?: number; max_events?: number; max_cities?: number; use_anchors?: boolean; }

const SYSTEM_PROMPT = `You are ELLE, the Event Lead List Engine. You discover bookable events for mobile food vendors (DonutNV). Return STRICTLY VALID JSON. Wins at every step — partial data is fine.`;

function buildUserPrompt(city: string, zip: string | null, lookback: number, max_events: number, anchors: string[], zips: string[]) {
  const now = new Date();
  const future = new Date(now.getTime() + lookback * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const zipRule = zips.length
    ? `\n\nZIP BOUNDARY (critical): Only include events physically located within these ZIP codes: ${zips.join(", ")}. If you cannot confirm an event falls inside one of these ZIPs, EXCLUDE it. Always populate the "zip" field with the event's real ZIP code.`
    : "";
  const anchorRule = anchors.length
    ? `\n\nPRIORITY VENUES & HOSTS: In addition to a general search, specifically look up these known venues and recurring event hosts in this area and pull their UPCOMING public events (only if inside the ZIP boundary above): ${anchors.join("; ")}.`
    : "";
  return `Find upcoming events in ${city}${zip ? ` (zip ${zip})` : ""} between ${fmt(now)} and ${fmt(future)} that a mobile food vendor (donuts + lemonade trailer) could book or attend.${zipRule}${anchorRule}

Use web search to find: public festivals; food truck rallies & farmers markets; school events & fundraisers & sports tournaments; church gatherings; charity fundraisers (5K runs, galas, walks); craft/arts festivals; music festivals & concerts open to outside vendors; grand openings; large corporate events open to vendors; wedding venues with active calendars.

For EACH event return ONE row. Up to ${max_events} most-relevant. Prioritize recurring annual events, >500 attendance, and events that accept outside food vendors.

Return ONLY a JSON object (no prose, no markdown fences):
{
  "city": "${city}",
  "events": [
    { "name": string, "start_date": "YYYY-MM-DD"|null, "end_date": "YYYY-MM-DD"|null, "venue": string|null, "city": string, "zip": string|null, "event_type_guess": "large_public_festival"|"medium_public_festival"|"small_public_event"|"large_corporate"|"school_district"|"school_individual"|"youth_sports_tournament"|"church"|"charity_fundraiser"|"grand_opening"|"food_truck_rally"|"farmers_market"|"craft_arts_festival"|"music_festival"|"sports_pro"|null, "source_url": string, "discovery_confidence": 0-100, "notes": string|null }
  ]
}

If the event already happened, you can't determine a future date, or it's outside the ZIP boundary, skip it. Quality over quantity.`;
}

function extractJson(text: string): any {
  let t = text.replace(/```json|```/g, "").trim();
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("No JSON object found in Claude output");
  return JSON.parse(t.slice(start, end + 1));
}

async function discoverCity(city: string, zip: string | null, lookback: number, max_events: number, anchors: string[], zips: string[]) {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 8192, system: SYSTEM_PROMPT, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }], messages: [{ role: "user", content: buildUserPrompt(city, zip, lookback, max_events, anchors, zips) }] })
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = await res.json();
  const textBlocks = (data.content ?? []).filter((b: any) => b.type === "text");
  const lastText = textBlocks[textBlocks.length - 1]?.text ?? "";
  return extractJson(lastText);
}

async function sourceId() {
  const { data } = await supabase.from("elle_sources").select("id").eq("code", "eventbrite_api").maybeSingle();
  return data?.id ?? null;
}
async function alreadyKnown(name: string): Promise<boolean> {
  const { data: e } = await supabase.from("elle_events").select("id").ilike("name", name).maybeSingle();
  if (e) return true;
  const { data: r } = await supabase.from("elle_events_raw").select("id").ilike("name", name).limit(1).maybeSingle();
  return !!r;
}

async function runSweep(targets: Array<{ city: string; zip: string | null }>, lookback: number, max_events: number, tenant_id: string | null, anchors: string[], zips: string[]) {
  const allResults: any[] = [];
  let totalInserted = 0;
  const srcId = await sourceId();
  const zipSet = new Set(zips);
  for (const tgt of targets) {
    try {
      const result = await discoverCity(tgt.city || tgt.zip || "", tgt.zip, lookback, max_events, anchors, zips);
      const events = result.events ?? [];
      let inserted = 0, skippedKnown = 0, skippedZip = 0;
      for (const ev of events) {
        if (!ev?.name) continue;
        // Zip-strict: require a confirmed in-territory zip when a boundary is set.
        if (zipSet.size > 0 && (!ev.zip || !zipSet.has(String(ev.zip)))) { skippedZip++; continue; }
        if (await alreadyKnown(ev.name)) { skippedKnown++; continue; }
        const rawPayload = { ...ev, _city_searched: tgt.city, _zip_searched: tgt.zip, _discovered_at: new Date().toISOString() };
        const { error: insErr } = await supabase.from("elle_events_raw").insert({
          source_id: srcId, source_code: "claude_web_discovery", source_url: ev.source_url, raw_payload: rawPayload,
          name: ev.name, start_date: ev.start_date, end_date: ev.end_date,
          city: ev.city ?? tgt.city, zip: ev.zip ?? null
        });
        if (!insErr) inserted++;
      }
      totalInserted += inserted;
      allResults.push({ city: tgt.city || tgt.zip, found: events.length, inserted, skippedKnown, skippedZip });
    } catch (err) {
      allResults.push({ city: tgt.city || tgt.zip, error: String(err).slice(0, 200) });
    }
  }
  await supabase.from("elle_worker_runs").insert({ worker: "elle-discover-events", tenant_id, summary: { cities: targets.length, inserted: totalInserted, anchors: anchors.length, breakdown: allResults } }).catch(() => {});
  return { cities_searched: targets.length, events_inserted: totalInserted, breakdown: allResults };
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
    if (!isServiceRole(req)) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), { status: 500 });
    const body: DiscoverRequest = await req.json();
    const lookback = body.lookback_days ?? 365;
    const max_events = body.max_events ?? 15;
    const max_cities = body.max_cities ?? 99;

    let targets: Array<{ city: string; zip: string | null }> = [];
    let anchors: string[] = [];
    let zips: string[] = [];

    if (body.city) {
      targets.push({ city: body.city, zip: body.zip ?? null });
      if (body.zip) zips = [body.zip];
    } else if (body.zip) {
      const { data: zc } = await supabase.from("elle_zip_cities").select("city").eq("zip", body.zip).maybeSingle();
      targets.push({ city: zc?.city ?? "", zip: body.zip });
      zips = [body.zip];
    } else if (body.tenant_id) {
      const { data } = await supabase.from("elle_territory_zips").select("zip").eq("tenant_id", body.tenant_id);
      zips = (data ?? []).map((r: any) => r.zip);
      const { data: cityRows } = await supabase.from("elle_zip_cities").select("zip, city").in("zip", zips.length ? zips : ["none"]);
      const cityByZip: Record<string, string> = {};
      for (const r of cityRows ?? []) cityByZip[r.zip] = r.city;
      const seen = new Set<string>();
      for (const z of zips) { const c = cityByZip[z]; if (c && !seen.has(c)) { seen.add(c); targets.push({ city: c, zip: z }); } }
      if (targets.length > max_cities) targets = targets.slice(0, max_cities);
      if (body.use_anchors !== false) {
        const { data: a } = await supabase.from("elle_territory_anchors").select("name").eq("tenant_id", body.tenant_id).eq("watch", true).in("kind", ["venue", "event_host", "race_series"]);
        anchors = (a ?? []).map((r: any) => String(r.name)).slice(0, 20);
      }
    } else {
      return new Response(JSON.stringify({ error: "provide tenant_id, city, or zip" }), { status: 400 });
    }

    const work = runSweep(targets, lookback, max_events, body.tenant_id ?? null, anchors, zips);
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) { rt.waitUntil(work); return new Response(JSON.stringify({ ok: true, accepted: true, cities: targets.map((t) => t.city || t.zip), anchors: anchors.length, zip_bounded: zips.length }), { status: 202, headers: { "Content-Type": "application/json" } }); }
    const result = await work;
    return new Response(JSON.stringify({ success: true, ...result }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
