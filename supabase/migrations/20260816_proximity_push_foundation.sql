-- ═══════════════════════════════════════════════════════════════════════════
-- Option B — Live Proximity Push: FOUNDATION (tables, RLS, indexes, retention)
-- APP project (cfghtxfplkodjnndzmcf). Apply against the APP database ONLY.
--
-- ADDITIVE ONLY. This migration creates new, namespaced objects and does not
-- alter, drop, or replace anything that already exists. It reuses read-only:
--   * truck_latest_location / active_live_sessions  (truck position + open state)
--   * proximity_pushes                              (per-session dedupe interlock)
--   * push_subscriptions                            (existing web-push channel)
--
-- SECURITY POSTURE (deliberate — we just closed an anon-readable location leak
-- on live_sessions/truck_locations; this must not open a new one):
--   * customer_positions / customer_latest_position hold live CUSTOMER location.
--     That is the most sensitive data in the platform. Writes are service-role
--     ONLY (via the location-ingest edge function). Reads are the user's OWN ROW
--     only. Operators do NOT get to read customer positions — a franchisee has
--     no business reading where their customers physically are. Superadmin is
--     excluded too; debugging goes through service-role, which is audited.
--   * Every table below enables RLS in the same statement block that creates it
--     and grants the narrowest privilege that makes the feature work.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. customer_positions — position history (short-lived, for debug/QA) ─────
-- Kept deliberately small: pruned to 24h. The matcher does NOT read this table;
-- it reads customer_latest_position. History exists only to debug "why didn't I
-- get a push" reports and to sanity-check battery/ping cadence.
create table if not exists public.customer_positions (
  id           bigint generated always as identity primary key,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id)  on delete cascade,
  geog         geography(Point, 4326) not null,
  accuracy_m   real,
  recorded_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- No GiST here on purpose: this table is never spatially queried, and a GiST
-- index on a high-write history table is pure write amplification.
create index if not exists customer_positions_profile_recorded_idx
  on public.customer_positions (profile_id, recorded_at desc);
create index if not exists customer_positions_recorded_idx
  on public.customer_positions (recorded_at);

alter table public.customer_positions enable row level security;
alter table public.customer_positions force row level security;

revoke all on public.customer_positions from anon, authenticated;
grant select on public.customer_positions to authenticated;

-- Own row only. No insert/update/delete for any API role — ingest is service-role.
create policy customer_positions_read_own on public.customer_positions
  for select to authenticated
  using (profile_id = auth.uid());


