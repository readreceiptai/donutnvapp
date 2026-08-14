-- APP project (cfghtxfplkodjnndzmcf). Apply with the Supabase SQL editor / MCP
-- against the APP database ONLY.
--
-- Fix (review M2): live_sessions.live_read and truck_locations.loc_read were
-- `using(true)`, so anyone with the anon key could read EVERY tenant's rows
-- directly via PostgREST — including visibility='private' "on the way to your
-- event" sessions and the truck's live GPS en route to a private event. The
-- public map is served by the active_live_sessions view (public-only) and the
-- token-gated get_event_tracking() RPC, so tightening the base tables does not
-- change what the map legitimately shows.
--
-- New posture:
--   * Public: only PUBLIC, live, non-expired sessions — and only GPS for a truck
--     that currently has such a session (matches how the map joins by truck_id).
--   * Operators: their own tenant's rows (needed to manage go-live).
--   * Superadmin: everything.
--
-- IMPORTANT — verify after applying: load the customer Find map for a territory
-- with a live public truck and confirm the truck + its position still appear
-- (the map reads the active_live_sessions and truck_latest_location views). If
-- those views are security_invoker on live, this policy is what feeds them; the
-- correlation below is written to keep them working. A private "on the way"
-- session must NOT appear on the public map, and /track/<token> must still work.

-- live_sessions: public sees only public/live/non-expired; operators see own tenant.
drop policy if exists live_read on public.live_sessions;
create policy live_read on public.live_sessions for select
  using (
    (is_live = true
      and coalesce(visibility, 'public') = 'public'
      and (ends_at is null or ends_at > now()))
    or (public.is_operator() and tenant_id = public.current_tenant_id())
    or public.is_superadmin()
  );

-- truck_locations: public sees GPS only for a truck with a current PUBLIC live
-- session (correlated by truck_id, so it holds even when session_id is null on
-- the ping); operators see own tenant; superadmin all.
drop policy if exists loc_read on public.truck_locations;
create policy loc_read on public.truck_locations for select
  using (
    exists (
      select 1 from public.live_sessions s
      where s.truck_id = truck_locations.truck_id
        and s.is_live = true
        and coalesce(s.visibility, 'public') = 'public'
        and (s.ends_at is null or s.ends_at > now())
    )
    or (public.is_operator() and tenant_id = public.current_tenant_id())
    or public.is_superadmin()
  );
