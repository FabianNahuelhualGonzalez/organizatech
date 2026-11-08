-- Horario flexible is available only to the Usuario portal. Existing plans
-- remain fixed; the weekday keys of flexible plans are stable compatibility
-- slots A-G, while executions keep their independent actual Santiago date.
begin;

create or replace function private.validate_training_cycle_plan(
  p_user_id uuid,
  p_portal_scope text,
  p_plan jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_day jsonb;
  v_exercise jsonb;
  v_set jsonb;
  v_drop jsonb;
  v_catalog_id uuid;
  v_custom_id uuid;
  v_source_name text;
  v_video_url text;
  v_day_code text;
  v_technique text;
  v_day_order numeric;
  v_exercise_order numeric;
  v_set_order numeric;
  v_drop_order numeric;
  v_reps numeric;
  v_kg numeric;
  v_total_exercises integer := 0;
  v_total_sets integer := 0;
  v_total_drops integer := 0;
  v_exercise_drops integer;
  v_seen_days text[] := array[]::text[];
  v_seen_day_orders integer[];
  v_seen_exercise_orders integer[];
  v_seen_set_orders integer[];
  v_seen_drop_orders integer[];
  v_expected_slot integer := 0;
begin
  perform private.assert_training_cycle_portal_access(p_user_id, p_portal_scope);

  if p_plan is null
    or pg_catalog.jsonb_typeof(p_plan) is distinct from 'object'
    or pg_catalog.octet_length(p_plan::pg_catalog.text) > 262144
    or not (p_plan ? 'days')
    or p_plan - array['days', 'scheduleMode']::text[] <> '{}'::jsonb
    or (p_plan ? 'scheduleMode' and (
      p_portal_scope <> 'usuario'
      or pg_catalog.jsonb_typeof(p_plan->'scheduleMode') is distinct from 'string'
      or p_plan->>'scheduleMode' <> 'flexible'
    ))
    or pg_catalog.jsonb_typeof(p_plan->'days') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_plan->'days') not between 1 and 7
  then
    raise exception 'invalid training cycle plan' using errcode = '22023';
  end if;

  v_seen_day_orders := array[]::integer[];
  for v_day in
    select value from pg_catalog.jsonb_array_elements(p_plan->'days')
  loop
    if pg_catalog.jsonb_typeof(v_day) is distinct from 'object'
      or not (v_day ?& array['day', 'name', 'order', 'exercises'])
      or v_day - array['day', 'name', 'order', 'exercises']::text[] <> '{}'::jsonb
      or pg_catalog.jsonb_typeof(v_day->'day') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_day->'name') is distinct from 'string'
      or pg_catalog.char_length(pg_catalog.btrim(v_day->>'name')) > 120
      or v_day->>'name' ~ '[[:cntrl:]]'
      or pg_catalog.jsonb_typeof(v_day->'order') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_day->'exercises') is distinct from 'array'
      or pg_catalog.jsonb_array_length(v_day->'exercises') > 50
    then
      raise exception 'invalid training cycle day' using errcode = '22023';
    end if;

    v_day_code := v_day->>'day';
    v_day_order := (v_day->>'order')::pg_catalog.numeric;
    if v_day_code not in (
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
    )
      or v_day_code = any(v_seen_days)
      or v_day_order not between 0 and 6
      or pg_catalog.trunc(v_day_order) <> v_day_order
      or v_day_order::integer = any(v_seen_day_orders)
    then
      raise exception 'invalid or duplicate training cycle day' using errcode = '22023';
    end if;
    -- Weekday codes are compatibility slot keys only in flexible plans. Their
    -- position is canonical and never represents the performed weekday.
    if p_plan ? 'scheduleMode' then
      if v_day_order <> v_expected_slot
        or v_day_code <> (array[
          'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
        ])[v_expected_slot + 1]
      then
        raise exception 'invalid flexible routine slot' using errcode = '22023';
      end if;
      v_expected_slot := v_expected_slot + 1;
    end if;
    v_seen_days := pg_catalog.array_append(v_seen_days, v_day_code);
    v_seen_day_orders := pg_catalog.array_append(v_seen_day_orders, v_day_order::integer);

    v_seen_exercise_orders := array[]::integer[];
    for v_exercise in
      select value from pg_catalog.jsonb_array_elements(v_day->'exercises')
    loop
      v_total_exercises := v_total_exercises + 1;
      if v_total_exercises > 200
        or pg_catalog.jsonb_typeof(v_exercise) is distinct from 'object'
        or not (v_exercise ?& array['order', 'technique', 'sets'])
        or v_exercise - array[
          'catalogExerciseId', 'customExerciseId', 'order', 'technique', 'videoUrl', 'sets'
        ]::text[] <> '{}'::jsonb
        or pg_catalog.jsonb_typeof(v_exercise->'order') is distinct from 'number'
        or pg_catalog.jsonb_typeof(v_exercise->'technique') is distinct from 'string'
        or pg_catalog.jsonb_typeof(v_exercise->'sets') is distinct from 'array'
        or pg_catalog.jsonb_array_length(v_exercise->'sets') not between 1 and 20
      then
        raise exception 'invalid training cycle exercise' using errcode = '22023';
      end if;

      if v_exercise ? 'videoUrl'
        and pg_catalog.jsonb_typeof(v_exercise->'videoUrl') not in ('string', 'null')
      then
        raise exception 'invalid training exercise video' using errcode = '22023';
      end if;

      begin
        v_catalog_id := nullif(v_exercise->>'catalogExerciseId', '')::uuid;
        v_custom_id := nullif(v_exercise->>'customExerciseId', '')::uuid;
      exception when invalid_text_representation then
        raise exception 'invalid training exercise source' using errcode = '22023';
      end;

      if pg_catalog.num_nonnulls(v_catalog_id, v_custom_id) <> 1 then
        raise exception 'exactly one training exercise source is required' using errcode = '22023';
      end if;

      if v_catalog_id is not null then
        select catalog.canonical_name, catalog.default_video_url
          into v_source_name, v_video_url
        from public.training_exercise_catalog as catalog
        where catalog.id = v_catalog_id
          and catalog.is_active;
      else
        select custom.name, custom.video_url
          into v_source_name, v_video_url
        from public.training_custom_exercises as custom
        where custom.id = v_custom_id
          and custom.user_id = p_user_id
          and custom.portal_scope = p_portal_scope
          and custom.archived_at is null;
      end if;

      if v_source_name is null then
        raise exception 'invalid training exercise source' using errcode = '22023';
      end if;

      v_exercise_order := (v_exercise->>'order')::pg_catalog.numeric;
      if v_exercise_order not between 0 and 199
        or pg_catalog.trunc(v_exercise_order) <> v_exercise_order
        or v_exercise_order::integer = any(v_seen_exercise_orders)
      then
        raise exception 'invalid or duplicate training exercise order' using errcode = '22023';
      end if;
      v_seen_exercise_orders := pg_catalog.array_append(
        v_seen_exercise_orders,
        v_exercise_order::integer
      );

      v_technique := v_exercise->>'technique';
      if v_technique not in ('linear', 'ascending', 'descending', 'drop_set', 'failure') then
        raise exception 'invalid training technique' using errcode = '22023';
      end if;

      if v_exercise ? 'videoUrl' then
        v_video_url := v_exercise->>'videoUrl';
      end if;
      if v_video_url is not null and not private.is_valid_training_youtube_url(v_video_url) then
        raise exception 'invalid training exercise video' using errcode = '22023';
      end if;

      v_seen_set_orders := array[]::integer[];
      v_exercise_drops := 0;
      for v_set in
        select value from pg_catalog.jsonb_array_elements(v_exercise->'sets')
      loop
        v_total_sets := v_total_sets + 1;
        if v_total_sets > 2000
          or pg_catalog.jsonb_typeof(v_set) is distinct from 'object'
          or not (v_set ?& array['order', 'targetReps', 'targetKg', 'toFailure', 'drops'])
          or v_set - array['order', 'targetReps', 'targetKg', 'toFailure', 'drops']::text[] <> '{}'::jsonb
          or pg_catalog.jsonb_typeof(v_set->'order') is distinct from 'number'
          or pg_catalog.jsonb_typeof(v_set->'targetReps') is distinct from 'number'
          or pg_catalog.jsonb_typeof(v_set->'targetKg') is distinct from 'number'
          or pg_catalog.jsonb_typeof(v_set->'toFailure') is distinct from 'boolean'
          or pg_catalog.jsonb_typeof(v_set->'drops') is distinct from 'array'
          or pg_catalog.jsonb_array_length(v_set->'drops') > 8
        then
          raise exception 'invalid training set' using errcode = '22023';
        end if;

        v_set_order := (v_set->>'order')::pg_catalog.numeric;
        v_reps := (v_set->>'targetReps')::pg_catalog.numeric;
        v_kg := (v_set->>'targetKg')::pg_catalog.numeric;
        if v_set_order not between 0 and 19
          or pg_catalog.trunc(v_set_order) <> v_set_order
          or v_set_order::integer = any(v_seen_set_orders)
          or v_reps not between 1 and 1000
          or pg_catalog.trunc(v_reps) <> v_reps
          or v_kg not between 0 and 99999.99
          or pg_catalog.scale(v_kg) > 2
        then
          raise exception 'invalid training set values' using errcode = '22023';
        end if;
        v_seen_set_orders := pg_catalog.array_append(v_seen_set_orders, v_set_order::integer);

        if v_technique <> 'drop_set' and pg_catalog.jsonb_array_length(v_set->'drops') <> 0 then
          raise exception 'drops require drop_set technique' using errcode = '22023';
        end if;

        v_seen_drop_orders := array[]::integer[];
        for v_drop in
          select value from pg_catalog.jsonb_array_elements(v_set->'drops')
        loop
          v_total_drops := v_total_drops + 1;
          v_exercise_drops := v_exercise_drops + 1;
          if v_total_drops > 4000
            or pg_catalog.jsonb_typeof(v_drop) is distinct from 'object'
            or not (v_drop ?& array['order', 'kg', 'reps'])
            or v_drop - array['order', 'kg', 'reps']::text[] <> '{}'::jsonb
            or pg_catalog.jsonb_typeof(v_drop->'order') is distinct from 'number'
            or pg_catalog.jsonb_typeof(v_drop->'kg') is distinct from 'number'
            or pg_catalog.jsonb_typeof(v_drop->'reps') is distinct from 'number'
          then
            raise exception 'invalid training drop' using errcode = '22023';
          end if;

          v_drop_order := (v_drop->>'order')::pg_catalog.numeric;
          v_kg := (v_drop->>'kg')::pg_catalog.numeric;
          v_reps := (v_drop->>'reps')::pg_catalog.numeric;
          if v_drop_order not between 0 and 7
            or pg_catalog.trunc(v_drop_order) <> v_drop_order
            or v_drop_order::integer = any(v_seen_drop_orders)
            or v_kg not between 0 and 99999.99
            or pg_catalog.scale(v_kg) > 2
            or v_reps not between 1 and 1000
            or pg_catalog.trunc(v_reps) <> v_reps
          then
            raise exception 'invalid training drop values' using errcode = '22023';
          end if;
          v_seen_drop_orders := pg_catalog.array_append(v_seen_drop_orders, v_drop_order::integer);
        end loop;
      end loop;

      if v_technique = 'drop_set' and v_exercise_drops = 0 then
        raise exception 'drop_set requires at least one drop' using errcode = '22023';
      end if;
    end loop;
  end loop;
