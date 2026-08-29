-- SECURITY-SCAN-2179 / findings 1 and 2: make recurrence evaluation bounded
-- and cap persistent reminder cardinality per identity and portal.

create or replace function private.calendar_reminder_occurs_on(
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
  v_weekday text := (array['sun','mon','tue','wed','thu','fri','sat'])[
    extract(dow from p_candidate)::integer + 1
  ];
  v_occurrence integer;
  v_remainder integer;
  v_offset integer;
  v_month_span integer;
  v_month_offset integer;
  v_month_start date;
  v_month_end date;
  v_occurrence_date date;
  v_target_dow integer;
begin
  if p_candidate < p_reminder.starts_on then
    return false;
  end if;
  if p_reminder.end_mode = 'on_date' and p_candidate > p_reminder.ends_on then
    return false;
  end if;

  if p_reminder.recurrence_frequency = 'once' then
    return p_candidate = p_reminder.starts_on;
  end if;

  if p_reminder.recurrence_frequency = 'daily' then
    if p_reminder.end_mode <> 'after_occurrences' then
      return true;
    end if;
    return v_days + 1 <= p_reminder.occurrence_count;
  end if;

  if p_reminder.recurrence_frequency = 'weekly' then
    if not (v_weekday = any(p_reminder.weekly_days)) then
      return false;
    end if;
    if p_reminder.end_mode <> 'after_occurrences' then
      return true;
    end if;

    -- Count complete weeks arithmetically, then inspect at most seven days.
    v_occurrence := (v_days / 7) * pg_catalog.cardinality(p_reminder.weekly_days);
    v_remainder := v_days % 7;
    for v_offset in 0..v_remainder loop
      if (array['sun','mon','tue','wed','thu','fri','sat'])[
          extract(dow from p_reminder.starts_on + v_offset)::integer + 1
        ] = any(p_reminder.weekly_days)
      then
        v_occurrence := v_occurrence + 1;
      end if;
    end loop;
    return v_occurrence <= p_reminder.occurrence_count;
  end if;

  v_month_start := pg_catalog.date_trunc('month', p_candidate)::pg_catalog.date;
  v_month_end := (v_month_start + interval '1 month - 1 day')::pg_catalog.date;

  if p_reminder.monthly_mode = 'day_of_month' then
    if p_reminder.monthly_day > extract(day from v_month_end)::integer then
      return false;
    end if;
    v_occurrence_date := v_month_start + (p_reminder.monthly_day - 1)::integer;
  else
    v_target_dow := case p_reminder.monthly_weekday
      when 'sun' then 0
      when 'mon' then 1
      when 'tue' then 2
      when 'wed' then 3
      when 'thu' then 4
      when 'fri' then 5
      when 'sat' then 6
    end;

    if p_reminder.monthly_position = 'last' then
      v_occurrence_date := v_month_end - (
        (extract(dow from v_month_end)::integer - v_target_dow + 7) % 7
      );
    else
      v_occurrence_date := v_month_start + (
        (v_target_dow - extract(dow from v_month_start)::integer + 7) % 7
        + (p_reminder.monthly_position::integer - 1) * 7
      );
    end if;
  end if;

  if v_occurrence_date is distinct from p_candidate then
    return false;
  end if;
  if p_reminder.end_mode <> 'after_occurrences' then
    return true;
  end if;

  v_month_span := (
    (extract(year from p_candidate)::integer
      - extract(year from p_reminder.starts_on)::integer) * 12
    + extract(month from p_candidate)::integer
    - extract(month from p_reminder.starts_on)::integer
  );

  -- occurrence_count is at most 52. Even a day-31 rule reaches 52 valid
  -- occurrences within 120 months, so older candidates cannot qualify.
  if v_month_span > 120 then
    return false;
  end if;

  v_occurrence := 0;
  for v_month_offset in 0..v_month_span loop
    v_month_start := (
      pg_catalog.date_trunc('month', p_reminder.starts_on)
      + pg_catalog.make_interval(months => v_month_offset)
    )::pg_catalog.date;
    v_month_end := (v_month_start + interval '1 month - 1 day')::pg_catalog.date;
    v_occurrence_date := null;

    if p_reminder.monthly_mode = 'day_of_month' then
      if p_reminder.monthly_day <= extract(day from v_month_end)::integer then
        v_occurrence_date := v_month_start + (p_reminder.monthly_day - 1)::integer;
      end if;
    elsif p_reminder.monthly_position = 'last' then
      v_occurrence_date := v_month_end - (
        (extract(dow from v_month_end)::integer - v_target_dow + 7) % 7
      );
    else
      v_occurrence_date := v_month_start + (
        (v_target_dow - extract(dow from v_month_start)::integer + 7) % 7
        + (p_reminder.monthly_position::integer - 1) * 7
      );
    end if;

    if v_occurrence_date is not null and v_occurrence_date >= p_reminder.starts_on then
      v_occurrence := v_occurrence + 1;
      if v_occurrence_date = p_candidate then
        return v_occurrence <= p_reminder.occurrence_count;
      end if;
      if v_occurrence >= p_reminder.occurrence_count then
        return false;
      end if;
    end if;
  end loop;

  return false;
end;
$calendar_reminder_occurs_on$;

revoke all on function private.calendar_reminder_occurs_on(
  public.calendar_reminders, date
) from public, anon, authenticated;

create or replace function public.create_own_calendar_reminder(
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
  p_occurrence_count smallint,
  p_portal_scope text
)
returns table (id uuid)
language plpgsql
security definer
set search_path = ''
as $create_scoped_calendar_reminder$
declare
  v_user_id uuid := auth.uid();
  v_existing_id uuid;
  v_existing_scope text;
  v_created_id uuid;
begin
  if v_user_id is null
    or p_request_id is null
    or p_portal_scope is null
    or p_portal_scope not in ('usuario', 'coach')
  then
    raise exception 'invalid calendar portal request' using errcode = '42501';
  end if;

  if p_portal_scope = 'coach' and not exists (
    select 1
    from public.coach_registrations as registration
    where registration.user_id = v_user_id
  ) then
    raise exception 'coach portal membership required' using errcode = '42501';
  end if;

  -- One lock covers both fresh IDs and retries, closing concurrent quota races.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organizatech:security-calendar-quota:'
        || v_user_id::pg_catalog.text || ':' || p_portal_scope,
      0
    )
  );

  -- Always acquire quota first and request second. The request lock serializes
  -- a reused request_id even when concurrent calls target different portals.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organizatech:calendar-request:'
        || v_user_id::pg_catalog.text || ':' || p_request_id::pg_catalog.text,
      0
    )
  );

  select reminder.id, reminder.portal_scope
    into v_existing_id, v_existing_scope
  from public.calendar_reminders as reminder
  where reminder.user_id = v_user_id
    and reminder.request_id = p_request_id;

  if v_existing_id is not null and v_existing_scope is distinct from p_portal_scope then
    raise exception 'request_id portal mismatch' using errcode = '22023';
  end if;

  -- Exact retries still reach the private idempotency check at the quota.
  if v_existing_id is null and exists (
    select 1
    from public.calendar_reminders as reminder
    where reminder.user_id = v_user_id
      and reminder.portal_scope = p_portal_scope
    order by reminder.starts_on, reminder.reminder_time, reminder.id
    offset 499
    limit 1
  ) then
    raise exception using errcode = '54000', message = 'calendar reminder limit reached';
  end if;

  select created.id
    into v_created_id
  from private.create_own_calendar_reminder(
    p_request_id,
    p_title,
    p_description,
    p_kind,
    p_starts_on,
    p_reminder_time,
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
  ) as created;

  if v_created_id is null then
    raise exception 'calendar reminder could not be confirmed' using errcode = '42501';
  end if;

  if v_existing_id is null then
    update public.calendar_reminders as reminder
    set portal_scope = p_portal_scope
    where reminder.id = v_created_id
      and reminder.user_id = v_user_id
      and reminder.portal_scope = 'usuario';
  end if;

  if not exists (
    select 1
    from public.calendar_reminders as reminder
    where reminder.id = v_created_id
      and reminder.user_id = v_user_id
      and reminder.portal_scope = p_portal_scope
  ) then
    raise exception 'calendar reminder portal mismatch' using errcode = '22023';
  end if;

  return query select v_created_id;
end;
$create_scoped_calendar_reminder$;

revoke all on function public.create_own_calendar_reminder(
  uuid, text, text, text, date, time without time zone, text, boolean, text,
  text[], text, smallint, text, text, text, date, smallint, text
) from public, anon, authenticated;
grant execute on function public.create_own_calendar_reminder(
  uuid, text, text, text, date, time without time zone, text, boolean, text,
  text[], text, smallint, text, text, text, date, smallint, text
) to authenticated;
