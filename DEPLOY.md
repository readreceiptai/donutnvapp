# Deploying the DonutNV App

## Are we ready to deploy?

**Yes — the app builds cleanly and is deploy-ready right now.** You can connect it
to Netlify today and it will go live. It becomes *fully functional* as you add the
keys below, and you can launch in stages: the **core** (live map + accounts +
booking) first, then flip on push alerts, the "on the way" text, and Square
loyalty as you connect those. None of the later pieces block the core.

---

## Every API / account you need (the complete list)

| # | Service | What it powers | Needed to launch? | What to get |
|---|---------|----------------|-------------------|-------------|
| 1 | **Supabase** | Login, database, server functions | **Required** | Project URL + anon key (Settings → API). Service-role key is auto-available to functions. |
| 2 | **Google Maps Platform** | The live truck map, ETAs, and turning ZIP / event addresses into coordinates | **Required** | One API key with **Maps JavaScript API** + **Geocoding API** enabled |
| 3 | **Twilio** | (a) the 6-digit **login text codes**, (b) the **"on the way" text** | **Required** for phone login; en-route text optional | Account SID, Auth Token, one phone number |
| 4 | **Web Push (VAPID)** | "A truck is near you" proximity alerts | Optional at launch | Generate free with `npx web-push generate-vapid-keys` — **no account needed** |
| 5 | **GHL / LeadConnector** | Booking → contacts + opportunities, and your SMS / review workflows | Needed for booking automation | Private Integration token + Location ID (+ optional Pipeline & Stage IDs) |
| 6 | **Square** | Loyalty points tied to real purchases | **Later** (V1.x) | API access + webhook signature key + each truck's Square location id |
| 7 | **Netlify** | Hosting | **Required** | You already have it — just connect the repo |
| 8 | **Cloudflare** | DNS for donutnvapp.com | **Required** | You already have it — point the domain at Netlify |

### Important: about "GPS tracking"
Capturing the truck's location uses the **phone's own GPS** through the browser —
there is **no separate GPS API and no GPS cost**. The only location-related API is
**Google Maps** (#2), used to *show* the map and compute ETAs. A hardware "puck"
(via Traccar) is only if you later want a dedicated device instead of a phone — not
required now.

**So the full set of outside things you need:** Supabase keys, one Google Maps key,
a Twilio account, a GHL token + location id, and self-generated VAPID keys. **Square
is the only thing you can defer.** That's everything.

---

## Step-by-step deploy (about 30–45 minutes)

### A. Database (5 min)
1. Supabase → **SQL Editor** → run, in order: `schema.sql`, then `seed.sql`, then `schema_bookings.sql`.

### B. Login (5 min)
2. Supabase → **Authentication → Providers** → enable **Email**.
3. Enable **Phone** and connect **Twilio** (SID, token, from-number). This is what texts the login codes.

### C. App keys (5 min)
4. Copy `.env.example` to `.env` and fill: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_MAPS_API_KEY`, `VITE_VAPID_PUBLIC_KEY`, `VITE_TENANT_SLUG=ph`.

### D. Server functions + secrets (10 min — can be done right after first deploy)
5. Install the Supabase CLI, `supabase link` to your project, then:
   ```
   supabase functions deploy ghl-sync notify-proximity send-enroute-sms square-webhook
   supabase secrets set \
     GHL_API_TOKEN=... GHL_LOCATION_ID=... \
     GOOGLE_GEOCODING_KEY=... \
     VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:party@donutnv.com \
     TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM=+1... \
     APP_BASE_URL=https://donutnvapp.com
   ```
6. Supabase → **Database → Cron** → call `notify-proximity` every minute.
7. GHL → build a workflow triggered by the `event-lead` tag (confirmations / reminders / review request). Square → point its `payment.created` webhook at the `square-webhook` URL (when you're ready for loyalty).

### E. Go live (10 min)
8. Push the `donutnvapp` folder to a GitHub repo.
9. Netlify → **Add new site → Import from Git** → pick the repo (build settings come from `netlify.toml` automatically).
10. Netlify → **Site settings → Environment variables** → add the same `VITE_…` values from your `.env`.
11. Deploy.
12. Cloudflare → point `donutnvapp.com` (and `www`) at the Netlify site (Netlify shows you the exact target). Territory paths like `/ph` work automatically.

### F. First-run smoke test
- Open the site → curtains open → **sign up** → land on the map.
- In Supabase → `profiles`, set your row's `role` to `operator` → log out/in → you get the **owner app** → try **Go Live**.
- Submit a **booking** → it appears on the **Bookings** tab.

---

## Want it live TODAY with just the core?
Minimum to launch the map + accounts + booking (skip push & Square for now):
**Supabase keys + Google Maps key + Twilio (for login) + GHL token.** Deploy, then
add VAPID (push) and Square later — they're modular and the app runs fine without them.
