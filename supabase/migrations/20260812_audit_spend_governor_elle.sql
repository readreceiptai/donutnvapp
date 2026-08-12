-- =====================================================================
-- Audit snapshot: ELLE spend governor (caps + alerts + ledger + API lockdown)
-- Project: ELLE  (nvxfkzwbiomnswcxiblq)
-- Captured: 2026-08-12
--
-- Current-state reconstruction of today's spend-governance objects, pulled
-- live from the ELLE database. Tables are reconstructed from information_schema
-- + pg_constraint/pg_indexes; functions and views are verbatim (pg_get_functiondef
-- / pg_get_viewdef). Config seed rows for rates + caps are included at the end.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SECTION 1: TABLES
-- ---------------------------------------------------------------------

-- Table: public.elle_spend_ledger  (append-only spend log; RLS enabled)
create table if not exists public.elle_spend_ledger (
  id           uuid        not null default gen_random_uuid(),
  tenant_id    uuid,
  service      text        not null,
  phase        text        not null default 'recurring'::text,
  units        numeric     not null default 0,
  unit_cost    numeric     not null default 0,
  dollar_cost  numeric     not null default 0,
  ref_type     text,
  ref_id       text,
  meta         jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  constraint elle_spend_ledger_pkey primary key (id),
  constraint elle_spend_ledger_tenant_id_fkey foreign key (tenant_id) references public.elle_tenants(id) on delete cascade
);
alter table public.elle_spend_ledger enable row level security;
create index if not exists idx_spend_phase          on public.elle_spend_ledger using btree (tenant_id, phase);
create index if not exists idx_spend_tenant_service on public.elle_spend_ledger using btree (tenant_id, service);
create index if not exists idx_spend_tenant_time    on public.elle_spend_ledger using btree (tenant_id, created_at desc);

-- Table: public.elle_service_rates  (config: per-unit cost per service; RLS enabled)
create table if not exists public.elle_service_rates (
  service     text        not null,
  unit_cost   numeric     not null default 0,
  unit_label  text,
  note        text,
  updated_at  timestamptz not null default now(),
  constraint elle_service_rates_pkey primary key (service)
);
alter table public.elle_service_rates enable row level security;

-- Table: public.elle_spend_caps  (config: monthly ceilings + kill switch; RLS enabled)
create table if not exists public.elle_spend_caps (
  cap_key       text        not null,
  monthly_usd   numeric,
  monthly_units numeric,
  enabled       boolean     not null default true,
  note          text,
  updated_at    timestamptz not null default now(),
  warn_at_pct   numeric     not null default 0.80,
  constraint elle_spend_caps_pkey primary key (cap_key)
);
alter table public.elle_spend_caps enable row level security;

-- Table: public.elle_spend_alerts  (warn/breach events, deduped per month; RLS enabled)
create table if not exists public.elle_spend_alerts (
  id            uuid        not null default gen_random_uuid(),
  period_month  date        not null default (date_trunc('month'::text, now()))::date,
  cap_key       text        not null,
  level         text        not null,
  metric        text        not null,
  mtd           numeric     not null,
  cap           numeric     not null,
  created_at    timestamptz not null default now(),
  delivered     boolean     not null default false,
  delivered_at  timestamptz,
  constraint elle_spend_alerts_pkey primary key (id),
  constraint elle_spend_alerts_period_month_cap_key_level_metric_key unique (period_month, cap_key, level, metric)
);
alter table public.elle_spend_alerts enable row level security;

-- ---------------------------------------------------------------------
-- SECTION 2: FUNCTIONS  (verbatim, via pg_get_functiondef)
-- ---------------------------------------------------------------------

