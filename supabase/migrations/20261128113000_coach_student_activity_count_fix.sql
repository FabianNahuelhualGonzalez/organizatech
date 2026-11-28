-- A cycle can retain migrated legacy sessions beside current executions.
-- Count only one source, as the historical cycle reader already does.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.read_own_coach_student_activity(p_episode_id uuid)
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
    'sessionsInCycle', case when c.id is null then 0
      when exists (select 1 from public.training_cycle_executions e
        where e.user_id = v_student and e.cycle_id = c.id and e.portal_scope = 'usuario')
      then (select count(*) from public.training_cycle_executions e
        where e.user_id = v_student and e.cycle_id = c.id and e.portal_scope = 'usuario')
      else (select count(*) from public.training_sessions s
        where s.user_id = v_student and s.cycle_id = c.id
          and s.status = 'completed' and s.deleted_at is null) end,
    'isTraining', coalesce((select p.expires_at > pg_catalog.clock_timestamp()
      from private.coach_student_workout_presence p where p.student_user_id = v_student), false)
  ) into v_result
  from (select (select cycle.id from public.training_cycles cycle
    where cycle.user_id = v_student and cycle.portal_scope = 'usuario'
      and cycle.status = 'active' and cycle.deleted_at is null
    order by cycle.created_at desc limit 1) id) c;
  return v_result;
end;
$fn$;
commit;
