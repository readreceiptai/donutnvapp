// Internal spend-alert SMS sender. Called server-side (pg_net) with a shared
// secret stored in app_config. Sends via the project's existing Twilio creds to
// the fixed recipient in app_config. Not user-facing.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } }) }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const { secret, text } = await req.json().catch(() => ({}))

  const { data: cfg } = await supabase.from('app_config').select('key,value').in('key', ['spend_alert_secret', 'spend_alert_to'])
  const map: Record<string, string> = Object.fromEntries((cfg ?? []).map((r: any) => [r.key, r.value]))
  if (!secret || secret !== map['spend_alert_secret']) return json({ error: 'unauthorized' }, 401)

  const sid = Deno.env.get('TWILIO_ACCOUNT_SID'); const auth = Deno.env.get('TWILIO_AUTH_TOKEN'); const from = Deno.env.get('TWILIO_FROM')
  if (!sid || !auth || !from) return json({ error: 'Twilio not configured' }, 503)
  const to = map['spend_alert_to']
  if (!to) return json({ error: 'no recipient configured' }, 400)

  const bodyText = String(text ?? 'DonutNV ELLE spend alert').slice(0, 600)
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${sid}:${auth}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: bodyText }),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) return json({ ok: false, error: out?.message ?? 'Twilio send failed', code: out?.code }, 502)
  return json({ ok: true, sid: out?.sid })
})
