# ELLE — Event Lead Engine

ELLE finds, scores, and enriches leads (events, businesses, non-profits) per franchisee territory and pushes them to the owner's LeadConnector. It is a separate Supabase project (`nvxfkzwbiomnswcxiblq`), reached from the app server-side only through the `elle-dashboard` edge function. UI lives at `/elle` (dark theme).

## The lead pipeline

1. **Discovery** (`elle_run_discovery` / `elle_weekly_discovery` → `elle-discover` / `elle-discover-events`) — source events from free sources (Eventeny, RunSignup, municipal, web/LLM) across the tenant's owned ZIPs, de-dupe, score.
2. **Enrichment** (`elle_run_enrichment` → `elle-enrich-event`, `elle-enrich-business`, `elle-enrich-linkedin`, `elle-press-gm`, `elle-apollo-business`) — find real contacts (Apollo, LinkedIn/Apify, press). **This is the expensive step.**
3. **Market brief** (`elle_refresh_market_briefs` → `elle-market-brief`) — hyper-local market report per territory (LLM), refreshed ~6 months.
4. **Board** — leads land in `elle_tenant_events`, shown via the `elle_z_dashboard` view. Lifecycle: New / Working / Done, with recycle/dismiss and a "Bad info" (`info_bad`) flag.
5. **Push** — contactable leads sync to the owner's LeadConnector (`elle_leadconnector`, `ghl-sync` pattern).

Cron jobs (pg_cron on ELLE): weekly discovery (Sun), weekly enrichment (Sun), daily linkedin backfill, weekly market-brief refresh, recurring roll-forward. **All paid orchestrators filter `where enabled and paid_apis_enabled and not is_demo`.**

## The confirm switch + spend safety (CRITICAL)

**No paid API call runs for a tenant until it is confirmed.** The gate is `elle_tenants.paid_apis_enabled` (default **false**). All five paid orchestrators (`elle_run_discovery`, `elle_weekly_discovery`, `elle_run_enrichment`, `elle_run_linkedin_backfill`, `elle_refresh_market_briefs`) skip tenants where it's false. Today **all 11 tenants are false** → zero automatic paid spend.

- **Flip a Z live:** `select public.elle_set_paid_enabled('<tenant_uuid>', true);` (service-role only). Flipping true also auto-clears that tenant's EXAMPLE leads (real leads are now incoming).
- Billing note: the **franchisor is expected to pay**, so there is no per-Z payment gate to build. The confirm switch stays as the "this Z is live, start spending" control. Do not remove it.

## Spend governor (defense in depth — never remove)

- **Ledger:** `elle_spend_ledger` — one row per billable call. Rates in `elle_service_rates` (apollo $0.05, apify_linkedin $0.30, apify_places $0.20, apify_press $0.15, llm $0.001, geocoding $0.005).
- **Caps:** `elle_spend_caps` (monthly). **`global` $2500 = master kill switch** (set `enabled=false` to stop everything). apollo $1000 / 20000 credits, apify $50, llm $1000, geocoding $100. `warn_at_pct` = 0.80.
- **Enforcement:** `elle_call_edge_function` (the dispatcher) checks `elle_spend_allowed(service)` before dispatching and returns null (no spend) if over cap or the kill switch is on. It also **estimate-meters** paid functions that don't self-log actual spend, so every cap (esp. LLM) sees all usage.
- **Alerts:** `elle_spend_evaluate()` writes to `elle_spend_alerts` at 80% and at breach (deduped). Delivery is via the APP `spend-alert-sms` function to **+15592462122** — **pending Twilio setup** (not yet sending).
- **Self-loggers (actual spend):** `elle-enrich-business` (apollo), `elle-maps-source` (apify_places), `elle-enrich-linkedin` (apify_linkedin + apollo). Others get dispatcher estimates until precise per-function logging is added (ROADMAP #58).

## Auto-seed for every Z (free, no spend)

- On new `elle_tenants` insert, `trg_elle_seed_examples` → `elle_seed_examples()` inserts **3 clearly-labeled EXAMPLE leads** (non-callable `example@donotcontact.invalid` contacts) so the board is never empty. Zero API spend. Tenants that already have real leads are skipped.
- Examples bypass the territory zipwall via `enrichment_status='example'`; uniqueness on the global `(slug,start_date)` constraint is guaranteed by a per-tenant date offset + retry loop.
- Tracked in `elle_example_seed`. On confirm (`paid_apis_enabled` → true), `trg_elle_clear_examples` → `elle_clear_examples()` wipes them.

## Tenants (as of 2026-08-13)

11 ELLE tenants incl. Palm Harbor, DNV Corporate–Orlando (Alex), Las Vegas (Nicole), Piedmont Triad (Josh), Ocala (Demo, `is_demo=true`), Frisco/Plano (Perez), Harrisburg (Peterson), Cape Fear (Mangis), Central AL (Cambron), Gulf Coast AL (Bailey), Porter County IN (Kurtz). All have events loaded (19–246 each) and all are `paid_apis_enabled=false`.

## Known open items (see ROADMAP)

- `elle-discover` runs a long scrape/ingest in one invocation with no durable resume — needs a job queue (#56).
- Precise per-function spend logging for the cost dashboard (#58).
- Lead routing for out-of-bounds / unowned-territory leads to nearest Z + fair distribution (Alex's focal point) — needs a current, complete ZIP→owner registry first.
