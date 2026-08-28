-- CAL-REMINDER-01B: one auth-owned calendar shared by Usuario and Coach portals.
-- Email is stored only as a preference; this migration does not deliver notifications.

create table public.calendar_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  title text not null,
  description text not null default '',
  kind text not null,
  starts_on date not null,
  reminder_time time without time zone not null,
  timezone text not null default 'America/Santiago',
  lead_time text not null,
  email_notification boolean not null default false,
  recurrence_frequency text not null,
  weekly_days text[] null,
  monthly_mode text null,
  monthly_day smallint null,
  monthly_weekday text null,
  monthly_position text null,
  end_mode text not null,
  ends_on date null,
  occurrence_count smallint null,
  created_at timestamp with time zone not null default statement_timestamp(),
  constraint calendar_reminders_user_request_unique unique (user_id, request_id),
  constraint calendar_reminders_title_length check (
    char_length(btrim(title)) between 1 and 120
  ),
  constraint calendar_reminders_description_length check (char_length(description) <= 1000),
  constraint calendar_reminders_kind_allowed check (kind in ('revision', 'vencimiento', 'personal')),
  constraint calendar_reminders_timezone_fixed check (timezone = 'America/Santiago'),
  constraint calendar_reminders_lead_time_allowed check (
    lead_time in ('at_time', '10_minutes', '1_hour', '1_day')
  ),
  constraint calendar_reminders_frequency_allowed check (
    recurrence_frequency in ('once', 'daily', 'weekly', 'monthly')
  ),
  constraint calendar_reminders_weekly_shape check (
    (recurrence_frequency = 'weekly'
      and cardinality(weekly_days) between 1 and 7
      and weekly_days <@ array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']::text[])
    or (recurrence_frequency <> 'weekly' and weekly_days is null)
  ),
  constraint calendar_reminders_monthly_shape check (
    ((recurrence_frequency = 'monthly' and (
      (monthly_mode is not null
        and monthly_mode = 'day_of_month'
        and monthly_day is not null
        and monthly_day between 1 and 31
        and monthly_weekday is null
        and monthly_position is null)
      or
      (monthly_mode is not null
        and monthly_mode = 'weekday_position'
        and monthly_day is null
        and monthly_weekday is not null
        and monthly_weekday in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
        and monthly_position is not null
        and monthly_position in ('1', '2', '3', '4', 'last'))
    ))
    or (recurrence_frequency <> 'monthly'
      and monthly_mode is null
      and monthly_day is null
      and monthly_weekday is null
      and monthly_position is null)) is true
  ),
  constraint calendar_reminders_end_shape check (
    (recurrence_frequency = 'once'
      and end_mode = 'never'
      and ends_on is null
      and occurrence_count is null)
    or
    (recurrence_frequency <> 'once' and (
      (end_mode = 'never' and ends_on is null and occurrence_count is null)
      or (end_mode = 'on_date' and ends_on >= starts_on and occurrence_count is null)
      or (end_mode = 'after_occurrences' and ends_on is null and occurrence_count between 2 and 52)
    ))
  )
);

create index calendar_reminders_user_starts_on_idx
  on public.calendar_reminders (user_id, starts_on, reminder_time, id);

alter table public.calendar_reminders enable row level security;
alter table public.calendar_reminders force row level security;

create policy "calendar reminders select own rows"
  on public.calendar_reminders
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all privileges on table public.calendar_reminders from public;
revoke all privileges on table public.calendar_reminders from anon;
revoke all privileges on table public.calendar_reminders from authenticated;
grant select on table public.calendar_reminders to authenticated;

