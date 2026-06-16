// ── Cloudflare Turnstile verification — Supabase Edge Function ──
// Server-side check that a Turnstile token is real before we let a public form
// (signup / book-a-truck) through. The browser never holds the secret key — it
// only gets a token from the Turnstile widget, then asks this function to
// validate it against Cloudflare. This is the second line of defense behind the
// honeypot + time-trap already on those forms.
//
// Deploy:  supabase functions deploy verify-turnstile
// Secret:  TURNSTILE_SECRET_KEY   (from the Cloudflare Turnstile dashboard)
//   supabase secrets set TURNSTILE_SECRET_KEY=...
//
// Graceful pre-launch behavior: if no secret is configured yet, this returns
// { ok: true, skipped: true } so the app keeps working before Turnstile is set
// up. Once the secret is set, tokens are actually enforced.
//
// Call with: { "token": "<turnstile-response-token>" }

const SECRET = Deno.env.get('TURNSTILE_SECRET_KEY') ?? ''

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, content-type, apikey',
        'access-control-allow-methods': 'POST, OPTIONS',
      },
    })
  }

  // Not configured yet → no-op pass so the form still works pre-launch.
  if (!SECRET) return json({ ok: true, skipped: true })

  const { token } = await req.json().catch(() => ({}))
  if (!token) return json({ ok: false, error: 'missing token' }, 400)

  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || ''
  const form = new FormData()
  form.append('secret', SECRET)
  form.append('response', token)
  if (ip) form.append('remoteip', ip)

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', body: form,
  })
  const out = await res.json().catch(() => ({ success: false }))
  return json({ ok: !!out.success, codes: out['error-codes'] ?? [] }, out.success ? 200 : 403)
})
