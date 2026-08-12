-- APP project (cfghtxfplkodjnndzmcf). Fix: Square webhook could lose or double a
-- loyalty stamp because it marked the event "processed" BEFORE writing the stamp and
-- did the writes non-transactionally. This RPC does dedup + deposit + sale + stamp in
-- ONE transaction: a crash rolls back the dedup claim too (Square retries cleanly),
-- and a genuine duplicate is skipped. square-webhook (v7) now calls this instead of
-- doing inline writes.
create or replace function public.process_square_sale(
  p_event_id text,
  p_square_location text,
  p_order_id text,
  p_payment_done boolean,
  p_phone text,
  p_amount_cents integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid; v_session uuid; v_profile uuid; v_campaign uuid; v_claimed text;
begin
  if p_event_id is not null then
    insert into processed_square_events(event_id) values (p_event_id)
      on conflict (event_id) do nothing
      returning event_id into v_claimed;
    if v_claimed is null then
      return jsonb_build_object('ok', true, 'duplicate', true);
    end if;
  end if;

  select id into v_tenant from tenants where square_location_id = p_square_location;
  if v_tenant is null then
    return jsonb_build_object('ok', true, 'skipped', 'unknown location');
  end if;

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
      update wallet_passes set needs_push = true, updated_at = now() where profile_id = v_profile;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'counted', true, 'stamped', v_profile is not null);
end$$;

revoke execute on function public.process_square_sale(text,text,text,boolean,text,integer) from public, anon, authenticated;
grant execute on function public.process_square_sale(text,text,text,boolean,text,integer) to service_role;
