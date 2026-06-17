// ── Wallet pass issuance — Supabase Edge Function ──
// Issues a DonutNV loyalty pass for the signed-in member. Builds the pass
// CONTENT now (brand, stamp progress, QR = member id) and tracks issuance, so
// the whole flow is testable before Apple approves the HazBinz LLC developer
// account. The actual .pkpass SIGNING needs the Apple Pass Type cert, which
// goes in later as secrets — until then this returns { configured:false } and
// the UI shows a "coming soon" state instead of breaking.
//
// Deploy:  supabase functions deploy wallet-pass
// Secrets (set AFTER Apple approves + you create the Pass Type ID/cert):
//   APPLE_PASS_CERT_P12_BASE64   (Pass Type ID cert + key, base64 .p12)
//   APPLE_PASS_CERT_PASSWORD
//   APPLE_PASS_TYPE_ID           (e.g. pass.com.donutnv.loyalty)
//   APPLE_TEAM_ID
//   APPLE_WWDR_CERT_BASE64       (Apple WWDR intermediate cert)
//   (Google Wallet uses GOOGLE_WALLET_ISSUER_ID + a service account — separate.)
//
// Call (authenticated member): POST { platform?: "apple"|"google" }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

// Brand tokens (kept in sync with the app's DonutNV palette).
const BRAND = { bg: 'rgb(233, 30, 99)', fg: 'rgb(255, 255, 255)', label: 'rgb(255, 224, 240)' }
const STAMP_GOAL = 10

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  })
}

function appleConfigured(): boolean {
  return !!(Deno.env.get('APPLE_PASS_CERT_P12_BASE64') && Deno.env.get('APPLE_PASS_TYPE_ID') && Deno.env.get('APPLE_TEAM_ID'))
}

// Builds the pass.json field structure for an Apple storeCard (loyalty) pass.
// This is the exact content that gets signed once the cert is available.
function buildApplePassJson(opts: {
  passTypeId: string; teamId: string; serial: string; authToken: string;
  firstName: string; stamps: number; tenantName: string; memberId: string;
}) {
  const remaining = Math.max(0, STAMP_GOAL - opts.stamps)
  return {
    formatVersion: 1,
    passTypeIdentifier: opts.passTypeId,
    teamIdentifier: opts.teamId,
    serialNumber: opts.serial,
    authenticationToken: opts.authToken,
    webServiceURL: `${SUPABASE_URL}/functions/v1/wallet-pass-web/`,
    organizationName: 'DonutNV',
    description: 'DonutNV Loyalty Card',
    logoText: 'DonutNV',
    foregroundColor: BRAND.fg,
    backgroundColor: BRAND.bg,
    labelColor: BRAND.label,
    storeCard: {
      headerFields: [{ key: 'stamps', label: 'STAMPS', value: `${opts.stamps}/${STAMP_GOAL}` }],
      primaryFields: [{ key: 'reward', label: 'NEXT REWARD', value: remaining === 0 ? 'Free bag! 🍩' : `${remaining} to a free bag` }],
      secondaryFields: [{ key: 'member', label: 'MEMBER', value: opts.firstName || 'Donut fan' }],
      auxiliaryFields: [{ key: 'territory', label: 'TRUCK', value: opts.tenantName }],
      backFields: [
        { key: 'how', label: 'How it works', value: `Earn a stamp every visit. ${STAMP_GOAL} stamps = a free bag of mini-donuts.` },
        { key: 'schedule', label: 'Find us', value: 'Open the DonutNV app to see where we are this week.' },
      ],
    },
    barcodes: [{ format: 'PKBarcodeFormatQR', message: opts.memberId, messageEncoding: 'iso-8859-1' }],
  }
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

  // Authenticate the member from their JWT.
  const authHeader = req.headers.get('Authorization') ?? ''
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: { user } } = await asUser.auth.getUser()
  if (!user) return json({ error: 'not signed in' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const { platform = 'apple' } = await req.json().catch(() => ({}))

  // Member profile + their tenant.
  const { data: profile } = await admin.from('profiles')
    .select('id, tenant_id, first_name').eq('id', user.id).maybeSingle()
  if (!profile) return json({ error: 'no profile' }, 404)

  const { data: tenant } = await admin.from('tenants').select('name').eq('id', profile.tenant_id).maybeSingle()

  // Current stamp count = this member's check-ins (purchases recorded via Square).
  const { count: stamps } = await admin.from('check_ins')
    .select('id', { count: 'exact', head: true }).eq('profile_id', profile.id)

  // Issue (or fetch) the pass record so we can track install + push later.
  let { data: pass } = await admin.from('wallet_passes')
    .select('*').eq('profile_id', profile.id).eq('platform', platform).maybeSingle()
  if (!pass) {
    const serial = crypto.randomUUID()
    const authToken = crypto.randomUUID().replace(/-/g, '')
    const { data: created } = await admin.from('wallet_passes').insert({
      tenant_id: profile.tenant_id, profile_id: profile.id, platform,
      serial_number: serial, auth_token: authToken, status: 'issued',
    }).select().single()
    pass = created
  }

  const passJson = buildApplePassJson({
    passTypeId: Deno.env.get('APPLE_PASS_TYPE_ID') || 'pass.com.donutnv.loyalty',
    teamId: Deno.env.get('APPLE_TEAM_ID') || 'TEAMID',
    serial: pass.serial_number, authToken: pass.auth_token,
    firstName: profile.first_name, stamps: stamps ?? 0,
    tenantName: tenant?.name || 'DonutNV', memberId: profile.id,
  })

  // Until the Apple cert is loaded we can't sign a real .pkpass — return the
  // built content so the UI can preview/"coming soon" and we can verify design.
  if (platform === 'apple' && !appleConfigured()) {
    return json({ configured: false, serial: pass.serial_number, pass_preview: passJson })
  }

  // TODO (post-Apple-approval): sign passJson + assets into a .pkpass zip using
  // APPLE_PASS_CERT_P12_BASE64 / APPLE_WWDR_CERT_BASE64 and return it with
  // content-type application/vnd.apple.pkpass. (Google Wallet: mint a JWT
  // "save" link against GOOGLE_WALLET_ISSUER_ID.)
  return json({ configured: true, serial: pass.serial_number, note: 'signing not yet implemented in scaffold', pass_preview: passJson })
})
