import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// v6: per-call overrides — request body may pass `model` and `max_searches` to
// run a premium pass (e.g. Sonnet + 6 searches) on a specific tenant without
// changing the global default. Defaults remain Haiku 4.5 / 3 searches (cheap).
// v3: service-role JWT required — this function spends Anthropic budget.
function isServiceRole(req: Request): boolean {
  try {
    const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role";
  } catch { return false; }
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = Deno.env.get("ELLE_CLAUDE_MODEL") ?? "claude-haiku-4-5-20251001";

interface InlineEvent {
  name: string;
  start_date?: string;
  end_date?: string;
  city?: string;
  zip?: string;
  source_url?: string;
}
interface EnrichRequest {
  event_raw_id?: number;
  event?: InlineEvent;
  model?: string;
  max_searches?: number;
}

const SYSTEM_PROMPT = `You are ELLE, the Event Lead List Engine. You research events for mobile food vendor franchisees (DonutNV) and return STRICTLY VALID JSON with confidence scores and source citations on every field.`;

function buildUserPrompt(ev: any) {
  return `Research this event and return JSON.

Event:
- Name: ${ev.name}
- Start date: ${ev.start_date ?? "unknown"}
- City: ${ev.city ?? "unknown"}
- Zip: ${ev.zip ?? "unknown"}
- Source URL: ${ev.source_url ?? "none"}

Use web search to find: host organization name & type; primary contact name/email/phone/title; vendor application URL & process; vendor fee structure; permit costs; application deadline + open date; estimated attendance (most recent year); vendor categories present at past events; mobile-dessert competitors who have appeared (Hopper's, Kona Ice, Mini Mouthful, Glazed and Confused, etc).

Return ONLY this JSON shape (no prose, no markdown fences):
{
  "host": {
    "name": string|null,
    "type": "festival_promoter"|"school"|"church"|"chamber"|"corporate"|"city"|"nonprofit"|"resort_venue"|"other"|null,
    "website": string|null,
    "primary_contact_name": string|null,
    "primary_contact_email": string|null,
    "primary_contact_phone": string|null,
    "primary_contact_title": string|null,
    "contact_confidence": 0-100,
    "contact_source_url": string|null
  },
  "application": {
    "url": string|null,
    "deadline": "YYYY-MM-DD"|null,
    "opens_date": "YYYY-MM-DD"|null,
    "vendor_fee": number|null,
    "vendor_fee_terms": string|null,
    "permit_cost": number|null,
    "permit_notes": string|null,
    "confidence": 0-100
  },
  "intel": {
    "venue": string|null,
    "estimated_attendance": number|null,
    "attendance_source_url": string|null,
    "vendor_categories_present": string[],
    "competitors_present": string[],
    "confidence": 0-100
  },
  "overall_confidence": 0-100,
  "notes": string
}

If a field cannot be found with at least 40 confidence, return null. Wins at every step: partial data is fine — return what you found.`;
}

function extractJson(text: string): any {
  let t = text.replace(/```json|```/g, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("No JSON object found in Claude output");
  return JSON.parse(t.slice(start, end + 1));
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
    }
    if (!isServiceRole(req)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), { status: 500 });
    }
    const body: EnrichRequest = await req.json();
    const reqModel = body.model ?? CLAUDE_MODEL;
    const reqSearches = body.max_searches ?? 3;

    let rawEvent: any;
    if (body.event_raw_id) {
      const { data, error } = await supabase
        .from("elle_events_raw")
        .select("*")
        .eq("id", body.event_raw_id)
        .single();
      if (error) throw error;
      rawEvent = data;
    } else if (body.event) {
      rawEvent = body.event;
    } else {
      return new Response(JSON.stringify({ error: "must provide event_raw_id or event" }), { status: 400 });
    }

    const claudeRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: reqModel,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: reqSearches }],
        messages: [{ role: "user", content: buildUserPrompt(rawEvent) }]
      })
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      throw new Error(`Claude API ${claudeRes.status}: ${errBody}`);
    }
    const claudeData = await claudeRes.json();
    const textBlocks = (claudeData.content ?? []).filter((b: any) => b.type === "text");
    const lastText = textBlocks[textBlocks.length - 1]?.text ?? "";
    const enriched = extractJson(lastText);

    let hostId: string | null = null;
    if (enriched.host?.name) {
      const { data: existing } = await supabase
        .from("elle_hosts")
        .select("id")
        .eq("name", enriched.host.name)
        .maybeSingle();

      const hostFields = {
        name: enriched.host.name,
        host_type: enriched.host.type,
        website: enriched.host.website,
        primary_contact_name: enriched.host.primary_contact_name,
        primary_contact_email: enriched.host.primary_contact_email,
        primary_contact_phone: enriched.host.primary_contact_phone,
        primary_contact_title: enriched.host.primary_contact_title,
        contact_confidence: enriched.host.contact_confidence ?? 0,
        contact_source_url: enriched.host.contact_source_url,
        updated_at: new Date().toISOString()
      };

      if (existing) {
        hostId = existing.id;
        await supabase.from("elle_hosts").update(hostFields).eq("id", hostId);
      } else {
        const { data: newHost, error: hErr } = await supabase
          .from("elle_hosts")
          .insert(hostFields)
          .select("id")
          .single();
        if (hErr) throw hErr;
        hostId = newHost.id;
      }
    }

    const overall = enriched.overall_confidence ?? 0;
    const status = overall >= 70 ? "complete" : overall >= 40 ? "partial" : "failed";

    const eventFields = {
      name: rawEvent.name,
      start_date: rawEvent.start_date ?? null,
      end_date: rawEvent.end_date ?? null,
      city: rawEvent.city ?? null,
      zip: rawEvent.zip ?? null,
      host_id: hostId,
      host_name_raw: enriched.host?.name ?? null,
      application_url: enriched.application?.url ?? null,
      application_deadline: enriched.application?.deadline ?? null,
      application_opens_date: enriched.application?.opens_date ?? null,
      vendor_fee: enriched.application?.vendor_fee ?? null,
      vendor_fee_terms: enriched.application?.vendor_fee_terms ?? null,
      permit_cost: enriched.application?.permit_cost ?? null,
      permit_notes: enriched.application?.permit_notes ?? null,
      estimated_attendance: enriched.intel?.estimated_attendance ?? null,
      attendance_source_url: enriched.intel?.attendance_source_url ?? null,
      vendor_categories_present: enriched.intel?.vendor_categories_present ?? [],
      competitors_present: enriched.intel?.competitors_present ?? [],
      venue: enriched.intel?.venue ?? null,
      enrichment_status: status,
      enrichment_confidence: overall,
      enrichment_notes: enriched.notes ?? null,
      last_enriched_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: ev, error: evErr } = await supabase
      .from("elle_events")
      .upsert(eventFields, { onConflict: "slug,start_date" })
      .select()
      .single();
    if (evErr) throw evErr;

    if (body.event_raw_id) {
      await supabase
        .from("elle_events_raw")
        .update({ processed: true, processed_at: new Date().toISOString(), promoted_event_id: ev.id })
        .eq("id", body.event_raw_id);
    }

    await supabase.rpc("elle_recompute_scores");

    return new Response(JSON.stringify({
      success: true,
      event_id: ev.id,
      host_id: hostId,
      model: reqModel,
      overall_confidence: overall,
      status,
      enriched
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
