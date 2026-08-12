// Demo-only helper: completes a demo customer's stamp card live on screen.
// Hardened: key lives in app_config (rotatable), restricted to an email allowlist,
// and capped at the card goal so it can never be farmed. Not part of the app UI.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function page(title: string, body: string) {
  return new Response(
    `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;background:#FBF3E7;color:#2b2118;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center;padding:24px}.c{max-width:340px}h1{color:#E5116A;font-size:1.6rem;margin:0 0 8px}p{color:#8a7c6b;font-size:1rem}</style><div class=c><h1>${title}</h1><p>${body}</p></div>`,
    { headers: { "content-type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  const { data: cfg } = await supabase.from("app_config").select("key,value").in("key", ["demo_checkin_key", "demo_checkin_emails"]);
  const map: Record<string, string> = Object.fromEntries((cfg ?? []).map((r: any) => [r.key, r.value]));
  const KEY = map["demo_checkin_key"] || "";
  if (!KEY || url.searchParams.get("key") !== KEY) return page("Nope", "Invalid key.");

  const email = (url.searchParams.get("email") || "kevin@donutnv.com").toLowerCase();
  const allow = (map["demo_checkin_emails"] || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  if (!allow.includes(email)) return page("Not allowed", "This demo helper only works for approved demo accounts.");

  const { data: prof } = await supabase.from("profiles").select("id,tenant_id").eq("email", email).maybeSingle();
  if (!prof) return page("Not found", `No customer for ${email}.`);
  const { data: camp } = await supabase.from("campaigns").select("id,config").eq("tenant_id", prof.tenant_id).eq("kind", "checkin_stamp").eq("is_active", true).maybeSingle();
  if (!camp) return page("No card", "No active stamp card for this territory.");
  const { data: truck } = await supabase.from("trucks").select("id").eq("tenant_id", prof.tenant_id).limit(1).maybeSingle();

  const goal = Number((camp.config as any)?.goal) || 5;
  const { count: before } = await supabase.from("check_ins").select("id", { count: "exact", head: true }).eq("profile_id", prof.id).eq("campaign_id", camp.id);
  const cur = before || 0;
  if (cur >= goal) return page("Already complete", `${cur}/${goal} stamps — card already full. No stamp added.`);

  await supabase.from("check_ins").insert({ profile_id: prof.id, tenant_id: prof.tenant_id, truck_id: truck?.id ?? null, campaign_id: camp.id, source: "manual", lat: 29.1875, lng: -82.1401, amount_cents: 900 });
  const n = cur + 1;
  const done = n >= goal;
  return page(done ? "Reward unlocked! 🎉" : "Checked in ✅", done ? `${n}/${goal} stamps — free bag earned. Refresh the Rewards screen.` : `${n}/${goal} stamps. ${goal - n} to go. Refresh the Rewards screen.`);
});
