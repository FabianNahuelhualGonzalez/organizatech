-- SEC-TRAIN-01: bound authenticated training payloads before they can fan out
-- into loops and inserts. Normal product usage remains unchanged through the
-- inclusive limit of 20 exercises per day/session.

begin;

create or replace function private.assert_training_session_entries_resource_bounds(
  p_entries jsonb,
  p_entry_kind text,
  p_status text,
  p_session_notes text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_entry jsonb;
  v_reps jsonb;
  v_rep jsonb;
  v_identity_id uuid;
  v_seen_identity_ids uuid[] := array[]::uuid[];
  v_numeric_value numeric;
begin
  if p_entries is null
    or pg_catalog.jsonb_typeof(p_entries) is distinct from 'array'
  then
    raise exception using errcode = '22023', message = 'La lista de ejercicios debe ser un arreglo JSON';
  end if;

  if pg_catalog.octet_length(p_entries::pg_catalog.text) > 524288 then
    raise exception using errcode = '54000', message = 'La sesion excede el tamano permitido';
  end if;

  if pg_catalog.jsonb_array_length(p_entries) > 20 then
    raise exception using errcode = '54000', message = 'La sesion admite hasta 20 ejercicios';
  end if;

  if pg_catalog.octet_length(coalesce(p_session_notes, '')) > 4096 then
    raise exception using errcode = '54000', message = 'Las notas de la sesion exceden el tamano permitido';
  end if;

  if p_entry_kind not in ('legacy', 'cycle') then
    raise exception using errcode = '22023', message = 'Tipo de entry de entrenamiento invalido';
  end if;

  if p_status = 'skipped' and pg_catalog.jsonb_array_length(p_entries) <> 0 then
    raise exception using errcode = '22023', message = 'Un entrenamiento omitido no admite ejercicios';
  end if;

  for v_entry in
    select entry.value
    from pg_catalog.jsonb_array_elements(p_entries) as entry(value)
  loop
    if pg_catalog.jsonb_typeof(v_entry) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'Cada ejercicio debe ser un objeto JSON';
    end if;

    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_entry) as entry_key(key)
      where not (
        entry_key.key = any(
          case p_entry_kind
            when 'legacy' then array[
              'id', 'exercise_id', 'weight', 'previous_weight', 'reps',
              'rir', 'notes', 'observation'
            ]::pg_catalog.text[]
            else array[
              'id', 'training_cycle_exercise_id', 'exercise_id',
              'exercise_lineage_id', 'weight', 'previous_weight', 'reps',
              'rir', 'notes', 'observation'
            ]::pg_catalog.text[]
          end
        )
      )
    ) then
      raise exception using errcode = '22023', message = 'El ejercicio contiene campos no permitidos';
    end if;

    begin
      v_identity_id := case p_entry_kind
        when 'legacy' then nullif(v_entry->>'exercise_id', '')::pg_catalog.uuid
        else nullif(v_entry->>'training_cycle_exercise_id', '')::pg_catalog.uuid
      end;
    exception
      when invalid_text_representation then
        raise exception using errcode = '22023', message = 'El identificador del ejercicio es invalido';
    end;

    if v_identity_id is null then
      raise exception using errcode = '22023', message = 'Cada entry requiere un identificador de ejercicio';
    end if;

    if v_identity_id = any(v_seen_identity_ids) then
      raise exception using errcode = '22023', message = 'El entrenamiento contiene ejercicios duplicados';
    end if;
    v_seen_identity_ids := pg_catalog.array_append(v_seen_identity_ids, v_identity_id);

    v_reps := v_entry->'reps';
    if v_reps is null
      or pg_catalog.jsonb_typeof(v_reps) is distinct from 'array'
      or pg_catalog.jsonb_array_length(v_reps) = 0
    then
      raise exception using errcode = '22023', message = 'Cada ejercicio requiere reps como arreglo no vacio';
    end if;

    if pg_catalog.jsonb_array_length(v_reps) > 64 then
      raise exception using errcode = '54000', message = 'Cada ejercicio admite hasta 64 series';
    end if;

    for v_rep in
      select rep.value
      from pg_catalog.jsonb_array_elements(v_reps) as rep(value)
    loop
      if pg_catalog.jsonb_typeof(v_rep) not in ('number', 'string') then
        raise exception using errcode = '22023', message = 'reps debe contener enteros validos';
      end if;

      begin
        v_numeric_value := (v_rep #>> '{}')::pg_catalog.numeric;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception using errcode = '22023', message = 'reps debe contener enteros validos';
      end;

      if pg_catalog.trunc(v_numeric_value) <> v_numeric_value
        or v_numeric_value not between 0 and 10000
      then
        raise exception using errcode = '22023', message = 'reps debe contener enteros entre 0 y 10000';
      end if;
    end loop;

    if pg_catalog.octet_length(coalesce(v_entry->>'rir', '')) > 128
      or pg_catalog.octet_length(coalesce(v_entry->>'notes', '')) > 4096
      or pg_catalog.octet_length(coalesce(v_entry->>'observation', '')) > 4096
    then
      raise exception using errcode = '54000', message = 'El detalle del ejercicio excede el tamano permitido';
    end if;

    if v_entry ? 'weight' and pg_catalog.jsonb_typeof(v_entry->'weight') not in ('number', 'string', 'null') then
      raise exception using errcode = '22023', message = 'El peso del ejercicio es invalido';
    end if;

    if v_entry ? 'previous_weight' and pg_catalog.jsonb_typeof(v_entry->'previous_weight') not in ('number', 'string', 'null') then
      raise exception using errcode = '22023', message = 'El peso anterior del ejercicio es invalido';
    end if;

    begin
      v_numeric_value := coalesce(nullif(v_entry->>'weight', '')::pg_catalog.numeric, 0);
      if v_numeric_value not between 0 and 99999.99 then
        raise exception using errcode = '22023', message = 'El peso del ejercicio esta fuera de rango';
      end if;

      v_numeric_value := coalesce(nullif(v_entry->>'previous_weight', '')::pg_catalog.numeric, 0);
      if v_numeric_value not between 0 and 99999.99 then
        raise exception using errcode = '22023', message = 'El peso anterior del ejercicio esta fuera de rango';
      end if;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception using errcode = '22023', message = 'El peso del ejercicio es invalido';
    end;
  end loop;
end;
$function$;

create or replace function private.assert_training_cycle_plan_resource_bounds(p_plan jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_routines jsonb;
  v_routine jsonb;
  v_days jsonb;
  v_day jsonb;
  v_exercises jsonb;
  v_exercise jsonb;
  v_training_day jsonb;
  v_total_days integer := 0;
  v_total_exercises integer := 0;
  v_numeric_value numeric;
begin
  if p_plan is null
    or pg_catalog.jsonb_typeof(p_plan) is distinct from 'object'
  then
    raise exception using errcode = '22023', message = 'El plan debe ser un objeto JSON';
  end if;

  if pg_catalog.octet_length(p_plan::pg_catalog.text) > 2097152 then
    raise exception using errcode = '54000', message = 'El plan excede el tamano permitido';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_plan) as root_key(key)
    where not (root_key.key = any(array['source', 'trainingDays', 'exerciseCount', 'routines']::pg_catalog.text[]))
  ) then
    raise exception using errcode = '22023', message = 'El plan contiene campos no permitidos';
  end if;

  if pg_catalog.jsonb_typeof(p_plan->'source') is distinct from 'string'
    or pg_catalog.octet_length(coalesce(p_plan->>'source', '')) > 128
    or pg_catalog.jsonb_typeof(p_plan->'trainingDays') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_plan->'trainingDays') > 7
    or pg_catalog.jsonb_typeof(p_plan->'exerciseCount') is distinct from 'number'
  then
    raise exception using errcode = '22023', message = 'La metadata del plan es invalida';
  end if;

  for v_training_day in
    select training_day.value
    from pg_catalog.jsonb_array_elements(p_plan->'trainingDays') as training_day(value)
  loop
    if pg_catalog.jsonb_typeof(v_training_day) is distinct from 'string'
      or pg_catalog.octet_length(v_training_day #>> '{}') > 32
    then
      raise exception using errcode = '22023', message = 'Los dias de entrenamiento son invalidos';
    end if;
  end loop;

  v_routines := p_plan->'routines';
  if pg_catalog.jsonb_typeof(v_routines) is distinct from 'array'
    or pg_catalog.jsonb_array_length(v_routines) = 0
  then
    raise exception using errcode = '22023', message = 'El plan requiere al menos una rutina';
  end if;

  if pg_catalog.jsonb_array_length(v_routines) > 32 then
    raise exception using errcode = '54000', message = 'El plan excede el limite de rutinas';
  end if;

  for v_routine in
    select routine.value
    from pg_catalog.jsonb_array_elements(v_routines) as routine(value)
  loop
    if pg_catalog.jsonb_typeof(v_routine) is distinct from 'object'
      or exists (
        select 1
        from pg_catalog.jsonb_object_keys(v_routine) as routine_key(key)
        where not (routine_key.key = any(array['name', 'sort_order', 'notes', 'days']::pg_catalog.text[]))
      )
      or pg_catalog.jsonb_typeof(v_routine->'name') is distinct from 'string'
      or nullif(pg_catalog.btrim(v_routine->>'name'), '') is null
      or pg_catalog.octet_length(v_routine->>'name') > 256
      or (v_routine ? 'notes' and pg_catalog.jsonb_typeof(v_routine->'notes') not in ('string', 'null'))
      or pg_catalog.octet_length(coalesce(v_routine->>'notes', '')) > 4096
      or pg_catalog.jsonb_typeof(v_routine->'sort_order') is distinct from 'number'
    then
      raise exception using errcode = '22023', message = 'Una rutina del plan es invalida';
    end if;

    v_numeric_value := (v_routine->>'sort_order')::pg_catalog.numeric;
    if pg_catalog.trunc(v_numeric_value) <> v_numeric_value or v_numeric_value not between 0 and 1000000 then
      raise exception using errcode = '22023', message = 'El orden de la rutina es invalido';
    end if;

    v_days := v_routine->'days';
    if pg_catalog.jsonb_typeof(v_days) is distinct from 'array'
      or pg_catalog.jsonb_array_length(v_days) = 0
    then
      raise exception using errcode = '22023', message = 'Cada rutina requiere al menos un dia';
    end if;

    v_total_days := v_total_days + pg_catalog.jsonb_array_length(v_days);
    if v_total_days > 128 then
      raise exception using errcode = '54000', message = 'El plan excede el limite de dias';
    end if;

    for v_day in
      select day_row.value
      from pg_catalog.jsonb_array_elements(v_days) as day_row(value)
    loop
      if pg_catalog.jsonb_typeof(v_day) is distinct from 'object'
        or exists (
          select 1
          from pg_catalog.jsonb_object_keys(v_day) as day_key(key)
          where not (day_key.key = any(array['week_index', 'day_code', 'sort_order', 'notes', 'exercises']::pg_catalog.text[]))
        )
        or pg_catalog.jsonb_typeof(v_day->'week_index') is distinct from 'number'
        or pg_catalog.jsonb_typeof(v_day->'day_code') is distinct from 'string'
        or (v_day->>'day_code') not in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
        or pg_catalog.jsonb_typeof(v_day->'sort_order') is distinct from 'number'
        or (v_day ? 'notes' and pg_catalog.jsonb_typeof(v_day->'notes') not in ('string', 'null'))
        or pg_catalog.octet_length(coalesce(v_day->>'notes', '')) > 4096
      then
        raise exception using errcode = '22023', message = 'Un dia del plan es invalido';
      end if;

      v_numeric_value := (v_day->>'week_index')::pg_catalog.numeric;
      if pg_catalog.trunc(v_numeric_value) <> v_numeric_value or v_numeric_value not between 1 and 520 then
        raise exception using errcode = '22023', message = 'La semana del dia es invalida';
      end if;

      v_numeric_value := (v_day->>'sort_order')::pg_catalog.numeric;
      if pg_catalog.trunc(v_numeric_value) <> v_numeric_value or v_numeric_value not between 0 and 1000000 then
        raise exception using errcode = '22023', message = 'El orden del dia es invalido';
      end if;

      v_exercises := v_day->'exercises';
      if pg_catalog.jsonb_typeof(v_exercises) is distinct from 'array'
        or pg_catalog.jsonb_array_length(v_exercises) = 0
      then
        raise exception using errcode = '22023', message = 'Cada dia requiere al menos un ejercicio';
      end if;

      if pg_catalog.jsonb_array_length(v_exercises) > 20 then
        raise exception using errcode = '54000', message = 'Cada dia admite hasta 20 ejercicios';
      end if;

      v_total_exercises := v_total_exercises + pg_catalog.jsonb_array_length(v_exercises);
      if v_total_exercises > 512 then
        raise exception using errcode = '54000', message = 'El plan excede el limite total de ejercicios';
      end if;

      for v_exercise in
        select exercise.value
        from pg_catalog.jsonb_array_elements(v_exercises) as exercise(value)
      loop
        if pg_catalog.jsonb_typeof(v_exercise) is distinct from 'object'
          or exists (
            select 1
            from pg_catalog.jsonb_object_keys(v_exercise) as exercise_key(key)
            where not (
              exercise_key.key = any(array[
                'name', 'target_sets', 'target_reps', 'base_weight', 'side_weight',
                'sort_order', 'notes', 'source_legacy_exercise_id', 'exercise_lineage_id'
              ]::pg_catalog.text[])
            )
          )
          or pg_catalog.jsonb_typeof(v_exercise->'name') is distinct from 'string'
          or nullif(pg_catalog.btrim(v_exercise->>'name'), '') is null
          or pg_catalog.octet_length(v_exercise->>'name') > 256
          or pg_catalog.jsonb_typeof(v_exercise->'target_sets') is distinct from 'number'
          or pg_catalog.jsonb_typeof(v_exercise->'target_reps') is distinct from 'number'
          or pg_catalog.jsonb_typeof(v_exercise->'base_weight') is distinct from 'number'
          or (v_exercise ? 'side_weight' and pg_catalog.jsonb_typeof(v_exercise->'side_weight') not in ('number', 'null'))
          or pg_catalog.jsonb_typeof(v_exercise->'sort_order') is distinct from 'number'
          or (v_exercise ? 'notes' and pg_catalog.jsonb_typeof(v_exercise->'notes') not in ('string', 'null'))
          or pg_catalog.octet_length(coalesce(v_exercise->>'notes', '')) > 4096
          or (v_exercise ? 'source_legacy_exercise_id' and pg_catalog.jsonb_typeof(v_exercise->'source_legacy_exercise_id') not in ('string', 'null'))
          or (v_exercise ? 'exercise_lineage_id' and pg_catalog.jsonb_typeof(v_exercise->'exercise_lineage_id') not in ('string', 'null'))
        then
          raise exception using errcode = '22023', message = 'Un ejercicio del plan es invalido';
        end if;

        v_numeric_value := (v_exercise->>'target_sets')::pg_catalog.numeric;
        if pg_catalog.trunc(v_numeric_value) <> v_numeric_value or v_numeric_value not between 1 and 64 then
          raise exception using errcode = '22023', message = 'Las series objetivo estan fuera de rango';
        end if;

        v_numeric_value := (v_exercise->>'target_reps')::pg_catalog.numeric;
        if pg_catalog.trunc(v_numeric_value) <> v_numeric_value or v_numeric_value not between 1 and 10000 then
          raise exception using errcode = '22023', message = 'Las repeticiones objetivo estan fuera de rango';
        end if;

        v_numeric_value := (v_exercise->>'base_weight')::pg_catalog.numeric;
        if v_numeric_value not between 0 and 99999.99 then
          raise exception using errcode = '22023', message = 'El peso base esta fuera de rango';
        end if;

        if pg_catalog.jsonb_typeof(v_exercise->'side_weight') = 'number' then
          v_numeric_value := (v_exercise->>'side_weight')::pg_catalog.numeric;
          if v_numeric_value not between 0 and 99999.99 then
            raise exception using errcode = '22023', message = 'El peso lateral esta fuera de rango';
          end if;
        end if;

        v_numeric_value := (v_exercise->>'sort_order')::pg_catalog.numeric;
        if pg_catalog.trunc(v_numeric_value) <> v_numeric_value or v_numeric_value not between 0 and 1000000 then
          raise exception using errcode = '22023', message = 'El orden del ejercicio es invalido';
        end if;
      end loop;
    end loop;
  end loop;

  v_numeric_value := (p_plan->>'exerciseCount')::pg_catalog.numeric;
  if pg_catalog.trunc(v_numeric_value) <> v_numeric_value
    or v_numeric_value <> v_total_exercises
  then
    raise exception using errcode = '22023', message = 'El conteo de ejercicios del plan es inconsistente';
  end if;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'El plan contiene valores numericos invalidos';
end;
$function$;

create or replace function private.enforce_training_cycle_snapshot_resource_bounds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.plan_snapshot is not null
    and pg_catalog.octet_length(new.plan_snapshot::pg_catalog.text) > 2105344
  then
    raise exception using errcode = '54000', message = 'El snapshot del ciclo excede el tamano permitido';
  end if;

  if new.plan_snapshot->>'source' = 'cycle-scoped' then
    perform private.assert_training_cycle_plan_resource_bounds(new.plan_snapshot->'plan');
  end if;

  return new;
end;
$function$;

drop trigger if exists training_cycles_resource_bounds on public.training_cycles;
create trigger training_cycles_resource_bounds
before insert or update of plan_snapshot on public.training_cycles
for each row execute function private.enforce_training_cycle_snapshot_resource_bounds();

create or replace function private.enforce_training_cycle_exercise_resource_bounds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_active_count integer;
  v_total_count integer;
  v_retired_marker constant pg_catalog.text := '[organizatech:future-plan-retired]';
begin
  if tg_op = 'UPDATE'
    and (
      new.user_id is distinct from old.user_id
      or new.cycle_id is distinct from old.cycle_id
      or new.source_legacy_exercise_id is distinct from old.source_legacy_exercise_id
      or new.exercise_lineage_id is distinct from old.exercise_lineage_id
    )
  then
    raise exception using errcode = '23514', message = 'La identidad historica del ejercicio es inmutable';
  end if;

  if not exists (
    select 1
    from public.training_cycle_days as cycle_day
    where cycle_day.id = new.day_id
      and cycle_day.user_id = new.user_id
      and cycle_day.cycle_id = new.cycle_id
      and cycle_day.deleted_at is null
  ) then
    raise exception using errcode = '23514', message = 'El dia no pertenece al ciclo y usuario indicados';
  end if;

  if new.source_legacy_exercise_id is not null
    and not exists (
      select 1
      from public.exercises as legacy_exercise
      where legacy_exercise.id = new.source_legacy_exercise_id
        and legacy_exercise.user_id = new.user_id
    )
  then
    raise exception using errcode = '23514', message = 'El ejercicio legacy no pertenece al usuario';
  end if;

  if new.deleted_at is null
    and pg_catalog.strpos(coalesce(new.notes, ''), v_retired_marker) = 0
    and new.exercise_lineage_id is null
  then
    raise exception using errcode = '23514', message = 'El ejercicio activo requiere identidad historica';
  end if;

  if new.exercise_lineage_id is not null
    and not exists (
      select 1
      from public.training_exercise_lineages as lineage
      where lineage.id = new.exercise_lineage_id
        and lineage.user_id = new.user_id
        and (
          new.source_legacy_exercise_id is null
          or lineage.source_legacy_exercise_id is null
          or lineage.source_legacy_exercise_id = new.source_legacy_exercise_id
        )
    )
  then
    raise exception using errcode = '23514', message = 'La identidad historica no es compatible con el ejercicio';
  end if;

  if nullif(pg_catalog.btrim(new.name), '') is null
    or pg_catalog.octet_length(new.name) > 256
    or new.target_sets not between 1 and 64
    or new.target_reps not between 1 and 10000
    or pg_catalog.octet_length(coalesce(new.notes, '')) > 4096
  then
    raise exception using errcode = '22023', message = 'El ejercicio del plan excede los limites permitidos';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.day_id::pg_catalog.text, 0));

  select pg_catalog.count(*)::pg_catalog.integer
    into v_total_count
  from public.training_cycle_exercises as exercise
  where exercise.day_id = new.day_id
    and exercise.id is distinct from new.id;

  if tg_op = 'INSERT' and v_total_count >= 256 then
    raise exception using errcode = '54000', message = 'El dia alcanzo el limite historico de ejercicios';
  end if;

  if tg_op = 'UPDATE'
    and old.day_id is distinct from new.day_id
    and v_total_count >= 256
  then
    raise exception using errcode = '54000', message = 'El dia alcanzo el limite historico de ejercicios';
  end if;

  if new.deleted_at is not null
    or pg_catalog.strpos(coalesce(new.notes, ''), v_retired_marker) > 0
  then
    return new;
  end if;

  if new.exercise_lineage_id is not null then
    update public.training_cycle_exercises as previous_exercise
    set notes = case
      when pg_catalog.strpos(coalesce(previous_exercise.notes, ''), v_retired_marker) > 0
        then previous_exercise.notes
      when nullif(pg_catalog.btrim(coalesce(previous_exercise.notes, '')), '') is null
        then v_retired_marker
      else pg_catalog.rtrim(previous_exercise.notes) || pg_catalog.chr(10) || v_retired_marker
    end
    where previous_exercise.day_id = new.day_id
      and previous_exercise.user_id = new.user_id
      and previous_exercise.cycle_id = new.cycle_id
      and previous_exercise.exercise_lineage_id = new.exercise_lineage_id
      and previous_exercise.id is distinct from new.id
      and previous_exercise.deleted_at is null
      and pg_catalog.strpos(coalesce(previous_exercise.notes, ''), v_retired_marker) = 0;
  end if;

  select pg_catalog.count(*)::pg_catalog.integer
    into v_active_count
  from public.training_cycle_exercises as exercise
  where exercise.day_id = new.day_id
    and exercise.id is distinct from new.id
    and exercise.deleted_at is null
    and pg_catalog.strpos(coalesce(exercise.notes, ''), v_retired_marker) = 0;

  if v_active_count >= 20 then
    raise exception using errcode = '54000', message = 'Cada dia admite hasta 20 ejercicios activos';
  end if;

  return new;
