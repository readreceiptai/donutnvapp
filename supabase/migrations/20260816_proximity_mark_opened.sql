-- ═══════════════════════════════════════════════════════════════════════════
-- Option B — CTR attribution
--
-- Marking a push as "opened" is the only write a customer ever makes to
-- proximity_notification_log. Granting UPDATE on the table would also let them
-- rewrite status, title, body and distance, which are the metrics themselves.
-- So: no UPDATE grant, and one narrow SECURITY DEFINER RPC that can set exactly
-- one column, on exactly the caller's own rows, exactly once.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.mark_proximity_notification_opened(
  p_session_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_updated integer;
begin
  if v_uid is null or p_session_id is null then
    return 0;
  end if;

  update proximity_notification_log
     set opened_at = now()
   where profile_id = v_uid           -- caller's own rows only
     and session_id = p_session_id
     and status = 'sent'
     and opened_at is null;           -- first open wins; not re-writable

  get diagnostics v_updated = row_count;
  return v_updated;
end$$;

revoke execute on function public.mark_proximity_notification_opened(uuid) from public, anon;
grant execute on function public.mark_proximity_notification_opened(uuid) to authenticated;
