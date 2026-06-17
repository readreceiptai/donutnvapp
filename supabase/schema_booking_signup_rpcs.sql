-- ============================================================================
-- DonutNV — Secure server-side RPCs for the two public write paths.
-- Already applied. Safe to re-run.
-- ============================================================================

-- Public booking: one server call inserts + routes the lead, returns id + token.
-- route_booking is then revoked from public callers (it runs inside here as definer).
create or replace function public.submit_booking(
  p_tenant uuid, p_contact_name text, p_contact_phone text, p_contact_email text,
  p_event_date date, p_start_time text, p_guests int, p_zip text, p_notes text,
  p_sms_consent boolean, p_marketing_consent boolean, p_consent_text_version text
) returns table (id uuid, tracking_token text)
language plpgsql security definer set search_path = public
as $$
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
    p_tenant, auth.uid(), p_contact_name, p_contact_phone, p_contact_email,
    p_event_date, p_start_time, p_guests, p_zip, p_notes,
    coalesce(p_sms_consent,false), coalesce(p_marketing_consent,false), p_consent_text_version
  ) returning bookings.id, bookings.tracking_token into v_id, v_token;
  perform public.route_booking(v_id);
  return query select v_id, v_token;
end;
$$;
grant execute on function public.submit_booking(uuid,text,text,text,date,text,int,text,text,boolean,boolean,text) to anon, authenticated;
revoke execute on function public.route_booking(uuid) from anon, authenticated;

-- Signup: profile + consents + home area atomically (consent paper trail can't be lost).
create or replace function public.complete_signup(
  p_tenant uuid, p_first_name text, p_last_name text, p_phone text, p_email text,
  p_zip text, p_birthday date, p_parent_email text,
  p_marketing_sms boolean, p_marketing_email boolean, p_consent_version text
) returns void
language plpgsql security definer set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  insert into public.profiles (id, tenant_id, first_name, last_name, phone, email, zip, birthday, parent_email)
  values (uid, p_tenant, p_first_name, p_last_name, p_phone, p_email, p_zip, p_birthday, p_parent_email)
  on conflict (id) do update set
    tenant_id = excluded.tenant_id, first_name = excluded.first_name, last_name = excluded.last_name,
    phone = excluded.phone, email = excluded.email, zip = excluded.zip,
    birthday = excluded.birthday, parent_email = excluded.parent_email;
  insert into public.consents (profile_id, tenant_id, kind, granted, text_version, source) values
    (uid, p_tenant, 'transactional_sms', true,                              p_consent_version, 'signup'),
    (uid, p_tenant, 'marketing_sms',     coalesce(p_marketing_sms, false),  p_consent_version, 'signup'),
    (uid, p_tenant, 'marketing_email',   coalesce(p_marketing_email, false),p_consent_version, 'signup');
  if p_zip is not null and length(p_zip) > 0 then
    insert into public.saved_areas (profile_id, tenant_id, label, zip)
    values (uid, p_tenant, 'Home', p_zip);
  end if;
end;
$$;
grant execute on function public.complete_signup(uuid,text,text,text,text,text,date,text,boolean,boolean,text) to authenticated;
