-- Compatible completed-session history for older cycles; current executions keep their existing reader.
begin;

create or replace function public.get_own_coach_student_cycle_activity(p_episode_id uuid, p_cycle_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
set statement_timeout = '5s' as $fn$
declare v_student uuid; v_result jsonb;
begin
  v_student := private.require_own_coach_student_training_subject(p_episode_id);
  if p_cycle_id is null then raise exception 'invalid cycle' using errcode = '22023'; end if;
  if not exists (select 1 from public.training_cycles c where c.id = p_cycle_id
    and c.user_id = v_student and c.portal_scope = 'usuario' and c.deleted_at is null) then
    raise exception 'cycle not found' using errcode = 'P0002';
  end if;
  -- Older cycles store completed training in training_sessions/exercise_entries.
  -- Use a per-cycle fallback; mixing both sources would count a registered workout twice.
  if not exists (select 1 from public.training_cycle_executions e
    where e.cycle_id = p_cycle_id and e.user_id = v_student and e.portal_scope = 'usuario') then
    with sessions as (
      select s.id, s.completed_at performed_at, s.trained_date performed_on
      from public.training_sessions s
      where s.cycle_id = p_cycle_id and s.user_id = v_student
        and s.deleted_at is null and s.status = 'completed'
    ), entries as (
      select ee.id, ee.exercise_lineage_id, ce.name, ee.reps, ee.weight,
        s.performed_at, s.performed_on
      from public.exercise_entries ee
      join sessions s on s.id = ee.session_id
      join public.training_cycle_exercises ce on ce.id = ee.training_cycle_exercise_id
        and ce.user_id = v_student and ce.cycle_id = p_cycle_id
      where ee.user_id = v_student and ee.exercise_lineage_id = ce.exercise_lineage_id
    ), lineages as (
      select distinct e.exercise_lineage_id from entries e
    ), records as (
      select l.exercise_lineage_id,
        (select e.name from entries e where e.exercise_lineage_id = l.exercise_lineage_id
          order by e.performed_at desc, e.id desc limit 1) name,
        (select pg_catalog.jsonb_build_object('performedOn', e.performed_on,
          'maxKg', e.weight,
          'sets', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'reps', rep, 'kg', e.weight) order by ord), '[]'::jsonb)
            from pg_catalog.unnest(e.reps) with ordinality as actual(rep, ord)))
          from entries e where e.exercise_lineage_id = l.exercise_lineage_id
          order by e.performed_at, e.id limit 1) first_record,
        (select pg_catalog.jsonb_build_object('performedOn', e.performed_on,
          'maxKg', e.weight,
          'sets', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'reps', rep, 'kg', e.weight) order by ord), '[]'::jsonb)
            from pg_catalog.unnest(e.reps) with ordinality as actual(rep, ord)))
          from entries e where e.exercise_lineage_id = l.exercise_lineage_id
          order by e.performed_at desc, e.id desc limit 1) last_record
      from lineages l
    )
    select pg_catalog.jsonb_build_object('cycleId', p_cycle_id,
      'sessionCount', (select count(*) from sessions),
      'lastSessionOn', (select max(performed_on) from sessions),
      'records', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'lineageId', r.exercise_lineage_id, 'name', r.name,
        'first', r.first_record, 'last', r.last_record)) from records r), '[]'::jsonb))
      into v_result;
    return v_result;
  end if;
  with executions as (
    select e.id, e.performed_at, e.performed_on from public.training_cycle_executions e
    where e.cycle_id = p_cycle_id and e.user_id = v_student and e.portal_scope = 'usuario'
  ), lineages as (
    select distinct x.exercise_lineage_id from public.training_cycle_execution_exercises x
    join executions e on e.id = x.execution_id
    where exists (select 1 from public.training_cycle_execution_sets s
      where s.execution_exercise_id = x.id and s.completed)
  ), records as (
    select l.exercise_lineage_id,
      (select x.name_snapshot from public.training_cycle_execution_exercises x
        join executions e on e.id = x.execution_id
        where x.exercise_lineage_id = l.exercise_lineage_id
        order by e.performed_at desc, e.id desc limit 1) name,
      (select pg_catalog.jsonb_build_object('performedOn', e.performed_on,
        'maxKg', (select max(s.actual_kg) from public.training_cycle_execution_sets s
          where s.execution_exercise_id = x.id and s.completed),
        'sets', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'reps', s.actual_reps, 'kg', s.actual_kg) order by s.sort_order), '[]'::jsonb)
          from public.training_cycle_execution_sets s
          where s.execution_exercise_id = x.id and s.completed))
       from public.training_cycle_execution_exercises x join executions e on e.id = x.execution_id
       where x.exercise_lineage_id = l.exercise_lineage_id and exists (
         select 1 from public.training_cycle_execution_sets s
         where s.execution_exercise_id = x.id and s.completed)
       order by e.performed_at, e.id limit 1) first_record,
      (select pg_catalog.jsonb_build_object('performedOn', e.performed_on,
        'maxKg', (select max(s.actual_kg) from public.training_cycle_execution_sets s
          where s.execution_exercise_id = x.id and s.completed),
        'sets', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'reps', s.actual_reps, 'kg', s.actual_kg) order by s.sort_order), '[]'::jsonb)
          from public.training_cycle_execution_sets s
          where s.execution_exercise_id = x.id and s.completed))
       from public.training_cycle_execution_exercises x join executions e on e.id = x.execution_id
       where x.exercise_lineage_id = l.exercise_lineage_id and exists (
         select 1 from public.training_cycle_execution_sets s
         where s.execution_exercise_id = x.id and s.completed)
       order by e.performed_at desc, e.id desc limit 1) last_record
    from lineages l
  )
  select pg_catalog.jsonb_build_object('cycleId', p_cycle_id,
    'sessionCount', (select count(*) from executions),
    'lastSessionOn', (select max(performed_on) from executions),
    'records', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'lineageId', r.exercise_lineage_id, 'name', r.name,
      'first', r.first_record, 'last', r.last_record))
      from records r), '[]'::jsonb)) into v_result;
  return v_result;
