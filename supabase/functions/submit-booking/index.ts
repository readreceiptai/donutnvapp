// ── Book-a-truck submission — Supabase Edge Function (#122 / M1) ──
// Bookings used to be created by calling the submit_booking RPC directly, which was
// EXECUTE-able by anon. A bot with the public anon key could POST bookings straight to
// Postgres, skipping the Turnstile human-check the client does separately. This function
// is now the ONLY way to create a booking (submit_booking is service_role-only):
//   1. verify the caller's JWT (must be a signed-in user)  -> the created_by we trust
//   2. verify the Turnstile token with Cloudflare          -> the human-check, coupled
//                                                             to the action, server-side
//   3. call submit_booking as service_role with the verified creator id
//
// Graceful pre-launch: if TURNSTILE_SECRET_KEY isn't set, the token check is skipped
// (mirrors verify-turnstile) so the form still works before Turnstile is configured.
//
// Deploy: supabase functions deploy submit-booking

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!
const TURNSTILE_SECRET = Deno.env.get('TURNSTILE_SECRET_KEY') ?? ''

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey',
  'access-control-allow-methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } })
}

async function turnstileOk(token: string, ip: string): Promise<boolean> {
  if (!TURNSTILE_SECRET) return true // not configured yet -> no-op pass
  if (!token) return false
  const form = new FormData()
  form.append('secret', TURNSTILE_SECRET)
  form.append('response', token)
  if (ip) form.append('remoteip', ip)
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
  const out = await res.json().catch(() => ({ success: false }))
  return !!out.success
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  // 1) Verify the caller is a signed-in user (booking requires login).
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
  })
  const { data: userData } = await userClient.auth.getUser()
  const uid = userData?.user?.id
  if (!uid) return json({ error: 'not_authenticated' }, 401)

  const body = await req.json().catch(() => ({}))

  // 2) Verify the Turnstile token server-side (coupled to the action).
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || ''
  if (!(await turnstileOk(body.turnstileToken ?? '', ip))) {
    return json({ error: 'human_check_failed' }, 403)
  }

  if (!body.p_tenant || !body.p_contact_name || !body.p_contact_email || !body.p_zip) {
    return json({ error: 'missing_fields' }, 400)
  }

  // 3) Create the booking as service_role, attributing it to the verified user.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data, error } = await admin.rpc('submit_booking', {
    p_tenant: body.p_tenant,
    p_contact_name: body.p_contact_name,
    p_contact_phone: body.p_contact_phone ?? null,
    p_contact_email: body.p_contact_email,
    p_event_date: body.p_event_date ?? null,
    p_start_time: body.p_start_time ?? null,
    p_guests: body.p_guests ?? null,
    p_zip: body.p_zip,
    p_notes: body.p_notes ?? null,
    p_sms_consent: !!body.p_sms_consent,
    p_marketing_consent: !!body.p_marketing_consent,
    p_consent_text_version: body.p_consent_text_version ?? null,
    p_created_by: uid,
  })
  if (error) {
    const msg = error.message || 'booking_failed'
    return json({ error: msg }, msg.includes('tenant_inactive') ? 409 : 500)
  }
  const row = Array.isArray(data) ? data[0] : data
  return json({ id: row?.id ?? null, tracking_token: row?.tracking_token ?? null })
})
