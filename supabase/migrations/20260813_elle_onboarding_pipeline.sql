-- One-button onboarding pipeline (#48). Free stages always run; paid stages (market
-- report, discovery, enrichment) only when the Z is confirmed (paid_apis_enabled). Every
-- stage is tracked in elle_onboarding (status readout / sales artifact). Also closes a
-- spend gap: elle_onboard_territory now refuses to spend on an unconfirmed tenant, and
-- confirming a Z kicks off its paid cold-load automatically.

create table if not exists public.elle_onboarding (
  tenant_id  uuid not null,
  stage      text not null,   -- intake | params | seed | market_report | discovery | enrichment | crons
  status     text not null default 'pending', -- pending|done|skipped|awaiting_confirm|running|error
  detail     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, stage)
);

create or replace function public._elle_set_stage(p_tenant uuid, p_stage text, p_status text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.elle_onboarding (tenant_id, stage, status, detail, updated_at)
  values (p_tenant, p_stage, p_status, p_detail, now())
  on conflict (tenant_id, stage) do update set status = excluded.status, detail = excluded.detail, updated_at = now();
$$;

-- Safety gate on the existing territory onboarder: never spend on an unconfirmed tenant.
create or replace function public.elle_onboard_territory(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path to 'public','vault','net' as $function$
declare csecret text; anon text; firstzip text; nanchors int; v_paid boolean;
begin
  select paid_apis_enabled into v_paid from public.elle_tenants where id = p_tenant;
  if not coalesce(v_paid, false) then
    return jsonb_build_object('ok', false, 'skipped', 'paid_apis_disabled', 'tenant', p_tenant);
  end if;

  select count(*) into nanchors from public.elle_territory_anchors where tenant_id=p_tenant and watch;
  select zip into firstzip from public.elle_territory_zips where tenant_id=p_tenant and zip_type='owned' order by priority nulls last, zip limit 1;
  if firstzip is null then select zip into firstzip from public.elle_territory_zips where tenant_id=p_tenant order by zip limit 1; end if;

  select decrypted_secret into csecret from vault.decrypted_secrets where name='elle_cron_secret';
  select decrypted_secret into anon    from vault.decrypted_secrets where name='elle_anon_key';
  if firstzip is not null then
    perform net.http_post(url:='https://nvxfkzwbiomnswcxiblq.supabase.co/functions/v1/elle-discover',
      headers:=jsonb_build_object('content-type','application/json','x-cron-secret',csecret,'authorization','Bearer '||anon,'apikey',anon),
      body:=jsonb_build_object('tenant_id',p_tenant,'source','runsignup','zip',firstzip,'radius',35), timeout_milliseconds:=120000);
  end if;
  perform public.elle_call_edge_function('elle-discover-events', jsonb_build_object('tenant_id',p_tenant,'use_anchors',true));
  perform public.elle_call_edge_function('elle-apollo-business', jsonb_build_object('tenant_id',p_tenant,'employee_ranges',jsonb_build_array('100,200','200,300')));

  insert into public.elle_worker_runs(worker, tenant_id, summary)
    values ('elle-onboard', p_tenant, jsonb_build_object('firstzip',firstzip,'watch_anchors',nanchors,'ran_at',now()));
  return jsonb_build_object('ok',true,'tenant',p_tenant,'zip',firstzip,'watch_anchors',nanchors);
end $function$;

-- The one button. Free stages always; paid stages gated on confirm.
create or replace function public.elle_provision_tenant(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_paid boolean; v_zips int; v_owned int;
begin
  select paid_apis_enabled into v_paid from public.elle_tenants where id = p_tenant;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such tenant'); end if;

  select count(*), count(*) filter (where zip_type='owned') into v_zips, v_owned
    from public.elle_territory_zips where tenant_id = p_tenant;
  perform public._elle_set_stage(p_tenant, 'intake',
    case when v_zips > 0 then 'done' else 'error' end,
    jsonb_build_object('territory_zips', v_zips, 'owned_zips', v_owned));

  insert into public.elle_tenant_params (tenant_id) values (p_tenant) on conflict (tenant_id) do nothing;
  perform public._elle_set_stage(p_tenant, 'params', 'done', '{}'::jsonb);
  perform public._elle_set_stage(p_tenant, 'seed', 'done', jsonb_build_object('note','example leads auto-seeded (free)'));

  if coalesce(v_paid, false) then
    perform public.elle_call_edge_function('elle-market-brief', jsonb_build_object('tenant_id', p_tenant));
    perform public._elle_set_stage(p_tenant, 'market_report', 'running', '{}'::jsonb);
    perform public.elle_onboard_territory(p_tenant);
    perform public._elle_set_stage(p_tenant, 'discovery', 'running', '{}'::jsonb);
    perform public._elle_set_stage(p_tenant, 'enrichment', 'running', '{}'::jsonb);
  else
    perform public._elle_set_stage(p_tenant, 'market_report', 'awaiting_confirm', '{}'::jsonb);
    perform public._elle_set_stage(p_tenant, 'discovery', 'awaiting_confirm', '{}'::jsonb);
    perform public._elle_set_stage(p_tenant, 'enrichment', 'awaiting_confirm', '{}'::jsonb);
  end if;

  perform public._elle_set_stage(p_tenant, 'crons', 'done', jsonb_build_object('note','weekly discovery/enrichment run once confirmed'));

  return jsonb_build_object('ok', true, 'tenant', p_tenant, 'paid_enabled', coalesce(v_paid,false),
    'stages', (select jsonb_agg(jsonb_build_object('stage',stage,'status',status) order by stage) from public.elle_onboarding where tenant_id = p_tenant));
end$$;

-- On confirm: clear examples AND kick off the paid cold-load.
create or replace function public.elle_tenants_confirm_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.paid_apis_enabled and not coalesce(old.paid_apis_enabled, false) then
    perform public.elle_clear_examples(new.id);
    perform public.elle_provision_tenant(new.id);
  end if;
  return new;
end$$;

revoke execute on function public.elle_provision_tenant(uuid), public._elle_set_stage(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.elle_provision_tenant(uuid) to service_role;