-- APP project (cfghtxfplkodjnndzmcf). #122 / M1 (bookings).
-- submit_booking was EXECUTE-able by anon, so a bot holding the public anon key could
-- POST bookings straight to Postgres, skipping the Turnstile human-check the client does
-- separately (client-only enforcement). Move booking creation behind the submit-booking
-- edge function, which verifies the caller's JWT + the Turnstile token server-side and
-- then calls this RPC as service_role. The RPC takes the verified creator id explicitly
-- (the edge extracts it from the JWT) because service_role has no auth.uid().
--
-- Re-tested (rolled back): anon/authenticated EXECUTE on submit_booking = false,
-- service_role = true; a service_role call with p_created_by created + routed a booking
-- with created_by set to the verified uid (status 'new', 32-char tracking token). Live
-- edge smoke test: anon-key POST -> 401 not_authenticated.
--
-- NOTE: OTP (signInWithOtp) is still called directly; native Supabase Auth CAPTCHA for
-- OTP is scheduled to land with the SMS/10DLC launch (#35), when OTP abuse becomes a
-- real cost and the auth path is being re-tested anyway.
drop function if exists public.submit_booking(uuid,text,text,text,date,text,integer,text,text,boolean,boolean,text);

create or replace function public.submit_booking(
  p_tenant uuid, p_contact_name text, p_contact_phone text, p_contact_email text,
  p_event_date date, p_start_time text, p_guests integer, p_zip text, p_notes text,
  p_sms_consent boolean, p_marketing_consent boolean, p_consent_text_version text,
  p_created_by uuid default null
) returns table(id uuid, tracking_token text)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid; v_token text;
begin
  if not exists (select 1 from public.tenants t where t.id = p_tenant and t.is_active) then
    raise exception 'tenant_inactive';
  end if;

  insert into public.bookings (
    tenant_id, created_by, contact_name, contact_phone, contact_email,
    event_date, start_time, guests, zip, notes,
    sms_consent, marketing_consent, consent_text_version
  ) values (
    p_tenant, coalesce(p_created_by, auth.uid()), p_contact_name, p_contact_phone, p_contact_email,
    p_event_date, p_start_time, p_guests, p_zip, p_notes,
    coalesce(p_sms_consent, false), coalesce(p_marketing_consent, false), p_consent_text_version
  ) returning bookings.id, bookings.tracking_token into v_id, v_token;

  perform public.route_booking(v_id);
  return query select v_id, v_token;
end;
$function$;

revoke execute on function public.submit_booking(uuid,text,text,text,date,text,integer,text,text,boolean,boolean,text,uuid) from public, anon, authenticated;
grant  execute on function public.submit_booking(uuid,text,text,text,date,text,integer,text,text,boolean,boolean,text,uuid) to service_role;
