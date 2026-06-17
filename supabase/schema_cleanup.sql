-- ============================================================================
-- DonutNV — Review cleanup batch 2 (already applied; safe to re-run)
-- ============================================================================

-- M6: corporate rollup is superadmin-only (a per-tenant 'admin' must not see
-- every tenant's aggregates).
create or replace function public.get_corporate_metrics()
returns table (
  tenant_id uuid, tenant_name text, app_active boolean,
  customers bigint, bookings bigint, reviews bigint, live_now bigint
)
language sql stable security definer set search_path = public
as $$
  select t.id, t.name, coalesce(t.app_active, false),
    (select count(*) from public.profiles p where p.tenant_id = t.id and p.role = 'customer'),
    (select count(*) from public.bookings b where b.tenant_id = t.id),
    (select count(*) from public.reviews  r where r.tenant_id = t.id),
    (select count(*) from public.live_sessions ls
       where ls.tenant_id = t.id and ls.is_live = true
         and (ls.ends_at is null or ls.ends_at > now()))
  from public.tenants t
  where public.is_superadmin()
  order by t.name;
$$;
grant execute on function public.get_corporate_metrics() to authenticated;

-- LOW: trigger functions are not meant to be public RPCs (they run as triggers
-- with owner privileges regardless of these grants).
revoke execute on function public.auto_superadmin()   from anon, authenticated;
revoke execute on function public.guard_profile_role() from anon, authenticated;
revoke execute on function public.touch_updated_at()   from anon, authenticated;

-- M1: Square webhook idempotency — dedupe at-least-once deliveries.
create table if not exists public.processed_square_events (
  event_id     text primary key,
  processed_at timestamptz not null default now()
);
alter table public.processed_square_events enable row level security;
-- service-role only (no policies); the webhook writes it, nobody reads via API.
