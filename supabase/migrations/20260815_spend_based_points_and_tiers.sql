-- ============================================================================
-- Spend-based points + tiers loyalty. Applied live to APP project
-- (cfghtxfplkodjnndzmcf) 2026-08-15 via MCP. Additive; reuses the sale path.
-- Earn 10 pts / $1 (config). 100 pts = $1 reward value (10% back).
-- ============================================================================

create table if not exists public.loyalty_config (
  tenant_id             uuid primary key references public.tenants(id) on delete cascade,
  earn_pts_per_dollar   integer not null default 10,
  redeem_pts_per_dollar integer not null default 100,
  free_dozen_pts        integer not null default 2000,
  tier_sprinkled_pts    integer not null default 5000,
  tier_golden_pts       integer not null default 20000,
  updated_at            timestamptz not null default now()
);
alter table public.loyalty_config enable row level security;
drop policy if exists loyalty_config_read on public.loyalty_config;
create policy loyalty_config_read on public.loyalty_config for select
  using (public.is_operator() and tenant_id = public.current_tenant_id());
insert into public.loyalty_config(tenant_id)
  select id from public.tenants on conflict (tenant_id) do nothing;

alter table public.profiles add column if not exists points_balance  integer not null default 0;
alter table public.profiles add column if not exists points_lifetime integer not null default 0;

create or replace function public.loyalty_tier(p_lifetime integer, p_tenant uuid)
returns text language sql stable as $fn$
  select case
    when p_lifetime >= coalesce((select tier_golden_pts    from public.loyalty_config where tenant_id = p_tenant), 20000) then 'Golden'
    when p_lifetime >= coalesce((select tier_sprinkled_pts from public.loyalty_config where tenant_id = p_tenant), 5000)  then 'Sprinkled'
    else 'Glazed' end;
$fn$;

create table if not exists public.loyalty_ledger (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  delta_points integer not null,
  reason       text not null,
  source       text,
  ref          text,
  created_at   timestamptz not null default now()
);
create index if not exists loyalty_ledger_profile_idx on public.loyalty_ledger(profile_id, created_at desc);
alter table public.loyalty_ledger enable row level security;
drop policy if exists loyalty_ledger_self on public.loyalty_ledger;
create policy loyalty_ledger_self on public.loyalty_ledger for select
  using (profile_id = auth.uid() or (public.is_operator() and tenant_id = public.current_tenant_id()));

create or replace function public.get_member_rewards(p_profile uuid)
returns table(points_balance int, points_lifetime int, tier text, reward_dollars numeric, free_dozen_pts int, to_free_dozen int)
language sql stable security definer set search_path = public as $fn$
  select pr.points_balance, pr.points_lifetime,
         public.loyalty_tier(pr.points_lifetime, pr.tenant_id),
         round(pr.points_balance::numeric / coalesce((select redeem_pts_per_dollar from public.loyalty_config where tenant_id = pr.tenant_id), 100), 2),
         coalesce((select free_dozen_pts from public.loyalty_config where tenant_id = pr.tenant_id), 2000),
         greatest(0, coalesce((select free_dozen_pts from public.loyalty_config where tenant_id = pr.tenant_id), 2000) - pr.points_balance)
  from public.profiles pr where pr.id = p_profile;
$fn$;
grant execute on function public.get_member_rewards(uuid) to authenticated;
grant execute on function public.loyalty_tier(integer, uuid) to authenticated;

