# DonutNV — Independent Review Findings (synthesized)

> **BETA-GATE RE-VERIFICATION — 2026-08-25** (live re-test, not eyeballed). All Critical + High re-checked against live `main`.
> - **C1** superadmin escalation — was **PARTIALLY OPEN** (INSERT vector); **NOW FIXED** (guard fires on INSERT OR UPDATE; verified-owner only). Re-tested: attacker insert/update → is_superadmin stays false, verified owner → true.
> - **C2** preview console — **FIXED**: `VITE_PREVIEW_MODE` absent from all Netlify contexts + hard prod-domain guard added; `/admin`, `/admin/customers`, `/elle` redirect to landing in the prod bundle.
> - **H1** `route_booking()` IDOR — was **STILL OPEN** (EXECUTE to PUBLIC on live); **NOW FIXED** (revoked; anon direct call denied; `submit_booking` still routes).
> - **H2** operator-owns-booking — **FIXED** (both fns enforce `operatorOfTenant`; no-auth → 401).
> - **H3** deposit amount — **FIXED** (`process_square_sale` requires `amount >= deposit_amount_cents` + USD; re-tested underpay→pending, correct→paid).
> - **H4** auth loading race — **FIXED** (AuthContext re-enters loading; App routes `session && !profile` → NeedsSetup).
> - **H5** COPPA/validation — parent email now persisted (**FIXED**); ZIP/phone validation **NOW FIXED** (`/^\d{5}$/` + 10–11 digits).
> - **H6** partial writes — **FIXED** (single atomic `complete_signup` RPC).
> - **H7** `/welcome` 404 — **FIXED** (no `/welcome` refs remain).
> Fixes this pass: migrations `20260825_fix_c1_superadmin_insert_guard`, `20260825_fix_h1_route_booking_revoke` (+ column revoke); frontend C2 domain guard + H5 validation.



Two independent reviewers (fresh context, no memory of the build) + Supabase's
automated advisors. Prioritized and de-duplicated. Each item has location + fix.
Compare this against the Claude Code report.

---

## 🔴 CRITICAL — fix before anything else

### C1. Superadmin privilege escalation via attacker-controlled `profiles.email`
**Where:** `supabase/schema_superadmin.sql` (auto_superadmin trigger) + `src/pages/SignUp.jsx`
**Problem:** the `auto_superadmin` trigger flips `is_superadmin = true` whenever the **`profiles.email` column** equals `k.deans@mac.com`. That column is written by the client during signup — it is NOT the cryptographically verified `auth.users.email`. So anyone can sign up with their own email, then set `profiles.email = 'k.deans@mac.com'` in the upsert and become platform god-mode across every tenant. Nothing currently stops a user from setting `is_superadmin` on their own row either.
**Fix:** (a) in the trigger, compare against the verified identity: `(select email from auth.users where id = new.id)`, not `new.email`; (b) add a guard so a normal authenticated user can never raise their own `is_superadmin` (only the service role or the verified-identity branch can). *(This is a bug I introduced this session — trivially exploitable, highest priority.)*

### C2. Preview mode can expose the entire operator console with no auth
**Where:** `.env` (`VITE_PREVIEW_MODE=1`) + `src/App.jsx`
**Problem:** when preview is on, App.jsx mounts every screen (`/admin`, `/admin/customers`, `/elle`, …) with no session/role check. It's intentionally on for the staging tour, but if that value reaches the production Netlify build, anyone can open the franchisee back office. (RLS still blocks the *data*, so lists come back empty, but the operator UI, buttons, and site map are all reachable.) Already on the launch checklist (#57) — flagging because both the reviewer and the launch gate agree it's critical.
**Fix:** gate preview so it can never be true in a production build (e.g. require `import.meta.env.DEV`), and ensure `VITE_PREVIEW_MODE` is absent from production env before the donutnvapp.com cutover.

---

## 🟠 HIGH

