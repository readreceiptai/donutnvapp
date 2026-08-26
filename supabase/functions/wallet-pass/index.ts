// ── Wallet pass issuance — Supabase Edge Function ──
// DonutNV rewards card — solid brand-blue storeCard (no strip, no QR).
//   • Apple  → signed .pkpass (blue background, circular logo, points/tier +
//     member fields, all on the front).
//   • Google → signed "Save to Google Wallet" JWT.
// Live points/tier from get_member_rewards(). No-ops to { configured:false }
// until the platform's signing secrets are set.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import forge from 'https://esm.sh/node-forge@1.3.1'
import JSZip from 'https://esm.sh/jszip@3.10.1'
import * as jose from 'https://esm.sh/jose@5.9.6'
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const env = (k: string) => Deno.env.get(k) || ''

const BLUE = 'rgb(2, 52, 98)'
const WHITE = 'rgb(255, 255, 255)'
const LABEL = 'rgb(159, 178, 201)'
const HEX_BG = '#023462'
const ICON_URL = env('WALLET_ICON_URL') || 'https://donutnvapp.com/logo-round.png'
const LOGO_URL = env('WALLET_LOGO_URL') || 'https://donutnvapp.com/brand/logo-white-solid.png'
const THUMB_URL = env('WALLET_THUMB_URL') || 'https://donutnvapp.com/logo-round.png'
const FALLBACK_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'access-control-allow-methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } })
}

const appleConfigured = () =>
  !!(env('APPLE_PASS_CERT_P12_BASE64') && env('APPLE_PASS_TYPE_ID') && env('APPLE_TEAM_ID') && env('APPLE_WWDR_CERT_BASE64'))
const googleConfigured = () => !!(env('GOOGLE_WALLET_ISSUER_ID') && env('GOOGLE_WALLET_SA_JSON'))

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64); const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function bytesToBinStr(u8: Uint8Array): string {
  let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s
}
function sha1Hex(u8: Uint8Array): string {
  const md = forge.md.sha1.create(); md.update(bytesToBinStr(u8)); return md.digest().toHex()
}
async function fetchPngOrNull(url: string): Promise<Uint8Array | null> {
  try { const r = await fetch(url); if (!r.ok) return null; return new Uint8Array(await r.arrayBuffer()) } catch { return null }
}

type Rewards = {
  balance: number; tier: string; rewardDollars: string; toFreeDozen: number;
  name: string; memberSince: string; tenantName: string;
}
const L = 'PKTextAlignmentLeft'

type PassLoc = { latitude: number; longitude: number; relevantText?: string }

// deno-lint-ignore no-explicit-any
async function loadLocations(admin: any, tenantId: string): Promise<PassLoc[]> {
  const nowMs = Date.now()
  const { data: stops } = await admin.from('scheduled_stops')
    .select('stop_name, lat, lng, ends_at, starts_at')
    .eq('tenant_id', tenantId).eq('is_public', true)
    .not('lat', 'is', null).not('lng', 'is', null)
    .order('starts_at', { ascending: true }).limit(40)
  const locs: PassLoc[] = (stops || [])
    .filter((s: any) => !s.ends_at || new Date(s.ends_at).getTime() >= nowMs)
    .slice(0, 10)
    .map((s: any) => ({
      latitude: s.lat, longitude: s.lng,
      relevantText: `DonutNV is nearby${s.stop_name ? ' at ' + s.stop_name : ''} — fresh mini donuts!`.slice(0, 150),
    }))
  if (locs.length > 0) return locs
  // Fallback: tenant home coordinates if no scheduled stops exist.
  const { data: home } = await admin.from('tenants').select('lat, lng, name').eq('id', tenantId).maybeSingle()
  if (home?.lat != null && home?.lng != null) {
    return [{ latitude: home.lat, longitude: home.lng, relevantText: `${home.name || 'DonutNV'} is nearby — fresh mini donuts!`.slice(0, 150) }]
  }
  return []
}

