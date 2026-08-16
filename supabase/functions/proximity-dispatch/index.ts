// ── Option B: proximity-dispatch — Supabase Edge Function ───────────────────
//
// The send half of the proximity engine. Runs on a schedule (every minute):
//   match_proximity_candidates()  ->  claim dedupe row  ->  fan out  ->  log
//
// Supersedes notify-proximity. The difference is the input: notify-proximity
// matches a truck against the customer's STATIC saved_areas (home/work ZIP);
// this matches against the customer's LIVE device position from the native app,
// at a radius we control. Both are kept during cutover and they cannot
// double-send, because both claim the same proximity_pushes (session_id,
// profile_id) primary key before sending.
//
// verify_jwt=false is intentional and matches notify-proximity: cron cannot
// send a JWT, so access is gated by CRON_SECRET, failing closed when unset.
//
// Channels: native APNs/Android via FCM HTTP v1 (push_tokens), plus the
// existing web-push/VAPID channel (push_subscriptions) so PWA users who never
// install the native app keep working.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.6.7'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

// Web push (existing channel, unchanged config)
const VAPID_PUB = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIV = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
if (VAPID_PUB && VAPID_PRIV) {
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:party@donutnv.com',
    VAPID_PUB,
    VAPID_PRIV,
  )
}

// Native push (new channel). FCM_SERVICE_ACCOUNT is the full service-account
// JSON from the Firebase console, stored as a single secret. Kept separate from
// every existing secret per the isolation rules.
const FCM_SERVICE_ACCOUNT = Deno.env.get('FCM_SERVICE_ACCOUNT') ?? ''

// ── FCM HTTP v1 auth ────────────────────────────────────────────────────────
// Service-account JWT -> OAuth2 access token. Cached in module scope for the
// life of the isolate; a 1-minute cron would otherwise mint a token per tick.
let cachedToken: { token: string; expiresAt: number } | null = null

