-- CRITICAL SECURITY FIX (applied live 2026-08-14).
-- The profiles UPDATE RLS policy lets a user write their own row, and the `authenticated`
-- role has column-level UPDATE on is_superadmin. profiles_role_guard blocks `role`
-- elevation but nothing blocked is_superadmin -> any signed-in customer could PATCH
-- is_superadmin=true and take over the platform. This UPDATE-only guard reverts any
-- false->true flip by a caller who is not already a superadmin. The owner bootstrap
-- (trg_auto_superadmin) runs on INSERT and is unaffected; SECURITY DEFINER RPCs run as
-- owner and bypass this.
create or replace function public.profiles_superadmin_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.is_superadmin, false) = true
     and coalesce(old.is_superadmin, false) = false
     and not public.is_superadmin() then
    new.is_superadmin := old.is_superadmin;   -- silently deny the elevation
  end if;
  return new;
end$$;

drop trigger if exists trg_profiles_superadmin_guard on public.profiles;
create trigger trg_profiles_superadmin_guard
  before update on public.profiles
  for each row execute function public.profiles_superadmin_guard();
