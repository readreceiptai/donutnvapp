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