create function public.create_own_calendar_reminder(
  p_request_id uuid,
  p_title text,
  p_description text,
  p_kind text,
  p_starts_on date,
  p_reminder_time time without time zone,
  p_lead_time text,
  p_email_notification boolean,
  p_recurrence_frequency text,
  p_weekly_days text[],
  p_monthly_mode text,
  p_monthly_day smallint,
  p_monthly_weekday text,
  p_monthly_position text,
  p_end_mode text,
  p_ends_on date,
  p_occurrence_count smallint
)
returns table (id uuid)
language plpgsql
security definer
set search_path = ''
as $create_own_calendar_reminder$
declare
  v_user_id uuid := auth.uid();
  v_title text := pg_catalog.btrim(p_title);
  v_description text := pg_catalog.btrim(pg_catalog.coalesce(p_description, ''));
  v_weekday_count integer;
  v_row public.calendar_reminders;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_request_id is null
    or pg_catalog.char_length(v_title) not between 1 and 120
    or pg_catalog.char_length(v_description) > 1000
    or p_kind not in ('revision', 'vencimiento', 'personal')
    or p_starts_on is null
    or p_reminder_time is null
    or p_lead_time not in ('at_time', '10_minutes', '1_hour', '1_day')
    or p_email_notification is null
    or p_recurrence_frequency not in ('once', 'daily', 'weekly', 'monthly')
  then
    raise exception 'invalid calendar reminder payload' using errcode = '22023';
  end if;

  if p_recurrence_frequency = 'weekly' then
    select pg_catalog.count(distinct weekday)
      into v_weekday_count
      from pg_catalog.unnest(p_weekly_days) as weekday;
    if p_weekly_days is null
      or pg_catalog.cardinality(p_weekly_days) not between 1 and 7
      or v_weekday_count <> pg_catalog.cardinality(p_weekly_days)
      or not (p_weekly_days <@ array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']::text[])
    then
      raise exception 'invalid weekly recurrence' using errcode = '22023';
    end if;
  elsif p_weekly_days is not null then
    raise exception 'weekly fields are not allowed' using errcode = '22023';
  end if;

  if p_recurrence_frequency = 'monthly' then
    if not (
      (p_monthly_mode is not null
        and p_monthly_mode = 'day_of_month'
        and p_monthly_day is not null
        and p_monthly_day between 1 and 31
        and p_monthly_weekday is null
        and p_monthly_position is null)
      or
      (p_monthly_mode is not null
        and p_monthly_mode = 'weekday_position'
        and p_monthly_day is null
        and p_monthly_weekday is not null
        and p_monthly_weekday in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
        and p_monthly_position is not null
        and p_monthly_position in ('1', '2', '3', '4', 'last'))
    ) then
      raise exception 'invalid monthly recurrence' using errcode = '22023';
    end if;
  elsif p_monthly_mode is not null
    or p_monthly_day is not null
    or p_monthly_weekday is not null
    or p_monthly_position is not null
  then
    raise exception 'monthly fields are not allowed' using errcode = '22023';
  end if;

  if p_recurrence_frequency = 'once' then
    if p_end_mode <> 'never' or p_ends_on is not null or p_occurrence_count is not null then
      raise exception 'one-time reminders cannot have an end rule' using errcode = '22023';
    end if;
  elsif not (
    (p_end_mode = 'never' and p_ends_on is null and p_occurrence_count is null)
    or (p_end_mode = 'on_date' and p_ends_on >= p_starts_on and p_occurrence_count is null)
    or (p_end_mode = 'after_occurrences' and p_ends_on is null and p_occurrence_count between 2 and 52)
  ) then
    raise exception 'invalid recurrence end' using errcode = '22023';
  end if;

  insert into public.calendar_reminders (
    user_id,
    request_id,
    title,
    description,
    kind,
    starts_on,
    reminder_time,
    timezone,
    lead_time,
    email_notification,
    recurrence_frequency,
    weekly_days,
    monthly_mode,
    monthly_day,
    monthly_weekday,
    monthly_position,
    end_mode,
    ends_on,
    occurrence_count
  ) values (
    v_user_id,
    p_request_id,
    v_title,
    v_description,
    p_kind,
    p_starts_on,
    p_reminder_time,
    'America/Santiago',
    p_lead_time,
    p_email_notification,
    p_recurrence_frequency,
    p_weekly_days,
    p_monthly_mode,
    p_monthly_day,
    p_monthly_weekday,
    p_monthly_position,
    p_end_mode,
    p_ends_on,
    p_occurrence_count
  )
  on conflict (user_id, request_id) do nothing;

  select reminder.*
    into v_row
    from public.calendar_reminders as reminder
    where reminder.user_id = v_user_id
      and reminder.request_id = p_request_id;

  if v_row.id is null
    or v_row.title is distinct from v_title
    or v_row.description is distinct from v_description
    or v_row.kind is distinct from p_kind
    or v_row.starts_on is distinct from p_starts_on
    or v_row.reminder_time is distinct from p_reminder_time
    or v_row.lead_time is distinct from p_lead_time
    or v_row.email_notification is distinct from p_email_notification
    or v_row.recurrence_frequency is distinct from p_recurrence_frequency
    or v_row.weekly_days is distinct from p_weekly_days
    or v_row.monthly_mode is distinct from p_monthly_mode
    or v_row.monthly_day is distinct from p_monthly_day
    or v_row.monthly_weekday is distinct from p_monthly_weekday
    or v_row.monthly_position is distinct from p_monthly_position
    or v_row.end_mode is distinct from p_end_mode
    or v_row.ends_on is distinct from p_ends_on
    or v_row.occurrence_count is distinct from p_occurrence_count
  then
    raise exception 'request_id payload mismatch' using errcode = '22023';
  end if;

  return query select v_row.id;
end;
$create_own_calendar_reminder$;

revoke all on function public.create_own_calendar_reminder(
  uuid, text, text, text, date, time without time zone, text, boolean, text,
  text[], text, smallint, text, text, text, date, smallint
) from public;
revoke all on function public.create_own_calendar_reminder(
  uuid, text, text, text, date, time without time zone, text, boolean, text,
  text[], text, smallint, text, text, text, date, smallint
) from anon;
revoke all on function public.create_own_calendar_reminder(
  uuid, text, text, text, date, time without time zone, text, boolean, text,
  text[], text, smallint, text, text, text, date, smallint
) from authenticated;
grant execute on function public.create_own_calendar_reminder(
  uuid, text, text, text, date, time without time zone, text, boolean, text,
  text[], text, smallint, text, text, text, date, smallint
) to authenticated;
