-- ============================================================================
-- DonutNV — Territory ownership & lead routing. Run after schema.sql (any time).
--
-- Rules encoded here:
--   • Customers are CORPORATE-owned by default (profiles.owner_tenant_id = null).
--   • When a customer books a truck, they transfer to the assigned franchisee.
--   • Book-a-truck leads route by the EVENT ZIP, and ONLY go to franchisees who
--     are active on the app (tenants.app_active). Owned ZIP whose owner is on the
--     app → that owner. Otherwise (OOB, or owner not yet on the app) → round-robin
--     to the nearest app-active franchisees within their service radius.
--
-- Data to load later (corporate provides):
--   • territory_zips  — the FDD ZIP → franchisee map
--   • zip_centroids   — a US ZIP → lat/lng table (public dataset) for distances
--   • tenants.lat/lng — each franchisee's territory centroid
--   • tenants.app_active = true once a franchisee signs up / onboards
-- ============================================================================

-- 1) Franchisee fields
alter table public.tenants add column if not exists app_active boolean not null default false;
alter table public.tenants add column if not exists lat double precision;                 -- territory centroid
alter table public.tenants add column if not exists lng double precision;
alter table public.tenants add column if not exists service_radius_miles int not null default 30; -- OOB reach
alter table public.tenants add column if not exists oob_lead_count int not null default 0;        -- round-robin fairness
alter table public.tenants add column if not exists ghl_location_id text;                  -- per-franchisee GHL location

-- pilot territory is live on the app
update public.tenants set app_active = true where slug = 'ph';

-- 2) ZIP → owner map (load corporate's FDD territory list)
create table if not exists public.territory_zips (
  zip        text primary key,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists territory_zips_tenant_idx on public.territory_zips(tenant_id);
alter table public.territory_zips enable row level security;
drop policy if exists tz_read on public.territory_zips;
create policy tz_read on public.territory_zips for select using (true);

-- 3) ZIP centroid cache (load a US ZIP centroid dataset)
create table if not exists public.zip_centroids (
  zip text primary key, lat double precision not null, lng double precision not null
);

-- 4) Customer ownership (null = corporate)
alter table public.profiles add column if not exists owner_tenant_id uuid references public.tenants(id) on delete set null;

-- 5) Booking assignment
alter table public.bookings add column if not exists assigned_tenant_id uuid references public.tenants(id) on delete set null;
alter table public.bookings add column if not exists assignment_reason text;   -- owned | round_robin | unassigned

-- distance in miles (haversine)
create or replace function public.miles_between(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable as $$
  select 3958.8 * 2 * asin(sqrt(
    power(sin(radians(b_lat - a_lat) / 2), 2) +
    cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)
  ));
$$;

-- 6) The router
create or replace function public.route_booking(p_booking_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  b public.bookings;
  owner_id uuid; owner_active boolean;
  ev_lat double precision; ev_lng double precision;
  chosen uuid; reason text;
begin
  select * into b from public.bookings where id = p_booking_id;
  if b.id is null then return json_build_object('ok', false); end if;
  -- idempotent: don't re-route (keeps the round-robin counter honest)
  if b.assignment_reason is not null then
    return json_build_object('ok', true, 'assigned', b.assigned_tenant_id, 'reason', b.assignment_reason);
  end if;

  -- (a) Owned ZIP whose owner is on the app → that owner
  select tz.tenant_id, t.app_active into owner_id, owner_active
    from public.territory_zips tz join public.tenants t on t.id = tz.tenant_id
    where tz.zip = b.zip;

  if owner_id is not null and owner_active then
    chosen := owner_id; reason := 'owned';
  else
    -- (b) OOB or owner not on the app → round-robin to nearest app-active Zs
    ev_lat := b.lat; ev_lng := b.lng;
    if ev_lat is null then
      select lat, lng into ev_lat, ev_lng from public.zip_centroids where zip = b.zip;
    end if;
    if ev_lat is not null then
      select t.id into chosen from public.tenants t
        where t.app_active and t.lat is not null
          and public.miles_between(ev_lat, ev_lng, t.lat, t.lng) <= t.service_radius_miles
        order by t.oob_lead_count asc, public.miles_between(ev_lat, ev_lng, t.lat, t.lng) asc
        limit 1;
    end if;
    if chosen is not null then
      reason := 'round_robin';
      update public.tenants set oob_lead_count = oob_lead_count + 1 where id = chosen;
    else
      -- fallback (e.g. pilot): keep with the current tenant if it's app-active
      select case when t.app_active then b.tenant_id end into chosen
        from public.tenants t where t.id = b.tenant_id;
      reason := case when chosen is not null then 'owned' else 'unassigned' end;
    end if;
  end if;

  update public.bookings
     set assigned_tenant_id = chosen,
         tenant_id = coalesce(chosen, tenant_id),
         assignment_reason = reason
   where id = b.id;

  -- customer becomes owned by the assigned franchisee the moment they book
  if chosen is not null and b.created_by is not null then
    update public.profiles set owner_tenant_id = chosen where id = b.created_by;
  end if;

  return json_build_object('ok', true, 'assigned', chosen, 'reason', reason);
end; $$;
grant execute on function public.route_booking(uuid) to anon, authenticated;
