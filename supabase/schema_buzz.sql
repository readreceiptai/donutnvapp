-- ============================================================================
-- DonutNV — "Buzz" served-count (real-time, from Square)
-- Run AFTER schema.sql. Safe to run more than once.
--
-- Every Square sale becomes a sales_events row (one per payment ≈ one customer
-- served), written by the square-webhook function. get_buzz() returns today's
-- count for a territory — an anonymous aggregate (no names, no locations) that
-- powers the "🍩 X served today" badge and the buzz crowd on the Find map.
-- ============================================================================

create table if not exists public.sales_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  session_id  uuid references public.live_sessions(id) on delete set null,
  source      text not null default 'square',
  created_at  timestamptz not null default now()
);
create index if not exists sales_events_tenant_time_idx
  on public.sales_events(tenant_id, created_at desc);

alter table public.sales_events enable row level security;

-- Operators can read their own tenant's sales events; inserts come from the
-- webhook (service role), which bypasses RLS.
drop policy if exists sales_ops on public.sales_events;
create policy sales_ops on public.sales_events for select
  using (public.is_operator() and tenant_id = public.current_tenant_id());

-- Public, anonymous "served today" count for the live map buzz.
create or replace function public.get_buzz(p_tenant uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.sales_events
  where tenant_id = p_tenant
    and created_at >= date_trunc('day', now());
$$;

grant execute on function public.get_buzz(uuid) to anon, authenticated;
