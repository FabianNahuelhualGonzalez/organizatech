-- P0-D.1: harden training session/entry writes behind RPCs.
-- Local migration candidate only. Do not apply to Production without the QA gate.
--
-- Goal:
-- - Keep the public RPC signatures unchanged.
-- - Preserve existing ownership and business validations.
-- - Let the RPC owner perform the table writes, then remove direct INSERT/UPDATE
--   access for authenticated clients on training_sessions and exercise_entries.
-- - service_role is deliberately revoked because these RPCs are exclusively for
--   the authenticated user flow and have no current server-side dependency.
--
-- Rollback:
-- - A concrete rollback SQL block is included at the end of this file.
-- - Do not execute rollback without separate, explicit authorization.

begin;

-- Do not consolidate duplicate data automatically. Abort before adding the
-- concurrency guard so any existing cycle-scoped duplicates can be reviewed.
do $$
begin
  if exists (
    select 1
    from public.training_sessions s
    where s.cycle_day_id is not null
      and s.deleted_at is null
    group by s.user_id, s.cycle_day_id, s.trained_date
    having count(*) > 1
  ) then
    raise exception 'No se puede aplicar P0-D.1: existen sesiones cycle-scoped duplicadas activas para el mismo usuario, dia de ciclo y fecha';
  end if;
end;
$$;

-- The legacy routine-based unique index does not cover cycle_day_id rows.
-- This partial unique index is the database-level concurrency guard for the
-- cycle-scoped session contract.
create unique index training_sessions_user_cycle_day_trained_unique_idx
  on public.training_sessions(user_id, cycle_day_id, trained_date)
  where cycle_day_id is not null
    and deleted_at is null;

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
        notes
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
        nullif(v_entry->>'notes', '')
      );
    end loop;
  end if;

  return v_session_id;
end;
$$;

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
as $$
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
        notes
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
        nullif(v_entry->>'notes', '')
      );
    end loop;
  end if;

  return v_session_id;
end;
$$;

revoke all on function public.create_training_session_with_entries(
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from public;
revoke all on function public.create_training_session_with_entries(
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from anon;
revoke all on function public.create_training_session_with_entries(
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from service_role;
grant execute on function public.create_training_session_with_entries(
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) to authenticated;

revoke all on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from public;
revoke all on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from anon;
revoke all on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from service_role;
grant execute on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) to authenticated;

revoke insert, update on table public.training_sessions from authenticated;
revoke insert, update on table public.exercise_entries from authenticated;
revoke delete on table public.training_sessions from authenticated;
revoke delete on table public.exercise_entries from authenticated;

commit;

/*
Rollback P0-D.1 - SQL concreto aplicable solo con autorizacion explicita.

Objetivo del rollback:
- Volver al modelo anterior donde las RPCs son SECURITY INVOKER.
- Restaurar SELECT, INSERT, UPDATE directos para authenticated sobre training_sessions y exercise_entries.
- Mantener DELETE sin conceder a authenticated.
- Restaurar EXECUTE para authenticated, que es el caller real de la app.

begin;

drop index if exists public.training_sessions_user_cycle_day_trained_unique_idx;

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
security invoker
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
        notes
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
        nullif(v_entry->>'notes', '')
      );
    end loop;
  end if;

  return v_session_id;
end;
$rollback$;

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
security invoker
set search_path = public, pg_temp
as $rollback$
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
        notes
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
        nullif(v_entry->>'notes', '')
      );
    end loop;
  end if;

  return v_session_id;
end;
$rollback$;

grant select, insert, update on table public.training_sessions to authenticated;
grant select, insert, update on table public.exercise_entries to authenticated;
revoke delete on table public.training_sessions from authenticated;
revoke delete on table public.exercise_entries from authenticated;

grant execute on function public.create_training_session_with_entries(
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) to authenticated;

grant execute on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) to authenticated;

commit;
*/
