# Decisions Log

Why things are the way they are. Newest first. Update this whenever a non-obvious call is made.

## 2026-08-14

- **Pre-launch review + fix pass** (full-codebase review, then a validated fix script). Landed:
  - **platform-metrics ELLE leak (P0):** the ELLE metrics block returned every franchise's leads/won/lost/booked_revenue/pipeline to ANY logged-in user. Now superadmin-only for the full network; a non-super franchisee gets only their own ELLE tenant (resolved by login email).
  - **elle-dashboard paid-spend gate (P0):** `find_linkedin`/`find_press` now check `paid_apis_enabled` AND that the `business_id` is on the caller's own board before spending Apify/Apollo — the confirm switch is now enforced at this direct path, not just in the SQL orchestrators.
  - **Login account-creation trap (P0):** Login now passes `shouldCreateUser:false` and shows a "create one" link on unknown email, so a mistyped login can't spin up a profile-less auth user. Added a `NeedsSetup` recovery screen for the session-without-profile state (was an infinite spinner).
  - **BetaGate mounted (P0):** the private-beta password wall was dead code; now wired in `main.jsx` (no-op unless `VITE_BETA_PASSWORD` is set). Docs and code now agree.
  - **ErrorBoundary + bundled Sentry (P1):** top-level React error boundary (branded reload card, reports to Sentry) so one bad render can't white-screen the app. Sentry is now the bundled `@sentry/react` (added to package.json/lock), not a runtime CDN import.
  - **elle-onboard authorization (P1):** self-provisioning an ELLE tenant + claiming ZIPs now requires operator/superadmin, not just any signed-in email.
  - **Repo rebuild-safety (P1):** removed the regressing/insecure snapshot definitions so a from-scratch `psql -f schema_*.sql` can't undo live fixes — `auto_superadmin` now uses verified `auth.email()` in schema_superadmin.sql, `route_booking` is revoked (not re-granted) in schema_territory.sql, `get_corporate_metrics` uses `is_superadmin()` in schema_corporate.sql, `camp_read` is tenant-scoped in schema.sql. Live DB stays the authoritative rebuild source until a real ordered-migration manifest exists (#62).
  - **Private live-location RLS (item 10):** new migration `20260814_scope_live_location_public_reads.sql` (APP project) scopes `live_read`/`loc_read` off `using(true)` so private "on the way" sessions + en-route GPS aren't anon-readable. Base files (schema.sql visibility-free interim + schema_bookings.sql authoritative) kept in sync. **Must verify the customer Find map still shows a live public truck after applying.**
  - **Dispatcher deny-by-default (P2):** new migration `20260814_elle_dispatcher_deny_by_default.sql` (ELLE project) blocks any unclassified function instead of dispatching it ungoverned. No behavior change today (all dispatched names are already mapped paid functions).
  - **P2 cleanup:** map centers on the tenant's centroid (not Palm Harbor FL); `?testpin=1` and `/track/demo` demo backdoors gated to preview builds only; `seed.sql` guarded against running on prod; consent toggle reverts + warns on a failed write; double-submit ref-guards on Signup/Book/Fundraise; puck-ingest rejects out-of-range/`0,0` coordinates; elle-apollo-webhook accepts the secret via header (query kept for Apollo).
  - **Left intentionally:** `demo-checkin` key stays in the URL (it's a clickable demo link). It is intentionally ON prod; the safety control is the `app_config` key + email allowlist + goal cap, not absence from prod. Do NOT delete it — that breaks the live demo.
  - **Still on Kevin (config, unchanged by this pass):** confirm `VITE_PREVIEW_MODE` is deleted on the prod Netlify site; restrict the Google Maps browser key by referrer; set Turnstile keys before public OTP/booking.

## 2026-08-13

- **Post-build audit** (Supabase security advisors + state checks) — clean overall; fixed 3 issues we'd introduced: enabled RLS on new tables `elle_example_seed` + `elle_onboarding` (were exposed via REST), revoked anon/authenticated execute on the `elle_tenants_seed_trg` / `elle_tenants_confirm_trg` trigger functions, and pinned `elle_enforce_event_zip` search_path. Verified: 0 tenants paid-enabled, 0 test residue, all objects present, APP RPCs not anon-callable. Pre-existing advisor items (service-role tables with RLS-deny, pg_net in public, leaked-password protection = ROADMAP #55-area) left as-is.
- **One-button onboarding backbone (#48)** built: `elle_provision_tenant` runs free stages always, gates paid stages on `paid_apis_enabled`, tracks progress in `elle_onboarding`. Closed a spend gap — `elle_onboard_territory` previously spent regardless of confirm; now gated. Confirming a Z auto-clears examples + triggers the paid cold-load. Remaining: audit/verify stage (#49), UI button.
- **Cost dashboard (#58 half)** shipped: `elle_cost_dashboard` / `elle_cost_by_service_phase` split actual vs estimate per client. Precise per-function actual logging deferred (needs coordinated 6-function + dispatcher change to avoid double-counting; no live spend yet since no Z confirmed). #58 stays open for that.
- **#61 Rewards tenant filter** shipped to prod (defense-in-depth on RLS).


- **Franchisor pays → no per-Z billing gate.** Corporate is expected to fund the platform, so we are NOT building per-franchisee payment/billing. The `paid_apis_enabled` confirm switch stays (it's the "this Z is live, start spending" control) but nothing is invested toward a per-Z-pays scenario. Could change; don't remove anything.
- **Beta rollout preference: contiguous regional cluster.** Preferred order: (1) contiguous regional cluster, (2) single-state saturation, (3) representative archetype sample. Reason: only contiguous coverage lets us test/prove Alex's "out-of-bounds lead → nearest Z + fair distribution" mechanic and gives a complete owned/unowned map. **Prerequisite:** get the current, complete ZIP→owner registry from corporate (the owned list Kevin gave is stale). Not guaranteed corporate will let us choose, but this is our preference.
- **Command-central docs** created (this `docs/` set + root `CLAUDE.md`) so context survives thread switches. Lives in the repo/git; external hard-disk copy planned.
- **Auto-seed for every Z, free.** New ELLE tenants get 3 labeled EXAMPLE leads automatically (no API spend); real paid discovery only after confirm. Examples auto-clear on confirm. Window sample-customer seed was NOT built (fake data in prod; ELLE examples already make the app feel alive) — revisit if wanted.
- **Book-A-Truck login gate** shipped: requires a signed-in account before submit (clean/attributable pilot leads); DEMO bypasses. Accepted tradeoff: may reduce cold public bookings later — soften at public launch.
- **Deploy target for pre-tester features = production** (testers use donutnvapp.com), even though design changes otherwise go to staging only.
- **Support email = kevin@donutnv.com** for the pilot (adjustable).

## Earlier (from the build + audit)

- **Square webhook made atomic** (`process_square_sale`) after finding it marked events processed before writing the stamp — a crash could lose or double a loyalty stamp.
- **ELLE API surface locked to service-role**; discovery/enrichment invoked only via the `elle_call_edge_function` dispatcher with spend enforcement.
- **Spend caps + kill switch + alerts** added; LLM cap could never trip because LLM logged nothing, so the dispatcher now estimate-meters non-self-logging paid functions.
- **PWA `selfDestroying: true`** — the service worker was caching a stale/broken prod bundle; self-destruct fixes it.
- **truck_locations retention** — table grew unbounded; nightly prune keeps each truck's latest point (map stays fast via the index regardless).
- **Curtain intro reverted** at root — looked wrong when already logged in.
- Copy rules from Kevin: no em dashes in sent copy; "Make your business sweet!"; ELLE = "E.L.L.E"; leads refreshed "every month"; 5 scoring factors; don't over-claim ownership/paperwork.

## Open decisions (need Kevin / corporate)

- **Customer ownership policy** (ROADMAP #57): is a customer global-to-brand or owned per-location? Re-signup currently overwrites `tenant_id`. Needs a corporate decision before fixing.
- **Rollout geography** — pending the current territory map from corporate.
