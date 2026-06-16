-- ============================================================================
-- DonutNV — Multi-tenant RLS hardening
-- Run AFTER schema.sql. Safe to run more than once.
--
-- Before: an operator could SELECT every tenant's customer profiles (the policy
-- allowed any operator to read all profiles). After: an operator only sees their
-- OWN territory's customers. Corporate/HQ rollups are unaffected — they use the
-- admin-gated get_corporate_metrics() SECURITY DEFINER function, not this policy.
-- ============================================================================

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select
  using (
    id = auth.uid()
    or parent_profile_id = auth.uid()
    or (public.is_operator() and tenant_id = public.current_tenant_id())
  );
