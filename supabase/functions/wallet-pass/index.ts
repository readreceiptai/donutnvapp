// ── Wallet pass issuance — Supabase Edge Function ──
// DonutNV loyalty card for Apple Wallet / Google Wallet, spend-based points model.
//   • Apple  → signed .pkpass (PKCS#7 detached w/ Pass Type cert + Apple WWDR).
//   • Google → signed "Save to Google Wallet" JWT.
// Reads live points/tier from get_member_rewards(). Art (icon/logo/strip) is
// fetched from the live site; missing art degrades gracefully. No-ops to
// { configured:false } until the platform's signing secrets are set.
//
// Apple secrets:  APPLE_PASS_CERT_P12_BASE64, APPLE_PASS_CERT_PASSWORD,
//                 APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_WWDR_CERT_BASE64
// Google secrets: GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SA_JSON
// Art overrides:  WALLET_ICON_URL, WALLET_LOGO_URL, WALLET_STRIP_URL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import forge from 'https://esm.sh/node-forge@1.3.1'
import JSZip from 'https://esm.sh/jszip@3.10.1'
import * as jose from 'https://esm.sh/jose@5.9.6'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const env = (k: string) => Deno.env.get(k) || ''

const HEX_BG = '#ffffff'
const ICON_URL = env('WALLET_ICON_URL') || 'https://donutnvapp.com/icon-192.png'
const LOGO_URL = env('WALLET_LOGO_URL') || 'https://donutnvapp.com/dnv_logo.png'
const STRIP_URL = env('WALLET_STRIP_URL') || 'https://donutnvapp.com/wallet-strip.png'
const FALLBACK_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey',
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

type Rewards = { balance: number; lifetime: number; tier: string; rewardDollars: string; freeDozenPts: number; toFreeDozen: number }

