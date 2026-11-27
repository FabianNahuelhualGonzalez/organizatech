-- Scheduler drains existing evaluation mail only. It never creates due reminders.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function public.claim_due_evaluation_email_retries(
  p_capability text, p_limit integer default 25
) returns table (
  delivery_id uuid, notification_id uuid, event_kind text, payload jsonb,
  idempotency_key uuid, recipient_email text, attempt_token uuid
) language plpgsql volatile security definer set search_path = ''
set statement_timeout = '8s' as $fn$
declare v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if auth.uid() is not null or not private.verify_evaluation_email_capability(p_capability) then
    raise exception 'evaluation retry forbidden' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 25 then
    raise exception 'evaluation retry invalid limit' using errcode = '22023';
  end if;

  return query with candidates as (
    select delivery.id from private.evaluation_email_deliveries delivery
    join private.evaluation_notifications notification on notification.id = delivery.notification_id
    where delivery.attempt_count < 5
      and notification.reminder_origin is distinct from 'automatic'
      and (
        delivery.status = 'pending'
        or (delivery.status = 'failed' and delivery.next_attempt_at <= v_now)
      )
    order by delivery.created_at, delivery.id
    for update of delivery skip locked limit p_limit
  ), claimed as (
    update private.evaluation_email_deliveries delivery
    set status = 'sending', attempt_count = delivery.attempt_count + 1,
      attempt_token = pg_catalog.gen_random_uuid(), claimed_at = v_now,
      next_attempt_at = null, provider_error_code = null, updated_at = v_now
    from candidates where delivery.id = candidates.id returning delivery.*
  ) select claimed.id, claimed.notification_id, claimed.event_kind,
    claimed.payload, claimed.idempotency_key, claimed.recipient_email_snapshot,
    claimed.attempt_token from claimed;
end;
$fn$;

revoke all on function public.claim_due_evaluation_email_retries(text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_due_evaluation_email_retries(text,integer) to anon;
commit;
