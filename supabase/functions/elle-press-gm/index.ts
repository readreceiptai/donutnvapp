// ELLE press / site-GM finder. For marquee employers whose local decision-maker isn't in Apollo
// or LinkedIn, this searches local press (grand openings, business-journal pieces) via Apify's
// RAG web browser and extracts the named site leader as a candidate contact for the Z to confirm.
// Server-side, no Claude tokens (Apify credits only). Dormant until APIFY_TOKEN is set.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN") ?? "";
const ACTOR = "apify~rag-web-browser";

const ROLES = "general manager|site leader|site lead|plant manager|facility manager|site director|operations manager|director of operations|site manager";
const NAME = "[A-Z][a-zA-Z.'\\-]+(?: [A-Z][a-zA-Z.'\\-]+){1,2}";
function isServiceRole(req: Request): boolean { try { const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""); const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return p?.role === "service_role"; } catch { return false; } }

function extract(text: string): Array<{ name: string; title: string }> {
  const out: Array<{ name: string; title: string }> = []; const seen = new Set<string>();
  const patterns = [
    new RegExp(`(${NAME}),?\\s+(?:is|was|serves as|named|the|as)\\s+(?:the\\s+)?(${ROLES})`, "gi"),
    new RegExp(`(${ROLES})[,:]?\\s+(${NAME})`, "gi"),
  ];
  for (let i = 0; i < patterns.length; i++) {
    let m: RegExpExecArray | null;
    while ((m = patterns[i].exec(text)) !== null) {
      const name = (i === 0 ? m[1] : m[2]).trim(); const title = (i === 0 ? m[2] : m[1]).trim();
      const key = name.toLowerCase();
      if (name.split(" ").length < 2 || seen.has(key)) continue;
      if (/(fulfillment|distribution|company|center|amazon|fedex|chewy|autozone|dollar)/i.test(name)) continue;
      seen.add(key); out.push({ name, title: title.replace(/\b\w/g, (c) => c.toUpperCase()) });
      if (out.length >= 5) return out;
    }
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!isServiceRole(req)) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  if (!APIFY_TOKEN) return new Response(JSON.stringify({ ok: false, dormant: true, reason: "APIFY_TOKEN not set" }), { status: 200, headers: { "Content-Type": "application/json" } });
  const body: any = await req.json().catch(() => ({}));
  const businessId = body.business_id;
  if (!businessId) return new Response(JSON.stringify({ error: "business_id required" }), { status: 400 });

  const { data: biz } = await supabase.from("elle_businesses").select("id,name,city,state").eq("id", businessId).single();
  if (!biz) return new Response(JSON.stringify({ error: "business not found" }), { status: 404 });

  const place = [biz.city, biz.state].filter(Boolean).join(" ");
  const query = `"${biz.name}" ${place} ("general manager" OR "site leader" OR "plant manager" OR "grand opening" OR "site director")`;
  const input = { query, maxResults: 3, outputFormats: ["text"], requestTimeoutSecs: 60, scrapingTool: "raw-http" };

  const r = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const items: any = await r.json().catch(() => []);
  const list: any[] = Array.isArray(items) ? items : [];
  let dbg = `PRESS status=${r.status} pages=${list.length}`;
  if (!r.ok) return new Response(JSON.stringify({ ok: false, status: r.status, detail: dbg }), { status: 200, headers: { "Content-Type": "application/json" } });

  const found: Array<{ name: string; title: string; url: string | null }> = [];
  for (const it of list) {
    const text = String(it.text || it.markdown || it.content || "");
    const url = it.metadata?.url || it.url || it.loadedUrl || null;
    for (const c of extract(text)) { if (!found.some((f) => f.name.toLowerCase() === c.name.toLowerCase())) found.push({ ...c, url }); }
  }
  dbg += ` candidates=${found.length}`;

  await supabase.from("elle_business_pocs").delete().eq("business_id", biz.id).eq("source", "press");
  const rows = found.slice(0, 5).map((f) => ({ business_id: biz.id, name: f.name, title: f.title, email: null, phone: null, seniority: null, source: "press", confidence: 40, is_bad: false, linkedin_url: f.url }));
  if (rows.length) await supabase.from("elle_business_pocs").insert(rows);
  await supabase.from("elle_businesses").update({ enrich_debug: (dbg).slice(0, 300) }).eq("id", biz.id);
  return new Response(JSON.stringify({ ok: true, business: biz.name, candidates: rows.map((x) => `${x.name} (${x.title})`) }), { headers: { "Content-Type": "application/json" } });
});
