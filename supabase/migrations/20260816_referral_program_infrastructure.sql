-- Referral program infrastructure (additive). Applied to APP prod
-- (cfghtxfplkodjnndzmcf) on 2026-08-16 via the Supabase MCP; this file captures
-- it so a repo rebuild recreates the same schema (rebuild-safety).

-- 1) Per-member unique referral code + who referred them.
alter table public.profiles add column if not exists referral_code text;
alter table public.profiles add column if not exists referred_by uuid references public.profiles(id);
create unique index if not exists profiles_referral_code_key on public.profiles(referral_code) where referral_code is not null;

-- 2) Unambiguous 8-char code generator (no I/L/O/0/1). SECURITY DEFINER so the
--    signup-time trigger can check uniqueness regardless of RLS.
create or replace function public.gen_referral_code()
returns text language plpgsql security definer set search_path='public' as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text; i int; ok boolean;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random()*length(alphabet))::int, 1);
    end loop;
    select not exists(select 1 from public.profiles where referral_code = code) into ok;
    exit when ok;
  end loop;
  return code;
end $$;

-- 3) Auto-assign a code to every new member.
create or replace function public.set_referral_code()
returns trigger language plpgsql security definer set search_path='public' as $$
begin
  if new.referral_code is null then
    new.referral_code := public.gen_referral_code();
  end if;
  return new;
end $$;
drop trigger if exists trg_set_referral_code on public.profiles;
create trigger trg_set_referral_code before insert on public.profiles
for each row execute function public.set_referral_code();

-- 4) Backfill existing members one at a time (so uniqueness holds in-transaction).
do $$
declare r record;
begin
  for r in select id from public.profiles where referral_code is null loop
    update public.profiles set referral_code = public.gen_referral_code() where id = r.id;
  end loop;
end $$;

-- 5) Referral lifecycle table.
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  referrer_id uuid not null references public.profiles(id),
  referred_id uuid not null references public.profiles(id),
  code text,
  status text not null default 'pending',      -- pending | converted
  points_awarded int not null default 0,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (referred_id)
);
alter table public.referrals enable row level security;
drop policy if exists referrals_read_own on public.referrals;
create policy referrals_read_own on public.referrals for select
  using (referrer_id = auth.uid() or public.is_superadmin());
-- No insert/update policy: writes only via SECURITY DEFINER functions / service role.

-- 6) Configurable reward value per tenant (nullable = not set yet).
alter table public.loyalty_config add column if not exists referral_points int;

-- 7) Claim a referral at signup (called by the newly-created user).
create or replace function public.claim_referral(p_code text)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare me uuid := auth.uid(); my_tenant uuid; ref public.profiles%rowtype;
begin
  if me is null then return jsonb_build_object('ok',false,'reason','not_signed_in'); end if;
  if p_code is null or length(trim(p_code))=0 then return jsonb_build_object('ok',false,'reason','no_code'); end if;
  select * into ref from public.profiles where referral_code = upper(trim(p_code));
  if not found then return jsonb_build_object('ok',false,'reason','bad_code'); end if;
  if ref.id = me then return jsonb_build_object('ok',false,'reason','self_referral'); end if;
  select tenant_id into my_tenant from public.profiles where id = me;
  update public.profiles set referred_by = ref.id where id = me and referred_by is null;
  if not found then return jsonb_build_object('ok',false,'reason','already_referred'); end if;
  insert into public.referrals(tenant_id, referrer_id, referred_id, code, status)
    values (my_tenant, ref.id, me, ref.referral_code, 'pending')
    on conflict (referred_id) do nothing;
  return jsonb_build_object('ok',true);
end $$;
grant execute on function public.claim_referral(text) to authenticated;

-- 8) Convert + pay out on the referred friend's FIRST real purchase (source='square').
create or replace function public.referral_on_first_purchase()
returns trigger language plpgsql security definer set search_path='public' as $$
declare v_ref public.referrals%rowtype; v_pts int; v_prior int;
begin
  if new.source is distinct from 'square' or coalesce(new.delta_points,0) <= 0 then
    return new;
  end if;
  select * into v_ref from public.referrals where referred_id = new.profile_id and status='pending';
  if not found then return new; end if;
  select count(*) into v_prior from public.loyalty_ledger
    where profile_id = new.profile_id and source='square' and delta_points > 0 and id <> new.id;
  if v_prior > 0 then return new; end if;                 -- not their first purchase
  select referral_points into v_pts from public.loyalty_config where tenant_id = v_ref.tenant_id;
  v_pts := coalesce(v_pts, 0);
  update public.referrals set status='converted', converted_at=now(), points_awarded=v_pts
    where id = v_ref.id and status='pending';
  if v_pts > 0 then                                       -- value is 0/unset for now
    update public.profiles set points_balance = coalesce(points_balance,0)+v_pts,
      points_lifetime = coalesce(points_lifetime,0)+v_pts where id = v_ref.referrer_id;
    insert into public.loyalty_ledger(tenant_id, profile_id, delta_points, reason, source, ref)
      values (v_ref.tenant_id, v_ref.referrer_id, v_pts, 'referral bonus', 'referral', v_ref.id::text);
  end if;
  return new;
end $$;
drop trigger if exists trg_referral_on_first_purchase on public.loyalty_ledger;
create trigger trg_referral_on_first_purchase after insert on public.loyalty_ledger
for each row execute function public.referral_on_first_purchase();
