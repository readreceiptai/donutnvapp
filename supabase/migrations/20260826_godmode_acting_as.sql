-- APP project (cfghtxfplkodjnndzmcf). #127 God Mode — server-stored per-superadmin
-- "acting-as" tenant + acting-as-aware current_tenant_id(). This one change re-scopes a
-- VERIFIED superadmin to another tenant across every operator RPC/RLS (they all key off
-- current_tenant_id()). Non-superadmins are byte-identical to before (verified live: the
-- full tenant-isolation suite passed unchanged after this migration).

create table if not exists public.superadmin_acting_as (
  superadmin_id    uuid primary key references auth.users(id) on delete cascade,
  acting_tenant_id uuid not null references public.tenants(id) on delete cascade,
  updated_at       timestamptz not null default now()
);
alter table public.superadmin_acting_as enable row level security;

drop policy if exists saa_self_read on public.superadmin_acting_as;
create policy saa_self_read on public.superadmin_acting_as for select
  using (superadmin_id = auth.uid() and public.is_superadmin());

revoke insert, update, delete on public.superadmin_acting_as from anon, authenticated;
grant select on public.superadmin_acting_as to authenticated;

-- Set / clear the acting-as tenant. Hard-gated to verified superadmins server-side.
create or replace function public.set_acting_tenant(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_superadmin() then
    raise exception 'not_superadmin';
  end if;
  if p_tenant is null then
    delete from public.superadmin_acting_as where superadmin_id = auth.uid();
    return;
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'no_such_tenant';
  end if;
  insert into public.superadmin_acting_as (superadmin_id, acting_tenant_id, updated_at)
  values (auth.uid(), p_tenant, now())
  on conflict (superadmin_id) do update
    set acting_tenant_id = excluded.acting_tenant_id, updated_at = now();
end;
$function$;
revoke execute on function public.set_acting_tenant(uuid) from anon;
grant execute on function public.set_acting_tenant(uuid) to authenticated;

-- Acting-as-aware tenant resolver. Verified superadmin with an acting row -> acted tenant;
-- otherwise the caller's own profile tenant (identical to prior behavior). The
-- is_superadmin() guard in the subquery means a stray row can never affect a
-- non-superadmin (defense in depth vs C1).
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select a.acting_tenant_id
       from public.superadmin_acting_as a
      where a.superadmin_id = auth.uid() and public.is_superadmin()),
    (select p.tenant_id from public.profiles p where p.id = auth.uid())
  );
$function$;