create or replace function public.redeem_points(p_profile uuid, p_points integer, p_reason text default 'redeem', p_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_tenant uuid; v_bal int;
begin
  select tenant_id, points_balance into v_tenant, v_bal from public.profiles where id = p_profile;
  if v_tenant is null then return jsonb_build_object('ok', false, 'error', 'no profile'); end if;
  if p_points <= 0 then return jsonb_build_object('ok', false, 'error', 'bad amount'); end if;
  if v_bal < p_points then return jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', v_bal); end if;
  update public.profiles set points_balance = points_balance - p_points where id = p_profile;
  insert into public.loyalty_ledger(tenant_id, profile_id, delta_points, reason, ref) values (v_tenant, p_profile, -p_points, p_reason, p_ref);
  update public.wallet_passes set needs_push = true, updated_at = now() where profile_id = p_profile;
  return jsonb_build_object('ok', true, 'balance', v_bal - p_points);
end $fn$;

-- process_square_sale extended to award spend-based points in the matched-customer block.
create or replace function public.process_square_sale(p_event_id text, p_square_location text, p_order_id text, p_payment_done boolean, p_phone text, p_amount_cents integer)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_tenant uuid; v_session uuid; v_profile uuid; v_campaign uuid; v_claimed text;
  v_rate integer; v_pts integer := 0;
begin
  if p_event_id is not null then
    insert into processed_square_events(event_id) values (p_event_id)
      on conflict (event_id) do nothing returning event_id into v_claimed;
    if v_claimed is null then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  end if;

  select id into v_tenant from tenants where square_location_id = p_square_location;
  if v_tenant is null then return jsonb_build_object('ok', true, 'skipped', 'unknown location'); end if;

  if p_order_id is not null and p_payment_done then
    update bookings set deposit_status = 'paid', deposit_paid_at = now()
      where square_order_id = p_order_id and deposit_status is distinct from 'paid'
        and (deposit_amount_cents is null or (p_amount_cents is not null and p_amount_cents >= deposit_amount_cents));
  end if;

  select id into v_session from live_sessions
    where tenant_id = v_tenant and is_live = true and ends_at > now()
    order by ends_at desc limit 1;
  insert into sales_events(tenant_id, session_id, source, amount_cents)
    values (v_tenant, v_session, 'square', p_amount_cents);

  if p_phone is not null then
    select id into v_profile from profiles where tenant_id = v_tenant and phone = p_phone;
    if v_profile is not null then
      select id into v_campaign from campaigns
        where tenant_id = v_tenant and kind = 'checkin_stamp' and is_active = true
        order by created_at desc limit 1;
      insert into check_ins(profile_id, tenant_id, campaign_id, source, amount_cents)
        values (v_profile, v_tenant, v_campaign, 'square', p_amount_cents);

      select coalesce(earn_pts_per_dollar, 10) into v_rate from loyalty_config where tenant_id = v_tenant;
      v_pts := floor(coalesce(p_amount_cents, 0) * coalesce(v_rate, 10) / 100.0);
      if v_pts > 0 then
        update profiles set points_balance = points_balance + v_pts, points_lifetime = points_lifetime + v_pts where id = v_profile;
        insert into loyalty_ledger(tenant_id, profile_id, delta_points, reason, source, ref)
          values (v_tenant, v_profile, v_pts, 'earn', 'square', p_order_id);
      end if;

      update wallet_passes set needs_push = true, updated_at = now() where profile_id = v_profile;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'counted', true, 'stamped', v_profile is not null, 'points_awarded', coalesce(v_pts, 0));
end$function$;

-- Backfill balances from historical matched Square spend.
with earned as (
  select c.profile_id, c.tenant_id,
         floor(sum(coalesce(c.amount_cents, 0)) * coalesce(lc.earn_pts_per_dollar, 10) / 100.0)::int as pts
  from public.check_ins c
  left join public.loyalty_config lc on lc.tenant_id = c.tenant_id
  group by c.profile_id, c.tenant_id, lc.earn_pts_per_dollar
)
update public.profiles p set points_balance = e.pts, points_lifetime = e.pts
from earned e where e.profile_id = p.id and e.pts > 0;

insert into public.loyalty_ledger(tenant_id, profile_id, delta_points, reason)
  select tenant_id, id, points_lifetime, 'backfill' from public.profiles where points_lifetime > 0;
