-- ═══════════════════════════════════════════════════════════════════════════
-- Option B — Live Proximity Push: MATCH ENGINE (ingest + PostGIS matcher)
-- APP project (cfghtxfplkodjnndzmcf). Apply after 20260816_proximity_push_foundation.
--
-- ADDITIVE ONLY. Creates new, namespaced functions. Reads existing objects
-- (truck_latest_location, active_live_sessions, proximity_pushes, app_config)
-- strictly read-only.
--
-- All three functions are SECURITY DEFINER with a pinned search_path and are
-- executable by service_role ONLY. The matcher reads every customer's live
-- position across all tenants, so it must never be reachable from the anon or
-- authenticated API roles.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Helper: quiet-hours test in the customer's local timezone ───────────────
-- Handles windows that wrap midnight (the normal case: 21:00 → 09:00).
-- Falls back to UTC on a bad timezone string rather than erroring the whole
-- matcher run — one customer's bad tz must not stop every push in the system.
create or replace function public.proximity_in_quiet_hours(
  p_timezone text,
  p_start    time,
  p_end      time,
  p_now      timestamptz default now()
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare v_local time;
begin
  begin
    v_local := (p_now at time zone p_timezone)::time;
  exception when others then
    v_local := (p_now at time zone 'UTC')::time;
  end;

  if p_start = p_end then
    return false;                        -- zero-width window = quiet hours off
  elsif p_start < p_end then
    return v_local >= p_start and v_local < p_end;
  else
    return v_local >= p_start or v_local < p_end;   -- wraps midnight
  end if;
end$$;

revoke execute on function public.proximity_in_quiet_hours(text, time, time, timestamptz)
  from public, anon, authenticated;
grant execute on function public.proximity_in_quiet_hours(text, time, time, timestamptz)
  to service_role;


-- ── Ingest: record one device position ──────────────────────────────────────
-- Called by the location-ingest edge function with the caller's verified
-- profile_id. Writes history + upserts the hot match row in one statement pair.
--
-- Rejects positions the app should never have sent: a customer who has not
-- opted in, and junk accuracy. Returns false when the write was refused so the
-- client can stop tracking rather than keep burning battery.
create or replace function public.ingest_customer_position(
  p_profile_id uuid,
  p_lat        double precision,
  p_lng        double precision,
  p_accuracy_m real default null,
  p_recorded_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_enabled   boolean;
  v_geog      geography(Point, 4326);
begin
  -- Coordinate sanity: reject nulls, out-of-range, and the 0,0 null-island
  -- fix that broken GPS stacks emit.
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90
     or p_lng not between -180 and 180
     or (abs(p_lat) < 0.0001 and abs(p_lng) < 0.0001) then
    return false;
  end if;

  -- Opt-in gate. No opt-in row, or opt-in switched off = we do not store
  -- location at all. This is the privacy contract, enforced in the database
  -- rather than trusted to the client.
  select pp.tenant_id, pp.enabled
    into v_tenant_id, v_enabled
    from proximity_prefs pp
   where pp.profile_id = p_profile_id;

  if v_tenant_id is null or v_enabled is not true then
    return false;
  end if;

  -- Drop absurdly imprecise fixes (>5km) — they cannot support a 5-mile
  -- geofence decision and would only produce false "truck is near you" sends.
  if p_accuracy_m is not null and p_accuracy_m > 5000 then
    return false;
  end if;

  v_geog := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;

  insert into customer_positions (profile_id, tenant_id, geog, accuracy_m, recorded_at)
  values (p_profile_id, v_tenant_id, v_geog, p_accuracy_m, p_recorded_at);

  insert into customer_latest_position (profile_id, tenant_id, geog, accuracy_m, recorded_at, updated_at)
  values (p_profile_id, v_tenant_id, v_geog, p_accuracy_m, p_recorded_at, now())
  on conflict (profile_id) do update
    set geog        = excluded.geog,
        tenant_id   = excluded.tenant_id,
        accuracy_m  = excluded.accuracy_m,
        recorded_at = excluded.recorded_at,
        updated_at  = now()
  -- Never let a delayed/replayed ping overwrite a newer fix.
  where customer_latest_position.recorded_at <= excluded.recorded_at;

  return true;
end$$;

revoke execute on function public.ingest_customer_position(uuid, double precision, double precision, real, timestamptz)
  from public, anon, authenticated;
grant execute on function public.ingest_customer_position(uuid, double precision, double precision, real, timestamptz)
  to service_role;


-- ── The matcher: which customers should be pushed, right now ────────────────
-- For every live PUBLIC truck with a fresh GPS fix, find opted-in customers of
-- the same tenant inside their chosen radius, then apply the rules layer.
--
-- Query shape is deliberate: live trucks (tens of rows) drive a LATERAL join
-- into customer_latest_position (100K rows) so ST_DWithin is evaluated as an
-- index-driven nested loop against customer_latest_position_geog_gix. Writing
-- it the other way round produces a seq scan per tick.
--
-- Returns candidates only. It does NOT send and does NOT claim the dedupe row —
-- proximity-dispatch does both, so a crash mid-run cannot silently burn a
-- customer's one-push-per-session budget.
create or replace function public.match_proximity_candidates(
  p_limit integer default 5000
)
returns table (
  profile_id   uuid,
  tenant_id    uuid,
  truck_id     uuid,
  session_id   uuid,
  stop_name    text,
  ends_at      timestamptz,
  distance_m   integer,
  radius_miles numeric
)
language sql
security definer
set search_path = public
as $$
  with kill_switch as (
    select coalesce(
      (select value from app_config where key = 'proximity_push_enabled'), 'false'
    ) = 'true' as is_on
  ),
  -- Live, public, non-expired sessions whose truck has a RECENT GPS fix.
  -- "Live" alone is not enough: a truck that went live and then lost signal an
  -- hour ago is not something we should tell customers to walk to.
  live_trucks as (
    select
      s.id          as session_id,
      s.tenant_id,
      s.truck_id,
      s.stop_name,
      s.ends_at,
      tll.lat,
      tll.lng,
      st_setsrid(st_makepoint(tll.lng, tll.lat), 4326)::geography as geog,
      cfg.max_radius_miles,
      cfg.position_max_age_minutes,
      cfg.max_sends_per_customer_per_day,
      cfg.min_hours_between_sends,
      cfg.quiet_hours_start as tenant_quiet_start,
      cfg.quiet_hours_end   as tenant_quiet_end
    from active_live_sessions s
    join tenant_proximity_config cfg
      on cfg.tenant_id = s.tenant_id and cfg.enabled
    join truck_latest_location tll
      on tll.truck_id = s.truck_id
    cross join kill_switch k
    where k.is_on
      and tll.lat is not null
      and tll.lng is not null
      and tll.recorded_at > now() - interval '15 minutes'
  )
  select
    c.profile_id,
    c.tenant_id,
    t.truck_id,
    t.session_id,
    t.stop_name,
    t.ends_at,
    c.distance_m,
    c.radius_miles
  from live_trucks t
  cross join lateral (
    select
      clp.profile_id,
      clp.tenant_id,
      round(st_distance(clp.geog, t.geog))::integer as distance_m,
      least(pp.radius_miles, t.max_radius_miles)    as radius_miles
    from customer_latest_position clp
    join proximity_prefs pp
      on pp.profile_id = clp.profile_id and pp.enabled
    where clp.tenant_id = t.tenant_id
      -- The index-driven predicate. Radius is capped by the tenant's maximum so
      -- a customer cannot opt themselves into a wider net than the franchisee
      -- configured.
      and st_dwithin(
            clp.geog,
            t.geog,
            least(pp.radius_miles, t.max_radius_miles) * 1609.344
          )
      -- Freshness: a three-hour-old fix is not "where the customer is".
      and clp.recorded_at > now() - make_interval(mins => t.position_max_age_minutes)
      -- Quiet hours: customer's own window, falling back to the tenant's.
      and not proximity_in_quiet_hours(
            pp.timezone,
            coalesce(pp.quiet_hours_start, t.tenant_quiet_start),
            coalesce(pp.quiet_hours_end,   t.tenant_quiet_end)
          )
      -- Per-session dedupe: reuses the existing proximity_pushes interlock, so
      -- the legacy notify-proximity function and this one cannot double-send
      -- to the same member during cutover.
      and not exists (
        select 1 from proximity_pushes px
         where px.session_id = t.session_id
           and px.profile_id = clp.profile_id
      )
      -- Frequency cap: minimum gap between any two sends.
      and not exists (
        select 1 from proximity_notification_log l
         where l.profile_id = clp.profile_id
           and l.status = 'sent'
           and l.sent_at > now() - make_interval(
                 hours => least(pp.min_hours_between, t.min_hours_between_sends))
      )
      -- Daily cap: rolling 24h, not calendar day, so it cannot be gamed by a
      -- truck going live at 11:55pm.
      and (
        select count(*) from proximity_notification_log l
         where l.profile_id = clp.profile_id
           and l.status = 'sent'
           and l.sent_at > now() - interval '24 hours'
      ) < least(pp.max_per_day, t.max_sends_per_customer_per_day)
  ) c
  -- Closest first: if we ever hit the limit, the most relevant sends win.
  order by c.distance_m
  limit p_limit;
$$;

revoke execute on function public.match_proximity_candidates(integer)
  from public, anon, authenticated;
grant execute on function public.match_proximity_candidates(integer)
  to service_role;


-- ── Metrics: opt-in rate, sends, CTR (the numbers the brief asks us to track) ─
create or replace function public.get_proximity_metrics(
  p_tenant_id uuid default null,
  p_days      integer default 30
)
returns table (
  tenant_id        uuid,
  opted_in         bigint,
  total_customers  bigint,
  opt_in_rate      numeric,
  active_devices   bigint,
  sends            bigint,
  suppressed       bigint,
  failed           bigint,
  opens            bigint,
  ctr              numeric
)
language sql
security definer
set search_path = public
as $$
  select
    t.id as tenant_id,
    (select count(*) from proximity_prefs pp
      where pp.tenant_id = t.id and pp.enabled)                       as opted_in,
    (select count(*) from profiles p
      where p.tenant_id = t.id and p.role = 'customer')               as total_customers,
    round(
      (select count(*) from proximity_prefs pp
        where pp.tenant_id = t.id and pp.enabled)::numeric
      / nullif((select count(*) from profiles p
                 where p.tenant_id = t.id and p.role = 'customer'), 0) * 100
    , 1)                                                              as opt_in_rate,
    (select count(*) from push_tokens pt
      where pt.tenant_id = t.id and pt.is_active)                     as active_devices,
    count(*) filter (where l.status = 'sent')                         as sends,
    count(*) filter (where l.status = 'suppressed')                   as suppressed,
    count(*) filter (where l.status = 'failed')                       as failed,
    count(*) filter (where l.opened_at is not null)                   as opens,
    round(
      count(*) filter (where l.opened_at is not null)::numeric
      / nullif(count(*) filter (where l.status = 'sent'), 0) * 100
    , 1)                                                              as ctr
  from tenants t
  left join proximity_notification_log l
    on l.tenant_id = t.id
   and l.sent_at > now() - make_interval(days => p_days)
  where (p_tenant_id is null or t.id = p_tenant_id)
    and (public.is_superadmin()
         or (public.is_operator() and t.id = public.current_tenant_id()))
  group by t.id;
$$;

revoke execute on function public.get_proximity_metrics(uuid, integer) from public, anon;
grant execute on function public.get_proximity_metrics(uuid, integer) to authenticated, service_role;
