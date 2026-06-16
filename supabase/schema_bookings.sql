-- ============================================================================
-- DonutNV — Event Booking add-on. Run AFTER schema.sql.
-- Adds the book-a-truck pipeline, private "on the way" tracking, and a secure
-- read for the client tracking page. Safe to run more than once.
-- ============================================================================

-- Private vs public broadcasts: a normal "Open" is public (shows on the map);
-- an "on the way to your event" broadcast is private (only the booked client,
-- via their tracking link, can see it).
alter table public.live_sessions
  add column if not exists visibility text not null default 'public'
    check (visibility in ('public', 'private')),
  add column if not exists booking_id uuid;

-- The customer map only shows PUBLIC, live, non-expired trucks.
create or replace view public.active_live_sessions as
  select * from public.live_sessions
  where is_live = true
    and visibility = 'public'
    and (ends_at is null or ends_at > now());

-- ============================================================================
-- BOOKINGS — the book-a-truck pipeline. Feeds GHL/LeadConnector.
-- ============================================================================
create table if not exists public.bookings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  created_by      uuid references public.profiles(id) on delete set null, -- null if a guest booked
  -- contact (mirrors the donutnv.com book-a-truck form)
  contact_name    text not null,              -- "First Last"
  contact_phone   text,                       -- optional, like the website form
  contact_email   text,                       -- required in the form
  -- event
  event_type      text,                       -- kept for future use (not on the website form)
  event_date      date,
  start_time      text,
  duration_hours  numeric,                     -- kept for future use
  guests          integer,                     -- "Exp. Attendance"
  address         text,                        -- kept for future use
  city            text,
  zip             text,                        -- "Zip Code" (required in the form)
  lat             double precision,           -- geocoded when the truck heads out
  lng             double precision,
  notes           text,                        -- "Tell Us About Your Event" (required)
  -- consent (mirrors the website's two checkboxes; fed to GHL)
  sms_consent          boolean not null default false,  -- Customer Care SMS
  marketing_consent    boolean not null default false,  -- Optional Marketing
  consent_text_version text,
  -- pipeline
  status          text not null default 'new'
                    check (status in ('new','quoted','confirmed','enroute','arrived','completed','cancelled')),
  truck_id        uuid references public.trucks(id) on delete set null,
  enroute_session_id uuid references public.live_sessions(id) on delete set null,
  -- public client tracking link
  tracking_token  text unique not null default replace(gen_random_uuid()::text, '-', ''),
  -- GHL / LeadConnector linkage
  ghl_contact_id      text,
  ghl_opportunity_id  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists bookings_tenant_status_idx on public.bookings(tenant_id, status, event_date);
create index if not exists bookings_token_idx on public.bookings(tracking_token);

-- Idempotent: if you ran an earlier version of this file, add the new columns.
alter table public.bookings add column if not exists sms_consent boolean not null default false;
alter table public.bookings add column if not exists marketing_consent boolean not null default false;
alter table public.bookings add column if not exists consent_text_version text;
alter table public.bookings alter column contact_phone drop not null;

drop trigger if exists bookings_touch on public.bookings;
create trigger bookings_touch before update on public.bookings
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.bookings enable row level security;

-- Anyone can submit a booking request (the public book-a-truck form uses the
-- anon key). They may only create rows for a real, active tenant.
drop policy if exists bookings_insert on public.bookings;
create policy bookings_insert on public.bookings for insert
  with check (exists (select 1 from public.tenants t where t.id = tenant_id and t.is_active));

-- Operators manage all bookings in their tenant; a logged-in customer can see
-- their own. (The public tracking page does NOT use this — see the RPC below.)
drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings for select
  using (public.is_operator() and tenant_id = public.current_tenant_id()
         or created_by = auth.uid());

drop policy if exists bookings_update on public.bookings;
create policy bookings_update on public.bookings for update
  using (public.is_operator() and tenant_id = public.current_tenant_id())
  with check (public.is_operator() and tenant_id = public.current_tenant_id());

-- ============================================================================
-- SECURE TRACKING READ
-- The client tracking page is public (the booked client isn't a logged-in
-- user). Instead of opening up the bookings table, this function takes the
-- secret token and returns ONLY safe fields + the truck's current position.
-- ============================================================================
create or replace function public.get_event_tracking(p_token text)
returns json language sql stable security definer set search_path = public as $$
  select case when b.id is null then null else json_build_object(
    'status',      b.status,
    'event_name',  coalesce(b.event_type, 'your event'),
    'contact_name', b.contact_name,
    'event_lat',   b.lat,
    'event_lng',   b.lng,
    'truck_lat',   loc.lat,
    'truck_lng',   loc.lng,
    'updated_at',  loc.recorded_at,
    'tenant',      t.name
  ) end
  from public.bookings b
  left join public.tenants t on t.id = b.tenant_id
  left join public.truck_latest_location loc on loc.truck_id = b.truck_id
  where b.tracking_token = p_token
  limit 1;
$$;

grant execute on function public.get_event_tracking(text) to anon, authenticated;
