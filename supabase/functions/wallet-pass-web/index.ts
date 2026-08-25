// Apple PassKit web service for DonutNV passes.
// For now this does two jobs:
//   1. Captures Apple's device error log (POST .../v1/log) so we can see exactly
//      what iOS complains about (this is what was 404ing before).
//   2. Acknowledges device register/unregister + "get updates" calls so iOS is
//      satisfied and stops erroring. (Full live-update push is a later step.)
// Apple authenticates with an "ApplePass <token>" header — we just ack here.
// Deployed with verify_jwt=false (Apple can't send a Supabase JWT).

Deno.serve(async (req) => {
  const path = new URL(req.url).pathname // e.g. /wallet-pass-web/v1/log

  // Apple's error log — record what iOS reports about the pass.
  if (req.method === "POST" && path.endsWith("/v1/log")) {
    const body = await req.text().catch(() => "");
    console.log("APPLE-PASS-LOG " + body.slice(0, 4000));
    return new Response("ok", { status: 200 });
  }

  // Device registration / unregistration for update pushes.
  if (path.includes("/v1/devices/") && path.includes("/registrations/")) {
    return new Response("", { status: req.method === "POST" ? 201 : 200 });
  }

  // "List updated serials" and "get latest pass" — nothing new to push yet.
  return new Response("", { status: 204 });
});
