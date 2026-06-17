-- ============================================================================
-- DonutNV — Wallet passes (Apple Wallet / Google Wallet) + revenue attribution
-- Run AFTER schema.sql + schema_buzz.sql. Safe to run more than once.
--
-- Scaffold for the loyalty pass that lives in a customer's phone wallet. The
-- pass itself is signed by an Apple cert that doesn't exist until Apple approves
-- the HazBinz LLC developer enrollment — so the wallet-pass Edge Function
-- no-ops gracefully until the cert secret is set. Everything here (issuance
-- tracking, install tracking, metrics) works now so we can flip it on instantly.
-- ============================================================================

-- One wallet pass record per member per platform.
create table if not exists public.wallet_passes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  platform      text not null default 'apple' check (platform in ('apple','google')),
  serial_number text not null unique,
  auth_token    text not null,                 -- used by Apple's pass web service
  status        text not null default 'issued' check (status in ('issued','installed','revoked')),
  installed_at  timestamptz,
  needs_push    boolean not null default false, -- set true when stamps change; cleared after push
  last_pushed_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (profile_id, platform)
);
create index if not exists wallet_passes_tenant_idx on public.wallet_passes(tenant_id);
create index if not exists wallet_passes_needs_push_idx on public.wallet_passes(needs_push) where needs_push = true;

alter table public.wallet_passes enable row level security;

-- A member can see their own pass; operators can read their tenant's passes.
drop policy if exists wallet_passes_self on public.wallet_passes;
create policy wallet_passes_self on public.wallet_passes for select
  using (profile_id = auth.uid() or (public.is_operator() and tenant_id = public.current_tenant_id()));

-- A member may register their own pass row (the Edge Function uses service role,
-- which bypasses RLS, but this lets the client mark install state if needed).
drop policy if exists wallet_passes_self_ins on public.wallet_passes;
create policy wallet_passes_self_ins on public.wallet_passes for insert
  with check (profile_id = auth.uid());

-- Revenue attribution: capture the purchase amount so we can show how much
-- wallet members actually spend (the metric that justifies the $99/yr).
alter table public.check_ins   add column if not exists amount_cents integer;
alter table public.sales_events add column if not exists amount_cents integer;

-- Operator/admin metrics for the wallet program. SECURITY DEFINER but gated to
-- operators of the tenant. "Wallet member" = a profile with an installed pass.
create or replace function public.get_wallet_metrics(p_tenant uuid)
returns table (
  passes_issued           bigint,
  passes_installed        bigint,
  wallet_members          bigint,
  wallet_member_purchases bigint,
  wallet_member_revenue_cents bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.wallet_passes wp where wp.tenant_id = p_tenant),
    (select count(*) from public.wallet_passes wp where wp.tenant_id = p_tenant and wp.status = 'installed'),
    (select count(distinct wp.profile_id) from public.wallet_passes wp where wp.tenant_id = p_tenant and wp.status = 'installed'),
    (select count(*) from public.check_ins c
       where c.tenant_id = p_tenant
         and c.profile_id in (select profile_id from public.wallet_passes wp where wp.tenant_id = p_tenant and wp.status = 'installed')),
    coalesce((select sum(c.amount_cents) from public.check_ins c
       where c.tenant_id = p_tenant
         and c.profile_id in (select profile_id from public.wallet_passes wp where wp.tenant_id = p_tenant and wp.status = 'installed')), 0)
  where public.is_operator() and public.current_tenant_id() = p_tenant;
$$;

grant execute on function public.get_wallet_metrics(uuid) to authenticated;
