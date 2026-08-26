-- APP project (cfghtxfplkodjnndzmcf). #127 God Mode — audit trail.
-- Every mutation a superadmin performs WHILE IMPERSONATING (an acting row exists) writes
-- one row here. The is_superadmin() AND acting-row guard makes the trigger a no-op for
-- all normal traffic. Verified live: an impersonated UPDATE wrote one row
-- (action=UPDATE, target=profiles, acting=<tenant>); a post-exit mutation wrote none.

create table if not exists public.superadmin_audit_log (
  id               bigint generated always as identity primary key,
  superadmin_id    uuid not null,
  acting_tenant_id uuid,
  action           text not null,        -- INSERT | UPDATE | DELETE
  target_table     text not null,
  target_id        text,
  created_at       timestamptz not null default now()
);
alter table public.superadmin_audit_log enable row level security;
drop policy if exists sal_superadmin_read on public.superadmin_audit_log;
create policy sal_superadmin_read on public.superadmin_audit_log for select
  using (public.is_superadmin());
revoke insert, update, delete on public.superadmin_audit_log from anon, authenticated;
grant select on public.superadmin_audit_log to authenticated;
create index if not exists sal_time_idx on public.superadmin_audit_log (created_at desc);

create or replace function public.audit_superadmin_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_acting uuid;
begin
  if public.is_superadmin() then
    select a.acting_tenant_id into v_acting
      from public.superadmin_acting_as a where a.superadmin_id = auth.uid();
    if v_acting is not null then
      insert into public.superadmin_audit_log (superadmin_id, acting_tenant_id, action, target_table, target_id)
      values (
        auth.uid(), v_acting, tg_op, tg_table_name,
        coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id')  -- generic; null if no id col
      );
    end if;
  end if;
  return null;  -- AFTER trigger: return value ignored
end;
$function$;

-- Attach to operator-writable tables. Centralized fn -> add coverage by adding triggers.
do $attach$
declare t text;
begin
  foreach t in array array[
    'bookings','campaigns','scheduled_stops','live_sessions','profiles',
    'saved_areas','consents','loyalty_config','reviews'
  ] loop
    execute format('drop trigger if exists trg_audit_superadmin on public.%I', t);
    execute format(
      'create trigger trg_audit_superadmin after insert or update or delete on public.%I
         for each row execute function public.audit_superadmin_mutation()', t);
  end loop;
end
$attach$;