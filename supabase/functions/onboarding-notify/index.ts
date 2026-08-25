// ============================================================================
// DonutNV — Onboarding submission notifier
// ----------------------------------------------------------------------------
// Fired by a Database Webhook / trigger on INSERT into public.onboarding_intake.
// Formats the submitted answers into a readable email (labeled fields, not raw
// JSON) and sends it to Kevin via Resend. The onboarding_intake row is the system
// of record; this is a notification layer ON TOP.
//
// Fail-safe by design: this runs AFTER the row is committed (a Database Webhook),
// so it can never block the insert. It also never throws — if Resend isn't
// configured yet, or a send fails, it logs and returns 200 so the webhook doesn't
// retry-storm and a broken email never matters to the submission.
//
// Auth: shared secret via ?key= (or x-webhook-secret header). Deploy with
// --no-verify-jwt. Config (Supabase Edge Function secrets):
//   ONBOARDING_NOTIFY_SECRET  our shared webhook secret
//   RESEND_API_KEY            Resend sending key (re_...)  [send.donutnvapp.com]
//   RESEND_FROM   (optional)  default: DonutNV Onboarding <onboarding@send.donutnvapp.com>
//   NOTIFY_TO     (optional)  default: kevindmc@trenchlogic.com
// ============================================================================

const NOTIFY_SECRET = Deno.env.get('ONBOARDING_NOTIFY_SECRET') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'DonutNV Onboarding <onboarding@send.donutnvapp.com>'
const NOTIFY_TO = Deno.env.get('NOTIFY_TO') ?? 'kevindmc@trenchlogic.com'

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

// The fields to show, in order, with human labels.
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

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    const presented = url.searchParams.get('key') ?? req.headers.get('x-webhook-secret')
    if (!NOTIFY_SECRET || presented !== NOTIFY_SECRET) {
      return new Response('unauthorized', { status: 401 })
    }

    let body: any
    try { body = await req.json() } catch { body = {} }
    // Accept both a raw row and a Supabase webhook envelope { type, record, ... }.
    const row = body?.record ?? body ?? {}
    if (!row || typeof row !== 'object') return new Response('ok (no row)', { status: 200 })

    // If Resend isn't configured yet, log and succeed (don't retry-storm, don't
    // matter to the submission — it's already saved).
    if (!RESEND_API_KEY) {
      console.log('onboarding-notify: RESEND_API_KEY not set; skipping send for row', row.id)
      return new Response('ok (email not configured)', { status: 200 })
    }

    const { subject, html } = buildEmail(row)
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: RESEND_FROM, to: [NOTIFY_TO], subject, html }),
      })
      if (!r.ok) {
        console.error('onboarding-notify: Resend send failed', r.status, await r.text().catch(() => ''))
      }
    } catch (e) {
      console.error('onboarding-notify: Resend request threw', String(e))
    }
    // Always 200: the row is saved; a failed notification must not signal failure.
    return new Response('ok', { status: 200 })
  } catch (e) {
    console.error('onboarding-notify: unexpected error', String(e))
    return new Response('ok', { status: 200 })
  }
})
