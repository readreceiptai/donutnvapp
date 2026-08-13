-- ELLE project (nvxfkzwbiomnswcxiblq). Automatic FREE seeding for every Z + auto-clear
-- on confirm. A brand-new ELLE tenant gets 3 clearly-labeled EXAMPLE leads (no callable
-- contacts) so the board is never empty — ZERO API spend. Tenants that already have real
-- leads are skipped. Examples auto-clear the moment the Z is confirmed (paid_apis_enabled
-- flips true and real, paid discovery begins). Pairs with elle_set_paid_enabled (the
-- confirm switch) and the existing paid-API gate on all discovery/enrichment jobs.

create table if not exists public.elle_example_seed (
  tenant_id uuid not null,
  event_id  uuid not null,
  host_id   uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, event_id)
);

-- Allow labeled EXAMPLE events past the territory zipwall so a brand-new tenant (no
-- territory zips configured yet) still gets its sample board. Real events unchanged.
create or replace function public.elle_enforce_event_zip()
returns trigger language plpgsql as $$
declare ez text; est text;
begin
  select zip, enrichment_status into ez, est from public.elle_events where id = new.event_id;
  if est = 'example' then return new; end if;
  if ez is null or not exists (
    select 1 from public.elle_territory_zips tz where tz.tenant_id = new.tenant_id and tz.zip = ez
  ) then
    return null;
  end if;
  return new;
end $$;

create or replace function public.elle_seed_examples(p_tenant uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_zip text; v_host uuid; v_ev uuid; n int := 0; ex record; v_date date; tries int;
begin
  if exists (select 1 from elle_tenant_events where tenant_id = p_tenant) then
    return 0;  -- never seed a tenant that already has real leads
  end if;
  select zip into v_zip from elle_territory_zips where tenant_id = p_tenant limit 1;

  for ex in select * from (values
      ('EXAMPLE — Fall Family Festival (sample lead — replace when you go live)', 30, 4500, 82, 'large_public_festival'),
      ('EXAMPLE — Chamber Business Expo (sample lead — replace when you go live)', 45, 1200, 68, 'medium_corporate'),
      ('EXAMPLE — Elementary Fun Run (sample lead — replace when you go live)',    60,  600, 74, 'school_individual')
    ) as v(name, days_out, att, score, etype)
  loop
    insert into elle_hosts (name, primary_contact_email)
      values ('EXAMPLE host — unlocks when you go live', 'example@donotcontact.invalid')
      returning id into v_host;
    -- per-tenant base offset + retry loop guarantees uniqueness on the global
    -- elle_events (slug, start_date) constraint even if two tenants collide.
    v_date := current_date + ex.days_out + (abs(hashtext(p_tenant::text)) % 30);
    tries := 0;
    loop
      begin
        insert into elle_events (name, city, zip, start_date, event_type, estimated_attendance, enrichment_status, host_id, date_is_estimated)
          values (ex.name, 'Your area', coalesce(v_zip, '00000'), v_date, ex.etype, ex.att, 'example', v_host, true)
          returning id into v_ev;
        exit;
      exception when unique_violation then
        tries := tries + 1; v_date := v_date + 1;
        if tries > 60 then raise; end if;
      end;
    end loop;
    insert into elle_tenant_events (tenant_id, event_id, score, decision)
      values (p_tenant, v_ev, ex.score, 'backlog');
    insert into elle_example_seed (tenant_id, event_id, host_id) values (p_tenant, v_ev, v_host);
    n := n + 1;
  end loop;
  return n;
end$$;

create or replace function public.elle_clear_examples(p_tenant uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from elle_tenant_events te using elle_example_seed s
    where s.tenant_id = p_tenant and te.tenant_id = s.tenant_id and te.event_id = s.event_id;
  get diagnostics n = row_count;
  delete from elle_events e using elle_example_seed s where s.tenant_id = p_tenant and e.id = s.event_id;
  delete from elle_hosts h using elle_example_seed s where s.tenant_id = p_tenant and h.id = s.host_id;
  delete from elle_example_seed where tenant_id = p_tenant;
  return n;
end$$;

-- Auto-seed every new tenant.
create or replace function public.elle_tenants_seed_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.elle_seed_examples(new.id); return new; end$$;
drop trigger if exists trg_elle_seed_examples on public.elle_tenants;
create trigger trg_elle_seed_examples after insert on public.elle_tenants
  for each row execute function public.elle_tenants_seed_trg();

-- Clear examples the moment a Z is confirmed (paid unlocked → real leads incoming).
create or replace function public.elle_tenants_confirm_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.paid_apis_enabled and not coalesce(old.paid_apis_enabled, false) then
    perform public.elle_clear_examples(new.id);
  end if;
  return new;
end$$;
drop trigger if exists trg_elle_clear_examples on public.elle_tenants;
create trigger trg_elle_clear_examples after update of paid_apis_enabled on public.elle_tenants
  for each row execute function public.elle_tenants_confirm_trg();

revoke execute on function public.elle_seed_examples(uuid), public.elle_clear_examples(uuid) from public, anon, authenticated;
grant execute on function public.elle_seed_examples(uuid), public.elle_clear_examples(uuid) to service_role;