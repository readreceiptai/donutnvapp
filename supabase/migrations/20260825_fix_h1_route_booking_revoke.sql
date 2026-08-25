-- APP project (cfghtxfplkodjnndzmcf). H1 remediation.
--
-- Re-verification for the beta found route_booking(uuid) still had EXECUTE granted
-- to PUBLIC on the live DB (anon_can_execute=true) — a prior CREATE OR REPLACE
-- re-granted the default PUBLIC execute, undoing the repo revoke. That is the IDOR:
-- any anon-key holder could re-route/reassign an arbitrary booking + the customer's
-- owner_tenant_id. Revoke public execute; it is only meant to run inside the
-- SECURITY DEFINER submit_booking() (same owner, so its internal call is unaffected).
-- Re-tested (rolled back): anon/authenticated can no longer execute it, a direct anon
-- call is denied (42501), and submit_booking still routes a booking end-to-end.
revoke execute on function public.route_booking(uuid) from public, anon, authenticated;
grant  execute on function public.route_booking(uuid) to service_role;