-- Post-build audit fixes (security advisor). Lock down objects introduced today to match
-- ELLE's service-role-only model: enable RLS (no policy = deny-all to anon/authenticated;
-- service_role bypasses) on the two new tables, revoke direct execute on the trigger
-- functions (they still fire as triggers), and pin the zipwall function's search_path.
alter table public.elle_example_seed enable row level security;
alter table public.elle_onboarding   enable row level security;

revoke execute on function public.elle_tenants_confirm_trg() from public, anon, authenticated;
revoke execute on function public.elle_tenants_seed_trg()    from public, anon, authenticated;

create or replace function public.elle_enforce_event_zip()
returns trigger language plpgsql set search_path = public as $$
declare ez text; est text;
begin
  select zip, enrichment_status into ez, est from public.elle_events where id = new.event_id;
  if est = 'example' then return new; end if;
  if ez is null or not exists (
    select 1 from public.elle_territory_zips tz where tz.tenant_id = new.tenant_id and tz.zip = ez
  ) then
    return null;
  end if;
  return new;
end $$;