### H1. `route_booking()` is anon-callable — IDOR on bookings
**Where:** `supabase/schema_territory.sql`
**Problem:** `SECURITY DEFINER`, granted to `anon`, takes any `booking_id`, and re-routes/reassigns the booking and the customer's `owner_tenant_id` with no authorization. Reachable by anyone with the anon key.
**Fix:** revoke `anon`; call it server-side (from `ghl-sync`) or gate it (verify the booking's `tracking_token`, or `is_operator()` + tenant match).

### H2. `square-deposit` and `send-enroute-sms` don't verify the caller owns the booking
**Where:** `supabase/functions/square-deposit/index.ts`, `.../send-enroute-sms/index.ts`
**Problem:** they require *a* valid JWT but not that the caller is an operator of that booking's tenant. Any authenticated customer who knows a `booking_id` could trigger an SMS to that contact or generate a Square deposit link. (Front-end only exposes these on operator screens, but the functions don't enforce it.)
**Fix:** inside each function, confirm the caller is an operator of the booking's tenant before acting.

### H3. `square-webhook` marks a deposit paid without checking the amount
**Where:** `supabase/functions/square-webhook/index.ts`
**Problem:** a matching COMPLETED payment flips `deposit_status='paid'` regardless of amount, so a $1 payment marks the deposit fully paid. (Signature verification does block forged events, so severity is bounded.)
**Fix:** compare `amount_money.amount` to `bookings.deposit_amount_cents` (allow ≥) and confirm currency before marking paid.

### H4. Auth loading race — operator briefly lands in the customer app after login
**Where:** `src/context/AuthContext.jsx`, `src/pages/Login.jsx`
**Problem:** `loading` is only set false once after initial session; `onAuthStateChange` reloads the profile without re-entering loading, so right after login `session` is true while `profile` is still null — App routes the user into the customer shell for a render or two. `Login.jsx` (plain customer login) doesn't `reloadProfile`, so it's the rawest case.
**Fix:** set loading during profile reload (or have App show the Loading fallback whenever `session && !profile`).

### H5. SignUp: COPPA parent linkage never saved + weak validation
**Where:** `src/pages/SignUp.jsx`
**Problem:** the under-13 flow requires a `parentEmail` but never writes it or sets `parent_profile_id` — the minor account is created with no parental linkage, despite the stated COPPA intent. ZIP (`maxLength=5` only) and phone are unvalidated, so junk gets stored and powers alerts.
**Fix:** persist the parent linkage (or block minor signup pending approval); validate ZIP `/^\d{5}$/` and phone (10–11 digits).

### H6. SignUp does partial writes with no rollback
**Where:** `src/pages/SignUp.jsx`
**Problem:** after OTP verify it does profile upsert (checked) then consents + saved_areas inserts (**unchecked**). If consents fails, the user is logged in with no consent records — the exact legal paper trail the code intends to keep.
**Fix:** move the post-signup writes into one transactional RPC, or check each error and surface/log failures.

### H7. `/welcome` route doesn't exist — "← Back" links 404 → bounce to landing
**Where:** `src/pages/SignUp.jsx`, `Login.jsx` link to `/welcome`; `Welcome.jsx` is never routed.
**Fix:** add the route (and import `Welcome`) or point Back links to `/`; delete `Welcome.jsx` if unused.

---

> **#122 MEDIUM/LOW SECURITY SWEEP — 2026-08-25** (non-beta-gating). Status of the security-bearing items:
> - **M2** `get_event_tracking` PII/no-expiry — **FIXED**: link now expires ~2 days after the event + stops for cancelled bookings. Re-tested (rolled back): today→data, 5-days-old→NULL, cancelled→NULL. Migration `20260825_fix_122_get_event_tracking_expiry`.
> - **M7** trigger-order fragility on `profiles` — **MITIGATED** (no change needed): after the C1 fix, `auto_superadmin` and `profiles_superadmin_guard` are both identity-checked (verified `auth.email()`), so elevation is blocked regardless of firing order. Left as-is to avoid re-ordering live triggers.
> - **M8** Google Maps key lockdown — **ALREADY DONE** (web key referrer-locked to donutnvapp.com; native key API+quota-scoped) + added `loading=async`. Deprecated `google.maps.Marker`→`AdvancedMarkerElement` migration still open (cosmetic, non-security).
> - **Low** `wallet_passes.auth_token` client-readable — **FIXED**: revoked table SELECT + re-granted all columns except `auth_token`. Re-tested: unreadable by authenticated/anon, service_role unaffected. Migration `20260825_fix_122_wallet_passes_hide_auth_token`.
> - **Low** Sentry-from-CDN — **ALREADY DONE** (bundled `@sentry/react`).
> - **M1** server-side bot enforcement — **OPEN, needs a decision**: Turnstile is verified server-side (`verify-turnstile`) but decoupled from the action; `submit_booking` is anon-callable and `signInWithOtp` is direct, so a bot can skip the check. Fix = booking edge-wrapper (verify token → call RPC as service_role, revoke anon execute) + enable native CAPTCHA in Supabase Auth for OTP. Changes the public booking/auth path — awaiting go-ahead.
> - Reliability items (**M3** tenant-load error handling, **M4** TrackEvent polling, **M5** PWA scope, **M6** unmount/alive guards) are not security — deferred to a separate pass.