function buildApplePassJson(o: { passTypeId: string; teamId: string; serial: string; authToken: string; memberId: string; r: Rewards; locations: PassLoc[]; refUrl: string | null }) {
  return {
    formatVersion: 1,
    passTypeIdentifier: o.passTypeId,
    teamIdentifier: o.teamId,
    serialNumber: o.serial,
    authenticationToken: o.authToken,
    webServiceURL: `${SUPABASE_URL}/functions/v1/wallet-pass-web/`,
    organizationName: 'DonutNV',
    description: 'DonutNV Rewards Card',
    foregroundColor: WHITE,
    backgroundColor: BLUE,
    labelColor: LABEL,
    // Location relevance: surface the card on the lock screen when the customer
    // is near a truck stop. maxDistance 1000m is Apple's large-radius maximum
    // (~0.62 mi) — the widest a Wallet pass allows. Up to 10 stops per pass.
    ...(o.locations.length ? { maxDistance: 1000, locations: o.locations.slice(0, 10) } : {}),
    // Personal referral QR — a friend scans it to sign up; the referrer earns on
    // the friend's first purchase. Also gives the card its bottom barcode row.
    ...(o.refUrl ? {
      barcodes: [{ format: 'PKBarcodeFormatQR', message: o.refUrl, messageEncoding: 'iso-8859-1', altText: 'Scan to share DonutNV' }],
      barcode: { format: 'PKBarcodeFormatQR', message: o.refUrl, messageEncoding: 'iso-8859-1', altText: 'Scan to share DonutNV' },
    } : {}),
    generic: {
      headerFields: [{ key: 'tier', label: 'TIER', value: o.r.tier }],
      primaryFields: [{ key: 'balance', label: 'BALANCE', value: `${o.r.balance.toLocaleString()} pts` }],
      secondaryFields: [
        { key: 'member', label: 'MEMBER', value: o.r.name, textAlignment: L },
        { key: 'since', label: 'MEMBER SINCE', value: o.r.memberSince, textAlignment: L },
      ],
      auxiliaryFields: [
        { key: 'value', label: 'REWARDS', value: `$${o.r.rewardDollars}`, textAlignment: L },
        { key: 'next', label: 'NEXT REWARD', value: o.r.toFreeDozen > 0 ? `${o.r.toFreeDozen.toLocaleString()} pts` : 'Ready!', textAlignment: L },
      ],
    },
  }
}

async function buildApplePkpass(passJson: Record<string, unknown>): Promise<Uint8Array> {
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.decode64(env('APPLE_PASS_CERT_P12_BASE64'))), env('APPLE_PASS_CERT_PASSWORD'))
  let key: unknown = null
  for (const t of [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag]) {
    const bags = p12.getBags({ bagType: t })[t] || []
    if (bags[0]?.key) { key = bags[0].key; break }
  }
  const cert = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [])[0]?.cert
  if (!key || !cert) throw new Error('could not read Pass Type cert/key from .p12')
  const wwdr = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.decode64(env('APPLE_WWDR_CERT_BASE64'))))

  // Icons MUST be three distinct sizes for Apple to draw the icon on the pass
  // face: 29 / 58 / 87 px. We had been shipping one 120px image reused for all
  // three — iOS accepts that for notifications but silently refuses to render it
  // on the card face. Resize the badge to the exact sizes here.
  const iconSrc = (await fetchPngOrNull(ICON_URL)) ?? b64ToBytes(FALLBACK_PNG_B64)
  const files: Record<string, Uint8Array> = {
    'pass.json': new TextEncoder().encode(JSON.stringify(passJson)),
  }
  try {
    const base = await Image.decode(iconSrc)
    for (const [name, px] of [['icon.png', 29], ['icon@2x.png', 58], ['icon@3x.png', 87]] as [string, number][]) {
      files[name] = await base.clone().resize(px, px).encode()
    }
  } catch (_e) {
    files['icon.png'] = iconSrc; files['icon@2x.png'] = iconSrc; files['icon@3x.png'] = iconSrc
  }
  console.log(JSON.stringify({ tag: 'wp-icons', i1: files['icon.png']?.length, i2: files['icon@2x.png']?.length, i3: files['icon@3x.png']?.length }))
  const logo = await fetchPngOrNull(LOGO_URL)
  if (logo) { files['logo.png'] = logo; files['logo@2x.png'] = logo; files['logo@3x.png'] = logo }

  // Thumbnail = the round DonutNV badge. Unlike icon.png (which Apple only shows
  // on the lock screen / notifications, never on the card face), the thumbnail IS
  // drawn on the front of a generic pass — right side, next to the fields. This is
  // the same slot GEICO's gecko / Amazon's product photo use.
  const thumb = await fetchPngOrNull(THUMB_URL)
  if (thumb) { files['thumbnail.png'] = thumb; files['thumbnail@2x.png'] = thumb; files['thumbnail@3x.png'] = thumb }

  const manifest: Record<string, string> = {}
  for (const [name, bytes] of Object.entries(files)) manifest[name] = sha1Hex(bytes)
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))

  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(bytesToBinStr(manifestBytes))
  p7.addCertificate(cert); p7.addCertificate(wwdr)
  p7.addSigner({
    key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  })
  p7.sign({ detached: true })
  const sigDer = forge.asn1.toDer(p7.toAsn1()).getBytes()
  const signature = new Uint8Array(sigDer.length)
  for (let i = 0; i < sigDer.length; i++) signature[i] = sigDer.charCodeAt(i)

  const zip = new JSZip()
  for (const [name, bytes] of Object.entries(files)) zip.file(name, bytes)
  zip.file('manifest.json', manifestBytes)
  zip.file('signature', signature)
  return await zip.generateAsync({ type: 'uint8array' })
}

