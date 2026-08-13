# Glossary

- **Z / Zee** — a DonutNV franchisee (owner-operator of a territory). The primary ELLE user.
- **Zor** — the franchisor / DonutNV corporate.
- **The Window** — the branded customer-facing app (find-the-truck, loyalty, games, booking).
- **ELLE** — Event Lead Engine (styled "E.L.L.E"). The franchisee-facing lead engine.
- **LeadConnector / GHL** — GoHighLevel CRM; each franchisee's pipeline. Leads/bookings push here via `ghl-sync`.
- **Territory / owned ZIPs** — the ZIP codes a franchisee owns. Basis for lead routing and the ELLE "zipwall."
- **Out-of-bounds lead** — a lead in a ZIP no onboarded Z owns; should route to the nearest Z with fair distribution (Alex's focal point).
- **paid_apis_enabled** — the ELLE per-tenant "confirm switch." False = no paid API spend. Flipped true when a Z is confirmed live.
- **The confirm switch** — `elle_set_paid_enabled(tenant, on)`; unlocks paid discovery and clears example leads.
- **EXAMPLE leads** — free, clearly-labeled sample leads auto-seeded into a new Z's ELLE board (no API spend, non-callable contacts).
- **Spend governor / kill switch** — ELLE spend caps; the `global` cap doubles as the master kill switch.
- **Book-A-Truck** — the customer booking flow (corporate/private events + fundraiser path).
- **The demo instance / DEMO mode** — a demo build (Ocala geography, dummy accounts) for on-camera walkthroughs; must never ship to real prod.
- **Trench Logic / Trench Labs** — Kevin's consultancy that builds/owns the platform. "Built by" lockup on collateral.

## People (context)

- **Kevin McLenithan** — owner/builder (Trench Logic). k.deans@mac.com / kevin@donutnv.com.
- **Alex** — corporate (DNV Corporate–Orlando); focal point: out-of-bounds lead routing + fair distribution. Also referenced re: the pilot ROI story.
- **Juan / Kristen** — the demo/pitch audience for the franchise townhall.
- **Beta-preview franchisees** in ELLE: Nicole (Las Vegas), Josh (Piedmont Triad), Perez (Frisco/Plano), Peterson (Harrisburg), Mangis (Cape Fear), Cambron (Central AL), Bailey (Gulf Coast AL), Kurtz (Porter County IN).

## Key identifiers (quick ref)

- APP Supabase: `cfghtxfplkodjnndzmcf` · ELLE Supabase: `nvxfkzwbiomnswcxiblq` · Org: `guwdmvkqtqjwfukppkfv`
- Netlify prod: site `donutnv-app-live` id `fa9c6458-c03f-4dac-b6b2-525a1882286d` → donutnvapp.com
- Spend alert phone: +15592462122
