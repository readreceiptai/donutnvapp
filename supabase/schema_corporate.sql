-- ============================================================================
-- DonutNV — Corporate metrics (HQ super-admin)
-- Run AFTER schema.sql, schema_territory.sql, schema_reviews.sql.
-- Safe to run more than once.
--
-- Cross-territory rollup for corporate. SECURITY DEFINER so it can read across
-- tenants (past RLS), but it returns NOTHING unless the caller's profile.role
-- is 'admin' — so an operator can never see another territory's numbers.
-- ============================================================================

create or replace function public.get_corporate_metrics()
returns table (
  tenant_id   uuid,
  tenant_name text,
  app_active  boolean,
  customers   bigint,
  bookings    bigint,
  reviews     bigint,
  live_now    bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.name,
    coalesce(t.app_active, false),
    (select count(*) from public.profiles p where p.tenant_id = t.id and p.role = 'customer'),
    (select count(*) from public.bookings b where b.tenant_id = t.id),
    (select count(*) from public.reviews  r where r.tenant_id = t.id),
    (select count(*) from public.live_sessions ls
       where ls.tenant_id = t.id and ls.is_live = true
         and (ls.ends_at is null or ls.ends_at > now()))
  from public.tenants t
  where (select role from public.profiles where id = auth.uid()) = 'admin'
  order by t.name;
$$;

grant execute on function public.get_corporate_metrics() to authenticated;
