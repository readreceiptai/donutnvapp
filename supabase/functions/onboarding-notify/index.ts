// ============================================================================
// DonutNV — Onboarding submission notifier
// ----------------------------------------------------------------------------
// Fired by a Database Webhook / trigger on INSERT into public.onboarding_intake.
// Formats the submitted answers into a readable email (labeled fields, not raw
// JSON) and sends it to Kevin via Resend. The onboarding_intake row is the system
// of record; this is a notification layer ON TOP.
//
// Config lives in app_config (RLS on, no policies => service-role only), read
// here via the auto-provided service role — so no manually-set Edge secrets are
// required. Keys:
//   onboarding_notify_secret   shared secret; must match the ?key= the trigger sends
//   resend_api_key             Resend sending key (re_...) for send.donutnvapp.com
//   onboarding_notify_from     (optional) default: DonutNV Onboarding <onboarding@send.donutnvapp.com>
//   onboarding_notify_to       (optional) default: kevindmc@trenchlogic.com
//
// Fail-safe: runs AFTER the row is committed (a webhook), so it can never block
// the insert; it never throws and always returns 200 so a failed/unconfigured
// send never matters to the submission.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

const DEFAULT_FROM = 'DonutNV Onboarding <onboarding@send.donutnvapp.com>'
const DEFAULT_TO = 'kevindmc@trenchlogic.com'

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const planLabel = (p: unknown) =>
  p === 'window_elle' ? 'The Window + E.L.L.E. (Event Lead List Engine)'
  : p === 'window' ? 'The Window (customer app)'
  : (p ? String(p) : '—')

const val = (v: unknown) => {
  if (v == null || v === '') return '—'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  return String(v)
}

const FIELDS: [string, string, ((v: unknown) => string)?][] = [
  ['territory_name', 'Territory'],
  ['owner_name', 'Owner name(s)'],
  ['business_name', 'Business / DBA'],
  ['mobile', 'Mobile'],
  ['email', 'Email'],
  ['operator_type', 'Operator type'],
  ['plan', 'Plan', planLabel],
  ['outcomes', 'Most looking forward to'],
  ['unit_count', 'Trucks / trailers'],
  ['gps_method', 'Live tracking'],
  ['phones', 'Phones'],
  ['owned_zips', 'Owned ZIPs'],
  ['home_base', 'Home base'],
  ['travel_radius', 'Travel radius'],
  ['uses_leadconnector', 'Uses LeadConnector'],
  ['lc_uses', 'LeadConnector uses'],
  ['other_booking_service', 'Other booking service'],
  ['square_email', 'Square email'],
  ['facebook_url', 'Facebook'],
  ['instagram_url', 'Instagram'],
  ['event_types', 'Event types'],
  ['notes', 'Notes'],
]

function buildEmail(row: Record<string, any>) {
  const rows = FIELDS.map(([key, label, fmt]) => {
    const raw = fmt ? fmt(row[key]) : val(row[key])
    return `<tr>
      <td style="padding:6px 12px;color:#6B6B6B;font-size:13px;white-space:nowrap;vertical-align:top">${esc(label)}</td>
      <td style="padding:6px 12px;color:#231F20;font-size:14px;font-weight:600">${esc(raw)}</td>
    </tr>`
  }).join('')

  const subject = `New onboarding: ${val(row.business_name)} (${val(row.territory_name)})`
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:0 auto">
    <div style="background:#DD1B22;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0">
      <div style="font-size:18px;font-weight:800">New DonutNV onboarding submission</div>
    </div>
    <div style="border:1px solid #ECE6E0;border-top:none;border-radius:0 0 12px 12px;padding:8px 8px 14px">
      <table style="width:100%;border-collapse:collapse">${rows}</table>
      <div style="padding:10px 12px 0;color:#9ca3af;font-size:12px">
        Submission id: ${esc(row.id ?? '—')} &middot; received ${esc(row.created_at ?? new Date().toISOString())}
      </div>
    </div>
  </div>`
  return { subject, html }
}

async function loadConfig() {
  const { data } = await admin.from('app_config').select('key, value').in('key', [
    'onboarding_notify_secret', 'resend_api_key', 'onboarding_notify_from', 'onboarding_notify_to',
  ])
  const cfg: Record<string, string> = {}
  for (const r of data ?? []) cfg[r.key] = r.value
  return cfg
}

Deno.serve(async (req) => {
  try {
    const cfg = await loadConfig()
    const url = new URL(req.url)
    const presented = url.searchParams.get('key') ?? req.headers.get('x-webhook-secret')
    const secret = cfg.onboarding_notify_secret ?? ''
    if (!secret || presented !== secret) {
      return new Response('unauthorized', { status: 401 })
    }

    let body: any
    try { body = await req.json() } catch { body = {} }
    // Accept both a raw row and a Supabase webhook envelope { type, record, ... }.
    const row = body?.record ?? body ?? {}
    if (!row || typeof row !== 'object') return new Response('ok (no row)', { status: 200 })

    const resendKey = cfg.resend_api_key ?? ''
    if (!resendKey) {
      console.log('onboarding-notify: resend_api_key not configured; skipping send for row', row.id)
      return new Response('ok (email not configured)', { status: 200 })
    }

    const { subject, html } = buildEmail(row)
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: cfg.onboarding_notify_from || DEFAULT_FROM,
          to: [cfg.onboarding_notify_to || DEFAULT_TO],
          subject, html,
        }),
      })
      const txt = await r.text().catch(() => '')
      if (r.ok) console.log('onboarding-notify: sent for row', row.id, txt)
      else console.error('onboarding-notify: Resend send failed', r.status, txt)
    } catch (e) {
      console.error('onboarding-notify: Resend request threw', String(e))
    }
    return new Response('ok', { status: 200 })
  } catch (e) {
    console.error('onboarding-notify: unexpected error', String(e))
    return new Response('ok', { status: 200 })
  }
})
