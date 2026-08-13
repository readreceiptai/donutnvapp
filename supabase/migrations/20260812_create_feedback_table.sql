-- APP project (cfghtxfplkodjnndzmcf). In-app tester feedback (franchisees on ELLE +
-- customers on The Window). Widget inserts here; superadmin reviews at /admin/feedback.
create table if not exists public.feedback (
  id           bigint generated always as identity primary key,
  tenant_id    uuid references public.tenants(id),
  user_id      uuid default auth.uid(),
  role         text,                                -- 'franchisee' | 'customer'
  category     text not null default 'other',       -- bug | idea | bad_lead | question | praise | other
  message      text not null,
  context      jsonb not null default '{}'::jsonb,  -- {page, url, app_version, user_agent}
  status       text not null default 'new',         -- new | seen | resolved
  admin_note   text,
  created_at   timestamptz not null default now()
);
create index if not exists feedback_status_created_idx on public.feedback (status, created_at desc);
create index if not exists feedback_tenant_idx on public.feedback (tenant_id, created_at desc);

alter table public.feedback enable row level security;

drop policy if exists feedback_insert_own on public.feedback;
create policy feedback_insert_own on public.feedback
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists feedback_read on public.feedback;
create policy feedback_read on public.feedback
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_superadmin()
    or (public.is_operator() and tenant_id = public.current_tenant_id())
  );

drop policy if exists feedback_update_admin on public.feedback;
create policy feedback_update_admin on public.feedback
  for update to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());
