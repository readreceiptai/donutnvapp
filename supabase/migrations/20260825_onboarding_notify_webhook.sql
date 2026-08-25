-- APP project (cfghtxfplkodjnndzmcf). Email-notify on new onboarding submissions.
--
-- Fires AFTER INSERT on onboarding_intake -> POSTs the row to the
-- onboarding-notify edge function, which formats + emails it (via Resend) to
-- Kevin. The onboarding_intake row stays the system of record; this is a
-- notification layer on top.
--
-- Fail-safe: net.http_post (pg_net) is fire-and-forget (it queues the request and
-- returns immediately), and the whole call is wrapped so ANY error is swallowed —
-- a broken/unconfigured notifier can never block a submission landing in the
-- table. Config lives in app_config (no secret in this SQL); if either key is
-- unset, the trigger no-ops.
--
-- To activate (once Supabase + Resend are back), set in app_config:
--   onboarding_notify_url    = https://cfghtxfplkodjnndzmcf.supabase.co/functions/v1/onboarding-notify
--   onboarding_notify_secret = <same value as the function's ONBOARDING_NOTIFY_SECRET>
-- and deploy the onboarding-notify function (--no-verify-jwt) with its secrets.
-- (Alternatively, skip this trigger and create a dashboard Database Webhook on
--  INSERT pointing to the function URL with ?key=<secret>.)

create or replace function public.notify_onboarding_intake()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url    from public.app_config where key = 'onboarding_notify_url';
  select value into v_secret from public.app_config where key = 'onboarding_notify_secret';
  if v_url is null or v_url = '' then
    return new; -- not configured yet -> no-op (submission still saved)
  end if;
  begin
    perform net.http_post(
      url     := v_url || '?key=' || coalesce(v_secret, ''),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object('type', 'INSERT', 'table', 'onboarding_intake', 'record', to_jsonb(new))
    );
  exception when others then
    -- notification is best-effort; never fail the insert
    raise notice 'notify_onboarding_intake: post failed (%%), submission still saved', sqlerrm;
  end;
  return new;
end;
$$;

revoke execute on function public.notify_onboarding_intake() from anon, authenticated;

drop trigger if exists trg_onboarding_notify on public.onboarding_intake;
create trigger trg_onboarding_notify
  after insert on public.onboarding_intake
  for each row execute function public.notify_onboarding_intake();
