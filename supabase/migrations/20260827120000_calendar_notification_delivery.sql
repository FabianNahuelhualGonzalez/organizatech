-- RELEASE-EMAIL-CAL-NOTIFY-01: persistent inbox and bounded reminder-email outbox.
-- Prepared locally only. Apply to QA first after independent audit.

begin;

create table public.calendar_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_id uuid not null references public.calendar_reminders(id) on delete cascade,
  occurrence_on date not null,
  reminder_time time without time zone not null,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint calendar_notifications_occurrence_unique unique (reminder_id, occurrence_on),
  constraint calendar_notifications_title_length check (char_length(title) between 1 and 120),
  constraint calendar_notifications_body_length check (char_length(body) between 1 and 1100)
);

create index calendar_notifications_owner_created_idx
  on public.calendar_notifications (user_id, created_at desc, id);

alter table public.calendar_notifications enable row level security;
alter table public.calendar_notifications force row level security;

create policy "calendar notifications select own rows"
  on public.calendar_notifications for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all privileges on table public.calendar_notifications from public, anon, authenticated;
grant select on table public.calendar_notifications to authenticated;

create table private.calendar_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_id uuid not null references public.calendar_reminders(id) on delete cascade,
  occurrence_on date not null,
  idempotency_key uuid not null,
  status text not null default 'pending',
  attempt_count smallint not null default 0,
  attempt_token uuid,
  claimed_at timestamptz,
  provider_message_id text,
  provider_error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint calendar_reminder_deliveries_occurrence_unique unique (reminder_id, occurrence_on),
  constraint calendar_reminder_deliveries_status_allowed check (
    status in ('pending', 'sending', 'sent', 'failed', 'rejected', 'ambiguous')
  ),
  constraint calendar_reminder_deliveries_attempts_bounded check (attempt_count between 0 and 3),
  constraint calendar_reminder_deliveries_claim_shape check (
    (status = 'sending' and attempt_token is not null and claimed_at is not null)
    or (status <> 'sending' and attempt_token is null)
  ),
  constraint calendar_reminder_deliveries_provider_id check (
    provider_message_id is null or (
      char_length(provider_message_id) between 1 and 512 and provider_message_id !~ '[\r\n]'
    )
  ),
  constraint calendar_reminder_deliveries_error_code check (
    provider_error_code is null or provider_error_code ~ '^[a-z0-9_]{1,64}$'
  )
);

create index calendar_reminder_deliveries_claim_idx
  on private.calendar_reminder_deliveries (status, updated_at, id)
  where status in ('pending', 'failed', 'sending');

alter table private.calendar_reminder_deliveries enable row level security;
alter table private.calendar_reminder_deliveries force row level security;
revoke all privileges on table private.calendar_reminder_deliveries from public, anon, authenticated;

create function private.calendar_reminder_occurs_on(
  p_reminder public.calendar_reminders,
  p_candidate date
)
returns boolean
language plpgsql
stable
strict
security invoker
set search_path = ''
as $calendar_reminder_occurs_on$
declare
  v_days integer := p_candidate - p_reminder.starts_on;
  v_weekday text := (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from p_candidate)::integer + 1];
  v_occurrence integer;
