# DonutNV Platform — Command Central

**This file auto-loads into any Claude session opened in this folder. Read it first, then the `docs/` files it points to. It is the single source of truth for the whole platform.**

Maintained by Kevin McLenithan (Trench Logic). Last updated: 2026-08-18.

---

## What this is

Two products, one codebase, two databases:

- **The Window** — the branded customer app (find-the-truck map, loyalty/rewards, games, Book-A-Truck). White-labeled per franchisee.
- **ELLE** (Event Lead Engine) — the franchisee-facing lead engine that finds, scores, and enriches event/business/non-profit leads and pushes them to each owner's LeadConnector.

Built for DonutNV, a mini-donut franchise. Customers = "Z" / "Zee" (franchisee owner). "Zor" = the franchisor/corporate. See `docs/GLOSSARY.md`.

## How a new session should get up to speed

1. Read this file.
2. Read `docs/ARCHITECTURE.md` (systems, IDs, deploy) and `docs/DATA-MODEL.md` (tables, flags, triggers).
3. For ELLE work read `docs/ELLE.md`; for customer-app work read `docs/WINDOW.md`; for the live proximity-push workstream read `docs/PROXIMITY-PUSH.md`.
4. Before changing anything, read `docs/DECISIONS.md` (why things are the way they are) and `docs/RUNBOOKS.md` (how to operate/deploy/recover).
5. Open items live in `docs/ROADMAP.md`.

## Ground rules (do not violate)

- **No paid API spend until a Z is confirmed.** ELLE's paid jobs gate on `elle_tenants.paid_apis_enabled`; it defaults false. The franchisor is expected to pay, so there is no per-Z billing gate to build — but leave the confirm switch in place. See `docs/ELLE.md`.
- **Never remove the spend caps / kill switch.** The global cap is the master kill switch. See `docs/RUNBOOKS.md`.
- **Brand:** never use the donut emoji anywhere — use the mini-donut / bucket brand imagery. Colors: red `#DD1B22`, blue `#0A7BC1`, cream `#FFF7F0`, ink `#231F20`. Fonts: Poppins / Roboto / Gochi Hand. No em dashes in customer-facing copy Kevin will send.
- **The Window colors do not change.** ELLE may get a light/white mode. Design changes go to **staging only**.
- **Git:** commits are made locally in this repo; **Kevin pushes from his Mac** (the sandbox has no push creds). Run `git gc` occasionally to clear stale lock warnings.
- **Demo-only hacks** (Ocala geography forcing, dummy accounts) must never ship in the real production app.

## Current status (2026-08-16)

- **Option B (live proximity push)** server-side pipeline is **built, applied to the APP DB, and proven end to end** on branch `feature/proximity-push`. Six new additive tables (RLS deny-by-default, no `anon` grant), a PostGIS `ST_DWithin` matcher with the full rules layer, and two edge functions written but not deployed. **Now an active track toward closed beta**: **both native shells building green** (iOS running in the Simulator, capture->ingest proven end-to-end there; Android with FCM baked in), priming screen Play-compliant, and both edge functions **deployed dormant** (no cron + kill switch `false` + empty tenant config = three locks; probed 401/403 from outside). Merge to `main` only after a real push lands on a real phone. Blockers: iOS Firebase plist + `FCM_SERVICE_ACCOUNT` secret, a real device, Transistorsoft license, Play registration. Also #70: Maps key rejects the native origin — see `docs/PROXIMITY-PUSH.md` and ROADMAP #63-69.

## Status as of 2026-08-13

- Production is live at **donutnvapp.com** (Netlify site `donutnv-app-live`).
- A production-readiness audit was completed; most REDs fixed. Remaining open items are in `docs/ROADMAP.md` (backups, Sentry, elle-discover job queue, ownership policy, SMTP, Twilio/A2P).
- Spend governor, kill switch, per-service caps, and dispatcher enforcement are live and tested.
- In-app feedback loop, FAQ/support, and Book-A-Truck login gate shipped to prod.
- ELLE auto-seeds free EXAMPLE leads for every new Z; confirm switch (`elle_set_paid_enabled`) unlocks paid discovery and auto-clears examples.
- Unpushed local commits exist — **push from the Mac.**

## Keeping Command Central current (STANDING RULE — every session)

This doc set is only useful if it stays true. **In every working session, before you finish, update it:**

- Shipped a feature, changed schema, added/edited an edge function, RPC, trigger, or cron → update the relevant `docs/` file (`ARCHITECTURE`, `DATA-MODEL`, `ELLE`, `WINDOW`).
- Made a non-obvious call or got a decision from Kevin → append to `docs/DECISIONS.md` (newest first, dated).
- Opened, closed, or reprioritized work → update `docs/ROADMAP.md`.
- New term, person, or identifier → add to `docs/GLOSSARY.md`.
- Update the "Last updated" date + "Current status" in this file when status materially changes.

Commit the doc updates in the same batch as the work. If a session ends without doc updates, that's a miss. Kevin will also switch threads periodically — leaving the docs current is how the next thread starts fully briefed.

## Backups

This doc set lives in the repo on Kevin's computer and in git history. Planned: copy to an external hard disk. Database backups + restore steps are in `docs/RUNBOOKS.md`.