end;
$function$;

drop trigger if exists training_cycle_exercises_resource_bounds on public.training_cycle_exercises;
create trigger training_cycle_exercises_resource_bounds
before insert or update
on public.training_cycle_exercises
for each row execute function private.enforce_training_cycle_exercise_resource_bounds();

create or replace function private.enforce_exercise_entry_resource_bounds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_entry_count integer;
begin
  if tg_op = 'UPDATE'
    and (
      new.user_id is distinct from old.user_id
      or new.session_id is distinct from old.session_id
      or new.exercise_id is distinct from old.exercise_id
      or new.training_cycle_exercise_id is distinct from old.training_cycle_exercise_id
      or new.exercise_lineage_id is distinct from old.exercise_lineage_id
    )
  then
    raise exception using errcode = '23514', message = 'La identidad del registro de ejercicio es inmutable';
  end if;

  if new.training_cycle_exercise_id is not null
    and not exists (
      select 1
      from public.training_cycle_exercises as cycle_exercise
      where cycle_exercise.id = new.training_cycle_exercise_id
        and cycle_exercise.user_id = new.user_id
        and cycle_exercise.exercise_lineage_id = new.exercise_lineage_id
    )
  then
    raise exception using errcode = '23514', message = 'El registro no coincide con el ejercicio del ciclo';
  end if;

  if new.exercise_id is not null
    and not exists (
      select 1
      from public.training_exercise_lineages as lineage
      where lineage.id = new.exercise_lineage_id
        and lineage.user_id = new.user_id
        and lineage.source_legacy_exercise_id = new.exercise_id
    )
  then
    raise exception using errcode = '23514', message = 'El registro no coincide con el ejercicio legacy';
  end if;

  if coalesce(pg_catalog.cardinality(new.reps), 0) not between 1 and 64
    or exists (
      select 1
      from pg_catalog.unnest(new.reps) as rep(value)
      where rep.value not between 0 and 10000
    )
    or pg_catalog.octet_length(coalesce(new.rir, '')) > 128
    or pg_catalog.octet_length(coalesce(new.notes, '')) > 4096
    or pg_catalog.octet_length(coalesce(new.observation, '')) > 4096
  then
    raise exception using errcode = '22023', message = 'El registro del ejercicio excede los limites permitidos';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.session_id::pg_catalog.text, 0));

  select pg_catalog.count(*)::pg_catalog.integer
    into v_entry_count
  from public.exercise_entries as entry
  where entry.session_id = new.session_id
    and entry.id is distinct from new.id;

  if v_entry_count >= 20 then
    raise exception using errcode = '54000', message = 'La sesion admite hasta 20 ejercicios';
  end if;

  return new;
