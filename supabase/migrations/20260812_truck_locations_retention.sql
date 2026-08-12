-- APP project (cfghtxfplkodjnndzmcf). Retention for truck_locations (unbounded live GPS
-- breadcrumbs). The customer Find map reads latest-per-truck via the (truck_id,
-- recorded_at DESC) index so it stays fast, but the table itself grows without bound;
-- this prunes history nightly while always keeping each truck's most-recent point so an
-- idle/parked truck still shows a last-known location.
create or replace function public.prune_truck_locations(p_keep_hours integer default 48)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_deleted integer;
begin
  with keep_latest as (
    select distinct on (truck_id) id from truck_locations order by truck_id, recorded_at desc
  )
  delete from truck_locations t
   where t.recorded_at < now() - make_interval(hours => p_keep_hours)
     and t.id not in (select id from keep_latest);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end$$;

revoke execute on function public.prune_truck_locations(integer) from public, anon, authenticated;
grant execute on function public.prune_truck_locations(integer) to service_role;

-- Schedule nightly at 04:00. Requires pg_cron (enabled here if not already).
create extension if not exists pg_cron;
select cron.schedule('prune-truck-locations', '0 4 * * *', $$select public.prune_truck_locations(48);$$);
