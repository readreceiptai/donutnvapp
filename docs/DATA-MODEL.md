# Data Model

Two databases. Below is the map of what matters, not every column. Confirm live schema before changing anything (`information_schema.columns`).

## APP project (`cfghtxfplkodjnndzmcf`)

Key tables:
- **tenants** — one row per franchisee territory (white-label brand, slug, `has_app`, `has_elle`, `square_location_id`). 8 rows today (Palm Harbor, Harrisburg, Wilmington, Gulf Coast, Frisco, Valparaiso, Central Alabama, Ocala). Ocala is the populated demo/reference territory.
- **profiles** — users. `id` (uuid; **no FK to auth.users** — sample rows are insertable), `tenant_id` (FK tenants), `role` ('customer' | 'operator'), name/phone/email/zip, `is_superadmin`, `parent_profile_id`. Unique index on `(tenant_id, phone)` where phone present.
- **check_ins** — loyalty stamps (profile_id, tenant_id, campaign_id, source, amount_cents).
- **campaigns** — loyalty campaigns; `kind='checkin_stamp'`, `is_active`. RLS read is tenant-scoped (`camp_read`: is_active AND (tenant match OR superadmin)) — a cross-tenant leak here was fixed.
- **bookings** — Book-A-Truck requests (square_order_id, deposit_status, deposit_amount_cents, tracking_token). Created via `submit_booking` RPC, routed by event ZIP, pushed to GHL via `ghl-sync`.
- **sales_events** — every Square sale counted (tenant_id, session_id, source, amount_cents).
- **live_sessions** / **active_live_sessions** — truck "go live" broadcasts.
- **truck_locations** — live GPS breadcrumbs (tenant_id, truck_id, session_id, lat, lng, recorded_at). Pruned nightly (see below).
- **wallet_passes** — Apple/Google wallet loyalty passes (`needs_push`).
- **feedback** — in-app tester feedback (tenant_id, user_id, role, category, message, context jsonb, status). RLS: insert own; read own/tenant-operator/superadmin; update superadmin. Reviewed at `/admin/feedback`.
- **app_config** — key/value settings (spend_alert_to `+15592462122`, spend_alert_secret, demo_checkin_key, demo_checkin_emails). RLS-enabled.
- **processed_square_events** — idempotency guard for the Square webhook.
- **zip_centroids**, territory/routing tables — lead routing by ZIP.

Key RPCs / functions (APP):
- `submit_booking(...)` — insert booking + route to app-active franchisee by ZIP, returns id + tracking_token.
- `process_square_sale(...)` — **atomic** dedup + deposit + sale + loyalty stamp (one transaction; a crash can't lose or double a stamp). Called by `square-webhook`.
- `get_wallet_metrics`, `get_territory_pulse`, `get_unrouted_bookings`, `get_frandev_leads`, `get_corporate_metrics` (superadmin-gated).
- `prune_truck_locations(p_keep_hours default 48)` — nightly pg_cron job `prune-truck-locations` at 04:00; keeps each truck's most-recent point.
- Helpers: `is_superadmin()`, `is_operator()`, `current_tenant_id()`.

## ELLE project (`nvxfkzwbiomnswcxiblq`)

Key tables:
- **elle_tenants** — franchisee record. Flags: **`paid_apis_enabled`** (the confirm switch; false = no paid spend), `is_demo`, `enabled`, `plan_tier`, `pull_frequency`, `max_sources`. 11 rows (incl. beta-preview franchisees), all currently `paid_apis_enabled=false`.
- **elle_events** — event details. Global unique constraint on **`(slug, start_date)`** (slug derived from name). `enrichment_status='example'` marks seeded sample leads.
- **elle_tenant_events** — the per-tenant lead board rows (tenant_id, event_id, score, decision, outcome, dismissed, blocked, info_bad, lc_stage). BEFORE INSERT trigger **`trg_te_zipwall`** (`elle_enforce_event_zip`) drops rows whose event zip isn't in the tenant's territory — **except** `enrichment_status='example'` (so new tenants can be seeded).
- **elle_z_dashboard** — VIEW joining tenant_events + events + hosts = what the franchisee sees.
- **elle_hosts** — event contacts (apollo/linkedin enriched).
- **elle_businesses / elle_tenant_businesses** — outbound business/catering accounts.
- **elle_territory_zips** — owned ZIPs per tenant (routing basis). ZIPs also power the zipwall.
- **elle_market_reports** — per-territory hyper-local market report.
- **elle_leadconnector** — per-tenant LeadConnector token/config.
- **Spend governor tables:** `elle_spend_ledger`, `elle_spend_caps`, `elle_service_rates`, `elle_spend_alerts`, views `elle_spend_rollup` / `elle_spend_by_service`. See `docs/ELLE.md`.
- **elle_example_seed** — tracks auto-seeded EXAMPLE leads per tenant (for clean auto-clear).
- **elle_event_types_catalog** — valid `event_type` codes (FK target). Examples: `large_public_festival`, `medium_corporate`, `school_individual`, `charity_fundraiser`, `grand_opening`, etc.

Key functions (ELLE): see `docs/ELLE.md` (dispatcher, spend, confirm switch, auto-seed, discovery/enrichment orchestrators).

## Important triggers (know these before touching data)

- APP: `square-webhook` → `process_square_sale` (atomic).
- ELLE `trg_te_zipwall` on `elle_tenant_events` — territory enforcement (examples exempt).
- ELLE `trg_elle_seed_examples` (AFTER INSERT on elle_tenants) — auto-seeds 3 example leads.
- ELLE `trg_elle_clear_examples` (AFTER UPDATE of paid_apis_enabled) — clears examples when a Z is confirmed.
- ELLE: name→slug derivation on `elle_events` (drives the unique constraint).