end;
$fn$;

create or replace function public.list_own_coach_student_cycle_sessions(
  p_episode_id uuid, p_cycle_id uuid, p_limit integer default 6, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = ''
set statement_timeout = '5s' as $fn$
declare v_student uuid; v_result jsonb;
begin
  v_student := private.require_own_coach_student_training_subject(p_episode_id);
  if p_cycle_id is null or p_limit is null or p_limit not between 1 and 20
    or p_offset is null or p_offset not between 0 and 10000 then
    raise exception 'invalid session page' using errcode = '22023';
  end if;
  if not exists (select 1 from public.training_cycles c where c.id = p_cycle_id
    and c.user_id = v_student and c.portal_scope = 'usuario' and c.deleted_at is null) then
    raise exception 'cycle not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.training_cycle_executions e
    where e.cycle_id = p_cycle_id and e.user_id = v_student and e.portal_scope = 'usuario') then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', s.id, 'performedOn', s.trained_date,
      'dayName', coalesce(r.name, d.day_code, 'Entrenamiento'),
      'exercises', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', ce.name, 'lineageId', ce.exercise_lineage_id,
        'sets', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'reps', actual.rep, 'kg', ee.weight) order by actual.ord), '[]'::jsonb)
          from pg_catalog.unnest(ee.reps) with ordinality as actual(rep, ord)))
        order by ce.sort_order, ee.id), '[]'::jsonb)
        from public.exercise_entries ee
        join public.training_cycle_exercises ce on ce.id = ee.training_cycle_exercise_id
          and ce.user_id = v_student and ce.cycle_id = p_cycle_id
        where ee.session_id = s.id and ee.user_id = v_student
          and ee.exercise_lineage_id = ce.exercise_lineage_id),
      'partial', false) order by s.completed_at desc, s.id desc), '[]'::jsonb)
      into v_result
    from (select * from public.training_sessions s
      where s.cycle_id = p_cycle_id and s.user_id = v_student
        and s.deleted_at is null and s.status = 'completed'
      order by s.completed_at desc, s.id desc limit p_limit offset p_offset) s
    left join public.training_cycle_days d on d.id = s.cycle_day_id
      and d.user_id = v_student and d.cycle_id = p_cycle_id
    left join public.training_cycle_routines r on r.id = d.routine_id
      and r.user_id = v_student and r.cycle_id = p_cycle_id;
    return v_result;
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', e.id, 'performedOn', e.performed_on, 'dayName', d.routine_name,
    'exercises', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'name', x.name_snapshot, 'lineageId', x.exercise_lineage_id,
      'sets', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'reps', s.actual_reps, 'kg', s.actual_kg) order by s.sort_order), '[]'::jsonb)
        from public.training_cycle_execution_sets s
        where s.execution_exercise_id = x.id and s.completed)) order by x.sort_order), '[]'::jsonb)
      from public.training_cycle_execution_exercises x where x.execution_id = e.id),
    'partial', exists (select 1 from public.training_cycle_execution_exercises x
      join public.training_cycle_execution_sets s on s.execution_exercise_id = x.id
      where x.execution_id = e.id and not s.completed))
    order by e.performed_at desc, e.id desc), '[]'::jsonb) into v_result
  from (select * from public.training_cycle_executions e
    where e.cycle_id = p_cycle_id and e.user_id = v_student and e.portal_scope = 'usuario'
    order by e.performed_at desc, e.id desc limit p_limit offset p_offset) e
  join public.training_cycle_plan_days d on d.id = e.plan_day_id
    and d.user_id = v_student and d.cycle_id = p_cycle_id;
  return v_result;
end;
$fn$;

commit;
