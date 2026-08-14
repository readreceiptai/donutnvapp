// Apollo async phone-reveal receiver. v5: correct payload shape people[].phone_numbers[].
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SECRET = Deno.env.get("APOLLO_WEBHOOK_SECRET") ?? "";
const RANK: Record<string, number> = { mobile: 1, work_direct: 2, direct: 3, other: 4, work_hq: 5 };

function pickPhone(p: any): string | null {
  const arr = Array.isArray(p?.phone_numbers) ? p.phone_numbers : [];
  const valid = arr.filter((x: any) => x?.raw_number);
  if (!valid.length) return null;
  valid.sort((a: any, b: any) => (RANK[a.type_cd] || 9) - (RANK[b.type_cd] || 9));
  return valid[0].raw_number;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Prefer the secret in a header (kept out of access logs). Fall back to the
  // ?key= query param for Apollo callbacks that can only carry a URL.
  const presented = req.headers.get("x-webhook-secret") ?? url.searchParams.get("key");
  if (!SECRET || presented !== SECRET) return new Response("forbidden", { status: 403 });
  const body: any = await req.json().catch(() => ({}));
  await supabase.from("apollo_webhook_log").insert({ body }).then(() => {}, () => {});
  const people: any[] = body?.people || body?.matches || body?.webhook_result?.people || (Array.isArray(body) ? body : []);
  let updated = 0;
  for (const p of people) {
    const pid = p?.id;
    const phone = pickPhone(p);
    if (!pid || !phone) continue;
    const { error } = await supabase.from("elle_business_pocs").update({ phone }).eq("apollo_person_id", String(pid)).is("phone", null);
    if (!error) updated++;
  }
  return new Response(JSON.stringify({ ok: true, updated, people: people.length }), { headers: { "Content-Type": "application/json" } });
});