end;
$function$;

drop trigger if exists exercise_entries_resource_bounds on public.exercise_entries;
create trigger exercise_entries_resource_bounds
before insert or update
on public.exercise_entries
for each row execute function private.enforce_exercise_entry_resource_bounds();

revoke all on function private.assert_training_session_entries_resource_bounds(jsonb, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.assert_training_cycle_plan_resource_bounds(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_training_cycle_snapshot_resource_bounds()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_training_cycle_exercise_resource_bounds()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_exercise_entry_resource_bounds()
  from public, anon, authenticated, service_role;

create or replace function public.apply_training_cycle_day_exercise_changes(
  p_cycle_id uuid,
  p_day_id uuid,
  p_retire_exercise_ids uuid[],
  p_insertions jsonb,
  p_updates jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_retire_ids uuid[] := coalesce(p_retire_exercise_ids, array[]::uuid[]);
  v_insertions jsonb := coalesce(p_insertions, '[]'::jsonb);
  v_updates jsonb := coalesce(p_updates, '[]'::jsonb);
  v_insertion jsonb;
  v_update jsonb;
  v_update_ids uuid[] := array[]::uuid[];
  v_insert_lineage_ids uuid[] := array[]::uuid[];
  v_changed_at timestamp with time zone := pg_catalog.clock_timestamp();
  v_exercise_id uuid;
  v_lineage_id uuid;
  v_active_count integer;
  v_total_count integer;
  v_locked_count integer;
  v_inserted_count integer := 0;
  v_retired_count integer := 0;
  v_updated_count integer := 0;
  v_numeric_value numeric;
  v_retired_marker constant text := '[organizatech:future-plan-retired]';
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Usuario no autenticado';
  end if;

  if pg_catalog.jsonb_typeof(v_insertions) is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_updates) is distinct from 'array'
  then
    raise exception using errcode = '22023', message = 'Los cambios del dia deben ser arreglos JSON';
  end if;

  if pg_catalog.cardinality(v_retire_ids) > 20
    or pg_catalog.jsonb_array_length(v_insertions) > 20
    or pg_catalog.jsonb_array_length(v_updates) > 20
    or pg_catalog.octet_length(v_insertions::pg_catalog.text) > 262144
    or pg_catalog.octet_length(v_updates::pg_catalog.text) > 262144
  then
    raise exception using errcode = '54000', message = 'Los cambios del dia exceden los limites permitidos';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(v_retire_ids) as retired(exercise_id)
    where retired.exercise_id is null
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.unnest(v_retire_ids) as retired(exercise_id)
  ) <> (
    select pg_catalog.count(distinct retired.exercise_id)
    from pg_catalog.unnest(v_retire_ids) as retired(exercise_id)
  ) then
    raise exception using errcode = '22023', message = 'La lista de retiros contiene identificadores invalidos o duplicados';
  end if;

  for v_insertion in
    select insertion.value
    from pg_catalog.jsonb_array_elements(v_insertions) as insertion(value)
  loop
    if pg_catalog.jsonb_typeof(v_insertion) is distinct from 'object'
      or exists (
        select 1
        from pg_catalog.jsonb_object_keys(v_insertion) as insertion_key(key)
        where insertion_key.key <> all(array[
          'name', 'target_sets', 'target_reps', 'base_weight', 'side_weight',
          'sort_order', 'notes', 'exercise_lineage_id'
        ]::pg_catalog.text[])
      )
      or not (
        v_insertion ? 'name'
        and v_insertion ? 'target_sets'
        and v_insertion ? 'target_reps'
        and v_insertion ? 'base_weight'
        and v_insertion ? 'side_weight'
        and v_insertion ? 'sort_order'
        and v_insertion ? 'notes'
        and v_insertion ? 'exercise_lineage_id'
      )
      or pg_catalog.jsonb_typeof(v_insertion->'name') is distinct from 'string'
      or nullif(pg_catalog.btrim(v_insertion->>'name'), '') is null
      or pg_catalog.octet_length(v_insertion->>'name') > 256
      or pg_catalog.jsonb_typeof(v_insertion->'target_sets') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_insertion->'target_reps') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_insertion->'base_weight') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_insertion->'sort_order') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_insertion->'side_weight') not in ('number', 'null')
      or pg_catalog.jsonb_typeof(v_insertion->'notes') not in ('string', 'null')
      or pg_catalog.jsonb_typeof(v_insertion->'exercise_lineage_id') not in ('string', 'null')
      or pg_catalog.octet_length(coalesce(v_insertion->>'notes', '')) > 4096
    then
      raise exception using errcode = '22023', message = 'Una alta contiene campos invalidos';
    end if;

    begin
      v_numeric_value := (v_insertion->>'target_sets')::pg_catalog.numeric;
      if pg_catalog.trunc(v_numeric_value) <> v_numeric_value or v_numeric_value not between 1 and 64 then
        raise exception using errcode = '22023', message = 'Las series del ejercicio estan fuera de rango';
      end if;
      v_numeric_value := (v_insertion->>'target_reps')::pg_catalog.numeric;
      if pg_catalog.trunc(v_numeric_value) <> v_numeric_value or v_numeric_value not between 1 and 10000 then
        raise exception using errcode = '22023', message = 'Las repeticiones del ejercicio estan fuera de rango';
      end if;
      v_numeric_value := (v_insertion->>'base_weight')::pg_catalog.numeric;
      if v_numeric_value not between 0 and 99999.99 then
        raise exception using errcode = '22023', message = 'El peso base esta fuera de rango';
      end if;
      if pg_catalog.jsonb_typeof(v_insertion->'side_weight') = 'number' then
        v_numeric_value := (v_insertion->>'side_weight')::pg_catalog.numeric;
        if v_numeric_value not between 0 and 99999.99 then
          raise exception using errcode = '22023', message = 'El peso lateral esta fuera de rango';
        end if;
      end if;
      v_numeric_value := (v_insertion->>'sort_order')::pg_catalog.numeric;
      if pg_catalog.trunc(v_numeric_value) <> v_numeric_value or v_numeric_value not between 0 and 1000000 then
        raise exception using errcode = '22023', message = 'El orden del ejercicio es invalido';
      end if;
      v_lineage_id := nullif(v_insertion->>'exercise_lineage_id', '')::pg_catalog.uuid;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception using errcode = '22023', message = 'Una alta contiene valores invalidos';
    end;

    if v_lineage_id is not null then
      if v_lineage_id = any(v_insert_lineage_ids) then
        raise exception using errcode = '22023', message = 'Una identidad historica no puede agregarse dos veces';
      end if;
      v_insert_lineage_ids := pg_catalog.array_append(v_insert_lineage_ids, v_lineage_id);
    end if;
  end loop;

  for v_update in
    select update_item.value
    from pg_catalog.jsonb_array_elements(v_updates) as update_item(value)
  loop
    if pg_catalog.jsonb_typeof(v_update) is distinct from 'object'
      or exists (
        select 1
        from pg_catalog.jsonb_object_keys(v_update) as update_key(key)
        where update_key.key <> all(array[
          'id', 'name', 'target_sets', 'target_reps', 'base_weight',
          'side_weight', 'sort_order', 'notes'
        ]::pg_catalog.text[])
      )
      or not (
        v_update ? 'id'
        and v_update ? 'name'
        and v_update ? 'target_sets'
        and v_update ? 'target_reps'
        and v_update ? 'base_weight'
        and v_update ? 'side_weight'
        and v_update ? 'sort_order'
        and v_update ? 'notes'
      )
      or pg_catalog.jsonb_typeof(v_update->'id') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_update->'name') is distinct from 'string'
      or nullif(pg_catalog.btrim(v_update->>'name'), '') is null
      or pg_catalog.octet_length(v_update->>'name') > 256
      or pg_catalog.jsonb_typeof(v_update->'target_sets') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_update->'target_reps') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_update->'base_weight') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_update->'sort_order') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_update->'side_weight') not in ('number', 'null')
      or pg_catalog.jsonb_typeof(v_update->'notes') not in ('string', 'null')
      or pg_catalog.octet_length(coalesce(v_update->>'notes', '')) > 4096
    then
      raise exception using errcode = '22023', message = 'Una actualizacion contiene campos invalidos';
    end if;

    begin
      v_exercise_id := nullif(v_update->>'id', '')::pg_catalog.uuid;
      v_numeric_value := (v_update->>'target_sets')::pg_catalog.numeric;
      if pg_catalog.trunc(v_numeric_value) <> v_numeric_value or v_numeric_value not between 1 and 64 then
        raise exception using errcode = '22023', message = 'Las series del ejercicio estan fuera de rango';
      end if;
      v_numeric_value := (v_update->>'target_reps')::pg_catalog.numeric;
      if pg_catalog.trunc(v_numeric_value) <> v_numeric_value or v_numeric_value not between 1 and 10000 then
        raise exception using errcode = '22023', message = 'Las repeticiones del ejercicio estan fuera de rango';
      end if;
      v_numeric_value := (v_update->>'base_weight')::pg_catalog.numeric;
      if v_numeric_value not between 0 and 99999.99 then
        raise exception using errcode = '22023', message = 'El peso base esta fuera de rango';
      end if;
      if pg_catalog.jsonb_typeof(v_update->'side_weight') = 'number' then
        v_numeric_value := (v_update->>'side_weight')::pg_catalog.numeric;
        if v_numeric_value not between 0 and 99999.99 then
          raise exception using errcode = '22023', message = 'El peso lateral esta fuera de rango';
        end if;
      end if;
      v_numeric_value := (v_update->>'sort_order')::pg_catalog.numeric;
      if pg_catalog.trunc(v_numeric_value) <> v_numeric_value or v_numeric_value not between 0 and 1000000 then
        raise exception using errcode = '22023', message = 'El orden del ejercicio es invalido';
      end if;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception using errcode = '22023', message = 'Una actualizacion contiene valores invalidos';
    end;

    if v_exercise_id is null
      or v_exercise_id = any(v_update_ids)
      or v_exercise_id = any(v_retire_ids)
    then
      raise exception using errcode = '22023', message = 'Una actualizacion contiene un identificador invalido o duplicado';
    end if;
    v_update_ids := pg_catalog.array_append(v_update_ids, v_exercise_id);
  end loop;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_day_id::pg_catalog.text, 0));

  if not exists (
    select 1
    from public.training_cycle_days as day
    join public.training_cycles as cycle
      on cycle.id = day.cycle_id
      and cycle.user_id = day.user_id
    where day.id = p_day_id
      and day.cycle_id = p_cycle_id
      and day.user_id = v_user_id
      and day.deleted_at is null
      and cycle.status = 'active'
      and cycle.deleted_at is null
  ) then
    raise exception using errcode = '42501', message = 'El dia no pertenece al ciclo activo del usuario';
  end if;

  perform exercise.id
  from public.training_cycle_exercises as exercise
  where exercise.id = any(v_retire_ids)
    and exercise.user_id = v_user_id
    and exercise.cycle_id = p_cycle_id
    and exercise.day_id = p_day_id
    and exercise.deleted_at is null
    and pg_catalog.strpos(coalesce(exercise.notes, ''), v_retired_marker) = 0
  for update;
  get diagnostics v_locked_count = row_count;
  if v_locked_count <> pg_catalog.cardinality(v_retire_ids) then
    raise exception using errcode = '42501', message = 'Un ejercicio a retirar no pertenece al dia activo';
  end if;

  perform exercise.id
  from public.training_cycle_exercises as exercise
  where exercise.id = any(v_update_ids)
    and exercise.user_id = v_user_id
    and exercise.cycle_id = p_cycle_id
    and exercise.day_id = p_day_id
    and exercise.deleted_at is null
    and pg_catalog.strpos(coalesce(exercise.notes, ''), v_retired_marker) = 0
  for update;
  get diagnostics v_locked_count = row_count;
  if v_locked_count <> pg_catalog.cardinality(v_update_ids) then
    raise exception using errcode = '42501', message = 'Un ejercicio a actualizar no pertenece al dia activo';
  end if;

  if exists (
    select 1
    from public.training_cycle_exercises as exercise
    where exercise.user_id = v_user_id
      and exercise.cycle_id = p_cycle_id
      and exercise.day_id = p_day_id
      and exercise.deleted_at is null
      and pg_catalog.strpos(coalesce(exercise.notes, ''), v_retired_marker) = 0
      and exercise.exercise_lineage_id = any(v_insert_lineage_ids)
      and not (exercise.id = any(v_retire_ids))
  ) then
    raise exception using errcode = '22023', message = 'La identidad historica activa debe retirarse en el mismo cambio';
  end if;

  if exists (
    select normalized_name
    from (
      select pg_catalog.lower(pg_catalog.btrim(insertion.value->>'name')) as normalized_name
      from pg_catalog.jsonb_array_elements(v_insertions) as insertion(value)
      union all
      select pg_catalog.lower(pg_catalog.btrim(update_item.value->>'name')) as normalized_name
      from pg_catalog.jsonb_array_elements(v_updates) as update_item(value)
    ) as changed_names
    group by normalized_name
    having pg_catalog.count(*) > 1
  ) or exists (
    select 1
    from public.training_cycle_exercises as exercise
    join (
      select pg_catalog.lower(pg_catalog.btrim(insertion.value->>'name')) as normalized_name
      from pg_catalog.jsonb_array_elements(v_insertions) as insertion(value)
      union all
      select pg_catalog.lower(pg_catalog.btrim(update_item.value->>'name')) as normalized_name
      from pg_catalog.jsonb_array_elements(v_updates) as update_item(value)
    ) as changed_names
      on changed_names.normalized_name = pg_catalog.lower(pg_catalog.btrim(exercise.name))
    where exercise.user_id = v_user_id
      and exercise.cycle_id = p_cycle_id
      and exercise.day_id = p_day_id
      and exercise.deleted_at is null
      and pg_catalog.strpos(coalesce(exercise.notes, ''), v_retired_marker) = 0
      and not (exercise.id = any(v_retire_ids))
      and not (exercise.id = any(v_update_ids))
  ) then
    raise exception using errcode = '22023', message = 'El dia contiene ejercicios duplicados';
  end if;

  select pg_catalog.count(*)::pg_catalog.integer
    into v_active_count
  from public.training_cycle_exercises as exercise
  where exercise.user_id = v_user_id
    and exercise.cycle_id = p_cycle_id
    and exercise.day_id = p_day_id
    and exercise.deleted_at is null
    and pg_catalog.strpos(coalesce(exercise.notes, ''), v_retired_marker) = 0;

  if v_active_count - pg_catalog.cardinality(v_retire_ids)
      + pg_catalog.jsonb_array_length(v_insertions) > 20
  then
    raise exception using errcode = '54000', message = 'Cada dia admite hasta 20 ejercicios activos';
  end if;

  select pg_catalog.count(*)::pg_catalog.integer
    into v_total_count
  from public.training_cycle_exercises as exercise
  where exercise.user_id = v_user_id
    and exercise.cycle_id = p_cycle_id
    and exercise.day_id = p_day_id;

  if v_total_count + pg_catalog.jsonb_array_length(v_insertions) > 256 then
    raise exception using errcode = '54000', message = 'El dia alcanzo el limite historico de ejercicios';
  end if;

  update public.training_cycle_exercises as exercise
  set
    notes = case
      when exists (
        select 1
        from public.exercise_entries as entry
        where entry.training_cycle_exercise_id = exercise.id
          and entry.user_id = v_user_id
      ) then case
        when pg_catalog.strpos(coalesce(exercise.notes, ''), v_retired_marker) > 0 then exercise.notes
        when nullif(pg_catalog.btrim(coalesce(exercise.notes, '')), '') is null then v_retired_marker
        else pg_catalog.rtrim(exercise.notes) || pg_catalog.chr(10) || v_retired_marker
      end
      else exercise.notes
    end,
    deleted_at = case
      when exists (
        select 1
        from public.exercise_entries as entry
        where entry.training_cycle_exercise_id = exercise.id
          and entry.user_id = v_user_id
      ) then exercise.deleted_at
      else v_changed_at
    end
  where exercise.id = any(v_retire_ids)
    and exercise.user_id = v_user_id
    and exercise.cycle_id = p_cycle_id
    and exercise.day_id = p_day_id
    and exercise.deleted_at is null;
  get diagnostics v_retired_count = row_count;

  for v_update in
    select update_item.value
    from pg_catalog.jsonb_array_elements(v_updates) as update_item(value)
  loop
    update public.training_cycle_exercises as exercise
    set
      name = pg_catalog.btrim(v_update->>'name'),
      target_sets = (v_update->>'target_sets')::pg_catalog.integer,
      target_reps = (v_update->>'target_reps')::pg_catalog.integer,
      base_weight = (v_update->>'base_weight')::pg_catalog.numeric,
      side_weight = nullif(v_update->>'side_weight', '')::pg_catalog.numeric,
      sort_order = (v_update->>'sort_order')::pg_catalog.integer,
      notes = nullif(v_update->>'notes', '')
    where exercise.id = (v_update->>'id')::pg_catalog.uuid
      and exercise.user_id = v_user_id
      and exercise.cycle_id = p_cycle_id
      and exercise.day_id = p_day_id;
    v_updated_count := v_updated_count + 1;
  end loop;

  for v_insertion in
    select insertion.value
    from pg_catalog.jsonb_array_elements(v_insertions) as insertion(value)
  loop
    v_lineage_id := nullif(v_insertion->>'exercise_lineage_id', '')::pg_catalog.uuid;
    if v_lineage_id is null then
      insert into public.training_exercise_lineages (
        user_id,
        origin_kind,
        metadata
      ) values (
        v_user_id,
        'scoped',
        pg_catalog.jsonb_build_object('source', 'training_cycle_day_edit')
      )
      returning id into v_lineage_id;
    elsif not exists (
      select 1
      from public.training_exercise_lineages as lineage
      where lineage.id = v_lineage_id
        and lineage.user_id = v_user_id
    ) then
      raise exception using errcode = '42501', message = 'La identidad historica no pertenece al usuario';
    end if;

    insert into public.training_cycle_exercises (
      user_id,
      cycle_id,
      day_id,
      name,
      target_sets,
      target_reps,
      base_weight,
      side_weight,
      sort_order,
      notes,
      source_legacy_exercise_id,
      exercise_lineage_id
    ) values (
      v_user_id,
      p_cycle_id,
      p_day_id,
      pg_catalog.btrim(v_insertion->>'name'),
      (v_insertion->>'target_sets')::pg_catalog.integer,
      (v_insertion->>'target_reps')::pg_catalog.integer,
      (v_insertion->>'base_weight')::pg_catalog.numeric,
      nullif(v_insertion->>'side_weight', '')::pg_catalog.numeric,
      (v_insertion->>'sort_order')::pg_catalog.integer,
      nullif(v_insertion->>'notes', ''),
      null,
      v_lineage_id
    )
    returning id into v_exercise_id;

    update public.training_exercise_lineages as lineage
    set origin_training_cycle_exercise_id = coalesce(
      lineage.origin_training_cycle_exercise_id,
      v_exercise_id
    )
    where lineage.id = v_lineage_id
      and lineage.user_id = v_user_id
      and lineage.origin_kind = 'scoped';

    v_inserted_count := v_inserted_count + 1;
  end loop;

  return pg_catalog.jsonb_build_object(
    'exercises_added', v_inserted_count,
    'exercises_updated', v_updated_count,
    'exercises_retired', v_retired_count
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'Los cambios del dia contienen valores invalidos';
end;
$function$;

revoke all on function public.apply_training_cycle_day_exercise_changes(
  uuid, uuid, uuid[], jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.apply_training_cycle_day_exercise_changes(
  uuid, uuid, uuid[], jsonb, jsonb
) to authenticated;

create or replace function public.create_training_session_with_entries(
  p_routine_id uuid,
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
  v_calendar_week_start date;
  v_session_id uuid;
  v_entry jsonb;
  v_exercise_id uuid;
  v_exercise_lineage_id uuid;
  v_reps jsonb;
  v_seen_exercises uuid[] := array[]::uuid[];
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_routine_id is null then
    raise exception 'La rutina es obligatoria';
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
    'legacy',
    p_status,
    p_notes
  );

  if jsonb_typeof(v_entries) <> 'array' then
    raise exception 'La lista de ejercicios debe ser un arreglo JSON';
  end if;

  if not exists (
    select 1
    from public.routines r
    where r.id = p_routine_id
      and r.user_id = v_user_id
      and r.deleted_at is null
  ) then
    raise exception 'La rutina no existe o no pertenece al usuario';
  end if;

  if p_status = 'completed' and jsonb_array_length(v_entries) = 0 then
    raise exception 'Un entrenamiento completado requiere ejercicios';
  end if;

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.routine_id = p_routine_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para esta rutina y fecha';
  end if;

  v_calendar_week_start := p_trained_date - (extract(isodow from p_trained_date)::integer - 1);

  insert into public.training_sessions (
    user_id,
    routine_id,
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
    p_routine_id,
    coalesce(p_week_number, 1),
    p_trained_date,
    v_calendar_week_start,
    p_planned_day,
    p_planned_date,
    p_trained_date,
    p_status,
    case when p_status = 'completed' then now() else null end,
    p_notes
  )
  returning id into v_session_id;

  if p_status = 'completed' then
    for v_entry in select * from jsonb_array_elements(v_entries)
    loop
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception 'Cada ejercicio debe ser un objeto JSON';
      end if;

      if nullif(v_entry->>'exercise_id', '') is null then
        raise exception 'Cada ejercicio requiere exercise_id';
      end if;

      begin
        v_exercise_id := (v_entry->>'exercise_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'exercise_id invalido';
      end;

      if v_exercise_id = any(v_seen_exercises) then
        raise exception 'El entrenamiento contiene ejercicios duplicados';
      end if;
      v_seen_exercises := array_append(v_seen_exercises, v_exercise_id);

      v_reps := v_entry->'reps';
      if v_reps is null or jsonb_typeof(v_reps) <> 'array' then
        raise exception 'Cada ejercicio requiere reps como arreglo';
      end if;

      if jsonb_array_length(v_reps) = 0 then
        raise exception 'Cada ejercicio requiere al menos una repeticion';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation then
          raise exception 'reps debe contener enteros validos';
      end;

      if not exists (
        select 1
        from public.exercises e
        where e.id = v_exercise_id
          and e.user_id = v_user_id
          and e.routine_id = p_routine_id
      ) then
        raise exception 'Un ejercicio no pertenece a la rutina del usuario';
      end if;

      select tel.id
      into v_exercise_lineage_id
      from public.training_exercise_lineages tel
      where tel.user_id = v_user_id
        and tel.source_legacy_exercise_id = v_exercise_id;

      if v_exercise_lineage_id is null then
        raise exception 'El ejercicio legacy no tiene identidad historica (exercise_lineage_id) registrada';
      end if;

      insert into public.exercise_entries (
        id,
        user_id,
        session_id,
        exercise_id,
        exercise_lineage_id,
        weight,
        previous_weight,
        reps,
        rir,
        notes,
        observation
      )
      values (
        coalesce((v_entry->>'id')::uuid, gen_random_uuid()),
        v_user_id,
        v_session_id,
        v_exercise_id,
        v_exercise_lineage_id,
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

  if not exists (
    select 1
    from public.training_cycles c
    where c.id = p_cycle_id
      and c.user_id = v_user_id
      and c.status = 'active'
      and c.deleted_at is null
  ) then
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

  if exists (
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

revoke all on function public.create_training_session_with_entries(
  uuid, text, date, date, text, integer, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_training_session_with_entries(
  uuid, text, date, date, text, integer, text, jsonb
) to authenticated;

revoke all on function public.create_training_session_with_cycle_entries(
  uuid, uuid, text, date, date, text, integer, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_training_session_with_cycle_entries(
  uuid, uuid, text, date, date, text, integer, text, jsonb
) to authenticated;

revoke all on function public.create_training_cycle_with_plan(
  text, integer, text, text, integer, date, date, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_training_cycle_with_plan(
  text, integer, text, text, integer, date, date, jsonb
) to authenticated;

commit;
