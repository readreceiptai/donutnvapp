// ELLE facility-level contacts via LinkedIn (Apify) + Apollo waterfall. v6: spend governor checks
// (Apify + Apollo) + ledger logging. LinkedIn finds the on-site person; Apollo reveals work email.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN") ?? "";
const APOLLO_KEY = Deno.env.get("APOLLO_API_KEY") ?? "";
const APOLLO_WEBHOOK = Deno.env.get("APOLLO_WEBHOOK_URL") ?? "";
const APOLLO = "https://api.apollo.io/api/v1";
const ACTOR = "harvestapi~linkedin-company-employees";
const FREE = /@(gmail|yahoo|hotmail|outlook|aol|icloud|live|me|proton|protonmail)\./i;

const TITLES = ["events", "event coordinator", "catering", "general manager", "operations manager", "office manager", "human resources", "hr manager", "administrator", "executive assistant"];
const ST: Record<string, string> = { al:"Alabama", fl:"Florida", ga:"Georgia", nc:"North Carolina", sc:"South Carolina", tx:"Texas", nv:"Nevada", pa:"Pennsylvania", in:"Indiana", oh:"Ohio", tn:"Tennessee", md:"Maryland" };
function stateName(s: string): string { const x = String(s || "").trim(); if (!x) return ""; const f = ST[x.toLowerCase()] || x; return f.replace(/\b\w/g, (c) => c.toUpperCase()); }
function isServiceRole(req: Request): boolean { try { const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""); const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return p?.role === "service_role"; } catch { return false; } }
async function apollo(path: string, body: unknown) { const r = await fetch(`${APOLLO}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "accept": "application/json", "x-api-key": APOLLO_KEY }, body: JSON.stringify(body) }); const json = await r.json().catch(() => ({})) as any; return { ok: r.ok, status: r.status, json }; }

function pickName(x: any) { return x.name || [x.firstName, x.lastName].filter(Boolean).join(" ") || x.fullName || null; }
function pickLIEmail(x: any) { let e: any = null; if (Array.isArray(x.emails) && x.emails.length) { const v = x.emails[0]; e = typeof v === "string" ? v : (v?.email || v?.value || null); } else e = x.email || x.workEmail || null; if (e && FREE.test(String(e))) return null; return e; }
function pickUrl(x: any) { return x.linkedinUrl || x.publicProfileUrl || x.profileUrl || x.url || (x.publicIdentifier ? `https://www.linkedin.com/in/${x.publicIdentifier}` : null); }
function pickTitle(x: any) { return x.headline || x.jobTitle || x.title || (Array.isArray(x.experience) && x.experience[0]?.title) || null; }
function looksJunk(title: string | null): boolean { const t = String(title || ""); if (!t) return false; const slashes = (t.match(/\//g) || []).length; const caps = (t.match(/[A-Z]/g) || []).length / Math.max(t.length, 1); return slashes >= 2 && caps > 0.45; }

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!isServiceRole(req)) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  if (!APIFY_TOKEN) return new Response(JSON.stringify({ ok: false, dormant: true, reason: "APIFY_TOKEN not set" }), { status: 200, headers: { "Content-Type": "application/json" } });
  const body: any = await req.json().catch(() => ({}));
  const businessId = body.business_id;
  const max = Math.min(Number(body.max_contacts) || 6, 10);
  if (!businessId) return new Response(JSON.stringify({ error: "business_id required" }), { status: 400 });

  // Spend governor: refuse if Apify is capped this month (protects direct calls).
  { const { data: gate } = await supabase.rpc("elle_spend_allowed", { p_service: "apify_linkedin" });
    if (gate && gate.allowed === false) return new Response(JSON.stringify({ ok: false, capped: true, reason: gate.reason }), { headers: { "Content-Type": "application/json" } }); }

  const { data: biz } = await supabase.from("elle_businesses").select("id,name,city,state,zip,website,linkedin_company_url").eq("id", businessId).single();
  if (!biz) return new Response(JSON.stringify({ error: "business not found" }), { status: 404 });

  const sName = stateName(biz.state);
  const loc = biz.city ? (sName ? `${biz.city}, ${sName}` : biz.city) : sName;
  const domain = String(biz.website || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  const common: any = { profileScraperMode: "Full + email search ($12 per 1k)", maxItems: max };
  if (loc) common.locations = [loc];
  if (biz.linkedin_company_url) { common.companies = [biz.linkedin_company_url]; common.companyBatchMode = "one_by_one"; common.maxItemsPerCompany = max; }
  else common.searchQuery = biz.name;

  let apifyRuns = 0;
  async function callActor(input: any) { apifyRuns++; const r = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=140`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); const j: any = await r.json().catch(() => []); return { status: r.status, ok: r.ok, list: Array.isArray(j) ? j : [] }; }

  let dbg = `LI loc=\"${loc}\" co=${biz.linkedin_company_url ? "url" : "name"}`;
  let res = await callActor({ ...common, jobTitles: TITLES });
  dbg += ` titled=${res.list.length}`;
  if (res.ok && res.list.length === 0) { res = await callActor({ ...common }); dbg += ` untitled=${res.list.length}`; }

  async function logSpend() {
    try {
      let tenantId: string | null = null;
      if (biz.zip) { const { data: tz } = await supabase.from("elle_territory_zips").select("tenant_id").eq("zip", biz.zip).limit(1).maybeSingle(); tenantId = tz?.tenant_id ?? null; }
      if (apifyRuns > 0) await supabase.rpc("elle_log_spend", { p_tenant: tenantId, p_service: "apify_linkedin", p_units: apifyRuns, p_phase: (body.phase || "manual"), p_ref_type: "business", p_ref_id: String(biz.id) });
      if (matches.length > 0) await supabase.rpc("elle_log_spend", { p_tenant: tenantId, p_service: "apollo", p_units: matches.length, p_phase: (body.phase || "manual"), p_ref_type: "business", p_ref_id: String(biz.id) });
    } catch (_) { /* logging never breaks enrichment */ }
  }

  if (!res.ok) { await logSpend(); await supabase.from("elle_businesses").update({ enrich_debug: (dbg + ` http=${res.status}`).slice(0, 300) }).eq("id", biz.id); return new Response(JSON.stringify({ ok: false, status: res.status, detail: dbg }), { status: 200, headers: { "Content-Type": "application/json" } }); }

  const li = res.list.map((x) => ({ name: pickName(x), title: pickTitle(x), url: pickUrl(x), email: pickLIEmail(x) })).filter((p) => p.name && !looksJunk(p.title));

  // ---- Waterfall: run each LinkedIn person through Apollo (only if Apollo isn't capped). ----
  let matches: any[] = [];
  if (APOLLO_KEY && li.length) {
    const { data: ag } = await supabase.rpc("elle_spend_allowed", { p_service: "apollo" });
    if (!(ag && ag.allowed === false)) {
      const details = li.map((p) => { const parts = String(p.name).trim().split(/\s+/); const d: any = { first_name: parts[0], last_name: parts.slice(1).join(" ") || undefined, name: p.name }; if (p.url) d.linkedin_url = p.url; if (domain) d.domain = domain; else d.organization_name = biz.name; return d; });
      const qs = new URLSearchParams();
      if (APOLLO_WEBHOOK) { qs.set("reveal_phone_number", "true"); qs.set("webhook_url", APOLLO_WEBHOOK); }
      const e = await apollo(`/people/bulk_match${qs.toString() ? `?${qs.toString()}` : ""}`, { details });
      matches = Array.isArray(e.json?.matches) ? e.json.matches : [];
      dbg += ` apollo=${e.status}/${matches.length}`;
    } else { dbg += " apollo=capped"; }
  }

  await logSpend();

  const rows = li.map((p, i) => {
    const m = matches[i] || null;
    const workEmail = (m?.email && m.email_status !== "unavailable") ? m.email : null;
    const email = workEmail || p.email || null;
    return { business_id: biz.id, apollo_person_id: m?.id ? String(m.id) : null, name: p.name, title: p.title || m?.title || null, email, phone: null, seniority: m?.seniority || null, source: "linkedin", confidence: email ? 88 : 74, is_bad: false, linkedin_url: p.url };
  }).filter((row) => row.name);

  await supabase.from("elle_business_pocs").delete().eq("business_id", biz.id).eq("source", "linkedin");
  if (rows.length) await supabase.from("elle_business_pocs").insert(rows);
  const status = rows.length ? "complete" : "national_branch";
  await supabase.from("elle_businesses").update({ enrichment_status: status, enrich_debug: (dbg + ` inserted=${rows.length}`).slice(0, 300), last_enriched_at: new Date().toISOString() }).eq("id", biz.id);
  return new Response(JSON.stringify({ ok: true, business: biz.name, contacts: rows.length, with_email: rows.filter((row) => row.email).length }), { headers: { "Content-Type": "application/json" } });
});
