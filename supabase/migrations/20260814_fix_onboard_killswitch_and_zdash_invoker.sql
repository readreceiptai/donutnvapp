-- ELLE project. Two review fixes (applied live 2026-08-14):
-- P1-9: elle_onboard_territory fired its first discovery via a raw net.http_post,
--   skipping the spend governor / kill switch. All three discovery/enrichment calls now
--   go through elle_call_edge_function so the global cap + kill switch apply. The
--   paid_apis_enabled gate at the top is retained.
-- P1-7 (partial): elle_z_dashboard was not security_invoker, so a PostgREST caller could
--   read it bypassing underlying RLS. The app reads it via service role (unaffected).
create or replace function public.elle_onboard_territory(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path to 'public','vault','net' as $function$
declare firstzip text; nanchors int; v_paid boolean;
begin
  select paid_apis_enabled into v_paid from public.elle_tenants where id = p_tenant;
  if not coalesce(v_paid, false) then
    return jsonb_build_object('ok', false, 'skipped', 'paid_apis_disabled', 'tenant', p_tenant);
  end if;

  select count(*) into nanchors from public.elle_territory_anchors where tenant_id=p_tenant and watch;
  select zip into firstzip from public.elle_territory_zips where tenant_id=p_tenant and zip_type='owned' order by priority nulls last, zip limit 1;
  if firstzip is null then select zip into firstzip from public.elle_territory_zips where tenant_id=p_tenant order by zip limit 1; end if;

  if firstzip is not null then
    perform public.elle_call_edge_function('elle-discover', jsonb_build_object('tenant_id',p_tenant,'source','runsignup','zip',firstzip,'radius',35));
  end if;
  perform public.elle_call_edge_function('elle-discover-events', jsonb_build_object('tenant_id',p_tenant,'use_anchors',true));
  perform public.elle_call_edge_function('elle-apollo-business', jsonb_build_object('tenant_id',p_tenant,'employee_ranges',jsonb_build_array('100,200','200,300')));

  insert into public.elle_worker_runs(worker, tenant_id, summary)
    values ('elle-onboard', p_tenant, jsonb_build_object('firstzip',firstzip,'watch_anchors',nanchors,'ran_at',now()));
  return jsonb_build_object('ok',true,'tenant',p_tenant,'zip',firstzip,'watch_anchors',nanchors);
end $function$;

alter view public.elle_z_dashboard set (security_invoker = on);
