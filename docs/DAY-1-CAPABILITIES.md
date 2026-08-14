# DonutNV — What a Franchisee Gets, and When

*The honest day-1 capability map. Use this to onboard responsibly, to build the deck, and to answer "what's real?" without over-promising. Last updated: 2026-08-14.*

A franchisee ("Z") experiences two products: **The Window** (their branded customer app) and **ELLE** (their lead engine). Here is what is real on day one, what lands in the first weeks, and what is genuinely later.

---

## Prerequisites for a real "Day 1" (per owner — quick but non-negotiable)

An owner only gets value once these are true. They're fast, but "day 1" doesn't happen without them:

1. **Their owned ZIPs are loaded** into the territory registry. Without it, ELLE has nothing to search and the territory guard blocks real leads. (Needs the current, accurate ZIP-to-owner map from corporate.)
2. **Confirm switch flipped on** — unlocks paid discovery and auto-kicks their cold-load.
3. **LeadConnector token connected** — the one manual step the owner does themselves.
4. **(Customer signups) custom SMTP configured** — otherwise new customers on The Window may not receive their confirmation/reset emails. This is the single biggest real day-1 gap right now.

---

## DAY 1 — live the moment they're confirmed

**The Window (customer app):**
- Branded customer app: live find-the-truck map, "truck near you" proximity alerts, loyalty stamp cards, donut passport, add-to-wallet pass, games hub, in-app feedback + help.
- Book-A-Truck and Fundraiser requests flow straight into their LeadConnector, routed by ZIP.
- Square sale automatically stamps the customer's loyalty card (atomic — can't lose or double a stamp).

**ELLE (lead engine):**
- A populated board from minute one: a free "example" board on creation so it's never empty, replaced by their real leads the moment they're confirmed.
- Cold-load on confirm: a hyper-local **market report** plus the **first wave of real event, business, and non-profit leads** across their ZIPs, scored A–F.
- **Business contacts** enriched on confirm; event-host and LinkedIn/press contacts fill in over the first days.
- Leads push to their LeadConnector; New / Working / Done lifecycle, "bad info" flag, recurring/recycle.
- One-button onboarding, with spend fully governed (per-service caps + master kill switch) so cost is controlled from the first dollar.

---

## WEEK 1–2 — comes online shortly after

- Weekly lead **waves** (automatic discovery + enrichment on a schedule).
- Deadline fast-lane for time-sensitive events; recurring rebook.
- Per-client **cost visibility** (estimated at launch; exact per-call actuals shortly after).
- Onboarding **audit/health checks** confirming everything fired correctly.

---

## LATER — real, but not yet

- **SMS**: en-route texts to customers + spend alerts. Needs Twilio + carrier **A2P registration (~1–3 weeks lead time)**. Start this now if it's in the pitch.
- **Out-of-bounds lead routing** to the nearest owner + fair distribution (corporate's priority). Needs the full territory map + a build.
- Durable job queue for very large scrapes; error monitoring (Sentry); point-in-time backups.
- Native App Store app; design/UX polish; more in-app games.

---

## Honest risk flags — fix before onboarding the relevant group

- **Consumer email deliverability (SMTP)** — before onboarding customers on The Window.
- **Territory ZIPs per owner** — before onboarding that owner to ELLE.
- **Twilio / A2P** — before promising any SMS feature to anyone.
- **Backups (PITR)** — before real data volume.

---

## The one-line version for the room

> "On day one, an owner gets a live, branded customer app and a lead board showing their real, scored local leads and contacts, flowing into the tools they already use. The heavier automation and text messaging come online over the following couple of weeks."

That sentence is true today. It's confident without writing a check you can't cash.
