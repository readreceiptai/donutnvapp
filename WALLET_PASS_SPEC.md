# DonutNV Wallet Pass — Spec & Cost (Phase 2)

The DonutNV loyalty/membership card living in **Apple Wallet** and **Google
Wallet** — the same place boarding passes and credit cards sit. Not the app, not
a text. A real branded card in the customer's wallet that can push to the lock
screen and update itself.

---

## 1. Cost — what's the all-in?

| Item | Cost | Notes |
|---|---|---|
| Apple Developer Program | **$99/yr** (+ local tax) | The one hard fee. Needed to sign Apple Wallet passes. |
| Google Wallet API | **Free** | Free issuer account; no per-pass fee. |
| Live-update service | **~$0** at our volume | Runs on existing Supabase/Netlify infra, reuses the Square webhook we already built. |
| **Build-ourselves all-in** | **≈ $99/yr** | Apple's fee is effectively the whole cost. |

**Managed alternative (optional):** a platform like **PassKit** is ~**$39.50/mo**
(~$474/yr) single-user, includes hosting + 250 passes, then ~0.5¢ per card/year
beyond. It removes Apple cert management and the need to build the update
service — convenience, not capability. Recommended only if cert upkeep becomes a
hassle or you want their console/analytics.

**Recommendation:** build it ourselves. We already run the Supabase infra and the
Square → stamp webhook, so the all-in stays at Apple's $99/yr.

---

## 2. What the card looks like

**Front**
- DonutNV logo + brand colors
- Member first name
- **Stamp progress:** "4 / 10 — 6 to a free bag 🍩" (or points balance)
- QR code (member ID) — staff scans at the truck / ties to Square

**Back**
- Home territory + "Catch us this week" link to the public schedule
- Birthday treat reminder
- Terms + unsubscribe

---

## 3. The Square → pass → push flow

1. **Add the pass.** Customer taps "Add to Wallet" from the signup confirmation
   or a QR at the truck. No app install required.
2. **Customer buys** at the truck on Square.
3. **Square fires `payment.created`** → our `square-webhook` (already live)
   matches the buyer by phone and increments their stamp/check-in.
4. **Pass updates (new step).** That same webhook calls the wallet provider to
   update the customer's pass — the stamp count bumps and an optional "You earned
   a stamp!" notification appears on their lock screen.
5. **Proximity.** When a truck goes live near a saved location, the pass surfaces
   automatically / a "We're 2 miles away 🍩" push can fire — without the app open.

The loyalty engine (steps 2–3) already exists; the wallet pass is just a new
front-end and push channel for it.

---

## 4. What you'd need to set up

**Build-ourselves route (≈ $99/yr)**
- Enroll in the **Apple Developer Program** ($99/yr) → create a Pass Type ID +
  signing certificate.
- Create a **Google Wallet API issuer account** (free) → request publishing
  access (new accounts start in demo mode).
- I build a **pass-update Edge Function** + a `passes` table mapping each member
  to their pass serial / auth token, and hook it into the existing Square webhook.
- I add **"Add to Wallet"** buttons to the signup-success and Account screens.

**Managed route (PassKit, ~$39.50/mo)**
- Create a PassKit account → design the pass in their console.
- I wire our Square webhook to their API. No Apple certificate handling.

---

## 5. Why this is sequenced as Phase 2

High value, but it needs real external accounts (Apple Developer + Google issuer)
and a small always-on update service — more setup than the launch-critical pieces
that no-op gracefully until keys are added. Worth doing soon after launch because
the lock-screen "we're nearby" push is the strongest re-engagement lever for a
truck that moves.

---

*Pricing verified June 2026: Apple Developer Program $99/yr; Google Wallet API
free; PassKit platform fee from $39.50/mo.*
