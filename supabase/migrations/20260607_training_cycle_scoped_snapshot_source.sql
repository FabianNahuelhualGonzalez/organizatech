-- Fase 2.2BU: normalize the external cycle-scoped snapshot marker for new cycles.
-- Historical/QA cycles can keep plan_snapshot.source = "cycle-scoped-qa".
-- New cycles created through this RPC use plan_snapshot.source = "cycle-scoped".

create or replace function public.create_training_cycle_with_plan(
  p_name text,
  p_cycle_number integer,
  p_cycle_type text,
  p_goal text,
  p_duration_weeks integer,
  p_planned_start_date date,
  p_planned_end_date date,
  p_plan jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_cycle_id uuid;
  v_routine jsonb;
  v_day jsonb;
  v_exercise jsonb;
  v_routine_id uuid;
  v_day_id uuid;
  v_routines jsonb := coalesce(p_plan->'routines', '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'El nombre del ciclo es obligatorio';
  end if;

  if p_cycle_number is null or p_cycle_number <= 0 then
    raise exception 'El numero de ciclo debe ser mayor que cero';
  end if;

  if p_duration_weeks is null or p_duration_weeks <= 0 then
    raise exception 'La duracion en semanas debe ser mayor que cero';
  end if;

  if p_planned_start_date is null or p_planned_end_date is null then
    raise exception 'Las fechas planificadas son obligatorias';
  end if;

  if p_planned_end_date < p_planned_start_date then
    raise exception 'La fecha de termino planificada no puede ser anterior al inicio';
  end if;

  if jsonb_typeof(v_routines) <> 'array' then
    raise exception 'p_plan.routines debe ser un arreglo';
  end if;

  if jsonb_array_length(v_routines) = 0 then
    raise exception 'El plan requiere al menos una rutina';
  end if;

  if exists (
    select 1
    from public.training_cycles c
    where c.user_id = v_user_id
      and c.status = 'active'
      and c.deleted_at is null
  ) then
    raise exception 'Ya existe un ciclo activo para este usuario';
  end if;

  insert into public.training_cycles (
    user_id,
    name,
    cycle_number,
    cycle_type,
    goal,
    started_at,
    status,
    duration_weeks,
    planned_start_date,
    planned_end_date,
    plan_snapshot,
    summary_snapshot
  )
  values (
    v_user_id,
    trim(p_name),
    p_cycle_number,
    nullif(trim(p_cycle_type), ''),
    nullif(trim(p_goal), ''),
    now(),
    'active',
    p_duration_weeks,
    p_planned_start_date,
    p_planned_end_date,
    jsonb_build_object(
      'source', 'cycle-scoped',
      'cycleType', p_cycle_type,
      'goal', p_goal,
      'durationWeeks', p_duration_weeks,
      'plannedStartDate', p_planned_start_date,
      'plannedEndDate', p_planned_end_date,
      'plan', coalesce(p_plan, '{}'::jsonb)
    ),
    null
  )
  returning id into v_cycle_id;

  for v_routine in select * from jsonb_array_elements(v_routines)
  loop
    if nullif(trim(v_routine->>'name'), '') is null then
      raise exception 'Cada rutina requiere nombre';
    end if;

    insert into public.training_cycle_routines (
      user_id,
      cycle_id,
      name,
      sort_order,
      notes
    )
    values (
      v_user_id,
      v_cycle_id,
      trim(v_routine->>'name'),
      coalesce((v_routine->>'sort_order')::integer, 0),
      nullif(v_routine->>'notes', '')
    )
    returning id into v_routine_id;

    if jsonb_typeof(coalesce(v_routine->'days', '[]'::jsonb)) <> 'array' then
      raise exception 'routine.days debe ser un arreglo';
    end if;

    if jsonb_array_length(coalesce(v_routine->'days', '[]'::jsonb)) = 0 then
      raise exception 'Cada rutina requiere al menos un dia';
    end if;

    for v_day in select * from jsonb_array_elements(coalesce(v_routine->'days', '[]'::jsonb))
    loop
      if (v_day->>'day_code') not in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday') then
        raise exception 'Dia planificado invalido';
      end if;

      insert into public.training_cycle_days (
        user_id,
        cycle_id,
        routine_id,
        week_index,
        day_code,
        sort_order,
        notes
      )
      values (
        v_user_id,
        v_cycle_id,
        v_routine_id,
        coalesce((v_day->>'week_index')::integer, 1),
        v_day->>'day_code',
        coalesce((v_day->>'sort_order')::integer, 0),
        nullif(v_day->>'notes', '')
      )
      returning id into v_day_id;

      if jsonb_typeof(coalesce(v_day->'exercises', '[]'::jsonb)) <> 'array' then
        raise exception 'day.exercises debe ser un arreglo';
      end if;

      if jsonb_array_length(coalesce(v_day->'exercises', '[]'::jsonb)) = 0 then
        raise exception 'Cada dia requiere al menos un ejercicio';
      end if;

      for v_exercise in select * from jsonb_array_elements(coalesce(v_day->'exercises', '[]'::jsonb))
      loop
        if nullif(trim(v_exercise->>'name'), '') is null then
          raise exception 'Cada ejercicio requiere nombre';
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
          source_legacy_exercise_id
        )
        values (
          v_user_id,
          v_cycle_id,
          v_day_id,
          trim(v_exercise->>'name'),
          coalesce((v_exercise->>'target_sets')::integer, 1),
          coalesce((v_exercise->>'target_reps')::integer, 1),
          coalesce((v_exercise->>'base_weight')::numeric, 0),
          nullif(v_exercise->>'side_weight', '')::numeric,
          coalesce((v_exercise->>'sort_order')::integer, 0),
          nullif(v_exercise->>'notes', ''),
          nullif(v_exercise->>'source_legacy_exercise_id', '')::uuid
        );
      end loop;
    end loop;
  end loop;

  return v_cycle_id;
end;
$$;

grant execute on function public.create_training_cycle_with_plan(
  text,
  integer,
  text,
  text,
  integer,
  date,
  date,
  jsonb
) to authenticated;
