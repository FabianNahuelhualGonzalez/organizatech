-- El entrenamiento puede realizarse antes del inicio planificado.
-- La fecha final vigente del snapshot continúa siendo el límite autoritativo.
create or replace function public.record_own_training_cycle_execution(
  p_request_id uuid,
  p_portal_scope text,
  p_cycle_id uuid,
  p_expected_version integer,
  p_performed_at timestamptz,
  p_execution jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '2s'
set statement_timeout = '8s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_performed_on date;
  v_week_started_on date;
  v_payload jsonb;
  v_receipt_execution_id uuid;
  v_receipt_version integer;
  v_cycle public.training_cycles;
  v_plan_version public.training_cycle_plan_versions;
  v_plan_day public.training_cycle_plan_days;
  v_execution_id uuid;
  v_execution_exercise_id uuid;
  v_execution_set_id uuid;
  v_exercise jsonb;
  v_set jsonb;
  v_drop jsonb;
  v_plan_exercise public.training_cycle_plan_exercises;
  v_plan_set public.training_cycle_plan_sets;
  v_plan_drop public.training_cycle_plan_drops;
  v_completed boolean;
  v_drop_completed boolean;
  v_reached_failure boolean;
  v_actual_reps numeric;
  v_actual_kg numeric;
  v_plan_day_id uuid;
  v_plan_exercise_id uuid;
  v_plan_set_id uuid;
  v_plan_drop_id uuid;
  v_order numeric;
  v_seen_exercise_ids uuid[] := array[]::uuid[];
  v_seen_set_ids uuid[];
  v_seen_drop_ids uuid[];
  v_total_sets integer := 0;
  v_total_drops integer := 0;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  perform private.lock_training_cycle_portal(v_user_id, p_portal_scope);

  if p_request_id is null
    or p_cycle_id is null
    or p_expected_version is null
    or p_expected_version not between 1 and 256
    or p_performed_at is null
    or p_execution is null
    or pg_catalog.jsonb_typeof(p_execution) is distinct from 'object'
    or pg_catalog.octet_length(p_execution::pg_catalog.text) > 262144
    or not (p_execution ?& array['dayId', 'exercises'])
    or p_execution - array['dayId', 'exercises']::text[] <> '{}'::jsonb
    or pg_catalog.jsonb_typeof(p_execution->'dayId') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_execution->'exercises') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_execution->'exercises') not between 1 and 200
  then
    raise exception 'invalid training cycle execution request' using errcode = '22023';
  end if;

  begin
    v_plan_day_id := (p_execution->>'dayId')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'invalid training cycle execution day' using errcode = '22023';
  end;

  v_payload := pg_catalog.jsonb_build_object(
    'portalScope', p_portal_scope,
    'cycleId', p_cycle_id,
    'expectedVersion', p_expected_version,
    'performedAt', p_performed_at,
    'execution', p_execution
  );

  select receipt.aggregate_id, receipt.result_version
    into v_receipt_execution_id, v_receipt_version
  from private.find_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'cycle_execution_record',
    v_payload
  ) as receipt;

  if v_receipt_execution_id is not null then
    return private.training_cycle_operation_result(
      p_request_id,
      'cycle_execution_record',
      v_receipt_execution_id,
      v_receipt_version
    );
  end if;

  if p_performed_at > v_now + interval '5 minutes'
    or p_performed_at < v_now - interval '730 days'
  then
    raise exception 'invalid training cycle execution timestamp' using errcode = '22023';
  end if;

  perform private.materialize_own_training_cycle_lifecycle(
    v_user_id,
    p_portal_scope,
    v_now
  );

  select cycle.*
    into v_cycle
  from public.training_cycles as cycle
  where cycle.id = p_cycle_id
    and cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status = 'active'
    and cycle.deleted_at is null
    and cycle.current_plan_version_id is not null
  for update;

  if v_cycle.id is null
    or v_cycle.current_plan_version is distinct from p_expected_version
  then
    raise exception 'training cycle execution version conflict' using errcode = '40001';
  end if;

  select version.*
    into v_plan_version
  from public.training_cycle_plan_versions as version
  where version.id = v_cycle.current_plan_version_id
    and version.cycle_id = v_cycle.id
    and version.user_id = v_user_id
    and version.portal_scope = p_portal_scope
    and version.version = p_expected_version;

  v_performed_on := pg_catalog.timezone(
    'America/Santiago',
    p_performed_at
  )::date;
  v_week_started_on := v_performed_on
    - (extract(isodow from v_performed_on)::integer - 1);

  if v_plan_version.id is null
    or v_performed_on > v_plan_version.end_date
  then
    raise exception 'training cycle execution is after the active snapshot end date'
      using errcode = '22023';
  end if;

  select plan_day.*
    into v_plan_day
  from public.training_cycle_plan_days as plan_day
  where plan_day.id = v_plan_day_id
    and plan_day.version_id = v_plan_version.id
    and plan_day.cycle_id = v_cycle.id
    and plan_day.user_id = v_user_id;

  if v_plan_day.id is null
    or pg_catalog.jsonb_array_length(p_execution->'exercises') <> (
      select pg_catalog.count(*)::integer
      from public.training_cycle_plan_exercises as plan_exercise
      where plan_exercise.version_id = v_plan_version.id
        and plan_exercise.day_id = v_plan_day.id
        and plan_exercise.user_id = v_user_id
        and plan_exercise.portal_scope = p_portal_scope
    )
  then
    raise exception 'training cycle execution day snapshot mismatch'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.training_cycle_executions as execution
    where execution.user_id = v_user_id
      and execution.portal_scope = p_portal_scope
    order by execution.created_at, execution.id
    offset 4095
    limit 1
  ) then
    raise exception using errcode = '54000',
      message = 'training cycle execution limit reached';
  end if;

  insert into public.training_cycle_executions (
    user_id,
    portal_scope,
    cycle_id,
    plan_version_id,
    plan_version,
    plan_day_id,
    request_id,
    performed_at,
    performed_on,
    week_started_on
  )
  values (
    v_user_id,
    p_portal_scope,
    v_cycle.id,
    v_plan_version.id,
    v_plan_version.version,
    v_plan_day.id,
    p_request_id,
    p_performed_at,
    v_performed_on,
    v_week_started_on
  )
  returning id into v_execution_id;

  for v_exercise in
    select value
    from pg_catalog.jsonb_array_elements(p_execution->'exercises')
  loop
    if pg_catalog.jsonb_typeof(v_exercise) is distinct from 'object'
      or not (v_exercise ?& array['planExerciseId', 'order', 'sets'])
      or v_exercise - array['planExerciseId', 'order', 'sets']::text[] <> '{}'::jsonb
      or pg_catalog.jsonb_typeof(v_exercise->'planExerciseId') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_exercise->'order') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_exercise->'sets') is distinct from 'array'
      or pg_catalog.jsonb_array_length(v_exercise->'sets') not between 1 and 20
    then
      raise exception 'invalid training cycle execution exercise' using errcode = '22023';
    end if;

    begin
      v_plan_exercise_id := (v_exercise->>'planExerciseId')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'invalid training cycle execution exercise id' using errcode = '22023';
    end;
    v_order := (v_exercise->>'order')::pg_catalog.numeric;

    if v_plan_exercise_id = any(v_seen_exercise_ids)
      or v_order not between 0 and 199
      or pg_catalog.trunc(v_order) <> v_order
    then
      raise exception 'duplicate or invalid training cycle execution exercise'
        using errcode = '22023';
    end if;
    v_seen_exercise_ids := pg_catalog.array_append(
      v_seen_exercise_ids,
      v_plan_exercise_id
    );

    select plan_exercise.*
      into v_plan_exercise
    from public.training_cycle_plan_exercises as plan_exercise
    where plan_exercise.id = v_plan_exercise_id
      and plan_exercise.version_id = v_plan_version.id
      and plan_exercise.day_id = v_plan_day.id
      and plan_exercise.cycle_id = v_cycle.id
      and plan_exercise.user_id = v_user_id
      and plan_exercise.portal_scope = p_portal_scope;

    if v_plan_exercise.id is null
      or v_plan_exercise.sort_order is distinct from v_order::smallint
      or pg_catalog.jsonb_array_length(v_exercise->'sets') <> (
        select pg_catalog.count(*)::integer
        from public.training_cycle_plan_sets as plan_set
        where plan_set.version_id = v_plan_version.id
          and plan_set.exercise_id = v_plan_exercise.id
          and plan_set.user_id = v_user_id
      )
    then
      raise exception 'training cycle execution exercise snapshot mismatch'
        using errcode = '22023';
    end if;

    insert into public.training_cycle_execution_exercises (
      execution_id,
      plan_exercise_id,
      plan_version_id,
      cycle_id,
      user_id,
      portal_scope,
      exercise_lineage_id,
      name_snapshot,
      muscle_group_snapshot,
      technique_snapshot,
      sort_order
    )
    values (
      v_execution_id,
      v_plan_exercise.id,
      v_plan_version.id,
      v_cycle.id,
      v_user_id,
      p_portal_scope,
      v_plan_exercise.exercise_lineage_id,
      v_plan_exercise.name_snapshot,
      v_plan_exercise.muscle_group_snapshot,
      v_plan_exercise.technique,
      v_plan_exercise.sort_order
    )
    returning id into v_execution_exercise_id;

    v_seen_set_ids := array[]::uuid[];
    for v_set in
      select value
      from pg_catalog.jsonb_array_elements(v_exercise->'sets')
    loop
      v_total_sets := v_total_sets + 1;
      if v_total_sets > 2000
        or pg_catalog.jsonb_typeof(v_set) is distinct from 'object'
        or not (v_set ?& array[
          'planSetId', 'order', 'completed', 'reps', 'kg',
          'reachedFailure', 'drops'
        ])
        or v_set - array[
          'planSetId', 'order', 'completed', 'reps', 'kg',
          'reachedFailure', 'drops'
        ]::text[] <> '{}'::jsonb
        or pg_catalog.jsonb_typeof(v_set->'planSetId') is distinct from 'string'
        or pg_catalog.jsonb_typeof(v_set->'order') is distinct from 'number'
        or pg_catalog.jsonb_typeof(v_set->'completed') is distinct from 'boolean'
        or pg_catalog.jsonb_typeof(v_set->'reachedFailure') is distinct from 'boolean'
        or pg_catalog.jsonb_typeof(v_set->'drops') is distinct from 'array'
        or pg_catalog.jsonb_array_length(v_set->'drops') > 8
      then
        raise exception 'invalid training cycle execution set' using errcode = '22023';
      end if;

      begin
        v_plan_set_id := (v_set->>'planSetId')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'invalid training cycle execution set id' using errcode = '22023';
      end;
      v_order := (v_set->>'order')::pg_catalog.numeric;
      v_completed := (v_set->>'completed')::boolean;
      v_reached_failure := (v_set->>'reachedFailure')::boolean;

      if v_plan_set_id = any(v_seen_set_ids)
        or v_order not between 0 and 19
        or pg_catalog.trunc(v_order) <> v_order
      then
        raise exception 'duplicate or invalid training cycle execution set'
          using errcode = '22023';
      end if;
      v_seen_set_ids := pg_catalog.array_append(v_seen_set_ids, v_plan_set_id);

      if v_completed then
        if pg_catalog.jsonb_typeof(v_set->'reps') is distinct from 'number'
          or pg_catalog.jsonb_typeof(v_set->'kg') is distinct from 'number'
        then
          raise exception 'completed execution set requires results' using errcode = '22023';
        end if;
        v_actual_reps := (v_set->>'reps')::pg_catalog.numeric;
        v_actual_kg := (v_set->>'kg')::pg_catalog.numeric;
        if v_actual_reps not between 1 and 1000
          or pg_catalog.trunc(v_actual_reps) <> v_actual_reps
          or v_actual_kg not between 0 and 99999.99
          or pg_catalog.scale(v_actual_kg) > 2
        then
          raise exception 'invalid training cycle execution set results'
            using errcode = '22023';
        end if;
      else
        if pg_catalog.jsonb_typeof(v_set->'reps') is distinct from 'null'
          or pg_catalog.jsonb_typeof(v_set->'kg') is distinct from 'null'
          or v_reached_failure
        then
          raise exception 'skipped execution set cannot contain results'
            using errcode = '22023';
        end if;
        v_actual_reps := null;
        v_actual_kg := null;
      end if;

      select plan_set.*
        into v_plan_set
      from public.training_cycle_plan_sets as plan_set
      where plan_set.id = v_plan_set_id
        and plan_set.version_id = v_plan_version.id
        and plan_set.exercise_id = v_plan_exercise.id
        and plan_set.user_id = v_user_id;

      if v_plan_set.id is null
        or v_plan_set.sort_order is distinct from v_order::smallint
        or pg_catalog.jsonb_array_length(v_set->'drops') <> (
          select pg_catalog.count(*)::integer
          from public.training_cycle_plan_drops as plan_drop
          where plan_drop.version_id = v_plan_version.id
            and plan_drop.exercise_id = v_plan_exercise.id
            and plan_drop.set_id = v_plan_set.id
            and plan_drop.user_id = v_user_id
        )
      then
        raise exception 'training cycle execution set snapshot mismatch'
          using errcode = '22023';
      end if;

      insert into public.training_cycle_execution_sets (
        execution_exercise_id,
        execution_id,
        plan_exercise_id,
        plan_set_id,
        plan_version_id,
        user_id,
        sort_order,
        completed,
        actual_reps,
        actual_kg,
        reached_failure,
        target_reps_snapshot,
        target_kg_snapshot,
        planned_to_failure_snapshot
      )
      values (
        v_execution_exercise_id,
        v_execution_id,
        v_plan_exercise.id,
        v_plan_set.id,
        v_plan_version.id,
        v_user_id,
        v_plan_set.sort_order,
        v_completed,
        v_actual_reps::smallint,
        v_actual_kg::numeric(8,2),
        v_reached_failure,
        v_plan_set.target_reps,
        v_plan_set.target_kg,
        v_plan_set.to_failure
      )
      returning id into v_execution_set_id;

      v_seen_drop_ids := array[]::uuid[];
      for v_drop in
        select value
        from pg_catalog.jsonb_array_elements(v_set->'drops')
      loop
        v_total_drops := v_total_drops + 1;
        if v_total_drops > 4000
          or pg_catalog.jsonb_typeof(v_drop) is distinct from 'object'
          or not (v_drop ?& array[
            'planDropId', 'order', 'completed', 'reps', 'kg'
          ])
          or v_drop - array[
            'planDropId', 'order', 'completed', 'reps', 'kg'
          ]::text[] <> '{}'::jsonb
          or pg_catalog.jsonb_typeof(v_drop->'planDropId') is distinct from 'string'
          or pg_catalog.jsonb_typeof(v_drop->'order') is distinct from 'number'
          or pg_catalog.jsonb_typeof(v_drop->'completed') is distinct from 'boolean'
        then
          raise exception 'invalid training cycle execution drop' using errcode = '22023';
        end if;

        begin
          v_plan_drop_id := (v_drop->>'planDropId')::uuid;
        exception
          when invalid_text_representation then
            raise exception 'invalid training cycle execution drop id' using errcode = '22023';
        end;
        v_order := (v_drop->>'order')::pg_catalog.numeric;
        v_drop_completed := (v_drop->>'completed')::boolean;

        if v_plan_drop_id = any(v_seen_drop_ids)
          or v_order not between 0 and 7
          or pg_catalog.trunc(v_order) <> v_order
          or (not v_completed and v_drop_completed)
        then
          raise exception 'duplicate or invalid training cycle execution drop'
            using errcode = '22023';
        end if;
        v_seen_drop_ids := pg_catalog.array_append(v_seen_drop_ids, v_plan_drop_id);

        if v_drop_completed then
          if pg_catalog.jsonb_typeof(v_drop->'reps') is distinct from 'number'
            or pg_catalog.jsonb_typeof(v_drop->'kg') is distinct from 'number'
          then
            raise exception 'completed execution drop requires results'
              using errcode = '22023';
          end if;
          v_actual_reps := (v_drop->>'reps')::pg_catalog.numeric;
          v_actual_kg := (v_drop->>'kg')::pg_catalog.numeric;
          if v_actual_reps not between 1 and 1000
            or pg_catalog.trunc(v_actual_reps) <> v_actual_reps
            or v_actual_kg not between 0 and 99999.99
            or pg_catalog.scale(v_actual_kg) > 2
          then
            raise exception 'invalid training cycle execution drop results'
              using errcode = '22023';
          end if;
        else
          if pg_catalog.jsonb_typeof(v_drop->'reps') is distinct from 'null'
            or pg_catalog.jsonb_typeof(v_drop->'kg') is distinct from 'null'
          then
            raise exception 'skipped execution drop cannot contain results'
              using errcode = '22023';
          end if;
          v_actual_reps := null;
          v_actual_kg := null;
        end if;

        select plan_drop.*
          into v_plan_drop
        from public.training_cycle_plan_drops as plan_drop
        where plan_drop.id = v_plan_drop_id
          and plan_drop.version_id = v_plan_version.id
          and plan_drop.exercise_id = v_plan_exercise.id
          and plan_drop.set_id = v_plan_set.id
          and plan_drop.user_id = v_user_id;

        if v_plan_drop.id is null
          or v_plan_drop.sort_order is distinct from v_order::smallint
        then
          raise exception 'training cycle execution drop snapshot mismatch'
            using errcode = '22023';
        end if;

        insert into public.training_cycle_execution_drops (
          execution_set_id,
          execution_exercise_id,
          execution_id,
          plan_exercise_id,
          plan_set_id,
          plan_drop_id,
          plan_version_id,
          user_id,
          sort_order,
          completed,
          actual_reps,
          actual_kg,
          target_reps_snapshot,
          target_kg_snapshot
        )
        values (
          v_execution_set_id,
          v_execution_exercise_id,
          v_execution_id,
          v_plan_exercise.id,
          v_plan_set.id,
          v_plan_drop.id,
          v_plan_version.id,
          v_user_id,
          v_plan_drop.sort_order,
          v_drop_completed,
          v_actual_reps::smallint,
          v_actual_kg::numeric(8,2),
          v_plan_drop.reps,
          v_plan_drop.kg
        );
      end loop;
    end loop;
  end loop;

  perform private.record_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'cycle_execution_record',
    v_payload,
    v_execution_id,
    v_plan_version.version
  );

  return private.training_cycle_operation_result(
    p_request_id,
    'cycle_execution_record',
    v_execution_id,
    v_plan_version.version
  );
end;
$function$;

revoke all on function public.record_own_training_cycle_execution(
  uuid, text, uuid, integer, timestamptz, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.record_own_training_cycle_execution(
  uuid, text, uuid, integer, timestamptz, jsonb
) to authenticated;
