-- ============================================================================
-- schema_fundraisers.sql
-- Exported from the APP Supabase project (ref cfghtxfplkodjnndzmcf).
-- Reconstructed from live DB introspection (information_schema + pg_catalog).
-- Covers: fundraisers table, fundraiser_contributions table, and the
-- public.submit_fundraiser RPC used by src/pages/Fundraise.jsx.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: public.fundraisers
-- A fundraiser tied to a booking; created by submit_fundraiser().
-- ----------------------------------------------------------------------------
create table if not exists public.fundraisers (
  id               uuid        not null default gen_random_uuid(),
  tenant_id        uuid        not null,
  org_name         text        not null,
  org_type         text,
  cause            text,
  contact_name     text,
  contact_email    text,
  contact_phone    text,
  event_date       date,
  giveback_percent numeric,
  goal_cents       integer,
  status           text        not null default 'requested'::text,
  share_slug       text,
  code             text        default upper(substr(md5((random())::text), 1, 6)),
  created_by       uuid,
  booking_id       uuid,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  constraint fundraisers_pkey primary key (id),
  constraint fundraisers_code_key unique (code),
  constraint fundraisers_share_slug_key unique (share_slug),
  constraint fundraisers_status_check check (status = any (array['requested'::text, 'confirmed'::text, 'live'::text, 'closed'::text, 'cancelled'::text])),
  constraint fundraisers_tenant_id_fkey foreign key (tenant_id) references public.tenants(id)
);

create index if not exists idx_fundraisers_tenant on public.fundraisers using btree (tenant_id);

-- RLS is enabled on this table with NO policies defined; all access is via
-- SECURITY DEFINER RPCs (e.g. submit_fundraiser). Direct client access is denied.
alter table public.fundraisers enable row level security;

-- ----------------------------------------------------------------------------
-- Table: public.fundraiser_contributions
-- Individual supporter contributions toward a fundraiser.
-- ----------------------------------------------------------------------------
create table if not exists public.fundraiser_contributions (
  id              uuid        not null default gen_random_uuid(),
  fundraiser_id   uuid        not null,
  tenant_id       uuid        not null,
  supporter_name  text,
  supporter_email text,
  amount_cents    integer     not null default 0,
  pay_it_forward  boolean     default false,
  source          text        default 'prepay'::text,
  created_at      timestamptz default now(),
  constraint fundraiser_contributions_pkey primary key (id),
  constraint fundraiser_contributions_source_check check (source = any (array['prepay'::text, 'truck'::text, 'manual'::text])),
  constraint fundraiser_contributions_fundraiser_id_fkey foreign key (fundraiser_id) references public.fundraisers(id) on delete cascade,
  constraint fundraiser_contributions_tenant_id_fkey foreign key (tenant_id) references public.tenants(id)
);

create index if not exists idx_fundraiser_contrib_fid on public.fundraiser_contributions using btree (fundraiser_id);

-- RLS enabled, no policies (RPC-only access, same as fundraisers).
alter table public.fundraiser_contributions enable row level security;

-- ----------------------------------------------------------------------------
-- RPC: public.submit_fundraiser(...)
-- Public-facing form handler: creates a booking (tagged [FUNDRAISER]),
-- routes it, then creates the linked fundraisers row. Returns the booking id
-- and its tracking_token. Called from src/pages/Fundraise.jsx.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_fundraiser(p_tenant uuid, p_org_name text, p_org_type text, p_cause text, p_contact_name text, p_contact_phone text, p_contact_email text, p_event_date date, p_guests integer, p_zip text, p_notes text, p_sms_consent boolean, p_marketing_consent boolean, p_consent_text_version text)
 RETURNS TABLE(id uuid, tracking_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_token text; v_tenant uuid; v_notes text;
begin
  if not exists (select 1 from public.tenants t where t.id = p_tenant and t.is_active) then
    raise exception 'tenant_inactive';
  end if;

  v_notes := '[FUNDRAISER] ' || coalesce(p_org_name,'')
    || case when p_org_type is not null then ' (' || p_org_type || ')' else '' end
    || case when p_cause is not null and length(p_cause) > 0 then E'\nCause: ' || p_cause else '' end
    || case when p_notes is not null and length(p_notes) > 0 then E'\n' || p_notes else '' end;

  insert into public.bookings (
    tenant_id, created_by, contact_name, contact_phone, contact_email,
    event_date, start_time, guests, zip, notes,
    sms_consent, marketing_consent, consent_text_version
  ) values (
    p_tenant, auth.uid(), p_contact_name, p_contact_phone, p_contact_email,
    p_event_date, null, p_guests, p_zip, v_notes,
    coalesce(p_sms_consent,false), coalesce(p_marketing_consent,false), p_consent_text_version
  ) returning bookings.id, bookings.tracking_token into v_id, v_token;

  perform public.route_booking(v_id);
  select bookings.tenant_id into v_tenant from public.bookings where bookings.id = v_id;

  insert into public.fundraisers (
    tenant_id, org_name, org_type, cause, contact_name, contact_email, contact_phone,
    event_date, status, booking_id, created_by, share_slug
  ) values (
    coalesce(v_tenant, p_tenant), p_org_name, p_org_type, p_cause, p_contact_name, p_contact_email, p_contact_phone,
    p_event_date, 'requested', v_id, auth.uid(),
    lower(regexp_replace(coalesce(p_org_name,'org'), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(md5(random()::text),1,6)
  );

  return query select v_id, v_token;
end;
$function$;

grant execute on function public.submit_fundraiser(uuid, text, text, text, text, text, text, date, integer, text, text, boolean, boolean, text) to anon, authenticated;
