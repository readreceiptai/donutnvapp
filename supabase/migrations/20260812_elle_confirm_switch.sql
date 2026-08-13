-- ELLE project (nvxfkzwbiomnswcxiblq). The "confirm switch".
-- Paid discovery/enrichment/linkedin-backfill/market-briefs ALL already gate on
-- elle_tenants.paid_apis_enabled (verified). It defaults false, so a franchisee costs
-- $0 in paid APIs until Kevin confirms them by flipping this true. This RPC is the
-- controlled way to flip it (service-role only).
create or replace function public.elle_set_paid_enabled(p_tenant uuid, p_on boolean)
returns table (id uuid, franchise_name text, paid_apis_enabled boolean)
language sql security definer set search_path = public as $$
  update public.elle_tenants set paid_apis_enabled = p_on, updated_at = now()
   where id = p_tenant
  returning id, franchise_name, paid_apis_enabled;
$$;
revoke execute on function public.elle_set_paid_enabled(uuid, boolean) from public, anon, authenticated;
grant execute on function public.elle_set_paid_enabled(uuid, boolean) to service_role;
