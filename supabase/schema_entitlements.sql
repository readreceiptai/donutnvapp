-- ============================================================================
-- DonutNV — Dual-app entitlements
-- Run AFTER schema.sql. Safe to run more than once.
--
-- A franchisee can buy the DonutNV ops/customer app, ELLE (event lead engine),
-- or both. These flags gate nav links and route access in the app so the two
-- products can be sold separately or bundled.
-- ============================================================================

alter table public.tenants
  add column if not exists has_app  boolean not null default true,
  add column if not exists has_elle boolean not null default false;

-- Pilot territory (Palm Harbor) gets ELLE switched on for testing.
update public.tenants set has_elle = true where slug = 'ph';
