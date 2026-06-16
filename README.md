# DonutNV Customer App

Find the truck. Get alerts. Earn free donuts. A white-label progressive web app (PWA) — built for your truck first, ready to license to the network. Owner: **Trench Logic**.

This is **V1, Layer 1 + Layer 2 + the map** of the build plan: customer accounts and the owned list, the live truck map, and a working rewards screen. It runs and builds today. (Proximity push alerts, Square Loyalty sync, and the full campaign engine are the next modules — see "What's next.")

---

## What's in here

| Part | What it does |
|------|--------------|
| **Branded PWA** | Installable app in DonutNV's real red/white/blue, Poppins + Gochi Hand fonts. Big buttons, three tabs — made for non-tech-savvy users. |
| **Accounts + owned list** | One-screen signup capturing **phone, name, email, ZIP, and birthday**, with passwordless code login. Every signup is a customer you own. |
| **Consent done right** | Mirrors DonutNV's own vetted two-checkbox pattern (account texts vs. marketing). Each consent is timestamped and versioned — a clean TCPA/CAN-SPAM paper trail. |
| **Birthday-as-perk** | Birthday is asked as a treat ("free donut 🎂"), and quietly routes any under-13 signup to a parent's email — covering COPPA without an off-putting age wall. |
| **Live map** | Google Maps showing every truck that's currently live, with directions. Reads public, read-only views so anyone can see trucks. |
| **Rewards** | A live stamp card driven by whatever campaign the operator switches on. |
| **Multi-tenant database** | White-label from day one. The app re-themes per operator from the database. Row-level security so customers only ever see their own data. |

---

## Setup — about 20 minutes, no coding

### 1. Put your keys in
1. Make a copy of `.env.example` and name it `.env`.
2. Fill in four values:
   - **Supabase URL + anon key** — Supabase → your project → Project Settings → API.
   - **Google Maps key** — Google Cloud Console → enable "Maps JavaScript API" → create an API key. (Restrict it to your website later.)
   - **Tenant slug** — leave as `donutnv-home` for now.

### 2. Set up the database
1. In Supabase, open **SQL Editor → New query**.
2. Paste in everything from `supabase/schema.sql` and click **Run**.
3. Do the same with `supabase/seed.sql` (creates your demo truck so the map shows something).

### 3. Turn on phone & email login
In Supabase → **Authentication → Providers**: enable **Phone** (connect a text provider like Twilio — Supabase walks you through it) and **Email**. That's what sends the 6-digit codes.

