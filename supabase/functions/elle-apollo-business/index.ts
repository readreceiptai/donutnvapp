import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const APOLLO_API_KEY = Deno.env.get("APOLLO_API_KEY") ?? "";
const APOLLO = "https://api.apollo.io/api/v1";
const DEFAULT_RANGES = ["100,200", "200,500", "500,1000", "1000,100000"];
const POC_TITLES = ["Office Manager", "Facilities Manager", "Human Resources Manager", "HR Manager", "Operations Manager", "Executive Assistant", "General Manager", "Owner", "President", "Office Administrator"];

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function isServiceRole(req: Request): boolean {
  try { const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""); const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return p?.role === "service_role"; } catch { return false; }
}
async function apolloPost(path: string, payload: unknown) {
  const res = await fetch(`${APOLLO}${path}`, { method: "POST", headers: { "X-Api-Key": APOLLO_API_KEY, "Content-Type": "application/json", "accept": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Apollo ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}
async function apolloGet(path: string) {
  const res = await fetch(`${APOLLO}${path}`, { headers: { "X-Api-Key": APOLLO_API_KEY, "accept": "application/json" } });
  if (!res.ok) throw new Error(`Apollo GET ${path} ${res.status}`);
  return await res.json();
}

async function fetchPocs(pairs: Array<{ bizId: string; orgId: string }>, perOrg = 5) {
  let n = 0;
  for (const { bizId, orgId } of pairs) {
    if (!orgId) continue;
    try {
      const data = await apolloPost("/mixed_people/api_search", { organization_ids: [orgId], person_titles: POC_TITLES, per_page: perOrg, page: 1 });
      for (const pp of (data.people ?? [])) {
        const name = pp.name ?? ([pp.first_name, pp.last_name].filter(Boolean).join(" ") || null);
        if (!name) continue;
        const { data: pe } = await supabase.from("elle_business_pocs").select("id").eq("business_id", bizId).eq("name", name).maybeSingle();
        if (pe) continue;
        await supabase.from("elle_business_pocs").insert({ business_id: bizId, name, title: pp.title ?? null, seniority: pp.seniority ?? null, source: "apollo" });
        n++;
      }
    } catch (_) {}
  }
  return n;
}

async function tenantPairs(tenant_id: string) {
  const { data: tb } = await supabase.from("elle_tenant_businesses").select("business_id").eq("tenant_id", tenant_id);
  const ids = (tb ?? []).map((r: any) => r.business_id);
  if (!ids.length) return [];
  const { data: bz } = await supabase.from("elle_businesses").select("id, apollo_org_id").in("id", ids);
  return (bz ?? []).filter((b: any) => b.apollo_org_id).map((b: any) => ({ bizId: b.id, orgId: b.apollo_org_id }));
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    if (!isServiceRole(req)) return json({ error: "unauthorized" }, 401);
    if (!APOLLO_API_KEY) return json({ error: "APOLLO_API_KEY not set" }, 500);
    const body = await req.json();
    const tenant_id = body.tenant_id;
    if (!tenant_id) return json({ error: "tenant_id required" }, 400);

    if (body.pocs_only) {
      const pairs = await tenantPairs(tenant_id);
      const pocs = await fetchPocs(pairs, body.per_org ?? 5);
      return json({ success: true, mode: "pocs_only", businesses: pairs.length, pocs });
    }

    const ranges = (Array.isArray(body.employee_ranges) && body.employee_ranges.length) ? body.employee_ranges : DEFAULT_RANGES;
    const max_pages = body.max_pages ?? 2;
    const { data: tz } = await supabase.from("elle_territory_zips").select("zip").eq("tenant_id", tenant_id);
    const zips = (tz ?? []).map((r: any) => r.zip);
    const { data: zc } = zips.length ? await supabase.from("elle_zip_cities").select("city").in("zip", zips) : { data: [] as any[] };
    const cities = [...new Set((zc ?? []).map((r: any) => String(r.city)))];
    if (!cities.length) return json({ error: "tenant has no mapped cities" }, 400);
    const zipSet = new Set(zips);

    let seen = 0, enriched = 0, inZip = 0, links = 0;
    const pairs: Array<{ bizId: string; orgId: string }> = [];

    for (const range of ranges) {
      for (let page = 1; page <= max_pages; page++) {
        const data = await apolloPost("/mixed_companies/search", { organization_locations: cities, organization_num_employees_ranges: [range], page, per_page: 100 });
        const orgs = data.organizations ?? data.accounts ?? [];
        if (!orgs.length) break;
        for (const o of orgs) {
          seen++;
          const apolloId = o.id ?? o.organization_id ?? null;
          const domain = o.primary_domain ?? null;
          let emp: number | null = null, city: string | null = null, state: string | null = null, zip: string | null = null, industry: string | null = null;
          let phone: string | null = o.primary_phone?.sanitized_number ?? o.sanitized_phone ?? o.phone ?? null;
          if (domain) {
            try { const e = await apolloGet(`/organizations/enrich?domain=${encodeURIComponent(domain)}`); const org = e.organization ?? {}; emp = org.estimated_num_employees ?? null; city = org.city ?? null; state = org.state ?? null; zip = org.postal_code ?? null; industry = org.industry ?? null; phone = phone ?? org.sanitized_phone ?? org.phone ?? null; enriched++; } catch (_) {}
          }
          if (!zip || !zipSet.has(String(zip))) continue;
          inZip++;
          const bizFields: any = { name: o.name, website: o.website_url ?? (domain ? `https://${domain}` : null), phone, city, state, zip, industry, employee_count: emp, apollo_org_id: apolloId, source: "apollo", enrichment_status: emp ? "complete" : "partial", last_enriched_at: new Date().toISOString(), updated_at: new Date().toISOString() };
          let bizId: string | null = null;
          if (apolloId) {
            const { data: exist } = await supabase.from("elle_businesses").select("id").eq("apollo_org_id", apolloId).maybeSingle();
            if (exist) { bizId = exist.id; await supabase.from("elle_businesses").update(bizFields).eq("id", bizId); }
            else { const { data: ne } = await supabase.from("elle_businesses").insert(bizFields).select("id").single(); bizId = ne?.id ?? null; }
          }
          if (!bizId) continue;
          const { data: le } = await supabase.from("elle_tenant_businesses").select("id").eq("tenant_id", tenant_id).eq("business_id", bizId).maybeSingle();
          if (!le) { const { data: ins } = await supabase.from("elle_tenant_businesses").insert({ tenant_id, business_id: bizId, territory_match: "owned", decision: "backlog" }).select("id").maybeSingle(); if (ins) links++; }
          if (apolloId) pairs.push({ bizId, orgId: apolloId });
        }
        if (orgs.length < 100) break;
      }
    }

    const pocs = await fetchPocs(pairs, 5);
    return json({ success: true, tenant_id, cities, ranges, seen, enriched, inZip, links, pocs });
  } catch (err) { return json({ error: (err as Error).message }, 500); }
});