begin
  if p_candidate < p_reminder.starts_on then return false; end if;
  if p_reminder.end_mode = 'on_date' and p_candidate > p_reminder.ends_on then return false; end if;

  if p_reminder.recurrence_frequency = 'once' then
    v_occurrence := 1;
    return p_candidate = p_reminder.starts_on;
  elsif p_reminder.recurrence_frequency = 'daily' then
    v_occurrence := v_days + 1;
  elsif p_reminder.recurrence_frequency = 'weekly' then
    if not (v_weekday = any(p_reminder.weekly_days)) then return false; end if;
    select pg_catalog.count(*)::integer into v_occurrence
    from pg_catalog.generate_series(p_reminder.starts_on, p_candidate, interval '1 day') as day(value)
    where (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from day.value)::integer + 1]
      = any(p_reminder.weekly_days);
  elsif p_reminder.monthly_mode = 'day_of_month' then
    if extract(day from p_candidate)::integer <> p_reminder.monthly_day then return false; end if;
    select pg_catalog.count(*)::integer into v_occurrence
    from pg_catalog.generate_series(p_reminder.starts_on, p_candidate, interval '1 day') as day(value)
    where extract(day from day.value)::integer = p_reminder.monthly_day;
  else
    if v_weekday <> p_reminder.monthly_weekday then return false; end if;
    if p_reminder.monthly_position = 'last' then
      if p_candidate + 7 <= (pg_catalog.date_trunc('month', p_candidate) + interval '1 month - 1 day')::date then return false; end if;
    elsif ((extract(day from p_candidate)::integer - 1) / 7 + 1)::text <> p_reminder.monthly_position then
      return false;
    end if;
    select pg_catalog.count(*)::integer into v_occurrence
    from pg_catalog.generate_series(p_reminder.starts_on, p_candidate, interval '1 day') as day(value)
    where extract(dow from day.value) = extract(dow from p_candidate)
      and (
        (p_reminder.monthly_position = 'last'
          and day.value + interval '7 day' > pg_catalog.date_trunc('month', day.value) + interval '1 month - 1 day')
        or (p_reminder.monthly_position <> 'last'
          and ((extract(day from day.value)::integer - 1) / 7 + 1)::text = p_reminder.monthly_position)
      );
  end if;
  return p_reminder.end_mode <> 'after_occurrences' or v_occurrence <= p_reminder.occurrence_count;
end;
$calendar_reminder_occurs_on$;

revoke all on function private.calendar_reminder_occurs_on(public.calendar_reminders, date) from public, anon, authenticated;

-- Política civil explícita para America/Santiago:
--  * una hora inexistente avanza al primer minuto civil válido posterior;
--  * una hora duplicada usa el primer instante (el más temprano);
--  * la anticipación se resta luego como duración absoluta desde ese instante.
create function private.resolve_santiago_calendar_occurrence(
  p_occurrence_on date,
  p_reminder_time time without time zone
)
returns timestamptz
language plpgsql
stable
strict
security invoker
set search_path = ''
as $resolve_santiago_calendar_occurrence$
declare
  v_requested_local timestamp without time zone := p_occurrence_on + p_reminder_time;
  v_candidate_local timestamp without time zone;
  v_default_instant timestamptz;
  v_resolved_instant timestamptz;
  v_minutes integer;
begin
  for v_minutes in 0..180 loop
    v_candidate_local := v_requested_local + pg_catalog.make_interval(mins => v_minutes);
    v_default_instant := pg_catalog.timezone('America/Santiago', v_candidate_local);

    select pg_catalog.min(probe.value)
      into v_resolved_instant
    from pg_catalog.generate_series(
      v_default_instant - interval '2 hours',
      v_default_instant + interval '2 hours',
      interval '1 hour'
    ) as probe(value)
    where pg_catalog.timezone('America/Santiago', probe.value) = v_candidate_local;

    if v_resolved_instant is not null then
      return v_resolved_instant;
    end if;
  end loop;

  raise exception 'unable to resolve Santiago civil reminder time' using errcode = '22008';
end;
$resolve_santiago_calendar_occurrence$;

revoke all on function private.resolve_santiago_calendar_occurrence(date, time without time zone)
  from public, anon, authenticated;

