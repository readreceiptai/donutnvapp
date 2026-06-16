-- ============================================================================
-- DonutNV Customer App — Database Schema (Supabase / PostgreSQL)
-- Multi-tenant + white-label from day one. Built for the network, not one truck.
-- Owner: Trench Logic
--
-- HOW TO USE (non-technical):
--   1. Open your Supabase project → SQL Editor → New query.
--   2. Paste this whole file in and click "Run".
--   3. Then run seed.sql the same way to create your demo truck.
-- Running it twice is safe — it only creates things that don't already exist.
-- ============================================================================

-- Extensions ----------------------------------------------------------------
create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "postgis";        -- geography/geofencing (optional but recommended)

-- ============================================================================
-- TENANTS  — each operator/franchisee. White-label config lives here.
-- ============================================================================
create table if not exists public.tenants (
  id                uuid primary key default gen_random_uuid(),
  slug              text unique not null,                 -- e.g. 'donutnv-raleigh'
  name              text not null,                        -- display name
  brand             jsonb not null default '{}'::jsonb,   -- colors, logo url, fonts (white-label)
  square_location_id text,                                -- links loyalty to a Square location
  support_phone     text,
  support_email     text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ============================================================================
-- PROFILES — one row per customer. Mirrors auth.users (id = auth user id).
-- This is "the owned list." Phone + name + email + ZIP + birthday.
-- ============================================================================
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete restrict,
  role          text not null default 'customer'          -- 'customer' | 'operator' | 'admin'
                check (role in ('customer','operator','admin')),
  first_name    text,
  last_name     text,
  phone         text,                                     -- E.164, e.g. +19195551234
  email         text,
  zip           text,                                     -- home ZIP → powers proximity alerts
  birthday      date,                                     -- "free donut on your birthday" + age signal
  -- (under-13 is computed in the app at signup from birthday — no stored
  --  generated column, since current_date isn't allowed in one.)
  parent_profile_id uuid references public.profiles(id) on delete set null, -- under-13 → parent-managed
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists profiles_tenant_idx on public.profiles(tenant_id);
create index if not exists profiles_phone_idx  on public.profiles(tenant_id, phone);
create index if not exists profiles_email_idx  on public.profiles(tenant_id, email);

-- ============================================================================
-- CONSENTS — append-only record of exactly what each customer agreed to,
-- mirroring DonutNV's vetted language. One row per grant/revoke. This is your
-- legal paper trail for SMS (TCPA) and email (CAN-SPAM).
-- ============================================================================
create table if not exists public.consents (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  kind         text not null check (kind in
                 ('transactional_sms','marketing_sms','marketing_email')),
  granted      boolean not null,
  text_version text not null,                             -- the exact wording shown at the time
  source       text default 'signup',                     -- where it happened
  created_at   timestamptz not null default now()
);
create index if not exists consents_profile_idx on public.consents(profile_id, kind, created_at desc);

-- ============================================================================
-- SAVED AREAS — home/work areas a customer wants proximity alerts for.
-- ============================================================================
create table if not exists public.saved_areas (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  label       text default 'Home',
  zip         text,
  lat         double precision,
  lng         double precision,
  radius_m    integer not null default 4000,              -- alert radius in meters
  created_at  timestamptz not null default now()
);
create index if not exists saved_areas_profile_idx on public.saved_areas(profile_id);

-- ============================================================================
-- TRUCKS — physical units belonging to a tenant.
-- ============================================================================
create table if not exists public.trucks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,                              -- "DonutNV Truck 1"
  device_kind text default 'phone' check (device_kind in ('phone','puck')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists trucks_tenant_idx on public.trucks(tenant_id);

-- ============================================================================
-- LIVE SESSIONS — a deliberate "we're open & broadcasting" window.
-- Fail-safes live here: default OFF, every session auto-expires (ends_at).
-- ============================================================================
create table if not exists public.live_sessions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  truck_id    uuid not null references public.trucks(id) on delete cascade,
  stop_name   text,                                       -- "Midtown Park"
  is_live     boolean not null default false,             -- default OFF
  started_at  timestamptz,
  ends_at     timestamptz,                                -- auto-expire; nothing broadcasts overnight
  source      text default 'manual' check (source in ('manual','schedule')),
  created_at  timestamptz not null default now()
);
create index if not exists live_sessions_truck_idx on public.live_sessions(truck_id, is_live);

-- A truck is "currently live" only if flagged AND not past its expiry.
create or replace view public.active_live_sessions as
  select * from public.live_sessions
  where is_live = true and (ends_at is null or ends_at > now());

-- ============================================================================
-- TRUCK LOCATIONS — GPS pings. Phones POST straight here; pucks via Traccar.
-- ============================================================================
create table if not exists public.truck_locations (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  truck_id    uuid not null references public.trucks(id) on delete cascade,
  session_id  uuid references public.live_sessions(id) on delete set null,
  lat         double precision not null,
  lng         double precision not null,
  recorded_at timestamptz not null default now()
);
create index if not exists truck_locations_truck_time_idx on public.truck_locations(truck_id, recorded_at desc);

-- Latest known position per truck (what the map reads).
create or replace view public.truck_latest_location as
  select distinct on (truck_id)
    truck_id, tenant_id, session_id, lat, lng, recorded_at
  from public.truck_locations
  order by truck_id, recorded_at desc;

-- ============================================================================
-- SCHEDULED STOPS — approved public stops. Drives auto-go-live / auto-stop.
-- ============================================================================
create table if not exists public.scheduled_stops (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  truck_id    uuid references public.trucks(id) on delete cascade,
  stop_name   text not null,
  lat         double precision,
  lng         double precision,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  is_public   boolean not null default true,              -- private events → go dark
  created_at  timestamptz not null default now()
);
create index if not exists scheduled_stops_tenant_time_idx on public.scheduled_stops(tenant_id, starts_at);

-- ============================================================================
-- GEOFENCE BLACKLIST — home, commissary, flagged addresses.
-- Broadcasting is suppressed inside these zones even if toggled on.
-- ============================================================================
create table if not exists public.geofence_blacklist (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  label       text not null,                              -- "Home", "Commissary"
  lat         double precision not null,
  lng         double precision not null,
  radius_m    integer not null default 300,
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- CAMPAIGNS — the gamification engine. Rotate a fresh game weekly from admin.
-- config jsonb keeps it flexible without schema changes per game type.
-- ============================================================================
create table if not exists public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  kind        text not null check (kind in
                 ('checkin_stamp','passport','catch_the_truck','bonus_day')),
  name        text not null,
  config      jsonb not null default '{}'::jsonb,         -- goal counts, rewards, multipliers
  starts_at   timestamptz,
  ends_at     timestamptz,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists campaigns_tenant_active_idx on public.campaigns(tenant_id, is_active);

-- ============================================================================
-- CHECK-INS — gamification events (a visit, a stamp, a passport mark).
-- Square purchase webhooks can also insert here (buy = a stamp/point).
-- ============================================================================
create table if not exists public.check_ins (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  truck_id    uuid references public.trucks(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  source      text not null default 'app' check (source in ('app','square','manual')),
  lat         double precision,
  lng         double precision,
  created_at  timestamptz not null default now()
);
create index if not exists check_ins_profile_idx on public.check_ins(profile_id, created_at desc);

-- ============================================================================
-- PUSH SUBSCRIPTIONS — web push endpoints for proximity alerts.
-- ============================================================================
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  endpoint    text not null,
  keys        jsonb not null,
  created_at  timestamptz not null default now(),
  unique (profile_id, endpoint)
);

-- ============================================================================
-- updated_at trigger for profiles
-- ============================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Helper: which tenant does the current logged-in user belong to?
-- ============================================================================
create or replace function public.current_tenant_id()
returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_operator()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role in ('operator','admin'));
$$;

-- ============================================================================
-- ROW-LEVEL SECURITY
-- Customers see only their own private data. The live map (truck position,
-- live status, schedule, active campaigns) is public read, scoped per tenant.
-- Operators manage everything inside their own tenant.
-- ============================================================================
alter table public.profiles           enable row level security;
alter table public.consents           enable row level security;
alter table public.saved_areas        enable row level security;
alter table public.trucks             enable row level security;
alter table public.live_sessions      enable row level security;
alter table public.truck_locations    enable row level security;
alter table public.scheduled_stops    enable row level security;
alter table public.geofence_blacklist enable row level security;
alter table public.campaigns          enable row level security;
alter table public.check_ins          enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.tenants            enable row level security;

-- Tenants: anyone may read active tenant branding (needed to theme the app pre-login)
drop policy if exists tenants_read on public.tenants;
create policy tenants_read on public.tenants for select using (is_active = true);

-- Profiles: a user reads/updates only their own row (or their child's).
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select
  using (id = auth.uid() or parent_profile_id = auth.uid() or public.is_operator());
drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles for insert
  with check (id = auth.uid());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid() or parent_profile_id = auth.uid() or public.is_operator());

-- Consents / saved areas / push / check-ins: owner-only (operators can read within tenant).
drop policy if exists consents_owner on public.consents;
create policy consents_owner on public.consents for all
  using (profile_id = auth.uid() or public.is_operator())
  with check (profile_id = auth.uid());

drop policy if exists saved_areas_owner on public.saved_areas;
create policy saved_areas_owner on public.saved_areas for all
  using (profile_id = auth.uid() or public.is_operator())
  with check (profile_id = auth.uid());

drop policy if exists push_owner on public.push_subscriptions;
create policy push_owner on public.push_subscriptions for all
  using (profile_id = auth.uid() or public.is_operator())
  with check (profile_id = auth.uid());

drop policy if exists checkins_owner on public.check_ins;
create policy checkins_owner on public.check_ins for all
  using (profile_id = auth.uid() or public.is_operator())
  with check (profile_id = auth.uid());

-- Public-read map data (scoped to tenant). Operators can write.
drop policy if exists trucks_read on public.trucks;
create policy trucks_read on public.trucks for select using (is_active = true);
drop policy if exists trucks_write on public.trucks;
create policy trucks_write on public.trucks for all
  using (public.is_operator() and tenant_id = public.current_tenant_id())
  with check (public.is_operator() and tenant_id = public.current_tenant_id());

drop policy if exists live_read on public.live_sessions;
create policy live_read on public.live_sessions for select using (true);
drop policy if exists live_write on public.live_sessions;
create policy live_write on public.live_sessions for all
  using (public.is_operator() and tenant_id = public.current_tenant_id())
  with check (public.is_operator() and tenant_id = public.current_tenant_id());

drop policy if exists loc_read on public.truck_locations;
create policy loc_read on public.truck_locations for select using (true);
drop policy if exists loc_write on public.truck_locations;
create policy loc_write on public.truck_locations for all
  using (public.is_operator() and tenant_id = public.current_tenant_id())
  with check (public.is_operator() and tenant_id = public.current_tenant_id());

drop policy if exists stops_read on public.scheduled_stops;
create policy stops_read on public.scheduled_stops for select using (is_public = true);
drop policy if exists stops_write on public.scheduled_stops;
create policy stops_write on public.scheduled_stops for all
  using (public.is_operator() and tenant_id = public.current_tenant_id())
  with check (public.is_operator() and tenant_id = public.current_tenant_id());

drop policy if exists camp_read on public.campaigns;
create policy camp_read on public.campaigns for select using (is_active = true);
drop policy if exists camp_write on public.campaigns;
create policy camp_write on public.campaigns for all
  using (public.is_operator() and tenant_id = public.current_tenant_id())
  with check (public.is_operator() and tenant_id = public.current_tenant_id());

-- Geofence blacklist: operators only (sensitive — contains home address).
drop policy if exists geo_ops on public.geofence_blacklist;
create policy geo_ops on public.geofence_blacklist for all
  using (public.is_operator() and tenant_id = public.current_tenant_id())
  with check (public.is_operator() and tenant_id = public.current_tenant_id());

-- ============================================================================
-- Done. Next: run seed.sql to create your demo tenant + truck.
-- ============================================================================