## 🟡 MEDIUM

- **Bot protection is client-only / currently off.** Honeypot + Turnstile run only in React; a script posting straight to Supabase skips them, and `passesTurnstile` returns true when Turnstile isn't configured (it isn't yet). Enforce the token server-side for `bookings`/signup. *(`src/lib/antibot.js`, `Turnstile.jsx`)*
- **`get_event_tracking` leaks event PII to any token holder; token never expires.** Returns contact name, event details, notes, location, coupon — indefinitely. Add expiry/terminal-status check. *(`schema_event_journey.sql`)*
- **Tenant load has no error/empty handling.** If the territory slug doesn't match or the request errors, `tenant` stays null forever, brand never applies, no signal. Add error state + fallback + monitoring. *(`AuthContext.jsx`)*
- **TrackEvent polls every 15s forever**, even when completed/backgrounded, and a transient error flips it to "not found" permanently. Stop on terminal status, pause on `document.hidden`, retry transient errors. *(`TrackEvent.jsx`)*
- **PWA caching vs multi-territory.** `start_url:'/'`/`autoUpdate` can serve a stale shell across territories and silently swap the SW mid-broadcast for an operator. Set scope/start_url per deploy; consider `registerType:'prompt'`. *(`vite.config.js`)*
- **Fetches set state after unmount / no error UI.** Most effects are fire-and-forget `.then(setState)` (only Schedule guards). Failed fetches read as "empty" not "error." Add `alive` guards + error states; roll back the optimistic consent toggle in `Account.jsx`. 
- **Trigger-order fragility on `profiles`.** Two BEFORE triggers fire alphabetically; don't rely on naming for security — consolidate role + superadmin guarding. *(see C1)*
- **Lock down the Google Maps browser key** with HTTP-referrer + API restrictions in Google Cloud (it's public-by-design in the bundle, but must be restricted to avoid billing abuse). Also add `&loading=async` and migrate off the deprecated `google.maps.Marker`.

---

## 🟢 LOW / hygiene

- Repo root has cruft: `dist/` on disk (contains a preview-enabled bundle), two ~2.6MB `donutnv-staging*.zip`, a stray `ziQWxk1u`, empty `__wtest`, six `vite.config.js.timestamp-*.mjs`. Clean up; verify the zips contain no `.env`/preview bundle.
- `reloadProfile()` uses a possibly-stale `session` closure → pass the uid explicitly.
- Sentry loads from `esm.sh` CDN at runtime (supply-chain/availability risk in the error path) — bundle `@sentry/react` instead. Low: gated off until DSN set (now set).
- `wallet_passes.auth_token` is client-readable by the pass owner — expose via a view that omits it.
- Minor: duplicated geocode logic in `Bookings.jsx`; `computeAge` `isNaN(Date)`; `Rewards` campaign query relies on RLS (add explicit tenant filter for clarity); `AdminHome` lives outside `pages/operator/`.

---

## ✅ What's solid (independently confirmed)
- **RLS coverage is good** — every reviewed table has RLS + a policy; no cross-tenant read/write for an ordinary customer/operator **except** via C1 and H1. The RLS hardening correctly scopes operators to their own tenant; corporate metrics are admin-gated.
- **Square webhook HMAC verification is correct and fail-closed** (constant-time compare, raw body, configured URL).
- **No server secret is exposed to the client** — only public values live on `VITE_` vars (anon key, Maps browser key, VAPID public, Turnstile *site* key, Sentry DSN). Service-role/Square/GHL/ELLE keys are Edge-Function-only.
- **Code-splitting is correct** — operator/ELLE chunks are separate; customers don't download them. **Production build compiles clean** (no warnings).
- **GoLive is well-built** — default-off, auto-expire, geofence suppression, wake-lock re-acquire, GPS-error handling. No bugs found.
