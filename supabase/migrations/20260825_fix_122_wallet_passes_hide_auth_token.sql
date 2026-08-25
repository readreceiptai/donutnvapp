-- APP project (cfghtxfplkodjnndzmcf). #122 / Low.
-- wallet_passes.auth_token (the pass web-service push token) was client-readable by the
-- pass owner: a table-level SELECT grant means the RLS "profile_id = auth.uid()" policy
-- returns every column, auth_token included. The app never queries this table; only the
-- pass-push edge functions (service_role, which bypasses grants + RLS) need auth_token.
-- Revoke table SELECT from the client roles and re-grant every column EXCEPT auth_token.
-- Re-tested: has_column_privilege('authenticated', ...,'auth_token') = false; safe
-- columns still readable; service_role unaffected.
revoke select on public.wallet_passes from anon, authenticated;
grant select (id, tenant_id, profile_id, platform, serial_number, status,
              installed_at, needs_push, last_pushed_at, created_at, updated_at)
  on public.wallet_passes to authenticated;