# Architecture

## Systems at a glance

| Layer | What | Identifiers |
|---|---|---|
| Frontend | Vite + React SPA (The Window + operator + ELLE) | this repo (`donutnvapp`) |
| Hosting | Netlify (builds on Netlify infra) | prod site `donutnv-app-live`, id `fa9c6458-c03f-4dac-b6b2-525a1882286d`, domain **donutnvapp.com**; demo/preview site `mv-preview` |
| APP DB | Supabase — customer app, loyalty, bookings, sales, feedback | project **`cfghtxfplkodjnndzmcf`** ("donutnv-app"), Postgres 17, us-east-1 |
| ELLE DB | Supabase — lead engine | project **`nvxfkzwbiomnswcxiblq`** ("ELLE"), Postgres 17, us-east-1 |
| Org | Supabase org | `guwdmvkqtqjwfukppkfv` |
| CRM | GoHighLevel / LeadConnector (per-franchisee) | via `ghl-sync` + `elle_leadconnector` |

Both Supabase projects are separate databases. ELLE is reached from the app **server-side only** (service role); the browser never talks to ELLE directly — it goes through the `elle-dashboard` edge function.

## Frontend

- Build: Vite. PWA via `vite-plugin-pwa` with `selfDestroying: true` (the service worker self-destructs to avoid stale-bundle caching — this was a real prod bug once).
- Supabase client: `src/lib/supabase.js` (anon key, from Netlify env vars `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`).
- Auth/session: `src/context/AuthContext.jsx` → `useAuth()` exposes `{ session, profile, tenant, entitlements, loading, reloadProfile, signOut }`. Tenant (white-label brand) loads by URL slug via `activeTerritory()`.
- Routing: `src/App.jsx`.
  - Customer app (`AppShell`): `/` Find, `/rewards`, `/games`, `/book`, `/account`.
  - Operator app (`OperatorShell`): `/admin`, `/admin/live`, `/admin/bookings`, `/admin/schedule`, `/admin/games`, `/admin/dashboard`, `/admin/customers`, `/admin/reviews`, `/admin/corporate`, `/admin/unrouted`, `/admin/franchise`, `/admin/feedback`.
  - ELLE: `/elle` (renders bare, dark theme, no OperatorShell).
- Shared components: `AppShell`, `OperatorShell`, `FeedbackButton` (mounted in both shells + ELLE), `BrandLogo`, `MiniDonut`, `Turnstile`, `BetaGate`, `AddToWallet`.
- Entitlements gate nav/routes: `tenant.has_app` (default true) and `tenant.has_elle` (opt-in).

## Deploy

Production deploy uploads the repo and builds on Netlify:

1. Netlify MCP `deploy-site` (siteId `fa9c6458-...`) returns an authenticated `npx @netlify/mcp@latest --site-id ... --proxy-path "..."` command.
2. Run that command from the repo root; it uploads + builds + waits.
3. **Env vars live on Netlify, not in a local .env.** If they go missing the app shows "not connected to Supabase." Set them **sequentially** via the Netlify env-vars tool and verify (a parallel batch once silently failed).

See `docs/RUNBOOKS.md` for the full deploy + rollback steps.

## Edge functions

**APP (`cfghtxfplkodjnndzmcf`):**
`square-webhook` (v7 — atomic via `process_square_sale` RPC), `demo-checkin`, `spend-alert-sms` (Twilio, not yet configured), `ghl-sync`, `notify-proximity`, `wallet-pass`, `square-deposit`, `send-enroute-sms`, `verify-turnstile` (fail-open until secret set).

**ELLE (`nvxfkzwbiomnswcxiblq`):**
`elle-dashboard` (the read gateway the app calls), `elle-discover`, `elle-discover-events`, `elle-enrich-business`, `elle-enrich-event`, `elle-enrich-linkedin`, `elle-maps-source`, `elle-press-gm`, `elle-apollo-business`, `elle-market-brief`, `elle-apollo-webhook`, `elle-enrich` (cron worker).

Paid ELLE functions are invoked from SQL via the `elle_call_edge_function` dispatcher (pg_net), which enforces the spend governor. See `docs/ELLE.md`.

## RLS pattern

Tenant isolation: `tenant_id = current_tenant_id()` (SECURITY DEFINER: `select tenant_id from profiles where id = auth.uid()`), plus `is_superadmin()` and `is_operator()`. Note: Postgres grants function EXECUTE to `public` by default — to lock a function down you must `revoke ... from public` (not just anon/authenticated) and re-grant `service_role`.
