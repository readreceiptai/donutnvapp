// ELLE business & org sourcing via Google Maps (Apify compass/crawler-google-places). v5: spend
// governor check + ledger logging (1 Apify run) added. Dedupe by place id + name+zip; backfills
// thin records; fundraiser-org sourcing via org_type + min_reviews. Server-side. Needs APIFY_TOKEN.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN") ?? "";
const ACTOR = "compass~crawler-google-places";

const DEFAULT_TERMS = ["manufacturer", "car dealership", "corporate office", "assisted living facility", "gym", "church"];
function isServiceRole(req: Request): boolean { try { const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""); const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return p?.role === "service_role"; } catch { return false; } }
function cleanPhone(x: any) { const s = String(x?.phoneUnformatted || x?.phone || "").trim(); return s || null; }
function cleanSite(x: any) { const s = String(x?.website || "").trim(); return s || null; }
function reviewCount(x: any) { return Number(x?.reviewsCount ?? x?.userRatingCount ?? x?.reviewsCountNumeric ?? 0) || 0; }
function norm(name: string) { return String(name || "").toLowerCase().replace(/[.,'&/\-]/g, " ").replace(/\b(llc|inc|incorporated|corp|corporation|co|company|ltd|the)\b/g, " ").replace(/\s+/g, " ").trim(); }
const nz = (n: string, z: any) => `${norm(n)}|${String(z || "").trim()}`;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!isServiceRole(req)) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  if (!APIFY_TOKEN) return new Response(JSON.stringify({ ok: false, dormant: true, reason: "APIFY_TOKEN not set" }), { status: 200, headers: { "Content-Type": "application/json" } });
  const body: any = await req.json().catch(() => ({}));
  const tenantId = body.tenant_id;
  if (!tenantId) return new Response(JSON.stringify({ error: "tenant_id required" }), { status: 400 });
  const location = String(body.location || "").trim();
  if (!location) return new Response(JSON.stringify({ error: "location required (e.g. 'Ocala, Florida')" }), { status: 400 });

  // Spend governor: refuse if Apify is capped this month (protects direct calls).
  { const { data: gate } = await supabase.rpc("elle_spend_allowed", { p_service: "apify_places" });
    if (gate && gate.allowed === false) return new Response(JSON.stringify({ ok: false, capped: true, reason: gate.reason }), { headers: { "Content-Type": "application/json" } }); }

  const terms = (Array.isArray(body.terms) && body.terms.length ? body.terms : DEFAULT_TERMS).slice(0, 8);
  const perTerm = Math.min(Number(body.max_per_term) || 15, 40);
  const doEnrich = body.enrich === true;
  const withContacts = body.scrape_contacts === true;
  const orgType = body.org_type ? String(body.org_type) : null;
  const minReviews = Number(body.min_reviews) || 0;

  const input: any = { searchStringsArray: terms, locationQuery: location, maxCrawledPlacesPerSearch: perTerm, language: "en", countryCode: "us", skipClosedPlaces: true, scrapeContacts: withContacts };
  const r = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=110`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const items: any = await r.json().catch(() => []);
  const places: any[] = Array.isArray(items) ? items : [];

  // Log the Apify run (1 unit) to the ledger, attributed to this tenant. Never breaks sourcing.
  try { await supabase.rpc("elle_log_spend", { p_tenant: tenantId, p_service: "apify_places", p_units: 1, p_phase: (body.phase || "manual"), p_ref_type: "run", p_ref_id: ACTOR }); } catch (_) { /* noop */ }

  if (!r.ok) return new Response(JSON.stringify({ ok: false, status: r.status, detail: String(JSON.stringify(items)).slice(0, 300) }), { status: 200, headers: { "Content-Type": "application/json" } });

  const seen = new Set<string>();
  const clean = places.filter((p) => p?.placeId && p?.title && reviewCount(p) >= minReviews && !seen.has(p.placeId) && seen.add(p.placeId));
  const placeIds = clean.map((p) => p.placeId);
  const zips = [...new Set(clean.map((p) => String(p.postalCode || "").trim()).filter(Boolean))];

  type Ex = { id: string; website: string | null; phone: string | null; place: string | null; org: string | null };
  const byPlace: Record<string, string> = {};
  const byNameZip: Record<string, Ex> = {};
  for (let i = 0; i < placeIds.length; i += 150) { const { data } = await supabase.from("elle_businesses").select("id, google_place_id").in("google_place_id", placeIds.slice(i, i + 150)); for (const b of data ?? []) if (b.google_place_id) byPlace[b.google_place_id] = b.id; }
  for (let i = 0; i < zips.length; i += 100) { const { data } = await supabase.from("elle_businesses").select("id, name, zip, website, phone, google_place_id, org_type").in("zip", zips.slice(i, i + 100)); for (const b of data ?? []) byNameZip[nz(b.name, b.zip)] = { id: b.id, website: b.website, phone: b.phone, place: b.google_place_id, org: b.org_type }; }

  const resolved: Record<string, string> = {};
  const newPlaces: any[] = [];
  for (const p of clean) {
    const hit = byPlace[p.placeId] ? { id: byPlace[p.placeId] } as Ex : byNameZip[nz(p.title, p.postalCode)];
    if (hit) {
      resolved[p.placeId] = hit.id;
      const upd: any = {};
      if (!(hit as Ex).website && cleanSite(p)) upd.website = cleanSite(p);
      if (!(hit as Ex).phone && cleanPhone(p)) upd.phone = cleanPhone(p);
      if (!(hit as Ex).place) upd.google_place_id = p.placeId;
      if (orgType && !(hit as Ex).org) { upd.org_type = orgType; upd.is_fundraiser_target = true; upd.review_count = reviewCount(p); }
      if (Object.keys(upd).length) await supabase.from("elle_businesses").update(upd).eq("id", hit.id);
    } else newPlaces.push(p);
  }

  const toInsert = newPlaces.map((p) => ({ name: String(p.title).slice(0, 200), address: p.street || p.address || null, city: p.city || null, zip: p.postalCode || null, state: p.state || "FL", phone: cleanPhone(p), website: cleanSite(p), google_place_id: p.placeId, industry: p.categoryName || null, source: "google_maps", enrichment_status: null, org_type: orgType, review_count: reviewCount(p), is_fundraiser_target: !!orgType }));
  let inserted: any[] = [];
  if (toInsert.length) { const { data } = await supabase.from("elle_businesses").insert(toInsert).select("id, google_place_id"); inserted = data ?? []; }
  for (const b of inserted) if (b.google_place_id) resolved[b.google_place_id] = b.id;

  const allBizIds = [...new Set(placeIds.map((pid) => resolved[pid]).filter(Boolean))];
  const linkedSet = new Set<string>();
  for (let i = 0; i < allBizIds.length; i += 150) { const { data } = await supabase.from("elle_tenant_businesses").select("business_id").eq("tenant_id", tenantId).in("business_id", allBizIds.slice(i, i + 150)); for (const l of data ?? []) linkedSet.add(l.business_id); }
  const links = allBizIds.filter((id) => !linkedSet.has(id)).map((id) => ({ tenant_id: tenantId, business_id: id, territory_match: "owned", surfaced_at: new Date().toISOString() }));
  if (links.length) await supabase.from("elle_tenant_businesses").insert(links);

  let enrichDispatched = 0;
  if (doEnrich && inserted.length) { for (const b of inserted) { await supabase.rpc("elle_call_edge_function", { p_fn_name: "elle-enrich-business", p_payload: { business_id: b.id, max_contacts: 6, reveal_phone: true } }); enrichDispatched++; } }

  return new Response(JSON.stringify({ ok: true, location, terms, org_type: orgType, min_reviews: minReviews, places_found: clean.length, new_businesses: inserted.length, matched_existing: clean.length - inserted.length, newly_linked: links.length, enrich_dispatched: enrichDispatched }), { headers: { "Content-Type": "application/json" } });
});
