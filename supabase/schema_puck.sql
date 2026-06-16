-- ============================================================================
-- DonutNV — Hardware GPS puck support
-- Run AFTER schema.sql. Safe to run more than once.
--
-- A per-truck secret token. A Traccar/OsmAnd-style tracker (or any device) posts
-- its location to the `puck-ingest` edge function using this token; the function
-- writes to truck_locations and keeps the truck live — no phone needed.
-- Set a token per truck:  update public.trucks set puck_token = 'a-long-random-string' where id = '...';
-- ============================================================================

alter table public.trucks add column if not exists puck_token text;
create unique index if not exists trucks_puck_token_uniq
  on public.trucks(puck_token) where puck_token is not null;
