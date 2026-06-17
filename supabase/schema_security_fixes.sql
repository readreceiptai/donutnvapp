-- ============================================================================
-- DonutNV — Security remediation (post independent review, 2026-06-17)
-- Already applied to the live DB. Safe to re-run. Supersedes the auto_superadmin
-- trigger originally defined in schema_superadmin.sql.
-- ============================================================================

-- C1: lock privileged columns so no client can self-grant superadmin/role.
revoke insert (is_superadmin), update (is_superadmin) on public.profiles from anon, authenticated;
revoke insert (role),          update (role)          on public.profiles from anon, authenticated;

-- C1: derive superadmin from the VERIFIED login email (JWT), not the user-typed
-- profiles.email column.
create or replace function public.auto_superadmin()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if lower(coalesce(auth.email(), '')) = 'k.deans@mac.com' then
    new.is_superadmin := true;
  end if;
  return new;
end;
$$;

-- H1: tenant-scope every operator policy (operators see only their own tenant's
-- customer PII); superadmin transcends. Customers keep self-access.
drop policy if exists checkins_owner on public.check_ins;
create policy checkins_owner on public.check_ins for all
  using (profile_id = auth.uid() or (public.is_operator() and tenant_id = public.current_tenant_id()) or public.is_superadmin())
  with check (profile_id = auth.uid() or public.is_superadmin());

drop policy if exists consents_owner on public.consents;
create policy consents_owner on public.consents for all
  using (profile_id = auth.uid() or (public.is_operator() and tenant_id = public.current_tenant_id()) or public.is_superadmin())
  with check (profile_id = auth.uid() or public.is_superadmin());

drop policy if exists saved_areas_owner on public.saved_areas;
create policy saved_areas_owner on public.saved_areas for all
  using (profile_id = auth.uid() or (public.is_operator() and tenant_id = public.current_tenant_id()) or public.is_superadmin())
  with check (profile_id = auth.uid() or public.is_superadmin());

drop policy if exists push_owner on public.push_subscriptions;
create policy push_owner on public.push_subscriptions for all
  using (profile_id = auth.uid() or (public.is_operator() and tenant_id = public.current_tenant_id()) or public.is_superadmin())
  with check (profile_id = auth.uid() or public.is_superadmin());

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select
  using (id = auth.uid() or parent_profile_id = auth.uid()
         or (public.is_operator() and tenant_id = public.current_tenant_id())
         or public.is_superadmin());

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid() or parent_profile_id = auth.uid()
         or (public.is_operator() and tenant_id = public.current_tenant_id())
         or public.is_superadmin())
  with check (id = auth.uid() or parent_profile_id = auth.uid()
         or (public.is_operator() and tenant_id = public.current_tenant_id())
         or public.is_superadmin());

-- H3 (COPPA): keep the guardian's email on the minor's profile.
alter table public.profiles add column if not exists parent_email text;

-- NOTE (not in SQL):
--   H2 — Edge Functions send-enroute-sms / square-deposit now verify the caller
--        is an operator of the booking's tenant; territory-digest / notify-proximity
--        require a CRON_SECRET header (set the secret before scheduling them).
--   H4 — preview mode is now VITE_PREVIEW_MODE-only (no ?preview=1 backdoor).
--   STILL TODO — route_booking + ghl-sync (public booking path) move to a
--        SECURITY DEFINER submit_booking RPC so the client never calls them
--        directly; then revoke anon on route_booking.
