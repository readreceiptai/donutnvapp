// ============================================================================
// DonutNV — "back online" recovery notifier (ops alert)
// ----------------------------------------------------------------------------
// Target: an UptimeRobot alert webhook. When the monitor RECOVERS (alertType=2),
// this sends the branded back-online email (status-pages/back-online-email.html)
// to ops (Kevin). Down alerts (alertType=1) are acknowledged but don't email.
//
// Configure the UptimeRobot "up" webhook URL (GET or POST) as:
//   https://<ref>.supabase.co/functions/v1/back-online-notify?key=<SECRET>&type=*alertType*&monitor=*monitorFriendlyName*
//
// Public (no JWT); authenticated by the ?key= shared secret. Config is read from
// app_config via the service role (no manually-set Edge secrets needed):
//   back_online_notify_secret  shared secret; must match ?key=
//   resend_api_key             Resend sending key (re_...) for send.donutnvapp.com
//   back_online_notify_to      (optional) default: kevindmc@trenchlogic.com
//   back_online_notify_from    (optional) default: DonutNV Status <status@send.donutnvapp.com>
//
// Always returns 200 so UptimeRobot doesn't retry-hammer; failures are logged.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

const DEFAULT_FROM = 'DonutNV Status <status@send.donutnvapp.com>'
const DEFAULT_TO = 'kevindmc@trenchlogic.com'

// The branded recovery email (from status-pages/back-online-email.html).
// Email needs ABSOLUTE URLs; logo-black is used so it's visible on the white card.
function emailHtml() {
  return `<table width='100%' cellpadding='0' cellspacing='0' style='background:#FFF4EC;padding:32px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'>
  <tr><td align='center'>
    <table width='460' cellpadding='0' cellspacing='0' style='background:#ffffff;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.08);overflow:hidden;'>
      <tr><td align='center' style='padding:34px 28px 6px;'>
        <img src='https://donutnvapp.com/brand/logo-black.png' width='190' alt='DonutNV' style='display:block;width:190px;max-width:72%;height:auto;' />
      </td></tr>
      <tr><td style='padding:14px 34px 8px;text-align:center;'>
        <h1 style='margin:0 0 8px;font-size:23px;color:#231F20;'>We're back, and the shop's open</h1>
        <p style='margin:0 0 18px;font-size:15px;line-height:1.55;color:#5b5654;'>Thanks for hanging with us while we glazed things back together. Everything's running sweet again and right where you left it.</p>
        <div style='margin:2px 0 20px;'><a href='https://donutnvapp.com/' style='display:inline-block;background:#DD1B22;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 30px;border-radius:12px;'>Pick up where you left off</a></div>
        <p style='margin:0 0 4px;font-size:13px;line-height:1.5;color:#8a8482;'>Sorry for the short break. Sweet things are worth the wait.</p>
      </td></tr>
      <tr><td style='padding:18px 28px 26px;border-top:1px solid #f1ece9;text-align:center;'>
        <p style='margin:0;font-size:12px;color:#a8a2a0;'>DonutNV &bull; Make Your Next Party Sweet!&reg;</p>
      </td></tr>
    </table>
  </td></tr>
</table>`
}

async function loadConfig() {
  const { data } = await admin.from('app_config').select('key, value').in('key', [
    'back_online_notify_secret', 'resend_api_key', 'back_online_notify_to', 'back_online_notify_from',
  ])
  const cfg: Record<string, string> = {}
  for (const r of data ?? []) cfg[r.key] = r.value
  return cfg
}

Deno.serve(async (req) => {
  try {
    const cfg = await loadConfig()
    const url = new URL(req.url)

    // Auth: shared secret from ?key= (or x-webhook-secret header).
    const presented = url.searchParams.get('key') ?? req.headers.get('x-webhook-secret')
    const secret = cfg.back_online_notify_secret ?? ''
    if (!secret || presented !== secret) return new Response('unauthorized', { status: 401 })

    // Figure out the alert type + monitor name from query or body (UptimeRobot
    // can send either). alertType 2 = up/recovery, 1 = down.
    let alertType = url.searchParams.get('type') ?? url.searchParams.get('alertType') ?? ''
    let monitor = url.searchParams.get('monitor') ?? url.searchParams.get('monitorFriendlyName') ?? ''
    if (!alertType) {
      try {
        const ct = req.headers.get('content-type') ?? ''
        if (ct.includes('application/json')) {
          const b = await req.json()
          alertType = String(b.alertType ?? b.type ?? '')
          monitor = monitor || String(b.monitorFriendlyName ?? b.monitor ?? '')
        } else {
          const f = await req.formData()
          alertType = String(f.get('alertType') ?? f.get('type') ?? '')
          monitor = monitor || String(f.get('monitorFriendlyName') ?? f.get('monitor') ?? '')
        }
      } catch { /* no body */ }
    }

    // Only email on recovery (up). Acknowledge everything else without sending.
    if (String(alertType) !== '2') {
      console.log('back-online-notify: non-recovery alert (type=' + alertType + '); no email', monitor)
      return new Response('ok (not a recovery)', { status: 200 })
    }

    const resendKey = cfg.resend_api_key ?? ''
    if (!resendKey) {
      console.log('back-online-notify: resend_api_key not configured; skipping send')
      return new Response('ok (email not configured)', { status: 200 })
    }

    const subject = `DonutNV is back online${monitor ? ' — ' + monitor : ''}`
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: cfg.back_online_notify_from || DEFAULT_FROM,
          to: [cfg.back_online_notify_to || DEFAULT_TO],
          subject, html: emailHtml(),
        }),
      })
      const txt = await r.text().catch(() => '')
      if (r.ok) console.log('back-online-notify: sent', txt)
      else console.error('back-online-notify: Resend failed', r.status, txt)
    } catch (e) {
      console.error('back-online-notify: Resend threw', String(e))
    }
    return new Response('ok', { status: 200 })
  } catch (e) {
    console.error('back-online-notify: unexpected error', String(e))
    return new Response('ok', { status: 200 })
  }
})
