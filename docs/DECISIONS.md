# Decisions Log

Why things are the way they are. Newest first. Update this whenever a non-obvious call is made.

## 2026-08-13

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
