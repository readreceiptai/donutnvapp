# The Window — Customer App

The branded, white-labeled customer app. Runs on the APP Supabase project (`cfghtxfplkodjnndzmcf`). Colors do NOT change per the brand rule; each tenant's brand is applied at runtime from `tenant.brand`.

## Tabs / pages (customer, in `AppShell`)

- **Find** (`/`, `src/pages/Find.jsx`) — live find-the-truck map, proximity "truck near you" alerts, spinning-donut live marker. (Demo mode forces Ocala geography + a demo truck — never ship demo hacks to real prod.)
- **Rewards** (`/rewards`) — loyalty: stamp cards, donut passport, free-bag rewards, wallet pass. (ROADMAP #61: add a frontend tenant filter as defense-in-depth; RLS already covers it.)
- **Games** (`/games`, `src/pages/Games.jsx`) — games hub (Guess the Bucket playable + roadmap tiles), rewards tie-in.
- **Book** (`/book`, `src/pages/Book.jsx` → `BookTruck.jsx` / `Fundraise.jsx`) — Book-A-Truck. Split path: corporate/private → standard form; schools/non-profits → fundraiser path.
- **Account** (`/account`) — profile management. Log out is in the top bar.

## Operator app (`OperatorShell`, `/admin/*`)

Home dashboard (KPIs, kill switch to stop a broadcasting truck), Go Live, Bookings, Schedule, Games/Campaigns, Reviews, Customers/export, Corporate dashboard. Superadmin also sees Unrouted Leads, Franchise Leads, and **Tester feedback** (`/admin/feedback`). "ELLE — My Events" links to `/elle`.

## Booking flow + the login gate

- `BookTruck.jsx` submits via the **`submit_booking`** RPC → routes to the app-active franchisee by event ZIP → returns id + tracking token → pushed to GHL/LeadConnector via `ghl-sync` (speed-to-lead).
- **Login + complete-profile gate (shipped):** a signed-in account is required before a Book-A-Truck request submits (keeps pilot leads clean/attributable). DEMO mode bypasses it so on-camera demos flow. On submit, the customer's profile is auto-completed from the form.
- Public-launch note: the login wall may reduce cold bookings from people without accounts. Right for the pilot; revisit for public launch (e.g., allow a lightweight guest path). See `docs/DECISIONS.md`.

## Loyalty / Square

- Square sales hit `square-webhook` → `process_square_sale` (atomic): counts the sale, matches the buyer by phone, stamps their card, flags the wallet pass for push. Idempotent via `processed_square_events`.
- Twilio (en-route SMS, alerts) is **not yet configured** — ROADMAP #53 / #35.

## In-app feedback + support (shipped)

- `FeedbackButton` (floating "Feedback") mounts in The Window, the operator app, and ELLE. Role-aware (customer vs franchisee). Writes to the `feedback` table with page context. Includes a Help tab (role-aware FAQ + "Email support" → `kevin@donutnv.com`, adjustable).
- Kevin reviews submissions at `/admin/feedback` (triage new → seen → resolved).

## Auth / email

- Auth is Supabase. **Custom SMTP is not yet set up** (ROADMAP #34) — default email is rate-limited (~30 new signups/hr) and can land in spam. This is the top thing to fix before onboarding real testers who must receive confirmation/reset emails.

## Maps cost controls + Rewards page (deployed to prod 2026-08-18, commit c0bcf2a)

- **Landing after login is `/rewards`, not the map.** `/` redirects to `/rewards`; the Find map lives at `/find`. Bottom tab bar order is unchanged (the Find tab points at `/find`). Reason: every Find mount is a billable Google Maps load; landing there meant one per login for customers who only came to check their card.
- **Find map is lazy.** Nothing from Google Maps is requested on mount. The page renders the truck list + "See where we'll be this week" by default and mounts the map only on the **Show map** button. "Show me the fastest way" auto-shows the map first and waits for it before drawing the route. Verified in a real browser on the exact deployed bundle: fresh `/find` = 0 Maps script tags / `google.maps` undefined / 0 requests; after tap = loaded. **The demo build (`VITE_DEMO=1`) keeps map-first**, because the demo's opening beat is the spinning pin.
- **Rewards page:** "BACK OF PASS" heading removed (card + rows kept). New **Invite friends** block: referral QR generated locally with the `qrcode` package (data URL, no network) encoding `https://donutnvapp.com/r/<referral_code>`, the same URL the wallet pass encodes; code displayed; **Share** uses the Web Share API with a clipboard fallback; copy is generic ("Share your code and earn rewards when friends join") pending the reward value. Wallet buttons are now official-style **Add to Apple Wallet / Add to Google Wallet** badges (`src/components/WalletBadges.jsx`, inline SVG; do not recolor or restyle).
- **Push tap-through** (`proximity-dispatch`) now targets `/find` since `/` is Rewards.
- **Prod build rule:** the web bundle must carry only the referrer-locked web Maps key. Build for Netlify with `VITE_GOOGLE_MAPS_NATIVE_KEY` unset (it is only in the local `.env` for native builds); verify with `grep -oh "AIza[0-9A-Za-z_-]\{35\}" dist/assets/index-*.js | sort -u` before `netlify deploy`.
