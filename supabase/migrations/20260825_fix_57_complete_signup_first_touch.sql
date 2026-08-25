-- APP project (cfghtxfplkodjnndzmcf). #57 remediation — re-signup data-integrity bug.
--
-- The prior complete_signup used `on conflict (id) do update set tenant_id = excluded.tenant_id, ...`.
-- Since re-signup reuses the same auth identity (signInWithOtp on an existing email),
-- a returning customer who signed up again through a DIFFERENT territory's app had:
--   * their profiles.tenant_id flipped to the new tenant — and because operator RLS is
--     `is_operator() AND tenant_id = current_tenant_id()`, the original franchise lost
--     the customer from its roster entirely (the customer "moved" franchises);
--   * contact fields overwritten with whatever the new form held (blank = wiped);
--   * a duplicate 'Home' saved_area and 3 more consent rows appended every time.
--
-- Policy: FIRST-TOUCH OWNERSHIP. profiles.tenant_id (the field operator RLS/roster keys
-- on) is the customer's home franchise, set once at first signup and never moved by a
-- re-signup. Cross-territory service is a per-booking concern (owner_tenant_id /
-- route_booking), not a change of home tenant. A re-signup is a returning-customer event:
-- it fills/refreshes contact fields from non-empty values only (blank never wipes),
-- preserves loyalty/referral/role/parent linkage, keeps a single Home area, and records
-- a consent row only when the value actually changed.
--
-- Re-tested live (rolled back): signup in tenant A + accrued points/referral/owner, then
-- re-signup through tenant B with blanks + marketing opt-out -> tenant_id stays A,
-- owner_tenant stays A, no field wiped, points/referral intact, single Home (zip updated),
-- opt-out recorded as latest consent; an identical re-signup adds zero consent/area rows.

CREATE OR REPLACE FUNCTION public.complete_signup(
  p_tenant uuid, p_first_name text, p_last_name text, p_phone text, p_email text,
  p_zip text, p_birthday date, p_parent_email text,
  p_marketing_sms boolean, p_marketing_email boolean, p_consent_version text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
$function$;
