# DonutNV App — Product Roadmap & Vision

Looking at the platform through the four people it serves. Status key:
**✅ Built** · **▶️ Next (small, mostly needs a key)** · **🟡 Phase 2 (a real build)** · **🧩 Separate build**

---

## 1. Customers — "find my donuts today, have fun, win stuff"
- ✅ Find live trucks on a map; proximity text alerts; passwordless sign-up (owned list)
- ✅ Loyalty stamp card; weekly game engine; rewards tab
- ✅ Landing rewritten: find donuts → sign up for rewards → Donut Passport, prizes (T-shirts, swag, donuts), birthday treat; Facebook follow; private-events section
- ▶️ **Public schedule view** — see where we'll be this week (reads `scheduled_stops`; hides private-event details, shows the time as "Booked"). Needs the operator calendar populated (below).
- 🟡 **Donut Passport UI** — progress map across stops (engine + data model exist; needs the customer-facing screen)

## 2. The Z (operator) — "one automated hub to run my business"
- ✅ Go Live + GPS fail-safes; Bookings with full event-day flow; weekly games admin; kill switch
- ▶️ **Customer comms** — broadcast a promo/text to segments (fires via GHL)
- 🟡 **Schedule/calendar management** — add/edit public stops in-app, fed from GHL (see Calendar below)
- 🟡 **Engagement dashboard & metrics** — customers, signups, redemptions, review volume, **per-campaign efficacy** (which promos to keep vs drop)
- 🟡 **Reviews inbox** — see/respond, then publish (see Reviews engine)

## 3. Private-event clients — "quote, then keep me in the loop"
- ✅ Book-a-truck form → GHL; event portal (booked → on the way + ETA → in-event feedback → wrapping → we've left → review w/ 1-hr incentive → coupon); en-route text; all consent/compliance captured
- ▶️ **Automated sequences** — confirmations, reminders, day-of, thank-you, review, coupon run as GHL workflows off the tags we already send
- 🟡 **Quote flow** — structured quote/estimate back to the client in-app + e-sign/deposit (later)

## 4. DonutNV Corporate — "prove the value, market nationally"
- ✅ Multi-tenant + white-label foundation (every operator is a tenant; data scoped + RLS)
- 🟡 **Super-admin console** — cross-tenant: events booked system-wide, reviews & feedback nationwide, app usage, top reviews to feature
- 🟡 **National marketing list** — the owned customer base, segmented, for the ad fund
- 🟡 **Reporting & metrics** — for corporate *and* each Z

---

## Cross-cutting systems (the big asks)

### GHL contact migration + labeling ▶️/🟡
Today: bookings push to GHL with tags (`event-lead`, `sms-opt-in`, `marketing-opt-in`).
Next: mirror that for **every signup** → GHL contact, auto-labeled **app-user / booked-client / regular** (regular = N+ check-ins) and re-labeled as behavior changes. This makes your retargeting list "straight out of GHL." Needs the GHL API key + a field/tag map. Small build once keyed.

### Calendar — the high-value one 🟡 (feed) / 🧩 (multi-cal sync)
- **GHL → app public schedule → Facebook:** pull the Z's GHL calendar, show **public events** on the app schedule, show **private events as blocked time only** (no details), and **auto-post/sync the schedule to their Facebook Page** (solves the "Zs never post their calendar" problem). Needs GHL Calendar API scope + a Facebook Page integration (Meta app + Page token).
- **Multi-calendar merge into one view** (your 3-calendars-per-customer ask — block personal time as "busy" without exposing details): this is a genuinely separate, reusable scheduling product. Recommend scoping it as its own build; it would plug into this app via the same public/blocked model.

### Reviews as an engagement tool 🟡
Collection is ✅. Build: a **review hub** to approve and **publish** great reviews to **Facebook, the website, and the landing page** (embeddable widget), with the best ones surfaced to **corporate** for the national site. Needs Facebook/website publishing targets.

---

## Territory ownership & lead routing  ▶️ engine BUILT (gated on the ZIP data)
The rules, locked in:
- **Customers are corporate-owned by default** (public + private event attendees). `profiles.owner_tenant_id = null` means corporate.
- **Booking a truck transfers the customer to the assigned franchisee** — set automatically at the moment of booking.
- **Leads only go to franchisees active on the app** (`tenants.app_active`). The app is the carrot: no account, no leads. This is the adoption driver.
- **Routing keys off the EVENT ZIP:**
  - Owned ZIP whose owner is on the app → that owner (`owned`).
  - OOB ZIP **or owner not yet on the app** → **round-robin** to the nearest app-active franchisees within their service radius, balanced by fewest-recent leads (`round_robin`).
  - Nobody within range → `unassigned` (corporate handles).
- **Alerts stay proximity-based** (a Z live in an OOB area can alert anyone nearby who opted in) — independent of who owns the customer.

Built now: `schema_territory.sql` (the `territory_zips` map, `zip_centroids`, `app_active`, per-franchisee centroid + radius + round-robin counter, customer `owner_tenant_id`, booking `assigned_tenant_id`/`assignment_reason`) and the `route_booking()` function. The book-a-truck form already calls it on submit.

**To switch it fully on, we load corporate's data:** the FDD **ZIP → franchisee** list into `territory_zips`, a US **ZIP-centroid** table, each franchisee's territory centroid, and flip `app_active = true` as franchisees onboard. For the Palm Harbor pilot it already routes everything to you.

Still to build on top: a **corporate territory-admin screen** (upload/manage the ZIP map, see coverage gaps) and franchisee **onboarding/activation** flow.

---

## What I'd build next (suggested order), once keys are in
1. **Customer → GHL sync + labels** (turns on your marketing list) — GHL key
2. **Public schedule view + operator schedule management** — GHL calendar scope
3. **Facebook: follow link ✅ → auto-post schedule** — Meta app + Page token
4. **Reviews hub + embed/publish** — Facebook/website targets
5. **Dashboards & metrics** (Z + corporate) — no new key
6. **Super-admin console** — no new key
7. **Multi-calendar sync** — separate build, scoped on its own

---

## API keys & accounts we'll need (collect these next)
| Service | Powers | New? |
|---|---|---|
| Supabase URL + anon + service-role | data, auth, functions | have account |
| Google Maps (Maps JS + Geocoding) | map, ETAs, ZIP→coords | needed |
| Twilio (SID, token, from #) | login codes + the live texts | needed |
| VAPID keypair (`npx web-push`) | proximity push | free, self-gen |
| **GHL / LeadConnector** (Private Integration token, Location ID; **scopes: contacts, opportunities, calendars**) | booking sync, contact migration/labels, calendar feed | needed — now also calendar |
| **Meta / Facebook** (App ID + Page access token per location) | follow link (done), auto-post schedule, publish reviews | **new** — needs a Meta app + review |
| Square (API + webhook key) | loyalty points | later |
| Netlify + Cloudflare | hosting + DNS | have |
