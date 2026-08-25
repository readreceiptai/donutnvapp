// Site-wide password gate — runs on every request at the edge.
// Fail-closed: if SITE_PASSWORD isn't configured, the site stays locked.
import type { Context, Config } from "@netlify/edge-functions";

const COOKIE = "dnv_gate";

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function gatePage(err = ""): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DonutNV — Private Preview</title>
<style>
  body{margin:0;font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#231627;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:20px;padding:40px 36px;max-width:360px;width:88%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4)}
  .donut{width:64px;height:64px;border-radius:50%;background:#E91E63;margin:0 auto 16px;position:relative}
  .donut::after{content:"";position:absolute;inset:22px;border-radius:50%;background:#fff}
  h1{font-size:22px;color:#2B2430;margin:0 0 6px}
  p{color:#6E6473;font-size:14px;margin:0 0 22px}
  input{width:100%;box-sizing:border-box;padding:14px;border:2px solid #E5DEE8;border-radius:12px;font-size:16px;margin-bottom:14px;text-align:center}
  button{width:100%;padding:14px;border:0;border-radius:12px;background:#E91E63;color:#fff;font-size:16px;font-weight:700;cursor:pointer}
  .err{color:#C62828;font-size:13px;margin:0 0 12px}
</style></head><body>
<form class="card" method="POST" action="/__gate">
  <div class="donut"></div>
  <h1>Private preview</h1>
  <p>This site is not public yet. Enter the preview password to continue.</p>
  ${err ? `<div class="err">${err}</div>` : ""}
  <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password">
  <button type="submit">Enter</button>
</form></body></html>`;
  return new Response(html, { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export default async (req: Request, context: Context) => {
  // The demo site (mv-preview) is a curated, territory-locked build for showing partners — leave it
  // open so there's no password friction. The real production domain stays gated below.
  if (new URL(req.url).host.includes("mv-preview")) return context.next();

  // Public asset allowlist: the wallet pass is built by Apple/Google servers that
  // fetch these brand images anonymously and can't carry the preview cookie. These
  // are just logos, so serve them without the gate (the app itself stays locked).
  const p = new URL(req.url).pathname;
  if (p === "/logo-round.png" || p === "/icon-192.png" || p === "/icon-512.png" || p.startsWith("/brand/")) {
    return context.next();
  }

  // Public onboarding form. /onboard is a STANDALONE page (onboard.html) that
  // renders only the intake wizard — not the app router — so exposing it lets
  // invitees fill the form without the site password and WITHOUT unlocking the
  // beta app: the main app's index.html stays gated, so even though the JS/CSS
  // under /assets is served (inert, minified, already shipped to testers), there
  // is no ungated HTML that boots the app. Fonts/Turnstile load from their own
  // domains and aren't gated here.
  if (p === "/onboard" || p === "/onboard.html" || p.startsWith("/assets/")) {
    return context.next();
  }

  const password = Netlify.env.get("SITE_PASSWORD") ?? "";
  if (!password) return new Response("Preview locked (gate not configured).", { status: 503 });
  const token = await sha256Hex(password + "|dnv-gate-v1");

  // Already unlocked?
  const cookies = req.headers.get("cookie") ?? "";
  if (cookies.split(/;\s*/).some((c) => c === `${COOKIE}=${token}`)) return context.next();

  const url = new URL(req.url);
  if (req.method === "POST" && url.pathname === "/__gate") {
    const form = await req.formData().catch(() => null);
    const attempt = String(form?.get("password") ?? "");
    if (attempt === password) {
      return new Response(null, {
        status: 302,
        headers: {
          location: "/",
          "set-cookie": `${COOKIE}=${token}; Path=/; Max-Age=1209600; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
    return gatePage("That password isn't right — try again.");
  }
  return gatePage();
};

export const config: Config = { path: "/*" };
