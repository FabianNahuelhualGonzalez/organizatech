-- NOTIFICATIONS-PORTAL-SEPARATION-01
-- Contextual separation for Usuario and Coach surfaces that share auth.uid().
-- Historical rows predate portal provenance and are deliberately assigned to
-- Usuario. This is a product-context boundary; auth.uid() remains the security
-- ownership boundary and different identities remain isolated by FORCE RLS.

begin;

alter table public.calendar_reminders
  add column portal_scope text not null default 'usuario',
  add constraint calendar_reminders_portal_scope_allowed
    check (portal_scope in ('usuario', 'coach'));

comment on column public.calendar_reminders.portal_scope is
  'Product portal that owns the reminder context. Historical rows are usuario.';

drop index if exists public.calendar_reminders_user_starts_on_idx;
create index calendar_reminders_user_portal_starts_on_idx
  on public.calendar_reminders (user_id, portal_scope, starts_on, reminder_time, id);

alter table public.calendar_reminders enable row level security;
alter table public.calendar_reminders force row level security;
revoke all privileges on table public.calendar_reminders from public, anon, authenticated;

-- Retire the shared-portal public entrypoint without rewriting an applied
-- migration. The new public wrapper below is the only client-callable create.
alter function public.create_own_calendar_reminder(
  uuid, text, text, text, date, time without time zone, text, boolean, text,
  text[], text, smallint, text, text, text, date, smallint
) set schema private;

revoke all on function private.create_own_calendar_reminder(
  uuid, text, text, text, date, time without time zone, text, boolean, text,
  text[], text, smallint, text, text, text, date, smallint
) from public, anon, authenticated;

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

  -- Serialize retries for the same owner/request so a request id can never be
  -- reclassified across portals by concurrent calls.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || p_request_id::text, 0)
  );

  select reminder.id, reminder.portal_scope
    into v_existing_id, v_existing_scope
  from public.calendar_reminders as reminder
  where reminder.user_id = v_user_id
    and reminder.request_id = p_request_id;

  if v_existing_id is not null and v_existing_scope is distinct from p_portal_scope then
    raise exception 'request_id portal mismatch' using errcode = '22023';
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

create function public.list_own_calendar_reminders(
  p_portal_scope text,
  p_starts_on_lte date
)
returns table (
  id uuid,
  starts_on date,
  title text,
  description text,
  kind text,
  reminder_time time without time zone,
  lead_time text,
  email_notification boolean,
  recurrence_frequency text,
  weekly_days text[],
  monthly_mode text,
  monthly_day smallint,
  monthly_weekday text,
  monthly_position text,
  end_mode text,
  ends_on date,
  occurrence_count smallint
)
language plpgsql
stable
security definer
set search_path = ''
as $list_scoped_calendar_reminders$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null
    or p_portal_scope is null
    or p_portal_scope not in ('usuario', 'coach')
    or p_starts_on_lte is null
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

  return query
  select
    reminder.id,
    reminder.starts_on,
    reminder.title,
    reminder.description,
    reminder.kind,
    reminder.reminder_time,
    reminder.lead_time,
    reminder.email_notification,
    reminder.recurrence_frequency,
    reminder.weekly_days,
    reminder.monthly_mode,
    reminder.monthly_day,
    reminder.monthly_weekday,
    reminder.monthly_position,
    reminder.end_mode,
    reminder.ends_on,
    reminder.occurrence_count
  from public.calendar_reminders as reminder
  where reminder.user_id = v_user_id
    and reminder.portal_scope = p_portal_scope
    and reminder.starts_on <= p_starts_on_lte
  order by reminder.starts_on, reminder.reminder_time, reminder.id
  limit 500;
end;
$list_scoped_calendar_reminders$;

revoke all on function public.list_own_calendar_reminders(text, date)
  from public, anon, authenticated;
grant execute on function public.list_own_calendar_reminders(text, date)
  to authenticated;

alter table public.calendar_notifications
  add column portal_scope text not null default 'usuario',
  add constraint calendar_notifications_portal_scope_allowed
    check (portal_scope in ('usuario', 'coach'));

update public.calendar_notifications as notification
set portal_scope = reminder.portal_scope
from public.calendar_reminders as reminder
where reminder.id = notification.reminder_id
  and reminder.user_id = notification.user_id;

