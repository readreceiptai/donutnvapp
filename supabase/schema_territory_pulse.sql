-- ============================================================================
-- DonutNV — Territory activity pulse (franchisee engagement)
-- Run AFTER schema.sql + schema_buzz.sql + schema_wallet.sql. Safe to re-run.
--
-- Powers the "Your Territory This Week" pulse for operators: signups, donuts
-- served, bookings, reviews, wallet installs — all from our own data, near-zero
-- cost. Drives the in-app card and the (scheduled) digest send. Operator-gated.
-- ============================================================================

create or replace function public.get_territory_pulse(p_tenant uuid)
returns table (
  signups_today    bigint,
  signups_week     bigint,
  served_week      bigint,
  revenue_week_cents bigint,
  bookings_week    bigint,
  reviews_week     bigint,
  wallet_week      bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.profiles p
       where p.tenant_id = p_tenant and p.role = 'customer'
         and p.created_at >= date_trunc('day', now())),
    (select count(*) from public.profiles p
       where p.tenant_id = p_tenant and p.role = 'customer'
         and p.created_at >= now() - interval '7 days'),
    (select count(*) from public.sales_events s
       where s.tenant_id = p_tenant and s.created_at >= now() - interval '7 days'),
    coalesce((select sum(s.amount_cents) from public.sales_events s
       where s.tenant_id = p_tenant and s.created_at >= now() - interval '7 days'), 0),
    (select count(*) from public.bookings b
       where b.tenant_id = p_tenant and b.created_at >= now() - interval '7 days'),
    (select count(*) from public.reviews r
       where r.tenant_id = p_tenant and r.created_at >= now() - interval '7 days'),
    (select count(*) from public.wallet_passes w
       where w.tenant_id = p_tenant and w.created_at >= now() - interval '7 days')
  where public.is_operator() and public.current_tenant_id() = p_tenant;
$$;

grant execute on function public.get_territory_pulse(uuid) to authenticated;
