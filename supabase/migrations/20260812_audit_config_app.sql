-- =====================================================================
-- Audit snapshot: APP configuration surface (app_config + pg_net)
-- Project: APP  (cfghtxfplkodjnndzmcf)
-- Captured: 2026-08-12
--
-- Current-state reconstruction of the config plumbing that today's
-- spend-alert-sms and hardened demo-checkin edge functions depend on.
--
-- SECURITY NOTE: the VALUES stored in public.app_config are intentionally
-- NOT included here. They contain a spend-alert shared secret and a demo
-- check-in key. Those values live only in the database, never in the repo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SECTION 1: EXTENSIONS
-- pg_net is used by server-side functions to POST to edge functions
-- (e.g. the spend-alert SMS sender).
-- ---------------------------------------------------------------------
create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- SECTION 2: TABLE  public.app_config
-- Simple key/value store for server-side config + secrets. RLS enabled
-- (no policies -> reachable only via service_role / SECURITY DEFINER).
-- ---------------------------------------------------------------------
create table if not exists public.app_config (
  key         text        primary key,
  value       text,
  updated_at  timestamptz not null default now()
);
alter table public.app_config enable row level security;

-- ---------------------------------------------------------------------
-- SECTION 3: REQUIRED KEYS  (values NOT stored in the repo)
-- The following keys must exist in public.app_config for the edge
-- functions to work. Set their values directly in the database only:
--
--   spend_alert_to       -- SMS recipient phone number for spend alerts
--   spend_alert_secret   -- shared secret guarding the spend-alert-sms function
--   demo_checkin_key     -- rotatable key required by the demo-checkin helper
--   demo_checkin_emails  -- comma-separated allowlist of demo account emails
--
-- Do NOT commit the values of these keys. They are secrets/config that
-- live exclusively in the app_config table in the APP database.
-- Example (run manually against the DB, with real values):
--   -- insert into public.app_config (key, value) values ('spend_alert_to', '<redacted>')
--   --   on conflict (key) do update set value = excluded.value, updated_at = now();
-- ---------------------------------------------------------------------
