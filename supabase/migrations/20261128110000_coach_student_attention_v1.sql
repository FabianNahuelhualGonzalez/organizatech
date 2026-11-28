-- Coach-only attention facts and short-lived, student-owned workout presence.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table private.coach_student_workout_presence (
  student_user_id uuid primary key references auth.users(id) on delete cascade,
  seen_at timestamptz not null,
  expires_at timestamptz not null
);
alter table private.coach_student_workout_presence enable row level security;
alter table private.coach_student_workout_presence force row level security;
revoke all on private.coach_student_workout_presence from public, anon, authenticated;

create function public.pulse_own_coach_workout_presence(p_active boolean)
returns void language plpgsql volatile security definer set search_path = ''
set statement_timeout = '5s' as $fn$
declare v_user uuid := auth.uid(); v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_user is null or p_active is null or not exists (
    select 1 from public.user_registrations r where r.user_id = v_user
  ) then raise exception 'workout presence forbidden' using errcode = '42501'; end if;
  if not p_active then
    delete from private.coach_student_workout_presence p where p.student_user_id = v_user;
    return;
  end if;
  insert into private.coach_student_workout_presence (student_user_id, seen_at, expires_at)
    values (v_user, v_now, v_now + interval '75 seconds')
    on conflict (student_user_id) do update set seen_at = excluded.seen_at,
      expires_at = excluded.expires_at;
end;
$fn$;

create function public.read_own_coach_student_attention(p_limit integer default 40, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = ''
set statement_timeout = '8s' as $fn$
declare v_coach uuid := auth.uid(); v_today date := (pg_catalog.clock_timestamp() at time zone 'America/Santiago')::date;
  v_result jsonb;
begin
  if v_coach is null or not exists (select 1 from public.coach_registrations r where r.user_id = v_coach) then
    raise exception 'coach attention forbidden' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 40 or p_offset is null or p_offset not between 0 and 10000 then
    raise exception 'invalid coach attention page' using errcode = '22023';
  end if;
  with students as (
    select e.id episode_id, e.student_user_id, e.student_name_snapshot student_name,
      e.linked_at, p.ends_before due_on, c.id cycle_id,
      (select max(v.created_at) from public.training_cycle_plan_versions v
       where v.cycle_id = c.id and v.user_id = e.student_user_id and v.portal_scope = 'usuario') updated_at,
      (select max(history.trained_on) from (
        select max(x.performed_on) trained_on from public.training_cycle_executions x
          where x.user_id = e.student_user_id and x.portal_scope = 'usuario'
        union all
        select max(s.trained_date) from public.training_sessions s
          where s.user_id = e.student_user_id and s.status = 'completed' and s.deleted_at is null
      ) history) last_training_on,
      coalesce(presence.expires_at > pg_catalog.clock_timestamp(), false) is_training
    from private.coach_relationship_episodes e
    left join lateral (select cp.ends_before from private.coach_commercial_periods cp
      where cp.episode_id = e.id and cp.coach_user_id = v_coach
      order by cp.starts_on desc, cp.id desc limit 1) p on true
    left join lateral (select cycle.id from public.training_cycles cycle
      where cycle.user_id = e.student_user_id and cycle.portal_scope = 'usuario'
        and cycle.deleted_at is null and cycle.status = 'active'
      order by cycle.created_at desc limit 1) c on true
    left join private.coach_student_workout_presence presence on presence.student_user_id = e.student_user_id
    where e.coach_user_id = v_coach and e.ended_at is null
  ), facts as (
    select s.*,
      pg_catalog.array_remove(array[
        case when s.due_on < v_today then 'Pago vencido'
          when s.due_on = v_today then 'Pago vence hoy'
          when s.due_on > v_today and s.due_on <= v_today + 3 then 'Pago vence pronto' end,
        case when s.cycle_id is null then 'Sin rutina vigente'
          when s.updated_at is not null and v_today > (s.updated_at at time zone 'America/Santiago')::date + interval '1 month'
            then 'Rutina sin actualizar por más de un mes' end,
        case when s.last_training_on is null then 'Aún no registra entrenamientos'
          when s.last_training_on <= v_today - 3 then 'Sin entrenar desde hace 3 días o más' end
      ], null::text) reasons
    from students s
  ), alerted as (select * from facts where pg_catalog.array_length(reasons, 1) > 0),
  page as (select * from alerted order by linked_at desc, episode_id desc limit p_limit offset p_offset)
  select pg_catalog.jsonb_build_object('serverToday', v_today, 'total', (select count(*) from alerted),
    'rows', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'episodeId', episode_id, 'studentName', student_name, 'reasons', reasons,
      'dueOn', due_on, 'lastTrainingOn', last_training_on,
      'routineUpdatedAt', updated_at, 'isTraining', is_training
    ) order by linked_at desc, episode_id desc) from page), '[]'::jsonb)) into v_result;
  return v_result;
end;
$fn$;

create function public.read_own_coach_student_activity(p_episode_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
set statement_timeout = '5s' as $fn$
declare v_student uuid; v_result jsonb;
begin
  v_student := private.require_own_coach_student_training_subject(p_episode_id);
  select pg_catalog.jsonb_build_object(
    'lastTrainingOn', (select max(history.trained_on) from (
      select max(e.performed_on) trained_on from public.training_cycle_executions e
        where e.user_id = v_student and e.portal_scope = 'usuario'
      union all select max(s.trained_date) from public.training_sessions s
        where s.user_id = v_student and s.status = 'completed' and s.deleted_at is null
    ) history),
    'sessionsInCycle', (select count(*) from public.training_cycle_executions e
      where e.user_id = v_student and e.cycle_id = c.id and e.portal_scope = 'usuario')
      + (select count(*) from public.training_sessions s
      where s.user_id = v_student and s.cycle_id = c.id and s.status = 'completed' and s.deleted_at is null),
    'isTraining', coalesce((select p.expires_at > pg_catalog.clock_timestamp()
      from private.coach_student_workout_presence p where p.student_user_id = v_student), false)
  ) into v_result
  from (select cycle.id from public.training_cycles cycle
    where cycle.user_id = v_student and cycle.portal_scope = 'usuario'
      and cycle.status = 'active' and cycle.deleted_at is null
    order by cycle.created_at desc limit 1) c;
  if v_result is null then
    select pg_catalog.jsonb_build_object('lastTrainingOn', (select max(history.trained_on) from (
      select max(e.performed_on) trained_on from public.training_cycle_executions e
        where e.user_id = v_student and e.portal_scope = 'usuario'
      union all select max(s.trained_date) from public.training_sessions s
        where s.user_id = v_student and s.status = 'completed' and s.deleted_at is null
    ) history), 'sessionsInCycle', 0, 'isTraining', coalesce((select p.expires_at > pg_catalog.clock_timestamp()
      from private.coach_student_workout_presence p where p.student_user_id = v_student), false)) into v_result;
  end if;
  return v_result;
end;
$fn$;

revoke all on function public.pulse_own_coach_workout_presence(boolean),
  public.read_own_coach_student_attention(integer,integer),
  public.read_own_coach_student_activity(uuid) from public, anon, authenticated, service_role;
grant execute on function public.pulse_own_coach_workout_presence(boolean),
  public.read_own_coach_student_attention(integer,integer),
  public.read_own_coach_student_activity(uuid) to authenticated;
commit;
