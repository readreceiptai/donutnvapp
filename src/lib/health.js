// Backend reachability check for the customer-facing outage screen (#121).
// Complements the server-side UptimeRobot monitor: this is what a real customer's
// browser uses to decide "is Supabase reachable right now?" and, if not, to show
// the branded outage screen instead of a hung/blank app.
//
// Fail-safe by design: a single flaky request must never black out a working app.
// pingBackend() times out fast; checkBackend() only reports "down" after every
// attempt in a short burst fails. "Reachable" = we got ANY HTTP response under
// 500 (even a 4xx means Supabase answered); "down" = network error, timeout, or 5xx.
const URL = import.meta.env.VITE_SUPABASE_URL
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY
const HEALTH = URL ? `${URL}/auth/v1/health` : ''

// One lightweight, unauthenticated-ish ping (apikey only). Resolves true if
// Supabase responded (status < 500), false on network error / timeout / 5xx.
export async function pingBackend({ timeoutMs = 4000 } = {}) {
  // Not configured (dev without keys): never claim an outage — the app surfaces
  // "not connected" on its own; blacking out here would be a false positive.
  if (!URL || !ANON) return true
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(HEALTH, {
      method: 'GET',
      headers: { apikey: ANON },
      cache: 'no-store',
      signal: ctrl.signal,
    })
    return res.status < 500
  } catch {
    return false // network error or aborted (timeout)
  } finally {
    clearTimeout(t)
  }
}

// Reachable if ANY attempt in the burst succeeds; down only if ALL fail. This is
// the anti-false-positive guard — a couple of retries before we ever flip to down.
export async function checkBackend({ attempts = 2, timeoutMs = 4000, gapMs = 900 } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (await pingBackend({ timeoutMs })) return true
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, gapMs))
  }
  return false
}
