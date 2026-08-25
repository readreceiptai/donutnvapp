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
-- FIRST-TOUCH OWNERSHIP (#57): the tenant that first signs a customer up owns them
-- (profiles.tenant_id is what operator RLS/roster keys on). A re-signup by the same
-- identity is a returning-customer event -- it NEVER moves the customer to another
-- tenant, never wipes stored data or loyalty, and never nulls a blank-left field.
-- Cross-territory service is a per-booking concern (owner_tenant_id / route_booking).
create or replace function public.complete_signup(
  p_tenant uuid, p_first_name text, p_last_name text, p_phone text, p_email text,
  p_zip text, p_birthday date, p_parent_email text,
  p_marketing_sms boolean, p_marketing_email boolean, p_consent_version text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing public.profiles%rowtype;
  v_tenant uuid;
  v_last boolean;
  k record;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  select * into existing from public.profiles where id = uid;

  -- Home tenant is set once, at first signup, and never changed by a re-signup.
  v_tenant := coalesce(existing.tenant_id, p_tenant);
  if v_tenant is null then raise exception 'no_tenant'; end if;

  if existing.id is null then
    insert into public.profiles (id, tenant_id, first_name, last_name, phone, email, zip, birthday, parent_email)
    values (uid, v_tenant,
            nullif(btrim(p_first_name), ''), nullif(btrim(p_last_name), ''),
            nullif(btrim(p_phone), ''),      nullif(btrim(p_email), ''),
            nullif(btrim(p_zip), ''),        p_birthday, nullif(btrim(p_parent_email), ''));
  else
    -- Returning customer: fill/refresh contact fields only, from non-empty values so
    -- a blank never wipes stored data. tenant_id, owner_tenant_id, role, is_superadmin,
    -- points_*, referral_code, referred_by, parent_profile_id, created_at are untouched.
    update public.profiles set
      first_name   = coalesce(nullif(btrim(p_first_name), ''), first_name),
      last_name    = coalesce(nullif(btrim(p_last_name),  ''), last_name),
      phone        = coalesce(nullif(btrim(p_phone),      ''), phone),
      email        = coalesce(nullif(btrim(p_email),      ''), email),
      zip          = coalesce(nullif(btrim(p_zip),        ''), zip),
      birthday     = coalesce(p_birthday, birthday),
      parent_email = coalesce(nullif(btrim(p_parent_email), ''), parent_email),
      updated_at   = now()
    where id = uid;
  end if;

  -- Consents (append-only audit log): record a row per kind only when there is no
  -- prior record or the value changed from the latest one -- identical re-signups
  -- don't bloat the trail, but a genuine opt-in/opt-out is captured.
  for k in
    select * from (values
      ('transactional_sms', true),
      ('marketing_sms',   coalesce(p_marketing_sms,   false)),
      ('marketing_email', coalesce(p_marketing_email, false))
    ) as t(kind, granted)
  loop
    select c.granted into v_last
    from public.consents c
    where c.profile_id = uid and c.kind = k.kind
    order by c.created_at desc limit 1;
    if not found or v_last is distinct from k.granted then
      insert into public.consents (profile_id, tenant_id, kind, granted, text_version, source)
      values (uid, v_tenant, k.kind, k.granted, p_consent_version, 'signup');
    end if;
  end loop;

  -- Home area: keep a single 'Home' row (no duplicates on re-signup).
  if nullif(btrim(p_zip), '') is not null then
    if exists (select 1 from public.saved_areas where profile_id = uid and label = 'Home') then
      update public.saved_areas set zip = btrim(p_zip)
      where profile_id = uid and label = 'Home';
    else
      insert into public.saved_areas (profile_id, tenant_id, label, zip)
      values (uid, v_tenant, 'Home', btrim(p_zip));
    end if;
  end if;
end;
$$;
grant execute on function public.complete_signup(uuid,text,text,text,text,text,date,text,boolean,boolean,text) to authenticated;