create function private.verify_calendar_reminder_capability(p_capability text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $verify_calendar_reminder_capability$
declare v_expected_capability text;
begin
  select secret.decrypted_secret into v_expected_capability
  from vault.decrypted_secrets as secret
  where secret.name = 'organizatech_calendar_reminder_rpc_secret'
  order by secret.created_at desc limit 1;

  if p_capability is null or v_expected_capability is null
    or pg_catalog.char_length(p_capability) not between 32 and 512
    or pg_catalog.char_length(v_expected_capability) not between 32 and 512
    or p_capability ~ '[[:cntrl:][:space:]]'
    or v_expected_capability ~ '[[:cntrl:][:space:]]' then
    return false;
  end if;
  return private.transactional_email_constant_time_equal(
    extensions.digest(pg_catalog.convert_to(p_capability, 'UTF8'), 'sha256'),
    extensions.digest(pg_catalog.convert_to(v_expected_capability, 'UTF8'), 'sha256')
  );
exception when others then return false;
end;
$verify_calendar_reminder_capability$;

revoke all on function private.verify_calendar_reminder_capability(text)
  from public, anon, authenticated;

create function public.list_own_calendar_notifications(p_limit integer default 50)
returns table (id uuid, title text, body text, occurrence_on date, reminder_time time without time zone, read_at timestamptz, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $list_own_calendar_notifications$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null or p_limit not between 1 and 100 then
    raise exception 'invalid notification request' using errcode = '42501';
  end if;
  return query select n.id, n.title, n.body, n.occurrence_on, n.reminder_time, n.read_at, n.created_at
  from public.calendar_notifications as n
  where n.user_id = v_user_id
  order by n.created_at desc, n.id desc limit p_limit;
end;
$list_own_calendar_notifications$;

revoke all on function public.list_own_calendar_notifications(integer) from public, anon, authenticated;
grant execute on function public.list_own_calendar_notifications(integer) to authenticated;

create function public.mark_own_calendar_notifications_read(p_notification_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $mark_own_calendar_notifications_read$
declare v_user_id uuid := auth.uid(); v_count integer;
begin
  if v_user_id is null or p_notification_ids is null
    or pg_catalog.cardinality(p_notification_ids) not between 1 and 50 then
    raise exception 'invalid notification request' using errcode = '42501';
  end if;
  update public.calendar_notifications as n
  set read_at = coalesce(n.read_at, pg_catalog.clock_timestamp())
  where n.user_id = v_user_id and n.id = any(p_notification_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$mark_own_calendar_notifications_read$;

revoke all on function public.mark_own_calendar_notifications_read(uuid[]) from public, anon, authenticated;
grant execute on function public.mark_own_calendar_notifications_read(uuid[]) to authenticated;

create function public.claim_due_calendar_reminder_deliveries(p_capability text)
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
    insert into public.calendar_notifications (user_id, reminder_id, occurrence_on, reminder_time, title, body, created_at)
    select due_bounded.user_id, due_bounded.id, due_bounded.occurrence_on, due_bounded.reminder_time, due_bounded.title,
      case when due_bounded.description = '' then 'Tienes un recordatorio de calendario programado.' else due_bounded.description end,
      due_bounded.notify_at
    from due_bounded
    on conflict (reminder_id, occurrence_on) do nothing
    returning reminder_id, occurrence_on
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
  on conflict (reminder_id, occurrence_on) do nothing;

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

revoke all on function public.claim_due_calendar_reminder_deliveries(text) from public, anon, authenticated;
grant execute on function public.claim_due_calendar_reminder_deliveries(text) to anon;

create function public.complete_calendar_reminder_delivery(
  p_capability text, p_delivery_id uuid, p_attempt_token uuid, p_outcome text,
  p_provider_message_id text default null, p_provider_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $complete_calendar_reminder_delivery$
begin
  if not private.verify_calendar_reminder_capability(p_capability)
    or p_outcome not in ('sent', 'failed', 'rejected', 'ambiguous') then
    raise exception 'calendar completion unauthorized' using errcode = '42501';
  end if;
  if (p_outcome = 'sent' and (p_provider_message_id is null or p_provider_error_code is not null))
    or (p_outcome <> 'sent' and (p_provider_message_id is not null or p_provider_error_code is null)) then
    raise exception 'invalid calendar completion payload' using errcode = '22023';
  end if;
  update private.calendar_reminder_deliveries as d set
    status = p_outcome, attempt_token = null,
    provider_message_id = case when p_outcome = 'sent' then p_provider_message_id else null end,
    provider_error_code = case when p_outcome = 'sent' then null else p_provider_error_code end,
    sent_at = case when p_outcome = 'sent' then pg_catalog.clock_timestamp() else null end,
    updated_at = pg_catalog.clock_timestamp()
  where d.id = p_delivery_id and d.status = 'sending' and d.attempt_token = p_attempt_token;
  return found;
end;
$complete_calendar_reminder_delivery$;

revoke all on function public.complete_calendar_reminder_delivery(text, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_calendar_reminder_delivery(text, uuid, uuid, text, text, text) to anon;

commit;
