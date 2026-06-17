-- ============================================================================
-- DonutNV — "Admin Elite" / superadmin (platform owner)
-- Run AFTER schema.sql. Safe to re-run.
--
-- A single identity-based god-mode level ABOVE corporate/admin. Tied to the
-- person (their login), NOT to a tenant — so it never leaks to other operators
-- of a territory. The superadmin sees and edits everything across all tenants
-- and bypasses every limit (incl. ELLE's metered drip — full backlog).
--
-- Dormant until is_superadmin is set true on a specific account. Set Kevin's
-- owner profile once it exists:  update public.profiles set is_superadmin = true
--   where email = '<kevin-owner-email>';
-- ============================================================================

alter table public.profiles
  add column if not exists is_superadmin boolean not null default false;

create or replace function public.is_superadmin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_superadmin = true);
$$;
grant execute on function public.is_superadmin() to authenticated;

-- Superadmin passes every operator/admin gate regardless of role/tenant.
create or replace function public.is_operator()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid()
                   and (role in ('operator','admin') or is_superadmin = true));
$$;

-- Auto-elevate the platform owner's login (Kevin) the moment the profile exists,
-- so superadmin is tied to the login with no manual step. Change the email here
-- only if the owner login email changes.
create or replace function public.auto_superadmin()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if lower(new.email) = 'k.deans@mac.com' then
    new.is_superadmin := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_superadmin on public.profiles;
create trigger trg_auto_superadmin
  before insert or update on public.profiles
  for each row execute function public.auto_superadmin();
