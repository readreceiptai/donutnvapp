-- ELLE project. Per-client cost dashboard views. Separates ACTUAL spend (self-logged by
-- functions) from ESTIMATE spend (dispatcher metering, phase='estimate') so real per-client
-- cost is clean, with onboarding vs recurring and 7d/30d/total windows, plus a per-service
-- /phase breakdown. Read these for "what does each Z cost."
create or replace view public.elle_cost_dashboard as
select
  t.id as tenant_id,
  t.franchise_name,
  t.paid_apis_enabled,
  coalesce(sum(l.dollar_cost) filter (where l.phase <> 'estimate'), 0)                                        as actual_total,
  coalesce(sum(l.dollar_cost) filter (where l.phase = 'estimate'), 0)                                         as estimate_total,
  coalesce(sum(l.dollar_cost) filter (where l.phase = 'onboarding'), 0)                                       as onboarding_actual,
  coalesce(sum(l.dollar_cost) filter (where l.phase = 'recurring'), 0)                                        as recurring_actual,
  coalesce(sum(l.dollar_cost) filter (where l.phase <> 'estimate' and l.created_at > now() - interval '7 days'), 0)  as actual_7d,
  coalesce(sum(l.dollar_cost) filter (where l.phase <> 'estimate' and l.created_at > now() - interval '30 days'), 0) as actual_30d,
  count(l.id) filter (where l.phase <> 'estimate')                                                            as n_actual_charges,
  count(l.id) filter (where l.phase = 'estimate')                                                             as n_estimate_charges,
  max(l.created_at)                                                                                           as last_spend_at
from public.elle_tenants t
left join public.elle_spend_ledger l on l.tenant_id = t.id
group by t.id, t.franchise_name, t.paid_apis_enabled;

create or replace view public.elle_cost_by_service_phase as
select tenant_id, service, coalesce(phase,'unknown') as phase,
  sum(units) as units, sum(dollar_cost) as dollar_cost, count(*) as n
from public.elle_spend_ledger
group by tenant_id, service, coalesce(phase,'unknown');

alter view public.elle_cost_dashboard set (security_invoker = on);
alter view public.elle_cost_by_service_phase set (security_invoker = on);