end;
$function$;

create or replace function private.training_cycle_plan_snapshot_json(p_version_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'days',
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'snapshotId', day.id,
          'day', day.day_code,
          'name', day.routine_name,
          'order', day.sort_order,
          'legacyCycleDayId', day.legacy_cycle_day_id,
          'exercises', day.exercises
        )
        order by day.sort_order, day.id
      ),
      '[]'::jsonb
    )
  ) || coalesce(
    (
      select pg_catalog.jsonb_build_object('scheduleMode', version.plan_payload->'scheduleMode')
      from public.training_cycle_plan_versions as version
      where version.id = p_version_id
        and version.plan_payload ? 'scheduleMode'
    ),
    '{}'::jsonb
  )
  from (
    select
      plan_day.*,
      coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'snapshotId', exercise.id,
              'catalogExerciseId', exercise.catalog_exercise_id,
              'customExerciseId', exercise.custom_exercise_id,
              'exerciseLineageId', exercise.exercise_lineage_id,
              'name', exercise.name_snapshot,
              'muscleGroup', exercise.muscle_group_snapshot,
              'order', exercise.sort_order,
              'technique', exercise.technique,
              'videoUrl', exercise.video_url_snapshot,
              'legacyCycleExerciseId', exercise.legacy_cycle_exercise_id,
              'sets', coalesce(
                (
                  select pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                      'snapshotId', set_row.id,
                      'order', set_row.sort_order,
                      'targetReps', set_row.target_reps,
                      'targetKg', set_row.target_kg,
                      'toFailure', set_row.to_failure,
                      'drops', coalesce(
                        (
                          select pg_catalog.jsonb_agg(
                            pg_catalog.jsonb_build_object(
                              'snapshotId', drop_row.id,
                              'order', drop_row.sort_order,
                              'kg', drop_row.kg,
                              'reps', drop_row.reps
                            )
                            order by drop_row.sort_order, drop_row.id
                          )
                          from public.training_cycle_plan_drops as drop_row
                          where drop_row.version_id = p_version_id
                            and drop_row.exercise_id = exercise.id
                            and drop_row.set_id = set_row.id
                        ),
                        '[]'::jsonb
                      )
                    )
                    order by set_row.sort_order, set_row.id
                  )
                  from public.training_cycle_plan_sets as set_row
                  where set_row.version_id = p_version_id
                    and set_row.exercise_id = exercise.id
                ),
                '[]'::jsonb
              )
            )
            order by exercise.sort_order, exercise.id
          )
          from public.training_cycle_plan_exercises as exercise
          where exercise.version_id = p_version_id
            and exercise.day_id = plan_day.id
        ),
        '[]'::jsonb
      ) as exercises
    from public.training_cycle_plan_days as plan_day
    where plan_day.version_id = p_version_id
  ) as day
