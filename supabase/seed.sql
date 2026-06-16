-- ============================================================================
-- DonutNV — Seed data. Creates ONE demo tenant (your truck) + a truck +
-- a "live" session with a couple of location pings so the map shows something
-- before the real GPS feed is wired in. Run AFTER schema.sql.
-- Safe to run more than once (uses fixed UUIDs + upserts).
-- ============================================================================

-- Your operator/franchise (white-label tenant). Edit name/colors freely.
insert into public.tenants (id, slug, name, brand, support_phone, support_email)
values (
  '00000000-0000-0000-0000-0000000000a1',
  'ph',                                  -- territory slug → donutnvapp.com/ph
  'DonutNV Palm Harbor',
  jsonb_build_object(
    'red',   '#DD1B22',
    'redDeep','#911A1D',
    'blue',  '#0A7BC1',
    'navy',  '#003C77',
    'ink',   '#231F20',
    'cream', '#FFF7F0',
    'logoUrl','https://donutnv.com/wp-content/uploads/2022/12/DonutNV_NameOnly.svg'
  ),
  '+18333668868',
  'party@donutnv.com'
)
on conflict (id) do update set brand = excluded.brand, name = excluded.name;

-- Your truck.
insert into public.trucks (id, tenant_id, name, device_kind)
values (
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000a1',
  'DonutNV Truck 1',
  'phone'
)
on conflict (id) do nothing;

-- A live session so the map has an "open now" truck (auto-expires in 4 hours).
insert into public.live_sessions (id, tenant_id, truck_id, stop_name, is_live, started_at, ends_at, source)
values (
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000b1',
  'Demo Stop — Downtown',
  true,
  now(),
  now() + interval '4 hours',
  'manual'
)
on conflict (id) do update set is_live = true, started_at = now(), ends_at = now() + interval '4 hours';

-- A location ping (Palm Harbor, FL — change to wherever the truck actually is).
insert into public.truck_locations (tenant_id, truck_id, session_id, lat, lng)
values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1', 28.0764, -82.7637);

-- A sample active campaign (check-in stamp card → free donut at 5 visits).
insert into public.campaigns (id, tenant_id, kind, name, config, starts_at, ends_at, is_active)
values (
  '00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000a1',
  'checkin_stamp',
  'Stamp Card: 5 visits = free donuts',
  jsonb_build_object('goal', 5, 'reward', 'A free bag of mini donuts'),
  now(),
  now() + interval '60 days',
  true
)
on conflict (id) do nothing;
