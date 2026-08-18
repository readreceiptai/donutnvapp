# Store Submission — Background Location Justification & Privacy Labels

**For: Apple App Store review + Google Play review of the DonutNV native app
(Option B, live proximity push). Draft prepared 2026-08-17 on branch
`feature/proximity-push`. Submit only after activation (ROADMAP #63-69).**

Every claim in this document is backed by shipped code on this branch. Do not
edit the claims without editing the code, and vice versa — reviewers install
the app and check that it behaves the way the submission says it does.

---

## 1. The feature, as a reviewer will see it

DonutNV is a food-truck loyalty app. Customers can opt in to a single
notification when a DonutNV truck is actively serving within a distance they
choose (2, 5, or 10 miles). Trucks move constantly and go on/off service
throughout the day, so the only way to deliver this is for the app to know,
approximately and infrequently, where the customer is — including when the app
is closed. That is the entire use of background location.

## 2. Core justification narrative (both stores)

> DonutNV operates a fleet of food trucks that change location throughout the
> day. Customers ask us one question more than any other: "where is the truck
> right now, and why didn't I know it was near me?" The app lets a customer
> opt in to be notified when a truck is actively serving within a radius they
> choose. Because the trucks move (up to ~100 trucks across territories, many
> serving several stops per day), this cannot be implemented with on-device
> geofencing: iOS monitors at most 20 regions per app and Android has similar
> practical limits, while our geofences are moving targets. Instead, the app
> reports coarse, infrequent position updates (significant-change, ~500 m
> granularity, batched) to our backend, which performs the proximity match
> server-side and sends at most a capped number of notifications.
>
> Background location is strictly opt-in and off by default. It is presented
> to the user with a full-screen explanation before any OS permission prompt.
> Location data is visible only to the customer it belongs to (enforced by
> database row-level security; even our own staff and franchise operators
> cannot read it), position history is deleted after 24 hours, and the entire
> feature sits behind a server-side kill switch. Turning the feature off in
> the app stops collection immediately, including on the server side, which
> rejects position reports from any account that has not opted in.

## 3. Why on-device geofencing is not feasible (anticipated reviewer question)

- iOS region monitoring is capped at **20 regions per app**. We have up to
  ~100 trucks, each of which is itself a moving geofence.
- Geofences would need to be re-registered every time any truck moves — from
  the background, on every customer device, continuously. That is strictly
  worse for battery and privacy than one coarse position report per ~500 m of
  customer movement.
- The server-side design also lets us enforce quiet hours, frequency caps,
  and per-franchise controls in one audited place, which on-device logic
  cannot guarantee.

## 4. What the app actually collects and does (evidence-backed)

| Claim in this doc | Where it is enforced in code |
|---|---|
| Off by default; opt-in required | `proximity_prefs.enabled` defaults `false`; server RPC `ingest_customer_position` rejects writes for any profile not opted in |
| Two-step consent; OS prompt only after in-app explanation | `src/components/ProximityAlerts.jsx` priming flow |
| Coarse + infrequent, not continuous GPS | 500 m distance filter, batched uploads (`src/lib/location/config.js`); fixes with accuracy worse than 5 km rejected server-side |
| Own-row-only visibility | RLS `enable` + `force` on `customer_positions` / `customer_latest_position`; SELECT policy is `profile_id = auth.uid()`; **no operator, admin, or superadmin read path**; zero `anon` grants |
| 24-hour retention of position history | `prune_customer_positions(24)` nightly cron; only a single current position row is kept while opted in |
| Notification caps | Rolling 24 h daily cap (default 2) + minimum gap (default 6 h) + once per truck-session dedupe, enforced in SQL (`match_proximity_candidates`) |
| Quiet hours | 9 pm – 9 am default, evaluated in the customer's own timezone, server-side |
| Instant off switch | Toggle in Account; flips the DB flag, which also blocks server-side ingest; plus a global kill switch and per-franchise toggles |
| Deleting the account deletes the data | All six tables FK to `profiles` with `on delete cascade` |
| No sale, no sharing, no ad use | Coordinates go only to our backend (Supabase). Push delivery uses APNs/FCM as transport; **coordinates are never included in notification payloads** (only a human-readable distance string) |

## 5. Apple App Store

### 5.1 Info.plist purpose strings (paste-ready)

These are customer-facing: plain language, no emoji, no em dashes.

- **NSLocationWhenInUseUsageDescription**
  `DonutNV uses your location to show trucks near you on the map and to tell you when a truck is close.`
- **NSLocationAlwaysAndWhenInUseUsageDescription**
  `Allow location all the time so DonutNV can send you one alert when a truck is serving near you, even when the app is closed. We check your area only when you move, we never share your location, and we delete the trail every day.`
- **UIBackgroundModes**: `location`, `remote-notification`

### 5.2 App Review notes (paste into the review notes field)

> This app uses background location for exactly one user-facing feature:
> an opt-in alert when a DonutNV food truck is actively serving within a
> user-chosen radius (2/5/10 miles). The feature is OFF by default and is
> explained in-app before the system permission prompt appears
> (Account tab > "Know when a truck is close").
>
> Why background location instead of region monitoring: our geofences are
> ~100 food trucks that move throughout the day, which exceeds the 20-region
> monitoring limit and cannot be expressed as static regions. The app uses
> significant-change-style updates (approx. 500 m granularity, batched) and
> never continuous GPS.
>
> Privacy safeguards, all server-enforced: location is visible only to the
> account it belongs to (row-level security; our staff and franchise
> operators have no read access), history is deleted after 24 hours,
> notifications are capped (default max 2 per day, none 9 pm-9 am local),
> and disabling the toggle stops collection immediately, server-side
> included.
>
> To test: sign in with the demo account below, open Account, enable
> "Tell me when a truck is nearby", and accept the location prompts. A test
> truck can be put into a live session near the demo account's location on
> request. Demo credentials: [FILL IN before submission]

### 5.3 Privacy nutrition labels (App Privacy section)

App-wide labels; rows marked **(Option B)** are the ones this feature adds.
Merge with the existing app answers, do not replace them.

| Data type | Collected? | Linked to identity? | Used for tracking? | Purposes |
|---|---|---|---|---|
| Precise Location **(Option B)** | Yes | Yes | **No** | App Functionality |
| Coarse Location **(Option B)** | Yes | Yes | No | App Functionality |
| Name | Yes | Yes | No | App Functionality |
| Email Address | Yes | Yes | No | App Functionality |
| Phone Number | Yes | Yes | No | App Functionality |
| Purchase History (loyalty) | Yes | Yes | No | App Functionality |
| Device ID (push token) **(Option B)** | Yes | Yes | No | App Functionality |
| Product Interaction (notification opens) **(Option B)** | Yes | Yes | No | Analytics (first-party only) |

"Used for tracking" is Apple's term for cross-company advertising/data-broker
sharing. We do none, so every row is **No**. There is no third-party
analytics or advertising SDK in the app.

### 5.4 Expected pushback and the answer

Apple sometimes rejects "Always" location tied to marketing. The answer, all
true: this is a **user-requested utility alert**, configured by the customer
(radius, on/off), off by default, hard-capped in frequency, silent at night,
and it delivers the app's core promise ("find the truck"). It is not a
broadcast marketing channel: a franchisee cannot send free-form pushes
through it, cannot choose recipients, and cannot read anyone's location.
The message content is generated server-side from truck status only.

## 6. Google Play

### 6.1 Location permissions declaration (Play Console form)

- Permissions requested: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
  `ACCESS_BACKGROUND_LOCATION`, `POST_NOTIFICATIONS` (plus the foreground
  service type `location` used by the plugin's tracking notification).
- Core feature served: "Notify the user when a DonutNV food truck is
  actively serving within a user-chosen distance, while the app is closed."
- Why a foreground service/background access is required: the alert is only
  valuable when the app is NOT open; the trucks are moving targets, so
  static geofences cannot express the feature.

### 6.2 Prominent disclosure (must appear in-app BEFORE the runtime prompt)

Play policy requires an explicit disclosure screen with specific elements.
Our priming screen (`ProximityAlerts.jsx`) already carries most of this; the
paste-ready compliant copy is below. Customer-facing: no emoji, no em dashes.

> **DonutNV collects location data to let you know when a truck is serving
> near you, even when the app is closed or not in use.**
>
> We only check whether you are within your chosen distance of an active
> truck. Your location is never shared with anyone, is not used for ads, and
> your location history is deleted every 24 hours. You can turn this off any
> time in Account.
>
> [Agree and continue]   [No thanks]

(The bolded first sentence intentionally follows Play's required formula:
"This app collects location data to [feature], even when the app is closed
or not in use.")

### 6.3 Review video (Play requires one for background location)

Record a screen capture, under 30 seconds, showing in order:
1. The in-app prominent disclosure screen (above), then tapping Agree.
2. The system location permission flow, including "Allow all the time".
3. The feature working or clearly represented (Account screen showing
   "You are all set. We will let you know when a truck is within 5 miles.").
Upload it in the Play Console declaration; also link it in review notes.

### 6.4 Data safety form

| Question | Answer |
|---|---|
| Does the app collect or share user data? | Collects: yes. Shares: **no** |
| Location: approximate + precise | Collected, **not shared**, optional (user can decline the feature), collected only with the feature enabled |
| Purpose (location) | App functionality |
| Ephemeral? | History auto-deleted after 24 h; one current position retained while opted in |
| Personal info (name, email, phone) | Collected, not shared, app functionality |
| Financial info | Purchase history via loyalty program, not shared |
| Device or other IDs (push token) | Collected, not shared, app functionality |
| Data encrypted in transit? | Yes (HTTPS/TLS throughout) |
| Can users request deletion? | Yes; account deletion cascades to all location and notification data |
| Independent security review? | No (answer honestly) |

## 7. User-facing privacy policy paragraph (add to the policy page)

> **Truck-nearby alerts.** If you turn on truck alerts, the DonutNV app
> periodically sends your approximate location to our servers so we can tell
> you when a truck is serving within the distance you chose. This is off
> unless you turn it on. Your location is visible only to you: DonutNV staff
> and franchise owners cannot see it. We keep your location history for 24
> hours and then delete it automatically. We never sell or share your
> location, and we do not use it for advertising. Turning alerts off in the
> Account tab stops collection immediately, and deleting your account
> deletes this data entirely.

## 8. Pre-submission checklist

- [ ] Purpose strings from 5.1 in the iOS project; background modes set.
- [ ] Prominent disclosure copy from 6.2 wired as the priming screen text
      (ours is close; align the first sentence exactly).
- [ ] Demo account + on-request live test truck ready; fill credentials into
      the App Review notes (5.2). Never ship demo accounts in prod config.
- [ ] Play review video recorded per 6.3.
- [ ] Privacy policy updated with section 7 and reachable from the store
      listings and inside the app.
- [ ] Verify claims still match code: retention hours, caps, quiet hours,
      radius options, RLS posture (rerun the inertness/security queries in
      `docs/PROXIMITY-PUSH.md`).
- [ ] Both store forms answered from sections 5.3 / 6.4 verbatim.
