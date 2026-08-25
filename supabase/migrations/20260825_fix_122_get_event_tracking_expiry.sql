-- APP project (cfghtxfplkodjnndzmcf). #122 / M2.
-- get_event_tracking exposed event PII (contact name, notes, exact event coordinates,
-- coupon) to any holder of the tracking_token, with NO expiry -- a forwarded/leaked
-- link worked forever. Bound the exposure window: only return the row while the event
-- is upcoming or recent (event_date within the last 2 days, which still covers the
-- post-departure review window that opens for 1h after departed_at), and never for a
-- cancelled booking. Payload is otherwise unchanged (frontend needs no change).
-- Re-tested (rolled back): event today -> returns data; event 5 days ago -> NULL;
-- cancelled -> NULL.
CREATE OR REPLACE FUNCTION public.get_event_tracking(p_token text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when b.id is null then null else json_build_object(
    'status',       b.status,
    'contact_name', b.contact_name,
    'event_date',   b.event_date,
    'start_time',   b.start_time,
    'guests',       b.guests,
    'notes',        b.notes,
    'event_lat',    b.lat,  'event_lng', b.lng,
    'truck_lat',    loc.lat,'truck_lng', loc.lng,
    'updated_at',   loc.recorded_at,
    'departed_at',  b.departed_at,
    'reviewed_at',  b.reviewed_at,
    'coupon_code',  b.coupon_code,
    'review_window_open',
        (b.departed_at is not null and b.reviewed_at is null and b.departed_at > now() - interval '1 hour'),
    'tenant',       t.name
  ) end
  from public.bookings b
  left join public.tenants t on t.id = b.tenant_id
  left join public.truck_latest_location loc on loc.truck_id = b.truck_id
  where b.tracking_token = p_token
    and b.event_date >= (current_date - 2)
    and b.status is distinct from 'cancelled'
  limit 1;
$function$;