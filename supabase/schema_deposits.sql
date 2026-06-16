-- ============================================================================
-- DonutNV — Event deposits via Square (Payment Links / Quick Pay)
-- Run AFTER schema.sql + schema_bookings.sql. Safe to run more than once.
--
-- We use SQUARE (not Stripe) for event deposits. The operator taps
-- "Request deposit" on a booking → the square-deposit Edge Function creates a
-- Square hosted payment link for the deposit amount and stores it here. The
-- square-webhook marks the deposit paid when Square reports the payment.
-- ============================================================================

alter table public.bookings
  add column if not exists deposit_amount_cents integer,
  add column if not exists deposit_status        text not null default 'none',
  add column if not exists deposit_url            text,
  add column if not exists deposit_link_id        text,
  add column if not exists square_order_id        text,
  add column if not exists deposit_requested_at   timestamptz,
  add column if not exists deposit_paid_at        timestamptz;

-- Fast lookup when a Square payment webhook arrives and we need to match it to
-- the booking that requested the deposit.
create index if not exists bookings_square_order_idx
  on public.bookings(square_order_id);

-- deposit_status values: 'none' | 'requested' | 'paid' | 'refunded'
