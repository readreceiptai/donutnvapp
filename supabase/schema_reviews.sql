-- ============================================================================
-- DonutNV — Reviews hub
-- Run AFTER schema.sql + schema_bookings.sql + schema_event_journey.sql.
-- Safe to run more than once.
--
-- A curated set of reviews the operator chooses to feature publicly. Sources:
--   'event'  — pulled from a booking's review (bookings.review_rating/comment)
--   'manual' — pasted in by the operator (e.g. a Google / Facebook testimonial)
--   'app'    — a general app-customer review (future)
-- Only is_featured = true reviews are shown publicly, via the RPC below.
-- ============================================================================

create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  source      text not null default 'manual' check (source in ('event','manual','app')),
  booking_id  uuid references public.bookings(id) on delete set null,
  author_name text,
  rating      int check (rating between 1 and 5),
  body        text not null,
  is_featured boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists reviews_tenant_idx on public.reviews(tenant_id, is_featured, created_at desc);
-- One imported review per booking (re-importing just updates it).
create unique index if not exists reviews_booking_uniq on public.reviews(booking_id) where booking_id is not null;

alter table public.reviews enable row level security;

-- Operators manage their own tenant's reviews.
drop policy if exists reviews_ops on public.reviews;
create policy reviews_ops on public.reviews for all
  using (public.is_operator() and tenant_id = public.current_tenant_id())
  with check (public.is_operator() and tenant_id = public.current_tenant_id());

-- Public, read-only feed of featured reviews for the landing page.
create or replace function public.get_featured_reviews(p_tenant uuid, p_limit int default 12)
returns table (
  id          uuid,
  author_name text,
  rating      int,
  body        text,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.author_name, r.rating, r.body, r.created_at
  from public.reviews r
  where r.tenant_id = p_tenant and r.is_featured = true
  order by r.created_at desc
  limit greatest(1, least(p_limit, 50));
$$;

grant execute on function public.get_featured_reviews(uuid, int) to anon, authenticated;
