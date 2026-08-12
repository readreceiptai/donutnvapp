// ── Territory routing for the donutnvapp.com platform model ──
// One app serves the whole network. The first path segment is the territory,
// e.g. donutnvapp.com/ph → Palm Harbor. Reserved words are app routes, not
// territories, so donutnvapp.com/signup still works at the root.
//
// A territory maps 1:1 to a `tenants.slug` row in the database, so adding a
// franchise = adding a row + pointing their vanity domain (donutnvph.com) here.

import { DEMO } from './demo'

const RESERVED = new Set([
  '', 'signup', 'login', 'rewards', 'account', 'admin', 'app', 'find', 'index.html',
  'book', 'schedule', 'owner', 'track', 'preview', 'elle', 'franchise',
])

// Default territory when someone hits the bare domain with no segment.
// The demo build always presents Ocala, whatever the URL.
export const DEFAULT_TERRITORY = DEMO ? 'ocala' : (import.meta.env.VITE_TENANT_SLUG || 'ph').toLowerCase()

// The raw territory in the URL, or null if there isn't one.
export function urlTerritory() {
  const seg = (window.location.pathname.split('/')[1] || '').toLowerCase()
  return RESERVED.has(seg) ? null : seg
}

// The territory we should actually use (URL → default). Demo build is always Ocala.
export function activeTerritory() {
  if (DEMO) return 'ocala'
  return urlTerritory() || DEFAULT_TERRITORY
}

// React Router basename so /ph/signup, /ph/account, etc. all resolve cleanly.
export function territoryBasename() {
  const t = urlTerritory()
  return t ? '/' + t : '/'
}