### 4. Run it on your computer
Open a terminal in this folder and run:
```
npm install
npm run dev
```
Then open the link it prints (usually http://localhost:5173).

### 5. Put it online (Netlify)
1. Push this folder to a GitHub repo.
2. In Netlify → **Add new site → Import from Git** → pick the repo.
3. Add the same four `.env` values under **Site settings → Environment variables**.
4. Deploy. `netlify.toml` already has the right settings.
5. Point your Cloudflare domain at the Netlify site when ready.

---

## How the pieces fit (plain English)

- **Supabase** is the brain: it stores customers, trucks, locations, and rewards, and handles login. Phones will post their location straight into it; the puck feeds in through Traccar later.
- **The app** is the friendly face customers see. It reads truck positions and shows the map; it writes new signups into your owned list.
- **Square** (next module) runs the cash register and the points. The app never touches money — Square owns purchases, you own the relationship.

---

## Built to sell to corporate

- **Multi-tenant:** every operator is a `tenant` row. Add a new franchise = add a row; the app re-skins itself from that row's brand colors. No new build.
- **Your data stays yours:** customers are tied to your tenant. When you license the platform, you keep your operator list and collect licensing revenue. (Settle who owns the *network aggregate* with Alex in writing before handing anything to corporate — that's a business decision, not a code one.)
- **Safe by design:** row-level security means one operator can never see another's customers, and customers can never see each other's data.

---

## The operator (owner/zee) app

Owners log in at the **same** place customers do. If their profile `role` is
`operator` or `admin`, they land on the operator app instead of the customer map.

**Make yourself an operator:** sign up normally once, then in Supabase →
Table Editor → `profiles`, set your row's `role` to `operator`. Log out and back in.

What's in it:
- **🏠 Home** — customer count, what's broadcasting now, and an **admin kill switch** to stop any live truck instantly.
- **🟢 Go Live** — one-tap Open. Picks a stop, sets an auto-close time, then shares your phone's GPS while the screen says LIVE. Every fail-safe from the plan is built in: default off, auto-expire, blacklisted home/commissary zones (location is *not* shared inside them), schedule-driven stops, a one-tap "go dark for a private event," a loud live banner with a nudge, and instant Close.
- **🎮 Games** — switch on and schedule the weekly reward game (stamp card, passport, catch-the-truck, bonus day) with no developer. Turning one on makes it appear on every customer's Rewards tab.

**Set your no-broadcast zones:** in Supabase → `geofence_blacklist`, add a row
for home and the commissary (label, lat, lng, radius in meters). The Go Live
screen will refuse to share your location inside them.

## Proximity alerts (web push) — ready to flip on

The wiring is all here; it needs a VAPID key pair to send.

1. Generate keys: `npx web-push generate-vapid-keys`
2. Put the **public** key in `.env` as `VITE_VAPID_PUBLIC_KEY`.
3. Put both keys in Supabase secrets:
   `supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:party@donutnv.com`
4. Deploy the function: `supabase functions deploy notify-proximity`
5. In Supabase → Database → Cron, call it every minute.

Customers turn it on with the **🔔 Turn on truck alerts** button on their Account
screen. (Saved areas need lat/lng for distance matching — add ZIP geocoding at
signup when you're ready; the column is there.)

## Square Loyalty sync — ready to flip on (build-last, modular)

`supabase/functions/square-webhook/index.ts` turns a Square purchase into a stamp
and links it to the right customer by phone.

1. Deploy: `supabase functions deploy square-webhook`
2. In the Square Developer Dashboard → Webhooks, point `payment.created` at the
   function URL.
3. Add `SQUARE_WEBHOOK_SIGNATURE_KEY` to Supabase secrets (used to verify the call).
4. Put each truck's Square location id in the `tenants.square_location_id` column.

## Event booking + "on the way" tracking + reviews

Run `supabase/schema_bookings.sql` once (after `schema.sql`).

**What it does**
- Customers tap **Book the truck** on the landing → a branded form captures the
  event details → saves a booking → pushes it to GHL/LeadConnector.
- Owners see every request on the **📅 Bookings** tab. **Start driving** geocodes
  the event, opens a *private* live session (hidden from the public map),
  broadcasts the truck's GPS, and texts the client their live tracking link.
- The client opens **/track/&lt;token&gt;** — a public page with the truck moving
  toward their event and a live ETA. No login.
- **Mark done** ends the broadcast; GHL sends the review request.

**Division of labor (as chosen):** the app fires the live "on the way" text;
GHL runs confirmations, reminders, and review requests off the contact/tags.

**Connect GHL (LeadConnector v2):** deploy and set secrets —
```
supabase functions deploy ghl-sync
supabase secrets set GHL_API_TOKEN=... GHL_LOCATION_ID=... \
  GHL_PIPELINE_ID=... GHL_PIPELINE_STAGE_ID=... APP_BASE_URL=https://donutnvapp.com
```
In GHL, build a workflow triggered by the `event-lead` tag (or the opportunity)
for your confirmation / reminder / review sequence.

**Connect the on-the-way text (Twilio):**
```
supabase functions deploy send-enroute-sms
supabase secrets set TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM=+1...
```

Until those are connected, bookings still save and appear on the Bookings tab —
the GHL push and the text are best-effort and simply no-op without keys.

## Still parked for V2 (per the plan)

Badges & leaderboards, scavenger chains, pre-order / skip-the-line, full SMS
automation, and data-driven routing analytics.

---

*DonutNV® and its marks are property of DonutNV Franchising, Inc. / Keystone Amusements IP Holdings LLC. This app is being developed by Trench Logic.*
