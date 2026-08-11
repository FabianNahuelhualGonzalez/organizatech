-- OBS-2A.1: resolve exercise_lineage_id server-side for legacy session entries.
-- Local migration candidate only. Do not apply to Production without the QA gate.
--
-- Goal:
-- - create_training_session_with_cycle_entries already resolves and stores
--   exercise_lineage_id for every entry it inserts. create_training_session_with_entries
--   (the legacy, routine-scoped RPC) still inserts exercise_id but leaves
--   exercise_lineage_id null, which breaks the "last observation"/"last
--   performance" lookups for legacy entries (both are keyed exclusively by
--   exercise_lineage_id, with no fallback by name or exercise_id).
-- - This migration replaces ONLY public.create_training_session_with_entries
--   so it resolves exercise_lineage_id server-side, from
--   training_exercise_lineages, using the already-validated v_exercise_id.
--   The lineage is never trusted from the client: no exercise_lineage_id
--   field is read from p_entries in this RPC.
-- - If a legacy exercise has no matching row in training_exercise_lineages,
--   the RPC aborts with a stable, explicit error instead of inserting a
--   historical entry without lineage.
-- - Keep the RPC signature unchanged (still jsonb `p_entries`).
-- - Do not touch public.create_training_session_with_cycle_entries: it is not
--   redefined by this migration.
-- - Do not touch `notes`, `observation`, RLS, indexes, or grants: the
--   function signature (therefore its existing grants) is unchanged, and the
--   existing "entries own rows" row-level policy already covers
--   exercise_lineage_id because RLS is per-row, not per-column.
--
-- Rollback:
-- - A concrete rollback SQL block is included at the end of this file.
-- - Do not execute rollback without separate, explicit authorization.

begin;

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
as $$
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
$$;

commit;

/*
Rollback OBS-2A.1 - SQL concreto aplicable solo con autorizacion explicita.

Objetivo del rollback:
- Restaurar public.create_training_session_with_entries a la version vigente
  de OBS-1 (definida en 20260718_exercise_entries_observation.sql): sigue
  guardando observation, pero deja de resolver e insertar
  exercise_lineage_id en la ruta legacy.
- No eliminar la columna exercise_entries.observation.
- No modificar public.create_training_session_with_cycle_entries: no fue
  tocada por esta migracion y el rollback tampoco la toca.
- No tocar tablas, training_exercise_lineages, RLS, indices ni grants.

begin;

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
as $rollback$
declare
  v_user_id uuid := auth.uid();
  v_calendar_week_start date;
  v_session_id uuid;
  v_entry jsonb;
  v_exercise_id uuid;
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

      insert into public.exercise_entries (
        id,
        user_id,
        session_id,
        exercise_id,
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
$rollback$;

commit;
*/