-- Function: public.elle_log_spend
CREATE OR REPLACE FUNCTION public.elle_log_spend(p_tenant uuid, p_service text, p_units numeric, p_phase text DEFAULT 'recurring'::text, p_ref_type text DEFAULT NULL::text, p_ref_id text DEFAULT NULL::text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_rate numeric;
begin
  select unit_cost into v_rate from public.elle_service_rates where service = p_service;
  v_rate := coalesce(v_rate, 0);
  insert into public.elle_spend_ledger
    (tenant_id, service, phase, units, unit_cost, dollar_cost, ref_type, ref_id, meta)
  values
    (p_tenant, p_service, coalesce(p_phase,'recurring'), coalesce(p_units,0), v_rate,
     coalesce(p_units,0) * v_rate, p_ref_type, p_ref_id, coalesce(p_meta,'{}'::jsonb));
end;$function$

-- Function: public.elle_spend_group
CREATE OR REPLACE FUNCTION public.elle_spend_group(p_service text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_service = 'apollo'        then 'apollo'
    when p_service like 'apify%'     then 'apify'
    when p_service = 'llm'           then 'llm'
    when p_service = 'geocoding'     then 'geocoding'
    else 'other' end;
$function$

-- Function: public.elle_spend_allowed
CREATE OR REPLACE FUNCTION public.elle_spend_allowed(p_service text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_group text := elle_spend_group(p_service);
  v_month timestamptz := date_trunc('month', now());
  v_global_usd numeric; v_group_usd numeric; v_group_units numeric;
  v_gcap numeric; v_kill boolean;
  v_grp_usd_cap numeric; v_grp_units_cap numeric; v_grp_enabled boolean;
begin
  select monthly_usd, coalesce(enabled,true) into v_gcap, v_kill
    from elle_spend_caps where cap_key='global';
  if v_kill is false then
    return jsonb_build_object('allowed', false, 'reason', 'kill_switch');
  end if;

  select coalesce(sum(dollar_cost),0) into v_global_usd
    from elle_spend_ledger where created_at >= v_month;
  select coalesce(sum(dollar_cost),0), coalesce(sum(units),0)
    into v_group_usd, v_group_units
    from elle_spend_ledger where created_at >= v_month and elle_spend_group(service) = v_group;

  if v_gcap is not null and v_global_usd >= v_gcap then
    return jsonb_build_object('allowed', false, 'reason', 'global_cap',
      'mtd_global_usd', v_global_usd, 'cap', v_gcap);
  end if;

  select monthly_usd, monthly_units, coalesce(enabled,true)
    into v_grp_usd_cap, v_grp_units_cap, v_grp_enabled
    from elle_spend_caps where cap_key = v_group;

  if v_grp_enabled is false then
    return jsonb_build_object('allowed', false, 'reason', v_group||'_disabled');
  end if;
  if v_grp_usd_cap is not null and v_group_usd >= v_grp_usd_cap then
    return jsonb_build_object('allowed', false, 'reason', v_group||'_usd_cap',
      'mtd_group_usd', v_group_usd, 'cap', v_grp_usd_cap);
  end if;
  if v_grp_units_cap is not null and v_group_units >= v_grp_units_cap then
    return jsonb_build_object('allowed', false, 'reason', v_group||'_units_cap',
      'mtd_group_units', v_group_units, 'cap', v_grp_units_cap);
  end if;

  return jsonb_build_object('allowed', true, 'reason', 'ok',
    'mtd_global_usd', v_global_usd, 'mtd_group_usd', v_group_usd, 'mtd_group_units', v_group_units);
end;$function$

-- Function: public.elle_spend_evaluate
CREATE OR REPLACE FUNCTION public.elle_spend_evaluate()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_month date := date_trunc('month', now())::date;
  v_mstart timestamptz := date_trunc('month', now());
  rec record;
  v_out jsonb := '[]'::jsonb;
begin
  for rec in
    with mtd as (
      select 'global'::text grp, coalesce(sum(dollar_cost),0) usd, 0::numeric units
        from public.elle_spend_ledger where created_at >= v_mstart
      union all
      select public.elle_spend_group(service), coalesce(sum(dollar_cost),0), coalesce(sum(units),0)
        from public.elle_spend_ledger where created_at >= v_mstart group by 1
    )
    select c.cap_key, c.monthly_usd, c.monthly_units, c.warn_at_pct,
           coalesce(m.usd,0) usd, coalesce(m.units,0) units
      from public.elle_spend_caps c
      left join mtd m on m.grp = c.cap_key
  loop
    if rec.monthly_usd is not null then
      if rec.usd >= rec.monthly_usd then
        perform public._spend_alert(v_month, rec.cap_key, 'breach', 'usd', rec.usd, rec.monthly_usd);
      elsif rec.usd >= rec.warn_at_pct * rec.monthly_usd then
        perform public._spend_alert(v_month, rec.cap_key, 'warn', 'usd', rec.usd, rec.monthly_usd);
      end if;
    end if;
    if rec.monthly_units is not null then
      if rec.units >= rec.monthly_units then
        perform public._spend_alert(v_month, rec.cap_key, 'breach', 'units', rec.units, rec.monthly_units);
      elsif rec.units >= rec.warn_at_pct * rec.monthly_units then
        perform public._spend_alert(v_month, rec.cap_key, 'warn', 'units', rec.units, rec.monthly_units);
      end if;
    end if;
  end loop;

  with d as (
    update public.elle_spend_alerts set delivered = true, delivered_at = now()
    where delivered = false
    returning cap_key, level, metric, mtd, cap, period_month
  )
  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into v_out from d;
  return v_out;
end;$function$

-- Function: public._spend_alert
CREATE OR REPLACE FUNCTION public._spend_alert(p_month date, p_cap text, p_level text, p_metric text, p_mtd numeric, p_cap_val numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.elle_spend_alerts (period_month, cap_key, level, metric, mtd, cap)
  values (p_month, p_cap, p_level, p_metric, p_mtd, p_cap_val)
  on conflict (period_month, cap_key, level, metric) do nothing;
end;$function$

-- Function: public.elle_call_edge_function
CREATE OR REPLACE FUNCTION public.elle_call_edge_function(p_fn_name text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'net'
AS $function$
declare
  v_key text;
  v_request_id bigint;
  v_service text;
  v_gate jsonb;
begin
  -- SPEND GOVERNOR: block paid functions when their cap is hit or the kill switch is on.
  v_service := case
    when p_fn_name in ('elle-enrich-business','elle-enrich-event','elle-apollo-business','elle-enrich') then 'apollo'
    when p_fn_name in ('elle-enrich-linkedin','elle-maps-source','elle-press-gm')                       then 'apify'
    when p_fn_name in ('elle-market-brief','elle-discover','elle-discover-events')                      then 'llm'
    else null
  end;
  if v_service is not null then
    v_gate := public.elle_spend_allowed(v_service);
    if coalesce((v_gate->>'allowed')::boolean, true) is not true then
      raise notice 'elle_call_edge_function: % BLOCKED by spend governor (%)', p_fn_name, v_gate->>'reason';
      return null;  -- do not dispatch; no paid API call happens
    end if;
  end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'elle_service_role_key' limit 1;
  if v_key is null then raise exception 'elle_service_role_key not found in vault'; end if;

  select net.http_post(
    url := 'https://nvxfkzwbiomnswcxiblq.supabase.co/functions/v1/' || p_fn_name,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := p_payload,
    timeout_milliseconds := 120000
  ) into v_request_id;
  return v_request_id;
end;
$function$

-- ---------------------------------------------------------------------
-- SECTION 3: VIEWS  (verbatim body via pg_get_viewdef)
-- NOTE: both elle_spend_rollup and elle_spend_by_service are security_invoker views.
-- ---------------------------------------------------------------------

-- View: public.elle_spend_rollup  (security_invoker = true)
create or replace view public.elle_spend_rollup with (security_invoker = true) as
 SELECT t.id AS tenant_id,
    t.franchise_name,
    COALESCE(sum(l.dollar_cost) FILTER (WHERE l.phase = 'onboarding'::text), 0::numeric) AS onboarding_cost,
    COALESCE(sum(l.dollar_cost) FILTER (WHERE l.created_at > (now() - '7 days'::interval)), 0::numeric) AS cost_7d,
    COALESCE(sum(l.dollar_cost) FILTER (WHERE l.created_at > (now() - '30 days'::interval)), 0::numeric) AS cost_30d,
    COALESCE(sum(l.dollar_cost), 0::numeric) AS cost_total,
    count(l.id) AS n_charges,
    max(l.created_at) AS last_spend_at
   FROM elle_tenants t
     LEFT JOIN elle_spend_ledger l ON l.tenant_id = t.id
  GROUP BY t.id, t.franchise_name;

-- View: public.elle_spend_by_service  (security_invoker = true)
create or replace view public.elle_spend_by_service with (security_invoker = true) as
 SELECT tenant_id,
    service,
    sum(units) AS units,
    sum(dollar_cost) AS dollar_cost,
    count(*) AS n
   FROM elle_spend_ledger
  GROUP BY tenant_id, service;

-- ---------------------------------------------------------------------
-- SECTION 4: API SURFACE LOCKDOWN  (today's Fix 1, verbatim)
-- ---------------------------------------------------------------------

-- Fix 1: lock ELLE API surface to service_role only
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public grant execute on functions to service_role;

-- ---------------------------------------------------------------------
-- SECTION 5: CONFIG SEED ROWS  (service rates + spend caps)
-- Config values only -- no secrets. Safe to keep in the repo.
-- ---------------------------------------------------------------------

insert into public.elle_service_rates (service, unit_cost, unit_label, note) values
  ('apify_linkedin', 0.30, 'run', 'PLACEHOLDER: Apify LinkedIn employees actor per run.'),
  ('apify_places', 0.20, 'run', 'PLACEHOLDER: Apify Google Places crawler per run.'),
  ('apify_press', 0.15, 'run', 'PLACEHOLDER: Apify RAG web browser (press/GM) per run.'),
  ('apollo', 0.05, 'credit', 'PLACEHOLDER: Apollo per-match credit. Set to real plan cost.'),
  ('geocoding', 0.005, 'call', 'PLACEHOLDER: Google geocoding per call.'),
  ('llm', 0.001, '1k_tokens', 'PLACEHOLDER: blended LLM per 1k tokens.')
on conflict (service) do nothing;

insert into public.elle_spend_caps (cap_key, monthly_usd, monthly_units, enabled, note, warn_at_pct) values
  ('apify', 50, null, true, 'Apify LinkedIn + Places + press per month.', 0.80),
  ('apollo', 1000, 20000, true, 'Apollo: dollar AND credit ceilings per month.', 0.80),
  ('geocoding', 100, null, true, 'Google geocoding per month.', 0.80),
  ('global', 2500, null, true, 'Overall monthly ceiling across ALL paid services and tenants. enabled=false is the master kill switch.', 0.80),
  ('llm', 1000, null, true, 'LLM tokens per month.', 0.80)
on conflict (cap_key) do nothing;
