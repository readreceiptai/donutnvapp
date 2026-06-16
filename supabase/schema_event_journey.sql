-- ============================================================================
-- DonutNV — Event-day client journey. Run AFTER schema_bookings.sql.
-- Adds the booked-client touchpoints: status stages, in-event feedback,
-- post-event review (with a 1-hour incentive coupon), and secure token-gated
-- functions the public tracking page calls. Safe to run more than once.
-- ============================================================================

-- 1) Wider status set for the event day.
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('new','quoted','confirmed','enroute','arrived','serving','wrapping','departed','completed','reviewed','cancelled'));

alter table public.bookings add column if not exists departed_at  timestamptz;
alter table public.bookings add column if not exists review_rating int;
alter table public.bookings add column if not exists review_comment text;
alter table public.bookings add column if not exists reviewed_at  timestamptz;
alter table public.bookings add column if not exists coupon_code  text;

-- 2) In-event feedback (the client can leave notes while we're there).
create table if not exists public.event_feedback (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  phase       text,                 -- 'during' | 'wrapping'
  rating      int,
  message     text,
  created_at  timestamptz not null default now()
);
create index if not exists event_feedback_booking_idx on public.event_feedback(booking_id);
alter table public.event_feedback enable row level security;
drop policy if exists feedback_ops_read on public.event_feedback;
create policy feedback_ops_read on public.event_feedback for select
  using (public.is_operator() and tenant_id = public.current_tenant_id());
-- (Client inserts happen only through the security-definer RPC below.)

-- 3) Expanded, safe tracking read for the public client page.
create or replace function public.get_event_tracking(p_token text)
returns json language sql stable security definer set search_path = public as $$
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
  limit 1;
$$;
grant execute on function public.get_event_tracking(text) to anon, authenticated;

-- 4) Client submits in-event feedback (token-gated, no login).
create or replace function public.submit_event_feedback(p_token text, p_message text, p_rating int default null, p_phase text default 'during')
returns json language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  select * into b from public.bookings where tracking_token = p_token limit 1;
  if b.id is null then return json_build_object('ok', false); end if;
  insert into public.event_feedback (booking_id, tenant_id, phase, rating, message)
    values (b.id, b.tenant_id, coalesce(p_phase, 'during'), p_rating, p_message);
  return json_build_object('ok', true);
end; $$;
grant execute on function public.submit_event_feedback(text, text, int, text) to anon, authenticated;

-- 5) Client submits a review; if within 1 hour of departure, mint a coupon.
create or replace function public.submit_event_review(p_token text, p_rating int, p_comment text)
returns json language plpgsql security definer set search_path = public as $$
declare b public.bookings; v_coupon text; v_fast boolean;
begin
  select * into b from public.bookings where tracking_token = p_token limit 1;
  if b.id is null then return json_build_object('ok', false); end if;
  if b.reviewed_at is not null then
    return json_build_object('ok', true, 'already', true, 'coupon', b.coupon_code);
  end if;
  v_fast := (b.departed_at is not null and b.departed_at > now() - interval '1 hour');
  if v_fast then
    v_coupon := 'SWEET-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  end if;
  update public.bookings
     set review_rating = p_rating, review_comment = p_comment, reviewed_at = now(),
         coupon_code = v_coupon, status = 'reviewed'
   where id = b.id;
  return json_build_object('ok', true, 'fast', v_fast, 'coupon', v_coupon);
end; $$;
grant execute on function public.submit_event_review(text, int, text) to anon, authenticated;

-- ============================================================================
-- 6) SECURITY: stop a customer from making themselves an operator/admin.
-- Owner accounts are created by an admin (service role) or by an existing
-- operator; a normal logged-in user can never elevate their own role.
-- (Service role has no auth.uid(), so admin creation still works.)
-- ============================================================================
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role in ('operator', 'admin')
     and auth.uid() is not null
     and not public.is_operator() then
    new.role := coalesce(old.role, 'customer');   -- silently deny the elevation
  end if;
  return new;
end; $$;

drop trigger if exists profiles_role_guard on public.profiles;
create trigger profiles_role_guard before insert or update on public.profiles
  for each row execute function public.guard_profile_role();
