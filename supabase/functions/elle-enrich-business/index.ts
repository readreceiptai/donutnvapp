// ELLE business contact enrichment via Apollo (server-side). v12: spend governor
// check (protects direct calls) + ledger logging attributed to the ZIP-owning tenant.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const APOLLO_KEY = Deno.env.get("APOLLO_API_KEY") ?? "";
const WEBHOOK_URL = Deno.env.get("APOLLO_WEBHOOK_URL") ?? "";
const APOLLO = "https://api.apollo.io/api/v1";

const TITLES = [
  "office manager", "executive assistant", "human resources", "hr manager", "people operations",
  "events", "event coordinator", "operations manager", "general manager", "administrator",
  "office administrator", "owner", "president", "principal", "executive director",
];
const NATIONAL_RE = /(fulfillment|distribution center|distribution centre|sortation|logistics center|logistics hub|\bground\b|\bwarehouse\b|operations$)/i;
const ST: Record<string, string> = { al:"alabama", fl:"florida", ga:"georgia", nc:"north carolina", sc:"south carolina", tx:"texas", nv:"nevada", pa:"pennsylvania", in:"indiana", oh:"ohio", tn:"tennessee", md:"maryland" };
function stateName(s: string): string { const x = String(s || "").trim(); if (!x) return ""; const full = ST[x.toLowerCase()] || x; return full.replace(/\b\w/g, (c) => c.toUpperCase()); }
function isServiceRole(req: Request): boolean { try { const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""); const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return p?.role === "service_role"; } catch { return false; } }
async function apollo(path: string, body: unknown) { const r = await fetch(`${APOLLO}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "accept": "application/json", "x-api-key": APOLLO_KEY }, body: JSON.stringify(body) }); const json = await r.json().catch(() => ({})) as any; return { ok: r.ok, status: r.status, json }; }

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!isServiceRole(req)) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  if (!APOLLO_KEY) return new Response(JSON.stringify({ error: "APOLLO_API_KEY not set" }), { status: 500 });

  // Spend governor: refuse if Apollo is capped this month (also protects direct calls).
  { const { data: gate } = await supabase.rpc("elle_spend_allowed", { p_service: "apollo" });
    if (gate && gate.allowed === false) return new Response(JSON.stringify({ ok: false, capped: true, reason: gate.reason }), { headers: { "Content-Type": "application/json" } }); }

  const body: any = await req.json().catch(() => ({}));
  const businessId = body.business_id;
  const perBiz = Math.min(Number(body.max_contacts) || 5, 8);
  const wantPhone = body.reveal_phone !== false && !!WEBHOOK_URL;
  if (!businessId) return new Response(JSON.stringify({ error: "business_id required" }), { status: 400 });

  const { data: biz } = await supabase.from("elle_businesses").select("id,name,website,apollo_org_id,city,state,facility_code,zip").eq("id", businessId).single();
  if (!biz) return new Response(JSON.stringify({ error: "business not found" }), { status: 404 });

  const domain = String(biz.website || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  const sName = stateName(biz.state);
  const stateLoc = sName ? `${sName}, US` : null;
  const cityLoc = (biz.city && sName) ? `${biz.city}, ${sName}` : null;

  let orgId: string | null = biz.apollo_org_id;
  let orgHqState = "";
  let learnedDomain = "";
  if (!orgId && domain) {
    const o = await apollo("/mixed_companies/api_search", { q_organization_domains_list: [domain], per_page: 1 });
    const hit = o.json?.organizations?.[0] || o.json?.accounts?.[0];
    if (hit) { orgId = hit.id; orgHqState = hit.state || ""; }
  }
  if (!orgId && biz.name) {
    const n = await apollo("/mixed_companies/api_search", { q_organization_name: biz.name, per_page: 10 });
    const orgs: any[] = n.json?.organizations || n.json?.accounts || [];
    const local = orgs.find((o) => {
      const st = String(o.state || "").toLowerCase(); const ct = String(o.city || "").toLowerCase();
      return (sName && st.includes(sName.toLowerCase())) || (biz.city && ct.includes(String(biz.city).toLowerCase()));
    });
    const pick = local || orgs[0];
    if (pick) { orgId = pick.id; orgHqState = pick.state || ""; learnedDomain = pick.primary_domain || pick.domain || ""; }
  }
  if (orgId) {
    const upd: any = { apollo_org_id: orgId };
    if (learnedDomain && !biz.website) upd.website = "http://www." + learnedDomain.replace(/^www\./, "");
    await supabase.from("elle_businesses").update(upd).eq("id", biz.id);
  }

  const hqOutOfState = !!(orgHqState && sName && !orgHqState.toLowerCase().includes(sName.toLowerCase()));
  const isNational = NATIONAL_RE.test(String(biz.name)) || hqOutOfState;
  let dbg = `keylen=${APOLLO_KEY.length} phoneReady=${!!WEBHOOK_URL} org=${orgId} hq=\"${orgHqState}\" national=${isNational}`;

  if (!orgId && !domain) {
    await supabase.from("elle_businesses").update({ enrichment_status: "failed", enrich_debug: dbg + " no-org-no-domain", last_enriched_at: new Date().toISOString() }).eq("id", biz.id);
    return new Response(JSON.stringify({ ok: true, business: biz.name, found: 0, status: "failed" }), { headers: { "Content-Type": "application/json" } });
  }

  const base: any = { per_page: perBiz + 6 };
  if (orgId) base.organization_ids = [orgId]; else base.q_organization_domains_list = [domain];
  if (isNational) { const kw = [biz.city, biz.facility_code].filter(Boolean).join(" ").trim(); if (kw) base.q_keywords = kw; }
  async function runSearch(loc: string | null, titles: string[] | null) { const b: any = { ...base }; if (loc) b.person_locations = [loc]; if (titles) b.person_titles = titles; const r = await apollo("/mixed_people/api_search", b); return { status: r.status, people: Array.isArray(r.json?.people) ? r.json.people : [] }; }

  const ladder: Array<[string | null, string[] | null]> = isNational
    ? [[cityLoc, TITLES], [stateLoc, TITLES], [stateLoc, null]]
    : [[cityLoc, TITLES], [stateLoc, TITLES], [stateLoc, null], [null, TITLES], [null, null]];
  let attempt = ""; let s: { status: number; people: any[] } = { status: 0, people: [] };
  for (const [loc, ti] of ladder) {
    if (loc === null && ti === null && isNational) continue;
    s = await runSearch(loc, ti); attempt = `${loc || "org-wide"}/${ti ? "titled" : "any"}=${s.people.length}`;
    if (s.people.length) break;
  }
  const people = s.people.slice(0, perBiz);
  dbg += ` ladder[${attempt}] status=${s.status}`;

  if (people.length === 0) {
    const status = isNational ? "national_branch" : "partial";
    await supabase.from("elle_businesses").update({ enrichment_status: status, enrich_debug: dbg + " no-local-people", last_enriched_at: new Date().toISOString() }).eq("id", biz.id);
    return new Response(JSON.stringify({ ok: true, business: biz.name, found: 0, status }), { headers: { "Content-Type": "application/json" } });
  }

  const details = people.map((p: any) => ({ id: p.id }));
  const qs = new URLSearchParams();
  if (wantPhone) { qs.set("reveal_phone_number", "true"); qs.set("webhook_url", WEBHOOK_URL); }
  const e = await apollo(`/people/bulk_match${qs.toString() ? `?${qs.toString()}` : ""}`, { details });
  const matches: any[] = Array.isArray(e.json?.matches) ? e.json.matches : [];
  dbg += ` bulkStatus=${e.status} matches=${matches.length}`;

  // Log Apollo spend (credits ≈ matches), attributed to the ZIP-owning tenant. Never breaks enrichment.
  try {
    let tenantId: string | null = null;
    if (biz.zip) { const { data: tz } = await supabase.from("elle_territory_zips").select("tenant_id").eq("zip", biz.zip).limit(1).maybeSingle(); tenantId = tz?.tenant_id ?? null; }
    await supabase.rpc("elle_log_spend", { p_tenant: tenantId, p_service: "apollo", p_units: matches.length, p_phase: (body.phase || "manual"), p_ref_type: "business", p_ref_id: String(biz.id) });
  } catch (_) { /* logging must never break enrichment */ }

  await supabase.from("elle_business_pocs").delete().eq("business_id", biz.id).eq("source", "apollo");
  const rows = matches.filter((m) => m?.name).map((m) => ({ business_id: biz.id, apollo_person_id: String(m.id), name: m.name, title: m.title || null, email: (m.email && m.email_status !== "unavailable") ? m.email : null, phone: null, seniority: m.seniority || null, source: "apollo", confidence: m.email_status === "verified" ? 90 : 70, is_bad: false }));
  if (rows.length) await supabase.from("elle_business_pocs").insert(rows);
  await supabase.from("elle_businesses").update({ enrichment_status: "complete", enrich_debug: dbg + ` inserted=${rows.length}`, last_enriched_at: new Date().toISOString() }).eq("id", biz.id);

  return new Response(JSON.stringify({ ok: true, business: biz.name, contacts: rows.length, with_email: rows.filter((r) => r.email).length, status: "complete" }), { headers: { "Content-Type": "application/json" } });
});