-- ── 2. customer_latest_position — the hot spatial match target ───────────────
-- One row per customer. This is what ST_DWithin runs against, so it stays at
-- ~1 row/customer (100K rows at 100K users) instead of growing with every ping.
create table if not exists public.customer_latest_position (
  profile_id   uuid primary key references public.profiles(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  geog         geography(Point, 4326) not null,
  accuracy_m   real,
  recorded_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- THE index that makes the whole feature viable. ST_DWithin on a geography
-- column uses this GiST index; without it the matcher is a 100K-row seq scan
-- per truck per tick.
create index if not exists customer_latest_position_geog_gix
  on public.customer_latest_position using gist (geog);
create index if not exists customer_latest_position_tenant_idx
  on public.customer_latest_position (tenant_id);
create index if not exists customer_latest_position_recorded_idx
  on public.customer_latest_position (recorded_at desc);

alter table public.customer_latest_position enable row level security;
alter table public.customer_latest_position force row level security;

revoke all on public.customer_latest_position from anon, authenticated;
grant select on public.customer_latest_position to authenticated;

create policy customer_latest_position_read_own on public.customer_latest_position
  for select to authenticated
  using (profile_id = auth.uid());


-- ── 3. push_tokens — native APNs/FCM device tokens ──────────────────────────
-- Distinct from the existing push_subscriptions table (web push / VAPID), which
-- stays exactly as it is. proximity-dispatch fans out to BOTH channels.
create table if not exists public.push_tokens (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  token        text not null unique,
  platform     text not null check (platform in ('ios', 'android')),
  app_version  text,
  device_model text,
  is_active    boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists push_tokens_profile_idx
  on public.push_tokens (profile_id) where is_active;
create index if not exists push_tokens_tenant_idx
  on public.push_tokens (tenant_id) where is_active;

alter table public.push_tokens enable row level security;
alter table public.push_tokens force row level security;

revoke all on public.push_tokens from anon, authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;

-- Own row only. Operators are intentionally NOT granted read here: a device
-- token is a per-user identifier and a franchisee has no use for it.
create policy push_tokens_owner on public.push_tokens
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());


-- ── 4. proximity_prefs — per-customer notification settings ─────────────────
-- enabled defaults FALSE: background location is strictly opt-in. Nothing is
-- ever sent to a customer who has not affirmatively turned this on.
create table if not exists public.proximity_prefs (
  profile_id        uuid primary key references public.profiles(id) on delete cascade,
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  enabled           boolean not null default false,
  radius_miles      numeric(4,1) not null default 5.0
                      check (radius_miles > 0 and radius_miles <= 25),
  quiet_hours_start time not null default '21:00',
  quiet_hours_end   time not null default '09:00',
  timezone          text not null default 'America/New_York',
  max_per_day       smallint not null default 2 check (max_per_day between 0 and 10),
  min_hours_between smallint not null default 6 check (min_hours_between between 0 and 168),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists proximity_prefs_enabled_idx
  on public.proximity_prefs (tenant_id) where enabled;

alter table public.proximity_prefs enable row level security;
alter table public.proximity_prefs force row level security;

revoke all on public.proximity_prefs from anon, authenticated;
grant select, insert, update, delete on public.proximity_prefs to authenticated;

create policy proximity_prefs_owner on public.proximity_prefs
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());


-- ── 5. tenant_proximity_config — per-tenant admin controls + kill switch ────
-- Separate table rather than columns on `tenants`, so this workstream never
-- touches an existing table. enabled defaults FALSE: a franchisee must be
-- switched on deliberately.
create table if not exists public.tenant_proximity_config (
  tenant_id                      uuid primary key references public.tenants(id) on delete cascade,
  enabled                        boolean not null default false,
  default_radius_miles           numeric(4,1) not null default 5.0
                                   check (default_radius_miles > 0 and default_radius_miles <= 25),
  max_radius_miles               numeric(4,1) not null default 10.0
                                   check (max_radius_miles > 0 and max_radius_miles <= 25),
  quiet_hours_start              time not null default '21:00',
  quiet_hours_end                time not null default '09:00',
  max_sends_per_customer_per_day smallint not null default 2
                                   check (max_sends_per_customer_per_day between 0 and 10),
  min_hours_between_sends        smallint not null default 6
                                   check (min_hours_between_sends between 0 and 168),
  position_max_age_minutes       integer not null default 120
                                   check (position_max_age_minutes between 5 and 1440),
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);

alter table public.tenant_proximity_config enable row level security;
alter table public.tenant_proximity_config force row level security;

revoke all on public.tenant_proximity_config from anon, authenticated;
grant select, update on public.tenant_proximity_config to authenticated;

-- Operators manage their own territory's settings; superadmin sees all.
create policy tenant_proximity_config_read on public.tenant_proximity_config
  for select to authenticated
  using ((public.is_operator() and tenant_id = public.current_tenant_id())
         or public.is_superadmin());

create policy tenant_proximity_config_update on public.tenant_proximity_config
  for update to authenticated
  using ((public.is_operator() and tenant_id = public.current_tenant_id())
         or public.is_superadmin())
  with check ((public.is_operator() and tenant_id = public.current_tenant_id())
              or public.is_superadmin());


-- ── 6. proximity_notification_log — sends, suppressions, CTR ────────────────
-- Deliberately NO foreign keys to trucks/live_sessions: the log must outlive
-- session pruning so the metrics (opt-in rate, sends, CTR) stay auditable.
create table if not exists public.proximity_notification_log (
  id                  bigint generated always as identity primary key,
  profile_id          uuid not null references public.profiles(id) on delete cascade,
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  truck_id            uuid,
  session_id          uuid,
  channel             text not null check (channel in ('native', 'web')),
  status              text not null check (status in ('sent', 'failed', 'suppressed')),
  reason              text,
  distance_m          integer,
  radius_miles        numeric(4,1),
  title               text,
  body                text,
  provider_message_id text,
  sent_at             timestamptz not null default now(),
  opened_at           timestamptz
);

create index if not exists proximity_notification_log_profile_sent_idx
  on public.proximity_notification_log (profile_id, sent_at desc);
create index if not exists proximity_notification_log_tenant_sent_idx
  on public.proximity_notification_log (tenant_id, sent_at desc);
-- Supports the frequency-cap lookups in the matcher (sent-only, recent).
create index if not exists proximity_notification_log_cap_idx
  on public.proximity_notification_log (profile_id, sent_at desc)
  where status = 'sent';

alter table public.proximity_notification_log enable row level security;
alter table public.proximity_notification_log force row level security;

revoke all on public.proximity_notification_log from anon, authenticated;
grant select on public.proximity_notification_log to authenticated;

-- Customers see their own notification history (transparency: "why did you
-- message me?"). Operators see their tenant's aggregate rows for metrics.
create policy proximity_notification_log_read on public.proximity_notification_log
  for select to authenticated
  using (profile_id = auth.uid()
         or (public.is_operator() and tenant_id = public.current_tenant_id())
         or public.is_superadmin());


-- ── 7. Retention — customer location is PII; keep the window tight ──────────
-- 24h default (vs 48h for truck_locations): a truck's breadcrumb trail is
-- business data, a customer's is not. customer_latest_position is deliberately
-- NOT pruned by age — it is one row per user and the matcher's freshness check
-- (position_max_age_minutes) already ignores stale rows.
create or replace function public.prune_customer_positions(p_keep_hours integer default 24)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_deleted integer;
begin
  delete from customer_positions
   where recorded_at < now() - make_interval(hours => p_keep_hours);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end$$;

revoke execute on function public.prune_customer_positions(integer) from public, anon, authenticated;
grant execute on function public.prune_customer_positions(integer) to service_role;

-- Purge tokens that have gone quiet for 90 days (dead installs).
create or replace function public.prune_stale_push_tokens(p_keep_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_deleted integer;
begin
  delete from push_tokens
   where last_seen_at < now() - make_interval(days => p_keep_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end$$;

revoke execute on function public.prune_stale_push_tokens(integer) from public, anon, authenticated;
grant execute on function public.prune_stale_push_tokens(integer) to service_role;

-- Nightly at 04:15 (04:00 is taken by prune-truck-locations).
select cron.schedule(
  'prune-customer-positions',
  '15 4 * * *',
  $$select public.prune_customer_positions(24); select public.prune_stale_push_tokens(90);$$
);


-- ── 8. Global kill switch (reuses the existing app_config key/value table) ──
-- Master off switch for the entire Option B pipeline. Ships OFF.
insert into public.app_config (key, value)
values ('proximity_push_enabled', 'false')
on conflict (key) do nothing;
