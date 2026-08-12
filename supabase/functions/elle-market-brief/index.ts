import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Generates a hyper-local market brief for a territory (demographics, 100+ employer
// roster, venues, event hosts), stores it in elle_market_reports, refreshes the
// tenant's anchors, and sets a 6-month refresh date. Uses Sonnet + web search for
// quality since it runs only ~twice a year.
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-5";

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function isServiceRole(req: Request): boolean {
  try { const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""); const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return p?.role === "service_role"; } catch { return false; }
}
function toInt(v: unknown): number | null { if (typeof v === "number") return Math.round(v); const m = String(v ?? "").replace(/[, ]/g, "").match(/\d+/); return m ? parseInt(m[0]) : null; }
function extractJson(text: string): any { let t = text.replace(/```json|```/g, "").trim(); const s = t.indexOf("{"), e = t.lastIndexOf("}"); if (s < 0 || e < 0) throw new Error("no JSON"); return JSON.parse(t.slice(s, e + 1)); }

const SYSTEM = "You are ELLE producing a hyper-local market brief for DonutNV, a mobile mini-donut and lemonade catering franchise. Return STRICTLY VALID JSON only, no prose.";

function buildPrompt(cities: string[], zips: string[]) {
  return `Research the market for DonutNV in this territory. Cities: ${cities.join(", ")}. ZIP codes: ${zips.join(", ")}. Infer the metro and state from the ZIPs.

Return ONLY this JSON (no markdown fences):
{
  "territory": string,
  "overview": { "population": string, "median_income": string, "character": string },
  "employers": [ { "name": string, "sector": string, "employees": number, "note": string } ],
  "venues": [ { "name": string, "type": string } ],
  "event_hosts": [ { "name": string, "timing": string } ],
  "summary": string
}

Rules:
- employers: 12 to 20 real, named businesses/institutions with roughly 100+ staff AT THAT LOCATION (per-location headcount, not company-wide). Use local economic-development, chamber, and news sources. Include schools/hospitals/distribution/manufacturing/government where relevant.
- venues: the key event venues in or serving these ZIPs.
- event_hosts: recurring festivals, fairs, and community events.
- summary: 2-3 sentences on the DonutNV opportunity across events, business catering, and school fundraisers.
- Prefer accurate named entities; give best estimates where exact figures are unavailable. Keep it within/serving these ZIPs.`;
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    if (!isServiceRole(req)) return json({ error: "unauthorized" }, 401);
    if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not set" }, 500);
    const body = await req.json();
    const tenant_id = body.tenant_id;
    if (!tenant_id) return json({ error: "tenant_id required" }, 400);
    const model = body.model ?? DEFAULT_MODEL;
    const maxSearches = body.max_searches ?? 8;

    const { data: tz } = await supabase.from("elle_territory_zips").select("zip").eq("tenant_id", tenant_id);
    const zips = (tz ?? []).map((r: any) => r.zip);
    if (!zips.length) return json({ error: "tenant has no zips" }, 400);
    const { data: zc } = await supabase.from("elle_zip_cities").select("city").in("zip", zips);
    const cities = [...new Set((zc ?? []).map((r: any) => String(r.city)))];

    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 8192, system: SYSTEM, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }], messages: [{ role: "user", content: buildPrompt(cities, zips) }] })
    });
    if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const data = await res.json();
    const textBlocks = (data.content ?? []).filter((b: any) => b.type === "text");
    const report = extractJson(textBlocks[textBlocks.length - 1]?.text ?? "");

    const now = new Date();
    const next = new Date(now.getTime()); next.setMonth(next.getMonth() + 6);
    await supabase.from("elle_market_reports").upsert({
      tenant_id, report, generated_at: now.toISOString(), next_refresh_at: next.toISOString(), model, updated_at: now.toISOString()
    }, { onConflict: "tenant_id" });

    // Refresh anchors from the brief (replace prior market_brief anchors).
    await supabase.from("elle_territory_anchors").delete().eq("tenant_id", tenant_id).eq("source", "market_brief");
    const rows: any[] = [];
    for (const v of (report.venues ?? [])) if (v?.name) rows.push({ tenant_id, kind: "venue", name: v.name, category: v.type ?? null, watch: true, source: "market_brief" });
    for (const h of (report.event_hosts ?? [])) if (h?.name) rows.push({ tenant_id, kind: "event_host", name: h.name, category: "festival", notes: h.timing ?? null, watch: true, source: "market_brief" });
    for (const e of (report.employers ?? [])) if (e?.name) rows.push({ tenant_id, kind: "employer", name: e.name, category: e.sector ?? null, employee_estimate: toInt(e.employees), notes: e.note ?? null, watch: true, source: "market_brief" });
    if (rows.length) await supabase.from("elle_territory_anchors").insert(rows);

    return json({ success: true, tenant_id, territory: report.territory ?? null, employers: (report.employers ?? []).length, venues: (report.venues ?? []).length, event_hosts: (report.event_hosts ?? []).length, next_refresh_at: next.toISOString() });
  } catch (err) { return json({ error: (err as Error).message }, 500); }
});
