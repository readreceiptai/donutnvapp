-- ============================================================================
-- DonutNV — Public schedule ("Catch us this week")
-- Run this AFTER schema.sql. Safe to run more than once.
--
-- Customers can already read PUBLIC stops (see the stops_read policy in
-- schema.sql). This adds:
--   1. An optional `address` column for a human-friendly location label.
--   2. get_public_schedule(): one clean call that returns upcoming PUBLIC stops
--      in full detail AND PRIVATE stops anonymized to a time-only "booked" block
--      (no name, no address, no coordinates) — so customers see the truck is
--      busy then, without exposing private-event details.
-- ============================================================================

-- 1. Friendly address label (e.g. "Pop Stroke, Palm Harbor")
alter table public.scheduled_stops
  add column if not exists address text;

-- 2. Public schedule reader. SECURITY DEFINER so it can see private rows, but it
--    only ever RETURNS time blocks for them — never their details.
create or replace function public.get_public_schedule(
  p_tenant uuid,
  p_days   int default 14
)
returns table (
  id         uuid,
  starts_at  timestamptz,
  ends_at    timestamptz,
  is_public  boolean,
  stop_name  text,
  address    text,
  lat        double precision,
  lng        double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.starts_at,
    s.ends_at,
    s.is_public,
    case when s.is_public then s.stop_name else null end as stop_name,
    case when s.is_public then s.address   else null end as address,
    case when s.is_public then s.lat       else null end as lat,
    case when s.is_public then s.lng       else null end as lng
  from public.scheduled_stops s
  where s.tenant_id = p_tenant
    and s.ends_at >= now()
    and s.starts_at <= now() + (p_days || ' days')::interval
  order by s.starts_at asc;
$$;

-- Anyone (even logged-out customers) may read the schedule.
grant execute on function public.get_public_schedule(uuid, int) to anon, authenticated;
