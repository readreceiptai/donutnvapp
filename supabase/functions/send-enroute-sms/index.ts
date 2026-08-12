// ── "On the way" text — Supabase Edge Function (CORS-fixed, audit-hardened) ──
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'access-control-allow-methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })
}

async function operatorOfTenant(req: Request, tenantId: string): Promise<boolean> {
  const authz = req.headers.get('Authorization') ?? ''
  if (!authz) return false
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authz } } })
  const { data: { user } } = await asUser.auth.getUser()
  if (!user) return false
  const { data: p } = await supabase.from('profiles').select('role, tenant_id, is_superadmin').eq('id', user.id).maybeSingle()
  if (!p) return false
  return !!p.is_superadmin || ((p.role === 'operator' || p.role === 'admin') && p.tenant_id === tenantId)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Audit fix: fail fast with a clear 503 when Twilio isn't configured
  // (previously `!` assertions let it call Twilio with "undefined" creds).
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const auth = Deno.env.get('TWILIO_AUTH_TOKEN')
  const from = Deno.env.get('TWILIO_FROM')
  if (!sid || !auth || !from) return json({ error: 'Twilio not configured' }, 503)

  const { booking_id, kind = 'enroute' } = await req.json().catch(() => ({}))
  if (!booking_id) return json({ error: 'booking_id required' }, 400)

  const { data: b } = await supabase.from('bookings').select('*').eq('id', booking_id).single()
  if (!b) return json({ error: 'booking not found' }, 404)
  if (!(await operatorOfTenant(req, b.tenant_id))) return json({ error: 'unauthorized' }, 403)

  // Audit fix: respect the SMS consent captured on the booking form (TCPA hygiene).
  if (!b.contact_phone) return json({ error: 'booking has no contact phone' }, 400)
  if (b.sms_consent === false) return json({ error: 'customer did not consent to SMS' }, 403)

  const base = Deno.env.get('APP_BASE_URL') || 'https://donutnvapp.com'
  const link = `${base}/track/${b.tracking_token}`
  const messages: Record<string, string> = {
    enroute: `🍩 DonutNV is on the way to your event! Track us live & see our ETA: ${link}`,
    review:  `Thanks for having DonutNV! 🍩 How'd we do? Leave a quick review in the next hour for a sweet bonus toward your next event: ${link}`,
  }
  const bodyText = messages[kind] ?? messages.enroute

  const form = new URLSearchParams({ To: b.contact_phone, From: from, Body: bodyText })
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${sid}:${auth}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  const out = await res.json().catch(() => ({}))
  // Audit fix: surface Twilio failures instead of a misleading 200.
  if (!res.ok) return json({ ok: false, error: out?.message ?? 'Twilio send failed', code: out?.code }, 502)
  return json({ ok: true, sid: out?.sid })
})
