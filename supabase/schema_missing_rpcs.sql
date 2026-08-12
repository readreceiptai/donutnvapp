-- ============================================================================
-- schema_missing_rpcs.sql
-- Exported from the APP Supabase project (ref cfghtxfplkodjnndzmcf).
-- RPCs referenced by the frontend (src/) that exist in the live database but
-- had no CREATE statement committed anywhere under supabase/*.sql.
-- Definitions captured verbatim via pg_get_functiondef().
--
-- Included:
--   public.submit_frandev          (src/pages/Franchise.jsx)
--   public.get_frandev_leads       (src/pages/operator/FranDev.jsx, AdminHome.jsx)
--   public.mark_frandev_handled    (src/pages/operator/FranDev.jsx)
--   public.get_unrouted_bookings   (src/pages/operator/Unrouted.jsx, AdminHome.jsx)
--   public.mark_booking_forwarded  (src/pages/operator/Unrouted.jsx)
--
-- NOTE: submit_fundraiser (also frontend-referenced and missing) is exported
-- separately in schema_fundraisers.sql alongside its tables.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- RPC: public.submit_frandev(...)
-- Franchise-development lead intake form handler.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_frandev(p_first text, p_last text, p_email text, p_phone text, p_state text, p_capital text, p_message text, p_tenant uuid, p_consent text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare nid uuid;
begin
  if p_first is null or p_last is null or p_email is null then raise exception 'missing_required'; end if;
  insert into public.frandev_leads (first_name,last_name,email,phone,state,liquid_capital,message,tenant_id,consent_text_version)
  values (trim(p_first),trim(p_last),trim(p_email),p_phone,p_state,p_capital,p_message,p_tenant,p_consent)
  returning id into nid;
  return nid;
end $function$;

-- ----------------------------------------------------------------------------
-- RPC: public.get_frandev_leads()
-- Superadmin-only: unhandled franchise-development leads.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_frandev_leads()
 RETURNS SETOF frandev_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_superadmin() then raise exception 'forbidden'; end if;
  return query select * from public.frandev_leads where status <> 'handled' order by created_at desc;
end $function$;

-- ----------------------------------------------------------------------------
-- RPC: public.mark_frandev_handled(p_id uuid)
-- Superadmin-only: mark a frandev lead handled.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_frandev_handled(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_superadmin() then raise exception 'forbidden'; end if;
  update public.frandev_leads set status='handled' where id=p_id;
end $function$;

-- ----------------------------------------------------------------------------
-- RPC: public.get_unrouted_bookings()
-- Superadmin-only: bookings that could not be auto-assigned to a tenant,
-- joined against franchise_territories for owed-franchise context.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_unrouted_bookings()
 RETURNS TABLE(id uuid, created_at timestamp with time zone, contact_name text, contact_email text, contact_phone text, event_date date, start_time text, guests integer, zip text, notes text, assignment_reason text, owed_franchise text, owed_on_platform boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_superadmin() then raise exception 'forbidden'; end if;
  return query
    select b.id, b.created_at, b.contact_name, b.contact_email, b.contact_phone,
           b.event_date, b.start_time, b.guests, b.zip, b.notes,
           b.assignment_reason, ft.franchise_name, ft.on_platform
    from public.bookings b
    left join public.franchise_territories ft on ft.zip = b.zip
    where b.assigned_tenant_id is null
      and b.assignment_reason in ('off_platform_owned','unassigned')
    order by b.created_at desc;
end $function$;

-- ----------------------------------------------------------------------------
-- RPC: public.mark_booking_forwarded(p_booking_id uuid)
-- Superadmin-only: mark an unrouted booking as forwarded.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_booking_forwarded(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_superadmin() then raise exception 'forbidden'; end if;
  update public.bookings set assignment_reason = 'forwarded'
   where id = p_booking_id and assigned_tenant_id is null;
end $function$;

-- ----------------------------------------------------------------------------
-- Grants (mirrors observed usage: public form RPC is anon+authenticated;
-- superadmin-gated RPCs are authenticated).
-- ----------------------------------------------------------------------------
grant execute on function public.submit_frandev(text, text, text, text, text, text, text, uuid, text) to anon, authenticated;
grant execute on function public.get_frandev_leads() to authenticated;
grant execute on function public.mark_frandev_handled(uuid) to authenticated;
grant execute on function public.get_unrouted_bookings() to authenticated;
grant execute on function public.mark_booking_forwarded(uuid) to authenticated;
