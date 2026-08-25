-- APP project (cfghtxfplkodjnndzmcf). MotoWatchdog puck live-tracking.
--
-- Design note: the handoff doc's starter code upserts `truck_latest_location`,
-- but that is a VIEW (distinct-on over truck_locations). The real write path —
-- and the one the customer map already reads — is: insert a truck_locations row
-- and keep a rolling PUBLIC live_session open, exactly like the puck-ingest
-- function. So MotoWatchdog positions flow through the same pipeline as any puck.

-- 1) Device registry: map a MotoWatchdog external_id -> one of our trucks.
--    We set each puck's external_id = this value at registration, so every
--    inbound webhook is self-identifying. Reusing `trucks` (not a new table)
--    because truck_locations + live_sessions already key off trucks.id/tenant_id.
alter table public.trucks
  add column if not exists motowatchdog_external_id text;

create unique index if not exists trucks_motowatchdog_external_id_key
  on public.trucks (motowatchdog_external_id)
  where motowatchdog_external_id is not null;

-- 2) Raw webhook log: capture MotoWatchdog's exact payload wrapper on the first
--    real POST (locks the parser) and keep an audit trail. RLS enabled with NO
--    policies => only the service_role (the webhook) can read/write; anon and
--    authenticated are denied. Speed/address (which truck_locations has no
--    columns for) live here in the raw body until a UI needs them promoted.
create table if not exists public.motowatchdog_webhook_log (
  id          bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  body        jsonb
);
alter table public.motowatchdog_webhook_log enable row level security;
revoke all on public.motowatchdog_webhook_log from anon, authenticated;
