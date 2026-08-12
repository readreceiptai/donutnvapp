-- APP project. Prevent duplicate customer accounts sharing a phone within a franchise
-- (breaks Square loyalty phone-matching). Per-tenant; same person may be a customer
-- of two different franchises.
create unique index if not exists profiles_tenant_phone_uniq
  on public.profiles (tenant_id, phone)
  where phone is not null and phone <> '';
