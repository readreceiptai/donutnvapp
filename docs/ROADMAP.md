# Roadmap / Open Items

Mirrors the working task list. Grouped by what unblocks a beta launch. Update as items close.

## Needs Kevin / external (lead time — start early)

- **#63 Option B proximity push — purchases + credentials.** Server pipeline is built, applied and proven (`docs/PROXIMITY-PUSH.md`); these are the only hard blockers left. (a) **FCM project + APNs key** → set Supabase secret `FCM_SERVICE_ACCOUNT`; until then native sends log as `suppressed`. (b) **Transistorsoft background-geolocation license**, ~$300-400 **per platform** — buy before beta, the free plugin loses its watcher on process kill/reboot. (c) **Google Play registration $25**. (d) **App Review background-location justification + privacy labels** — the long pole, start the write-up early.
- **#34 Custom SMTP** — top pre-tester blocker. Default Supabase email is rate-limited (~30/hr) and lands in spam; testers may never get confirmation/reset emails. Provide SendGrid/SES/Postmark creds → ~10-min wire-up.
- **#53 Twilio + #35 A2P 10DLC** — carrier approval to text consumers takes 1–3 weeks. Gates en-route SMS and spend-alert SMS. Start registration now.
- **#54 PITR backups + restore runbook** — enable PITR on the APP project; only catastrophic-risk item left. Runbook already written (Desktop).
- **#55 Sentry / observability** — code is wired but off (no DSN). Create the project, set DSN, add structured logs (tenant/request/job ids) + uptime monitor.
- **#57 Customer ownership policy** — corporate decision (global vs per-location) before fixing re-signup tenant overwrite.
- Territory map — get current, complete ZIP→owner registry from corporate (needed for rollout + out-of-bounds routing).

## Code-level, Claude can do

- **#56 elle-discover job queue** — long scrape/ingest runs in one invocation with no durable resume; move to a jobs table / queue with retry + resume (bigger project).
- **#58 Precise per-function spend logging + cost dashboard** — 3 of the paid functions log actual spend; the rest get dispatcher estimates. Add real per-call logging so per-client cost is exact.
- **#60 Turnstile** — `verify-turnstile` fails open until `TURNSTILE_SECRET_KEY` is set; set it + flip to enforce before public launch.
- **#61 Rewards frontend tenant filter** — defense-in-depth; RLS already covers it. Next frontend deploy.
- **#62 Staging + CI/migrations** — stand up a staging Supabase project; run migrations there first; add CI + RLS smoke tests. Also resolve the `elle-dashboard` function-name collision across projects and remove the stale `puck-ingest/` folder.

## Option B — live proximity push (branch `feature/proximity-push`)

Server side is **done and proven**; see `docs/PROXIMITY-PUSH.md` for detail and benchmarks. Remaining, in order:

- **#64 Generate the native projects** — `npx cap add ios && npx cap add android`, drop in `GoogleService-Info.plist` / `google-services.json`, add iOS background-location + push entitlements. Blocked only by #63(a).
- **#65 Deploy the two edge functions** — `location-ingest` **with** JWT verify, `proximity-dispatch` with `--no-verify-jwt` + `CRON_SECRET`. Then schedule `proximity-dispatch` every minute.
- **#66 Cutover from `notify-proximity`** — run both (they share the `proximity_pushes` dedupe key, so no double-sends), then retire the legacy function once native coverage is real. Its push copy also uses the banned donut emoji; fix or delete on retirement.
- **#67 Staged switch-on** — flip `app_config.proximity_push_enabled = 'true'`, then enable `tenant_proximity_config` one territory at a time (Ocala first). Watch opt-in rate and CTR via `get_proximity_metrics()`.
- **#68 Operator + customer controls UI** — customer prefs component is built and wired into `/account`; still need the per-tenant admin toggle/radius screen for operators.
- **#69 Swap in Transistorsoft** — one line in `pickProvider()` once #63(b) is purchased. Do this before beta, not after.

## Product / growth (bigger builds)

- **#48 One-button Z onboarding pipeline** — idempotent, resumable: create tenant, validate ZIPs, market report, cold discovery, gated enrichment, schedule crons, audit, activate. (Auto-seed + confirm switch are the first pieces of this.)
- **#49 Onboarding audit/verification agents + health monitoring.**
- **#46 Training module / demo tutorial**; **#45 improve Juan/Kristen deck**.
- **#40 Fundraiser/giveback engine**; **#41 real in-app games**; **#42 fundraiser lead sources (schools/churches/charities)**.
- **#51 Window + ELLE design/UX overhaul (staging only)**.
- **#52 Seed Window customer data** — HELD (fake data in prod; only if a specific tester cohort needs it).
- **#43 Load full US ZIP centroids + all tenant coordinates**; **#44 done** (booking gate).
- Out-of-bounds lead routing → nearest Z + fair distribution (Alex's focal point).

## Done recently (for context)

Audit fixes (square-webhook atomic, ELLE lockdown, spend governor + kill switch + alerts + dispatcher metering, campaigns leak, phone uniqueness, truck_locations retention), in-app feedback + FAQ/support, Book-A-Truck login gate, ELLE auto-seed + confirm switch, production deploy. Local commits pending push from the Mac.
