-- RELEASE-EMAIL-CAL-NOTIFY-01: qualify conflict targets inside the
-- RETURNS TABLE worker RPC so PL/pgSQL output variables cannot shadow them.

begin;

create or replace function public.claim_due_calendar_reminder_deliveries(p_capability text)
returns table (
  delivery_id uuid, user_id uuid, reminder_id uuid, occurrence_on date,
  idempotency_key uuid, recipient_email text, title text, description text,
  reminder_time text, attempt_token uuid
)
language plpgsql
security definer
set search_path = ''
as $claim_due_calendar_reminder_deliveries$
declare p_now timestamptz := pg_catalog.clock_timestamp();
begin
  if not private.verify_calendar_reminder_capability(p_capability) then
    raise exception 'calendar scheduler unauthorized' using errcode = '42501';
  end if;

  -- A timed-out provider request is ambiguous and is never automatically retried.
  update private.calendar_reminder_deliveries as d
  set status = 'ambiguous', attempt_token = null, provider_error_code = 'stale_sending', updated_at = pg_catalog.clock_timestamp()
  where d.status = 'sending' and d.claimed_at < p_now - interval '15 minutes';

  with candidate_dates as (
    select reminder.id as reminder_id, day.value::date as occurrence_on
    from public.calendar_reminders as reminder
    cross join lateral pg_catalog.generate_series(
      (pg_catalog.timezone('America/Santiago', p_now - interval '2 days'))::date,
      (pg_catalog.timezone('America/Santiago', p_now + interval '2 days'))::date,
      interval '1 day'
    ) as day(value)
  ), due as (
    select reminder.*, candidate.occurrence_on,
      private.resolve_santiago_calendar_occurrence(candidate.occurrence_on, reminder.reminder_time)
      - case reminder.lead_time
          when '10_minutes' then interval '10 minutes'
          when '1_hour' then interval '1 hour'
          when '1_day' then interval '1 day'
          else interval '0'
        end as notify_at
    from candidate_dates as candidate
    join public.calendar_reminders as reminder on reminder.id = candidate.reminder_id
    where private.calendar_reminder_occurs_on(reminder, candidate.occurrence_on)
  ), due_bounded as (
    select due.* from due
    where due.notify_at > p_now - interval '2 days' and due.notify_at <= p_now
      and (
        not exists (
          select 1 from public.calendar_notifications as existing_notification
          where existing_notification.reminder_id = due.id
            and existing_notification.occurrence_on = due.occurrence_on
        )
        or (
          due.email_notification
          and due.notify_at > p_now - interval '10 minutes'
          and not exists (
            select 1 from private.calendar_reminder_deliveries as existing_delivery
            where existing_delivery.reminder_id = due.id
              and existing_delivery.occurrence_on = due.occurrence_on
          )
        )
      )
    order by due.notify_at, due.id, due.occurrence_on
    limit 100
  ), materialized as (
    insert into public.calendar_notifications as inserted_notification (
      user_id, reminder_id, occurrence_on, reminder_time, title, body, created_at
    )
    select due_bounded.user_id, due_bounded.id, due_bounded.occurrence_on, due_bounded.reminder_time, due_bounded.title,
      case when due_bounded.description = '' then 'Tienes un recordatorio de calendario programado.' else due_bounded.description end,
      due_bounded.notify_at
    from due_bounded
    on conflict on constraint calendar_notifications_occurrence_unique do nothing
    returning inserted_notification.reminder_id, inserted_notification.occurrence_on
  )
  insert into private.calendar_reminder_deliveries (
    user_id, reminder_id, occurrence_on, idempotency_key
  )
  select due_bounded.user_id, due_bounded.id, due_bounded.occurrence_on,
    private.transactional_email_idempotency_uuid(
      'organizatech:calendar-reminder:v1:' || due_bounded.id::text || ':' || due_bounded.occurrence_on::text
    )
  from due_bounded
  where due_bounded.notify_at > p_now - interval '10 minutes'
    and due_bounded.email_notification
  on conflict on constraint calendar_reminder_deliveries_occurrence_unique do nothing;

  update private.calendar_reminder_deliveries as d
  set status = 'rejected', attempt_token = null,
    provider_error_code = 'recipient_unavailable', updated_at = p_now
  where d.status in ('pending', 'failed')
    and not exists (
      select 1 from auth.users as auth_user
      where auth_user.id = d.user_id
        and auth_user.email_confirmed_at is not null
        and auth_user.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    );

  return query
  with candidates as (
    select d.id from private.calendar_reminder_deliveries as d
    join auth.users as auth_user on auth_user.id = d.user_id
      and auth_user.email_confirmed_at is not null
      and auth_user.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    where d.status in ('pending', 'failed') and d.attempt_count < 3
      and (d.status = 'pending' or d.updated_at <= p_now - pg_catalog.make_interval(mins => d.attempt_count * 5))
    order by d.created_at, d.id for update skip locked limit 25
  ), claimed as (
    update private.calendar_reminder_deliveries as d
    set status = 'sending', attempt_count = d.attempt_count + 1,
      attempt_token = pg_catalog.gen_random_uuid(), claimed_at = p_now,
      provider_error_code = null, updated_at = p_now
    from candidates where d.id = candidates.id returning d.*
  )
  select claimed.id, claimed.user_id, claimed.reminder_id, claimed.occurrence_on,
    claimed.idempotency_key, pg_catalog.lower(pg_catalog.btrim(auth_user.email)), reminder.title,
    reminder.description, reminder.reminder_time::text, claimed.attempt_token
  from claimed
  join auth.users as auth_user on auth_user.id = claimed.user_id and auth_user.email_confirmed_at is not null
  join public.calendar_reminders as reminder on reminder.id = claimed.reminder_id
  where auth_user.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
end;
$claim_due_calendar_reminder_deliveries$;

revoke all on function public.claim_due_calendar_reminder_deliveries(text)
  from public, anon, authenticated;
grant execute on function public.claim_due_calendar_reminder_deliveries(text) to anon;

commit;