async function buildGoogleSaveUrl(o: { memberId: string; r: Rewards; locations: PassLoc[]; refUrl: string | null }): Promise<string> {
  const sa = JSON.parse(env('GOOGLE_WALLET_SA_JSON'))
  const issuerId = env('GOOGLE_WALLET_ISSUER_ID')
  const classId = `${issuerId}.donutnv_loyalty`
  const objectId = `${issuerId}.${o.memberId.replace(/[^a-zA-Z0-9._-]/g, '')}`
  // Keep this inline class in lockstep with the class registered via the Wallet REST
  // API (#74) — same logo, hero, program name, colors — so a saved pass renders
  // identically whether Google resolves the registered class or this definition.
  const loyaltyClass = {
    id: classId, issuerName: 'DonutNV', programName: 'DonutNV Rewards',
    programLogo: {
      sourceUri: { uri: env('GOOGLE_WALLET_LOGO_URL') || 'https://donutnvapp.com/logo-round.png' },
      contentDescription: { defaultValue: { language: 'en-US', value: 'DonutNV logo' } },
    },
    heroImage: {
      sourceUri: { uri: env('GOOGLE_WALLET_HERO_URL') || 'https://donutnvapp.com/wallet-strip.png' },
      contentDescription: { defaultValue: { language: 'en-US', value: 'DonutNV Rewards' } },
    },
    reviewStatus: 'UNDER_REVIEW', hexBackgroundColor: HEX_BG,
  }
  const loyaltyObject = {
    id: objectId, classId, state: 'ACTIVE', accountName: o.r.name, accountId: o.memberId,
    loyaltyPoints: { label: 'Points', balance: { string: `${o.r.balance.toLocaleString()} pts` } },
    // Google "Nearby Passes" geofence triggers. Google has no hard cap on count,
    // but the API accepts up to 10 per object — we send the same stops as Apple.
    locations: o.locations.slice(0, 10).map((l) => ({ latitude: l.latitude, longitude: l.longitude })),
    // Personal referral QR (same as Apple) — friends scan it to sign up.
    ...(o.refUrl ? { barcode: { type: 'QR_CODE', value: o.refUrl, alternateText: 'Scan to share DonutNV' } } : {}),
    textModulesData: [
      { header: 'Tier', body: o.r.tier, id: 'tier' },
      { header: 'Reward value', body: `$${o.r.rewardDollars}`, id: 'value' },
      { header: 'Next reward', body: o.r.toFreeDozen > 0 ? `${o.r.toFreeDozen.toLocaleString()} pts` : 'Ready!', id: 'next' },
      { header: 'Home truck', body: o.r.tenantName, id: 'truck' },
    ],
  }
  const key = await jose.importPKCS8(sa.private_key, 'RS256')
  const jwt = await new jose.SignJWT({
    iss: sa.client_email, aud: 'google', typ: 'savetowallet', iat: Math.floor(Date.now() / 1000),
    payload: { loyaltyClasses: [loyaltyClass], loyaltyObjects: [loyaltyObject] },
  }).setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).sign(key)
  return `https://pay.google.com/gp/v/save/${jwt}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const authHeader = req.headers.get('Authorization') ?? ''
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: { user } } = await asUser.auth.getUser()
  if (!user) return json({ error: 'not signed in' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { platform = 'apple' } = await req.json().catch(() => ({}))

  const { data: profile } = await admin.from('profiles')
    .select('id, tenant_id, first_name, last_name, created_at, referral_code').eq('id', user.id).maybeSingle()
  if (!profile) return json({ error: 'no profile' }, 404)
  const { data: tenant } = await admin.from('tenants').select('name').eq('id', profile.tenant_id).maybeSingle()

  const { data: rw } = await admin.rpc('get_member_rewards', { p_profile: profile.id })
  const row = Array.isArray(rw) ? rw[0] : rw
  const r: Rewards = {
    balance: row?.points_balance ?? 0,
    tier: row?.tier ?? 'Glazed',
    rewardDollars: (row?.reward_dollars ?? 0).toString(),
    toFreeDozen: row?.to_free_dozen ?? 2000,
    name: `${profile.first_name || 'Member'}${profile.last_name ? ' ' + String(profile.last_name)[0] + '.' : ''}`,
    memberSince: profile.created_at ? new Date(profile.created_at).getFullYear().toString() : '',
    tenantName: tenant?.name || 'DonutNV',
  }

  let { data: pass } = await admin.from('wallet_passes').select('*').eq('profile_id', profile.id).eq('platform', platform).maybeSingle()
  if (!pass) {
    const { data: created } = await admin.from('wallet_passes').insert({
      tenant_id: profile.tenant_id, profile_id: profile.id, platform,
      serial_number: crypto.randomUUID(), auth_token: crypto.randomUUID().replace(/-/g, ''), status: 'issued',
    }).select().single()
    pass = created
  }

  // Location triggers: up to 10 upcoming public truck stops for this tenant,
  // shared by both the Apple and Google passes (~0.62 mi lock-screen relevance).
  const locations = await loadLocations(admin, profile.tenant_id)
  const refUrl = profile.referral_code ? `https://donutnvapp.com/r/${profile.referral_code}` : null

  if (platform === 'google') {
    if (!googleConfigured()) return json({ configured: false })
    try {
      const saveUrl = await buildGoogleSaveUrl({ memberId: profile.id, r, locations, refUrl })
      return json({ configured: true, saveUrl, serial: pass.serial_number })
    } catch (e) { return json({ configured: true, error: `google pass failed: ${e instanceof Error ? e.message : e}` }, 500) }
  }

  const passJson = buildApplePassJson({
    passTypeId: env('APPLE_PASS_TYPE_ID') || 'pass.com.donutnv.loyalty',
    teamId: env('APPLE_TEAM_ID') || 'TEAMID',
    serial: pass.serial_number, authToken: pass.auth_token, memberId: profile.id, r, locations, refUrl,
  })
  if (!appleConfigured()) return json({ configured: false, serial: pass.serial_number, pass_preview: passJson })

  try {
    const pkpass = await buildApplePkpass(passJson)
    return new Response(pkpass, {
      headers: { ...CORS, 'content-type': 'application/vnd.apple.pkpass', 'content-disposition': 'attachment; filename="donutnv.pkpass"' },
    })
  } catch (e) { return json({ configured: true, error: `apple pass failed: ${e instanceof Error ? e.message : e}` }, 500) }
})
