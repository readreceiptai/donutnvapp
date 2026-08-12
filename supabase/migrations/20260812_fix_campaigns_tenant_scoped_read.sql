-- APP project (cfghtxfplkodjnndzmcf). Fix: cross-tenant loyalty leak.
-- camp_read previously allowed ANY active campaign; scope it to the caller's tenant.
drop policy if exists camp_read on public.campaigns;
create policy camp_read on public.campaigns for select
  using (is_active = true and (tenant_id = public.current_tenant_id() or public.is_superadmin()));
