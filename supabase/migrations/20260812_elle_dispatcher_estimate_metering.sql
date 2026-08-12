-- ELLE project (nvxfkzwbiomnswcxiblq). Dispatcher estimate-metering.
-- Problem: only 3 of ~8 paid functions self-log actual spend, so several services
-- (LLM logged NOTHING) never accumulated month-to-date and their auto-caps could not
-- trip. Fix: the dispatcher now logs a conservative ESTIMATE at dispatch for the paid
-- functions that don't self-log, so every cap (apollo/apify/llm + global) sees all paid
-- usage. Self-loggers (enrich-business, maps-source, enrich-linkedin) are excluded to
-- avoid double counting. The estimate block is fully guarded and can never break
-- dispatch. Precise per-call logging + cost dashboard is tracked as task #58.
create or replace function public.elle_call_edge_function(p_fn_name text, p_payload jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $function$
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

  -- SPEND METER (estimate): conservative at-dispatch estimate for functions that don't
  -- self-log actual spend, so auto-caps count all paid usage. Never breaks dispatch.
  if v_request_id is not null then
    begin
      declare
        v_est_service text;
        v_est_units numeric;
        v_tenant uuid;
      begin
        v_est_service := case
          when p_fn_name in ('elle-enrich-event','elle-apollo-business','elle-enrich') then 'apollo'
          when p_fn_name = 'elle-press-gm'                                             then 'apify_press'
          when p_fn_name in ('elle-market-brief','elle-discover','elle-discover-events') then 'llm'
          else null end;
        v_est_units := case
          when v_est_service = 'apollo'      then 5
          when v_est_service = 'apify_press' then 1
          when v_est_service = 'llm'         then 200
          else 0 end;
        if v_est_service is not null then
          begin v_tenant := nullif(p_payload->>'tenant_id','')::uuid; exception when others then v_tenant := null; end;
          perform public.elle_log_spend(v_tenant, v_est_service, v_est_units, 'estimate', 'dispatch', p_fn_name, jsonb_build_object('estimated', true));
        end if;
      end;
    exception when others then
      raise notice 'elle_call_edge_function: estimate metering failed for % (dispatch unaffected)', p_fn_name;
    end;
  end if;

  return v_request_id;
end;
$function$;