function pemToBinary(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function getFcmAccessToken(): Promise<{ token: string; projectId: string } | null> {
  if (!FCM_SERVICE_ACCOUNT) return null

  let sa: { client_email: string; private_key: string; project_id: string }
  try {
    sa = JSON.parse(FCM_SERVICE_ACCOUNT)
  } catch {
    console.error('FCM_SERVICE_ACCOUNT is not valid JSON')
    return null
  }
  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    console.error('FCM_SERVICE_ACCOUNT missing client_email/private_key/project_id')
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return { token: cachedToken.token, projectId: sa.project_id }
  }

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))

  try {
    const key = await crypto.subtle.importKey(
      'pkcs8',
      pemToBinary(sa.private_key.replace(/\\n/g, '\n')),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = new Uint8Array(await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`),
    ))
    const jwt = `${header}.${claims}.${b64url(sig)}`

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    })
    const tok = await res.json()
    if (!tok?.access_token) {
      console.error('FCM token exchange failed', tok)
      return null
    }
    cachedToken = { token: tok.access_token, expiresAt: now + (tok.expires_in ?? 3600) }
    return { token: tok.access_token, projectId: sa.project_id }
  } catch (err) {
    console.error('FCM token mint failed', err)
    return null
  }
}

// ── Message copy ────────────────────────────────────────────────────────────
// Brand rules (CLAUDE.md): no donut emoji anywhere, and no em dashes in
// customer-facing copy. The legacy notify-proximity copy uses the donut emoji;
// this does not, and that is deliberate rather than an oversight.
function buildMessage(distanceM: number, stopName: string | null, endsAt: string | null) {
  const miles = distanceM / 1609.344
  const dist = miles < 0.2 ? 'right around the corner'
    : miles < 1 ? `${(Math.round(miles * 10) / 10).toFixed(1)} mi away`
    : `${Math.round(miles)} mi away`

  const where = stopName ? ` at ${stopName}` : ''
  let until = ''
  if (endsAt) {
    const t = new Date(endsAt)
    if (!isNaN(t.getTime())) {
      until = ` until ${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    }
  }

  return {
    title: 'DonutNV is nearby!',
    body: `We're ${dist}${where}${until}. Fresh mini donuts, come say hi.`,
  }
}

type Candidate = {
  profile_id: string
  tenant_id: string
  truck_id: string
  session_id: string
  stop_name: string | null
  ends_at: string | null
  distance_m: number
  radius_miles: number
}

Deno.serve(async (req) => {
  // Internal / scheduled use only. Fail closed if the secret is unset.
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('forbidden', { status: 403 })
  }

  const dryRun = new URL(req.url).searchParams.get('dry_run') === '1'

  // ── 1. Match. All rules (kill switch, tenant enabled, opt-in, radius,
  //       freshness, quiet hours, frequency caps, session dedupe) live in the
  //       RPC so they are enforced in one place, in the database. ────────────
  const { data: candidates, error: matchErr } = await supabase
    .rpc('match_proximity_candidates', { p_limit: 5000 })

  if (matchErr) {
    console.error('match_proximity_candidates failed', matchErr)
    return new Response(JSON.stringify({ ok: false, error: matchErr.message }), {
      status: 500, headers: { 'content-type': 'application/json' },
    })
  }

  const list = (candidates ?? []) as Candidate[]
  if (list.length === 0) {
    return new Response(JSON.stringify({ ok: true, matched: 0, sent: 0 }), {
      headers: { 'content-type': 'application/json' },
    })
  }

  if (dryRun) {
    return new Response(JSON.stringify({
      ok: true, dry_run: true, matched: list.length,
      sample: list.slice(0, 10).map((c) => ({
        distance_m: c.distance_m, radius_miles: c.radius_miles,
        ...buildMessage(c.distance_m, c.stop_name, c.ends_at),
      })),
    }), { headers: { 'content-type': 'application/json' } })
  }

  const fcm = await getFcmAccessToken()
  const webPushReady = !!(VAPID_PUB && VAPID_PRIV)

  let sent = 0, failed = 0, skipped = 0

  for (const c of list) {
    // ── 2. Claim the dedupe row BEFORE sending. ─────────────────────────────
    // A duplicate-key error means someone already notified this member for this
    // truck session (this function on a previous tick, or the legacy
    // notify-proximity during cutover). Reusing the existing interlock is what
    // makes running both functions side by side safe.
    const { error: claimErr } = await supabase
      .from('proximity_pushes')
      .insert({ session_id: c.session_id, profile_id: c.profile_id })
    if (claimErr) { skipped++; continue }

    const msg = buildMessage(c.distance_m, c.stop_name, c.ends_at)
    const logRow = {
      profile_id: c.profile_id,
      tenant_id: c.tenant_id,
      truck_id: c.truck_id,
      session_id: c.session_id,
      distance_m: c.distance_m,
      radius_miles: c.radius_miles,
      title: msg.title,
      body: msg.body,
    }

    let deliveredToAnyDevice = false

    // ── 3a. Native channel (APNs + Android via FCM). ────────────────────────
    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('id, token, platform')
      .eq('profile_id', c.profile_id)
      .eq('is_active', true)

    for (const t of tokens ?? []) {
      if (!fcm) {
        await supabase.from('proximity_notification_log').insert({
          ...logRow, channel: 'native', status: 'suppressed', reason: 'FCM not configured',
        })
        continue
      }
      try {
        const res = await fetch(
          `https://fcm.googleapis.com/v1/projects/${fcm.projectId}/messages:send`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${fcm.token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              message: {
                token: t.token,
                notification: { title: msg.title, body: msg.body },
                data: {
                  url: '/', truck_id: c.truck_id, session_id: c.session_id,
                  distance_m: String(c.distance_m),
                },
                // High priority + APNs alert so the push actually surfaces on a
                // locked screen. This is a time-sensitive "we are near you right
                // now" message; a silent background push would defeat the point.
                android: { priority: 'high' },
                apns: {
                  headers: { 'apns-priority': '10' },
                  payload: { aps: { sound: 'default', 'interruption-level': 'time-sensitive' } },
                },
              },
            }),
          },
        )

        if (res.ok) {
          const out = await res.json().catch(() => ({}))
          await supabase.from('proximity_notification_log').insert({
            ...logRow, channel: 'native', status: 'sent', provider_message_id: out?.name ?? null,
          })
          deliveredToAnyDevice = true
          sent++
        } else {
          const errBody = await res.json().catch(() => ({}))
          const status = errBody?.error?.details?.[0]?.errorCode ?? errBody?.error?.status ?? String(res.status)

          // Retire tokens FCM tells us are dead, the same way the legacy
          // function prunes dead web-push endpoints.
          if (status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT' || res.status === 404) {
            await supabase.from('push_tokens').update({ is_active: false }).eq('id', t.id)
          }
          await supabase.from('proximity_notification_log').insert({
            ...logRow, channel: 'native', status: 'failed', reason: String(status),
          })
          failed++
        }
      } catch (err) {
        await supabase.from('proximity_notification_log').insert({
          ...logRow, channel: 'native', status: 'failed', reason: String(err),
        })
        failed++
      }
    }

    // ── 3b. Web channel (existing PWA users, unchanged behaviour). ──────────
    if (webPushReady) {
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('id, endpoint, keys')
        .eq('profile_id', c.profile_id)

      for (const sub of subs ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({ title: msg.title, body: msg.body, url: '/' }),
          )
          await supabase.from('proximity_notification_log').insert({
            ...logRow, channel: 'web', status: 'sent',
          })
          deliveredToAnyDevice = true
          sent++
        } catch (err) {
          const sc = (err as any)?.statusCode
          if (sc === 404 || sc === 410) {
            await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          }
          await supabase.from('proximity_notification_log').insert({
            ...logRow, channel: 'web', status: 'failed', reason: String(sc ?? err),
          })
          failed++
        }
      }
    }

    // The customer matched every rule but has no reachable device. Release the
    // dedupe claim so they are not silently burned for this truck session, and
    // record why nothing went out.
    if (!deliveredToAnyDevice) {
      await supabase.from('proximity_pushes')
        .delete()
        .eq('session_id', c.session_id)
        .eq('profile_id', c.profile_id)
      await supabase.from('proximity_notification_log').insert({
        ...logRow, channel: 'native', status: 'suppressed', reason: 'no active device',
      })
    }
  }

  return new Response(
    JSON.stringify({ ok: true, matched: list.length, sent, failed, skipped }),
    { headers: { 'content-type': 'application/json' } },
  )
})
