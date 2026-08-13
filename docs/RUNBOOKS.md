# Runbooks

Operational procedures. See also the standalone **"DonutNV — Backups & Restore Runbook.md"** on Kevin's Desktop for the full backup/restore detail.

## Deploy to production

1. Make + test changes in the repo. Syntax-check changed JSX fast with esbuild if unsure (sandbox node_modules are macOS-arch, so a full local `vite build` won't run — Netlify builds on its own infra).
2. Netlify MCP `deploy-site` with siteId `fa9c6458-c03f-4dac-b6b2-525a1882286d` → returns an `npx @netlify/mcp@latest --site-id ... --proxy-path "..."` command.
3. Run it from the repo root. It uploads the repo, builds on Netlify, and waits. "Deploy is ready" = live at donutnvapp.com.
4. Commit the change locally. **Kevin pushes from the Mac.**

**Env vars:** live on Netlify (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, etc.), not a local .env. If the app says "not connected to Supabase," they're missing — set them **sequentially** via the Netlify env-vars tool and verify (a parallel batch once silently failed to persist).

## Confirm a franchisee (unlock paid ELLE spend)

`select public.elle_set_paid_enabled('<tenant_uuid>', true);` on the ELLE project. This lets the weekly paid jobs run for them and auto-clears their EXAMPLE leads. To pause spend again, pass `false`.

Get a tenant id: `select id, franchise_name from elle_tenants order by created_at;`

## Spend emergencies

- **Stop ALL paid spend immediately (kill switch):** on ELLE, `update elle_spend_caps set enabled=false where cap_key='global';`. Re-enable with `true`.
- **Stop one service:** set `enabled=false` for `cap_key` in ('apollo','apify','llm','geocoding').
- **Adjust a cap:** `update elle_spend_caps set monthly_usd=<n> where cap_key='<key>';`.
- **See spend:** `select * from elle_spend_rollup;` and `select * from elle_spend_by_service;`.
- Alerts fire at 80% and breach into `elle_spend_alerts` (SMS delivery pending Twilio).

## Backups / restore (summary)

Full detail: "DonutNV — Backups & Restore Runbook.md" (Desktop). Key points:
- Confirm the Supabase **plan** first: Free = no backups (upgrade to Pro). Pro = free 7-day daily backups.
- Enable **PITR** on the APP project (loyalty/booking/sales data) — Settings → Add-ons → PITR (needs Small compute add-on). ~$115/mo all-in for 7-day.
- Backups are DB-only: **separately back up edge-function secrets** (Twilio/Square keys, service-role keys, `elle_service_role_key`, Turnstile) to 1Password; Storage objects; and keep the git repo pushed.
- Safest restore = "Restore to a New Project" (non-destructive). Disable `pg_cron`/`pg_net` on any clone so its jobs don't fire.

## Git in this sandbox

Commits are local; **Kevin pushes from the Mac.** Stale `.git/*.lock` files can block commits and the sandbox can't `unlink` — work around by renaming: `mv .git/HEAD.lock aside`. Expect harmless `tmp_obj ... Operation not permitted` warnings. Run `git gc` on the Mac to tidy.

## Multi-statement SQL via Supabase MCP

`execute_sql` returns **only the last statement's result**. Combine reads into one SELECT, or run steps in separate calls. `do $$ ... raise notice $$` output is NOT returned — capture into a returned SELECT instead.
