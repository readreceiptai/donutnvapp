-- APP project (cfghtxfplkodjnndzmcf). C1 remediation completion.
--
-- Re-verification for the beta found C1 was only PARTIALLY closed: auto_superadmin
-- correctly used the verified auth.email(), and a guard blocked UPDATEs — but the
-- guard did NOT fire on INSERT, and anon/authenticated hold a TABLE-level INSERT
-- grant on profiles (which implicitly covers every column, so a column-level revoke
-- is a no-op). A freshly OTP-verified user could therefore INSERT their own profile
-- row with is_superadmin=true (before complete_signup) and become platform superadmin.
-- Proven live via a rolled-back role-simulation test (is_superadmin persisted = true).
--
-- Fix: make the superadmin guard fire on INSERT OR UPDATE, order-independent —
-- is_superadmin may only be raised via the cryptographically-verified owner email
-- (auth.email()) or by an existing superadmin; a normal client can never set it on
-- their own row. Column-level revoke kept as defense-in-depth/intent documentation.
-- Re-tested (rolled back): attacker insert -> false, attacker update -> false,
-- verified-owner -> true.

revoke insert (is_superadmin), update (is_superadmin) on public.profiles from anon, authenticated;
revoke insert (role),          update (role)          on public.profiles from anon, authenticated;

create or replace function public.profiles_superadmin_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(new.is_superadmin, false) = true
     and coalesce(old.is_superadmin, false) = false
     and lower(coalesce(auth.email(), '')) <> 'k.deans@mac.com'
     and not public.is_superadmin()
  then
    new.is_superadmin := coalesce(old.is_superadmin, false); -- silently deny the elevation
  end if;
  return new;
end
$function$;

drop trigger if exists trg_profiles_superadmin_guard on public.profiles;
create trigger trg_profiles_superadmin_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_superadmin_guard();