$function$;

-- Preserve the fixed-day uniqueness guard, while allowing repeated complete
-- sessions of the same flexible routine on one calendar date. Existing rows
-- remain fixed; only this owner-checked RPC sets the flexible flag.
alter table public.training_sessions
  add column is_flexible_schedule boolean not null default false;

drop index if exists public.training_sessions_user_cycle_day_trained_unique_idx;
create unique index training_sessions_user_cycle_day_trained_unique_idx
  on public.training_sessions(user_id, cycle_day_id, trained_date)
  where cycle_day_id is not null
    and deleted_at is null
    and not is_flexible_schedule;

create or replace function public.create_training_session_with_cycle_entries(
  p_cycle_id uuid,
  p_cycle_day_id uuid,
  p_planned_day text,
  p_planned_date date,
  p_trained_date date,
  p_status text,
  p_week_number integer,
  p_notes text,
  p_entries jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_entry jsonb;
  v_cycle_exercise_id uuid;
  v_legacy_exercise_id uuid;
  v_entry_lineage_id uuid;
  v_plan_lineage_id uuid;
  v_reps jsonb;
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
  v_flexible_schedule boolean := false;
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_cycle_id is null then
    raise exception 'El ciclo es obligatorio';
  end if;

  if p_cycle_day_id is null then
    raise exception 'El dia del ciclo es obligatorio';
  end if;

  if p_trained_date is null then
    raise exception 'La fecha real de entrenamiento es obligatoria';
  end if;

  if p_status not in ('completed', 'skipped') then
    raise exception 'Estado de entrenamiento invalido';
  end if;

  if p_planned_day is not null and p_planned_day not in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday') then
    raise exception 'Dia planificado invalido';
  end if;

  perform private.assert_training_session_entries_resource_bounds(
    v_entries,
    'cycle',
    p_status,
    p_notes
  );

  if jsonb_typeof(v_entries) <> 'array' then
    raise exception 'La lista de ejercicios debe ser un arreglo JSON';
  end if;

  if p_status = 'completed' and jsonb_array_length(v_entries) = 0 then
    raise exception 'Un entrenamiento completado requiere ejercicios';
  end if;

  select coalesce(c.plan_snapshot #>> '{plan,scheduleMode}' = 'flexible', false)
  into v_flexible_schedule
  from public.training_cycles c
  where c.id = p_cycle_id
    and c.user_id = v_user_id
    and c.status = 'active'
    and c.deleted_at is null;

  if not found then
    raise exception 'El ciclo no existe, no esta activo o no pertenece al usuario';
  end if;

  if not exists (
    select 1
    from public.training_cycle_days d
    where d.id = p_cycle_day_id
      and d.cycle_id = p_cycle_id
      and d.user_id = v_user_id
      and d.deleted_at is null
      and (p_planned_day is null or d.day_code = p_planned_day)
  ) then
    raise exception 'El dia no pertenece al ciclo del usuario o no corresponde al dia planificado';
  end if;

  if not v_flexible_schedule and exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.cycle_day_id = p_cycle_day_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para este dia y fecha';
  end if;

  begin
    insert into public.training_sessions (
      user_id,
      cycle_id,
      cycle_day_id,
      is_flexible_schedule,
      week_number,
      trained_at,
      calendar_week_start,
      planned_day,
      planned_date,
      trained_date,
      status,
      completed_at,
      notes
    )
    values (
      v_user_id,
      p_cycle_id,
      p_cycle_day_id,
      v_flexible_schedule,
      coalesce(p_week_number, 1),
      p_trained_date,
      p_trained_date - (extract(isodow from p_trained_date)::integer - 1),
      p_planned_day,
      p_planned_date,
      p_trained_date,
      p_status,
      case when p_status = 'completed' then now() else null end,
      p_notes
    )
    returning id into v_session_id;
  exception
    when unique_violation then
      raise exception 'Ya existe un entrenamiento registrado para este dia y fecha';
  end;

  if p_status = 'completed' then
    for v_entry in select * from jsonb_array_elements(v_entries)
    loop
      if nullif(v_entry->>'training_cycle_exercise_id', '') is null then
        raise exception 'Cada entry requiere training_cycle_exercise_id';
      end if;

      v_cycle_exercise_id := (v_entry->>'training_cycle_exercise_id')::uuid;
      v_legacy_exercise_id := nullif(v_entry->>'exercise_id', '')::uuid;
      v_entry_lineage_id := nullif(v_entry->>'exercise_lineage_id', '')::uuid;

      if v_legacy_exercise_id is not null and not exists (
        select 1
        from public.exercises e
        where e.id = v_legacy_exercise_id
          and e.user_id = v_user_id
      ) then
        raise exception 'El ejercicio legacy no pertenece al usuario';
      end if;

      select tce.exercise_lineage_id
      into v_plan_lineage_id
      from public.training_cycle_exercises tce
      where tce.id = v_cycle_exercise_id
        and tce.user_id = v_user_id
        and tce.cycle_id = p_cycle_id
        and tce.day_id = p_cycle_day_id
        and tce.deleted_at is null
        and (
          v_legacy_exercise_id is null
          or tce.source_legacy_exercise_id = v_legacy_exercise_id
        );

      if v_plan_lineage_id is null then
        raise exception 'El ejercicio planificado no pertenece al ciclo/dia del usuario o no tiene identidad historica';
      end if;

      if v_entry_lineage_id is not null and v_entry_lineage_id <> v_plan_lineage_id then
        raise exception 'La identidad historica informada no coincide con el ejercicio planificado';
      end if;

      v_reps := v_entry->'reps';
      if v_reps is null or jsonb_typeof(v_reps) <> 'array' or jsonb_array_length(v_reps) = 0 then
        raise exception 'Cada entry requiere reps como arreglo no vacio';
      end if;

      if exists (
        select 1
        from jsonb_array_elements_text(v_reps) as reps(rep_value)
        where rep_value is null
      ) then
        raise exception 'reps debe contener enteros validos';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'reps debe contener enteros validos';
      end;

      insert into public.exercise_entries (
        id,
        user_id,
        session_id,
        exercise_id,
        training_cycle_exercise_id,
        exercise_lineage_id,
        weight,
        previous_weight,
        reps,
        rir,
        notes,
        observation
      )
      values (
        coalesce(nullif(v_entry->>'id', '')::uuid, gen_random_uuid()),
        v_user_id,
        v_session_id,
        v_legacy_exercise_id,
        v_cycle_exercise_id,
        v_plan_lineage_id,
        coalesce((v_entry->>'weight')::numeric, 0),
        coalesce((v_entry->>'previous_weight')::numeric, 0),
        array(select rep_value::integer from jsonb_array_elements_text(v_reps) as reps(rep_value)),
        nullif(v_entry->>'rir', ''),
        nullif(v_entry->>'notes', ''),
        nullif(btrim(v_entry->>'observation'), '')
      );
    end loop;
  end if;

  return v_session_id;
end;
$function$;


revoke all on function public.create_training_session_with_cycle_entries(
  uuid, uuid, text, date, date, text, integer, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_training_session_with_cycle_entries(
  uuid, uuid, text, date, date, text, integer, text, jsonb
) to authenticated;

revoke all on function private.validate_training_cycle_plan(uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.training_cycle_plan_snapshot_json(uuid) from public, anon, authenticated, service_role;

commit;
