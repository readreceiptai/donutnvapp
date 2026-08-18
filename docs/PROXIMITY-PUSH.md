# Option B — Live Proximity Push

**Status: active build toward closed beta. Server pipeline live-but-dormant: `location-ingest` v1 + `proximity-dispatch` v1 deployed (no cron, kill switch `false`, tenant config empty = three independent locks). Android shell scaffolded, configured, and building green (app-debug.apk). iOS shell scaffolded + configured; build blocked on Xcode install. No push credentials wired yet.**

Branch: `feature/proximity-push`. Last updated: 2026-08-18.

The controllable "a truck is near you" push at a radius we choose (default 5 mi).
Apple Wallet caps proximity relevance at ~0.62 mi and Google controls its own
radius, so wallet passes can never be this. Native app + background location +
server-side geofencing + push is the only mechanism that delivers it, and it is
the durable moat.

---

## How it differs from what was already here

There was already a proximity push path, and it is **not** what this replaces
wholesale:

| | Legacy `notify-proximity` | New `proximity-dispatch` |
|---|---|---|
| Customer position | `saved_areas` — a static home/work ZIP the customer typed in | `customer_latest_position` — live device GPS |
| Distance math | Haversine in TypeScript, per row | PostGIS `ST_DWithin` on a GiST index |
| Radius | `saved_areas.radius_m`, default 4km | Per-customer, capped per tenant, default 5 mi |
| Channel | Web push (VAPID) | Native APNs/FCM **and** web push |
| Rules | Once per truck session | Session dedupe + opt-in + freshness + quiet hours + frequency cap + daily cap + tenant toggle + global kill switch |

**Both are safe to run at once.** They claim the same
`proximity_pushes (session_id, profile_id)` primary key before sending, so a
member cannot be double-notified for one truck session during cutover.

---

## Pipeline

```
[Capacitor native shell]
  src/lib/location/          provider interface  (community | transistor | web)
        │  batched fixes, 500m distance filter
        ▼
[edge fn: location-ingest]   JWT-verified; profile_id comes from the token
        │  ingest_customer_position()
        ▼
customer_positions (24h history)  +  customer_latest_position (hot, GiST)
        │
        ▼
[match_proximity_candidates()]    ST_DWithin + the whole rules layer
        │
        ▼
[edge fn: proximity-dispatch]     cron; claims dedupe, fans out FCM + web push
        │
        ▼
push_tokens / push_subscriptions  ->  proximity_notification_log (CTR)
```

## New DB objects (all additive, all RLS deny-by-default)

| Object | Purpose |
|---|---|
| `customer_positions` | Position history. Pruned to **24h** (tighter than truck_locations' 48h — customer location is PII, a truck's trail is business data). |
| `customer_latest_position` | One row per customer. **The spatial match target**, GiST-indexed on `geog`. |
| `push_tokens` | Native APNs/FCM tokens. Separate from the existing `push_subscriptions` (web/VAPID), which is untouched. |
| `proximity_prefs` | Per-customer opt-in, radius, quiet hours, timezone, caps. `enabled` defaults **false**. |
| `tenant_proximity_config` | Per-tenant on/off, max radius, quiet hours, caps. `enabled` defaults **false**. A separate table so this workstream never alters `tenants`. |
| `proximity_notification_log` | Every send, suppression and failure, plus `opened_at` for CTR. No FK to trucks/sessions so it outlives session pruning. |
| `ingest_customer_position()` | Validates and writes a fix. Rejects null island, >5km accuracy, and anyone not opted in. |
| `match_proximity_candidates()` | The matcher + rules layer. service_role only. |
| `proximity_in_quiet_hours()` | Timezone-aware, handles windows that wrap midnight, falls back to UTC on a bad tz rather than failing the run. |
| `get_proximity_metrics()` | Opt-in rate, sends, suppressions, failures, CTR. Superadmin or own-tenant operator. |
| `mark_proximity_notification_opened()` | The one write a customer may make to the log: `opened_at`, own rows, first open only. |
| `prune_customer_positions()` / `prune_stale_push_tokens()` | pg_cron `prune-customer-positions`, nightly 04:15. |

### Privacy posture (deliberate)

`customer_positions` and `customer_latest_position` are the most sensitive data
on the platform. Writes are **service-role only** (via `location-ingest`).
Reads are the customer's **own row only** — operators cannot read where their
customers are, and neither can superadmin. RLS is `enable` **and** `force`, and
`anon` has no grant on any of the six new tables.

## The rules layer

Every rule lives in `match_proximity_candidates`, in the database, in one place:

1. Global kill switch — `app_config.proximity_push_enabled`, ships `'false'`.
2. Tenant enabled — `tenant_proximity_config.enabled`, defaults false.
3. Truck genuinely serving — live + public session **and** a GPS fix < 15 min old.
4. Customer opted in — `proximity_prefs.enabled`.
5. Position fresh — within `position_max_age_minutes` (default 120).
6. Inside `least(customer radius, tenant max radius)`.
7. Not in quiet hours, in the customer's own timezone.
8. Session dedupe via the existing `proximity_pushes` interlock.
9. Frequency cap — minimum hours between any two sends (default 6).
10. Daily cap — rolling 24h, not calendar day, so it cannot be gamed by a truck going live at 11:55pm.

## Measured performance

Benchmarked on the live APP database against a **100,000-row** structural clone
in a throwaway `proximity_bench` schema (no synthetic rows ever entered the real
tables; schema dropped afterwards).

- Single truck, 5 mi radius, 100K customers: **100 ms**, `Bitmap Index Scan on ..._geog_gix`.
- **100 trucks in one tick**, 100K customers, 195,383 matches: **1.03 s**, `Nested Loop` + `Index Scan using ..._geog_gix`, ~6.5 ms per truck.

That is worst case by a wide margin: it packs all 100K customers *and* all 100
trucks into a single 60x60 mi box, so every truck matches ~1,950 people. Real
load spreads 100K customers across ~100 territories. Comfortably inside a
60-second cron tick.

## End-to-end proof

A simulated tenant, truck, live session, and two customers were created, run
through the real `ingest_customer_position` RPC and the real matcher, then
deleted in the same atomic batch. Result: the customer 2 mi away matched at
**3214 m**; the customer 40 mi away was correctly excluded. Verified afterwards
that zero rows and zero sentinel users remained and the kill switch was back to
`false`.

## Native shell

`src/lib/location/` puts the location source behind one interface
(`requestPermission` / `startTracking` / `onLocation` / `stopTracking`) with
three implementations:

- **community** — `@capacitor-community/background-geolocation`, free, installed, active.
- **transistor** — `@transistorsoft/...`, ~$300-400/platform, **not purchased**. Written against the real API and inert until installed. Its import is deliberately hidden from the bundler (`@vite-ignore` + variable specifier) so a missing paid package cannot break `vite build`.
- **web** — foreground only, and the opt-in UI says so honestly instead of showing a switch that does nothing.

Swapping to the paid plugin is one line in `pickProvider()`. Buy it before beta:
the free plugin loses its watcher across process kills, aggressive Android
battery optimisers, and reboots, and every one of those is a customer who opted
in and then silently never hears from us.

Battery contract lives in `src/lib/location/config.js`: 500 m distance filter
(significant-change semantics, not a GPS trace), batched flush of 10 fixes or
5 minutes.

## Opt-in UX

`src/components/ProximityAlerts.jsx`, wired into `/account`. Two steps on
purpose: our own priming screen first, the OS "Allow all the time" dialog only
after the customer has already said yes to us. The OS prompt can only be spent
once; a Deny there is effectively permanent. Copy follows the brand rules (no
donut emoji, no em dashes). The legacy `notify-proximity` copy also violated
this; fixed and redeployed (v10, 2026-08-17).

---

## Remaining to go live (updated 2026-08-18)

Done since the first draft: native projects generated and configured (Android
builds green; iOS configured, awaiting Xcode), priming screen carries Play's
verbatim prominent disclosure, both edge functions deployed dormant
(`location-ingest` verify_jwt ON, probed 401 without a token;
`proximity-dispatch` CRON_SECRET-gated, probed 403 on wrong secret).

**Kevin (critical path):**
1. **Install Xcode** on this Mac (App Store, ~12GB) then `sudo xcode-select -s /Applications/Xcode.app`. Nothing iOS can compile without it; CocoaPods is already installed and waiting.
2. **FCM project + APNs key** -> set `FCM_SERVICE_ACCOUNT` secret; drop `google-services.json` into `android/app/` (build auto-detects it) and `GoogleService-Info.plist` into `ios/App/App/`. Until then native sends log as `suppressed / FCM not configured`; web push unaffected.
3. **Transistorsoft license** (~$300-400/platform) before beta; swap is one line in `pickProvider()`.
4. **Google Play registration** ($25); TestFlight + Play internal testing tracks; Android test devices.

**Then (code side, after credentials):**
5. iOS entitlements (push + background modes are set in Info.plist; the aps-environment entitlement lands with the signing team in Xcode), `npx cap sync ios`, build.
6. Real-device end-to-end: simulated truck move -> real push on a phone. **Merge to `main` only after this is seen.**
7. Schedule `proximity-dispatch` every minute; flip `app_config.proximity_push_enabled = 'true'`; enable tenants one at a time (Ocala first); retire `notify-proximity` after cutover.
8. Store submission per `docs/STORE-SUBMISSION-LOCATION.md` checklist (demo account, review video, privacy policy page).
