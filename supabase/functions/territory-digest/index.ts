// ── Territory activity digest — Supabase Edge Function ──
// Composes the weekly "Your Territory This Week" recap for franchisee owners
// from our own app data (signups, served, bookings, reviews, wallet adds). Built
// to be called by a weekly scheduled task. Delivery is via GHL (the only sender)
// once the GHL token + owner-contact mapping are connected; until then it
// returns the composed digests so they're testable and nothing is assumed.
//
// Deploy:  supabase functions deploy territory-digest
// Call:    POST { tenant_id?: "<uuid>" }  (omit tenant_id = all app tenants)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function countSince(table: string, tenantId: string, sinceIso: string, extra?: (q: any) => any) {
  let q = supabase.from(table).select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).gte('created_at', sinceIso)
  if (extra) q = extra(q)
  const { count } = await q
  return count ?? 0
}

async function digestFor(tenant: { id: string; name: string }) {
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString()
  const [signups, served, bookings, reviews, wallet] = await Promise.all([
    countSince('profiles', tenant.id, weekAgo, (q) => q.eq('role', 'customer')),
    countSince('sales_events', tenant.id, weekAgo),
    countSince('bookings', tenant.id, weekAgo),
    countSince('reviews', tenant.id, weekAgo),
    countSince('wallet_passes', tenant.id, weekAgo),
  ])
  const { data: rev } = await supabase.from('sales_events')
    .select('amount_cents').eq('tenant_id', tenant.id).gte('created_at', weekAgo)
  const revenue = (rev || []).reduce((s, r) => s + (r.amount_cents || 0), 0)

  const text = `🍩 ${tenant.name} — this week: ${signups} new signups, ${served} served`
    + `${revenue ? ` ($${(revenue / 100).toFixed(0)})` : ''}, ${bookings} booking requests, `
    + `${reviews} reviews, ${wallet} wallet adds. Open the app for the full picture.`

  return { tenant_id: tenant.id, name: tenant.name, signups, served, revenue_cents: revenue, bookings, reviews, wallet, text }
}

Deno.serve(async (req) => {
  const { tenant_id } = await req.json().catch(() => ({}))

  let tenants: { id: string; name: string }[] = []
  if (tenant_id) {
    const { data } = await supabase.from('tenants').select('id, name').eq('id', tenant_id).maybeSingle()
    if (data) tenants = [data]
  } else {
    const { data } = await supabase.from('tenants').select('id, name').eq('has_app', true)
    tenants = data || []
  }

  const digests = []
  for (const t of tenants) digests.push(await digestFor(t))

  // Delivery: GHL is the only sender. Wire the send here once the owner's GHL
  // contact mapping is decided (push the digest text to the owner's contact with
  // tag 'territory-digest' so a GHL workflow delivers it). Until GHL is connected
  // this is a no-op and we just return the composed digests.
  const ghlReady = !!Deno.env.get('GHL_API_TOKEN')

  return json({ ok: true, sent: false, ghlReady, count: digests.length, digests })
})