function buildApplePassJson(o: {
  passTypeId: string; teamId: string; serial: string; authToken: string;
  firstName: string; tenantName: string; memberId: string; r: Rewards;
}) {
  const nextReward = o.r.toFreeDozen > 0 ? `${o.r.toFreeDozen.toLocaleString()} pts to a free dozen` : 'Free dozen ready! 🍩'
  return {
    formatVersion: 1,
    passTypeIdentifier: o.passTypeId,
    teamIdentifier: o.teamId,
    serialNumber: o.serial,
    authenticationToken: o.authToken,
    webServiceURL: `${SUPABASE_URL}/functions/v1/wallet-pass-web/`,
    organizationName: 'DonutNV',
    description: 'DonutNV Rewards Card',
    logoText: 'DonutNV',
    foregroundColor: 'rgb(17, 17, 17)',
    backgroundColor: 'rgb(255, 255, 255)',
    labelColor: 'rgb(221, 27, 34)',
    storeCard: {
      headerFields: [{ key: 'tier', label: 'TIER', value: o.r.tier }],
      primaryFields: [{ key: 'balance', label: 'BALANCE', value: `${o.r.balance.toLocaleString()} pts` }],
      secondaryFields: [
        { key: 'value', label: 'REWARD VALUE', value: `$${o.r.rewardDollars}` },
        { key: 'member', label: 'MEMBER', value: o.firstName || 'Donut fan' },
      ],
      auxiliaryFields: [{ key: 'next', label: 'NEXT REWARD', value: nextReward }],
      backFields: [
        { key: 'earn', label: 'Earning points', value: 'Earn 10 points for every $1 you spend. 100 points = $1 in rewards.' },
        { key: 'redeem', label: 'Free dozen', value: `Redeem a free dozen mini-donuts at ${o.r.freeDozenPts.toLocaleString()} points.` },
        { key: 'birthday', label: 'Birthday treat', value: 'A free dozen mini-donuts during your birthday month.' },
        { key: 'truck', label: 'Home truck', value: o.tenantName },
        { key: 'how', label: 'How to earn', value: 'Give your phone number at the register every visit — points are credited when your number is entered at checkout.' },
      ],
    },
    barcodes: [{ format: 'PKBarcodeFormatQR', message: o.memberId, messageEncoding: 'iso-8859-1' }],
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

  const icon = (await fetchPngOrNull(ICON_URL)) ?? b64ToBytes(FALLBACK_PNG_B64)
  const files: Record<string, Uint8Array> = {
    'pass.json': new TextEncoder().encode(JSON.stringify(passJson)),
    'icon.png': icon, 'icon@2x.png': icon, 'icon@3x.png': icon,
  }
  const logo = await fetchPngOrNull(LOGO_URL)
  if (logo) { files['logo.png'] = logo; files['logo@2x.png'] = logo }
  const strip = await fetchPngOrNull(STRIP_URL)
  if (strip) { files['strip.png'] = strip; files['strip@2x.png'] = strip; files['strip@3x.png'] = strip }

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

async function buildGoogleSaveUrl(o: { memberId: string; firstName: string; tenantName: string; r: Rewards }): Promise<string> {
  const sa = JSON.parse(env('GOOGLE_WALLET_SA_JSON'))
  const issuerId = env('GOOGLE_WALLET_ISSUER_ID')
  const classId = `${issuerId}.donutnv_loyalty`
  const objectId = `${issuerId}.${o.memberId.replace(/[^a-zA-Z0-9._-]/g, '')}`
  const nextReward = o.r.toFreeDozen > 0 ? `${o.r.toFreeDozen.toLocaleString()} pts to a free dozen` : 'Free dozen ready!'

  const loyaltyClass = {
    id: classId, issuerName: 'DonutNV', programName: 'DonutNV Rewards',
    programLogo: { sourceUri: { uri: env('GOOGLE_WALLET_LOGO_URL') || 'https://donutnvapp.com/icon-512.png' } },
    reviewStatus: 'UNDER_REVIEW', hexBackgroundColor: HEX_BG,
  }
  const loyaltyObject = {
    id: objectId, classId, state: 'ACTIVE', accountName: o.firstName || 'Donut fan', accountId: o.memberId,
    loyaltyPoints: { label: 'Points', balance: { string: `${o.r.balance.toLocaleString()} pts` } },
    barcode: { type: 'QR_CODE', value: o.memberId },
    textModulesData: [
      { header: 'Tier', body: o.r.tier, id: 'tier' },
      { header: 'Reward value', body: `$${o.r.rewardDollars}`, id: 'value' },
      { header: 'Next reward', body: nextReward, id: 'next' },
      { header: 'Home truck', body: o.tenantName, id: 'truck' },
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

  const { data: profile } = await admin.from('profiles').select('id, tenant_id, first_name').eq('id', user.id).maybeSingle()
  if (!profile) return json({ error: 'no profile' }, 404)
  const { data: tenant } = await admin.from('tenants').select('name').eq('id', profile.tenant_id).maybeSingle()
  const tenantName = tenant?.name || 'DonutNV'

  const { data: rw } = await admin.rpc('get_member_rewards', { p_profile: profile.id })
  const row = Array.isArray(rw) ? rw[0] : rw
  const r: Rewards = {
    balance: row?.points_balance ?? 0, lifetime: row?.points_lifetime ?? 0,
    tier: row?.tier ?? 'Glazed', rewardDollars: (row?.reward_dollars ?? 0).toString(),
    freeDozenPts: row?.free_dozen_pts ?? 2000, toFreeDozen: row?.to_free_dozen ?? 2000,
  }

  let { data: pass } = await admin.from('wallet_passes').select('*').eq('profile_id', profile.id).eq('platform', platform).maybeSingle()
  if (!pass) {
    const { data: created } = await admin.from('wallet_passes').insert({
      tenant_id: profile.tenant_id, profile_id: profile.id, platform,
      serial_number: crypto.randomUUID(), auth_token: crypto.randomUUID().replace(/-/g, ''), status: 'issued',
    }).select().single()
    pass = created
  }

  if (platform === 'google') {
    if (!googleConfigured()) return json({ configured: false })
    try {
      const saveUrl = await buildGoogleSaveUrl({ memberId: profile.id, firstName: profile.first_name, tenantName, r })
      return json({ configured: true, saveUrl, serial: pass.serial_number })
    } catch (e) { return json({ configured: true, error: `google pass failed: ${e instanceof Error ? e.message : e}` }, 500) }
  }

  const passJson = buildApplePassJson({
    passTypeId: env('APPLE_PASS_TYPE_ID') || 'pass.com.donutnv.loyalty',
    teamId: env('APPLE_TEAM_ID') || 'TEAMID',
    serial: pass.serial_number, authToken: pass.auth_token,
    firstName: profile.first_name, tenantName, memberId: profile.id, r,
  })
  if (!appleConfigured()) return json({ configured: false, serial: pass.serial_number, pass_preview: passJson })

  try {
    const pkpass = await buildApplePkpass(passJson)
    return new Response(pkpass, {
      headers: { ...CORS, 'content-type': 'application/vnd.apple.pkpass', 'content-disposition': 'attachment; filename="donutnv.pkpass"' },
    })
  } catch (e) { return json({ configured: true, error: `apple pass failed: ${e instanceof Error ? e.message : e}` }, 500) }
})