comment on column public.calendar_notifications.portal_scope is
  'Server-derived portal context inherited from calendar_reminders.';

drop index if exists public.calendar_notifications_owner_created_idx;
create index calendar_notifications_owner_portal_created_idx
  on public.calendar_notifications (user_id, portal_scope, created_at desc, id);

alter table public.calendar_notifications enable row level security;
alter table public.calendar_notifications force row level security;
revoke all privileges on table public.calendar_notifications from public, anon, authenticated;

create function private.assign_calendar_notification_portal_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $assign_calendar_notification_portal_scope$
declare
  v_reminder_user_id uuid;
  v_portal_scope text;
begin
  select reminder.user_id, reminder.portal_scope
    into v_reminder_user_id, v_portal_scope
  from public.calendar_reminders as reminder
  where reminder.id = new.reminder_id;

  if v_reminder_user_id is null
    or v_reminder_user_id is distinct from new.user_id
    or v_portal_scope not in ('usuario', 'coach')
  then
    raise exception 'calendar notification ownership mismatch' using errcode = '42501';
  end if;

  new.portal_scope := v_portal_scope;
  return new;
end;
$assign_calendar_notification_portal_scope$;

revoke all on function private.assign_calendar_notification_portal_scope()
  from public, anon, authenticated;

create trigger calendar_notifications_assign_portal_scope
  before insert on public.calendar_notifications
  for each row execute function private.assign_calendar_notification_portal_scope();

alter function public.list_own_calendar_notifications(integer) set schema private;
revoke all on function private.list_own_calendar_notifications(integer)
  from public, anon, authenticated;

create function public.list_own_calendar_notifications(
  p_portal_scope text,
  p_limit integer default 50
)
returns table (
  id uuid,
  title text,
  body text,
  occurrence_on date,
  reminder_time time without time zone,
  read_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $list_scoped_calendar_notifications$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null
    or p_portal_scope is null
    or p_portal_scope not in ('usuario', 'coach')
    or p_limit not between 1 and 100
  then
    raise exception 'invalid notification request' using errcode = '42501';
  end if;

  if p_portal_scope = 'coach' and not exists (
    select 1
    from public.coach_registrations as registration
    where registration.user_id = v_user_id
  ) then
    raise exception 'coach portal membership required' using errcode = '42501';
  end if;

  return query
  select
    notification.id,
    notification.title,
    notification.body,
    notification.occurrence_on,
    notification.reminder_time,
    notification.read_at,
    notification.created_at
  from public.calendar_notifications as notification
  where notification.user_id = v_user_id
    and notification.portal_scope = p_portal_scope
  order by notification.created_at desc, notification.id desc
  limit p_limit;
end;
$list_scoped_calendar_notifications$;

revoke all on function public.list_own_calendar_notifications(text, integer)
  from public, anon, authenticated;
grant execute on function public.list_own_calendar_notifications(text, integer)
  to authenticated;

alter function public.mark_own_calendar_notifications_read(uuid[]) set schema private;
revoke all on function private.mark_own_calendar_notifications_read(uuid[])
  from public, anon, authenticated;

create function public.mark_own_calendar_notifications_read(
  p_portal_scope text,
  p_notification_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $mark_scoped_calendar_notifications_read$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null
    or p_portal_scope is null
    or p_portal_scope not in ('usuario', 'coach')
    or p_notification_ids is null
    or pg_catalog.cardinality(p_notification_ids) not between 1 and 50
  then
    raise exception 'invalid notification request' using errcode = '42501';
  end if;

  if p_portal_scope = 'coach' and not exists (
    select 1
    from public.coach_registrations as registration
    where registration.user_id = v_user_id
  ) then
    raise exception 'coach portal membership required' using errcode = '42501';
  end if;

  update public.calendar_notifications as notification
  set read_at = pg_catalog.coalesce(notification.read_at, pg_catalog.clock_timestamp())
  where notification.user_id = v_user_id
    and notification.portal_scope = p_portal_scope
    and notification.id = any(p_notification_ids);

  get diagnostics v_count = row_count;
  return v_count;
end;
$mark_scoped_calendar_notifications_read$;

revoke all on function public.mark_own_calendar_notifications_read(text, uuid[])
  from public, anon, authenticated;
grant execute on function public.mark_own_calendar_notifications_read(text, uuid[])
  to authenticated;

commit;
