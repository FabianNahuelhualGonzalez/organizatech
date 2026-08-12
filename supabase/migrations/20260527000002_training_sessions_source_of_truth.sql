alter table public.routines
  add column if not exists deleted_at timestamptz;

alter table public.training_sessions
  add column if not exists routine_id uuid references public.routines(id) on delete restrict,
  add column if not exists calendar_week_start date,
  add column if not exists planned_day text,
  add column if not exists planned_date date,
  add column if not exists trained_date date,
  add column if not exists status text not null default 'completed',
  add column if not exists completed_at timestamptz,
  add column if not exists deleted_at timestamptz;

alter table public.training_sessions
  drop constraint if exists training_sessions_status_check;

alter table public.training_sessions
  add constraint training_sessions_status_check
  check (status in ('completed', 'skipped'));

alter table public.training_sessions
  drop constraint if exists training_sessions_planned_day_check;

alter table public.training_sessions
  add constraint training_sessions_planned_day_check
  check (
    planned_day is null
    or planned_day in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
  );

create index if not exists training_sessions_user_trained_date_idx
  on public.training_sessions(user_id, trained_date);

create index if not exists training_sessions_user_calendar_week_idx
  on public.training_sessions(user_id, calendar_week_start);

create index if not exists training_sessions_user_routine_week_idx
  on public.training_sessions(user_id, routine_id, calendar_week_start);

create index if not exists training_sessions_user_status_idx
  on public.training_sessions(user_id, status);

create index if not exists training_sessions_user_deleted_at_idx
  on public.training_sessions(user_id, deleted_at);

-- Legacy rows with routine_id IS NULL do not participate in this unique index.
-- New training writes must provide routine_id through create_training_session_with_entries.
create unique index if not exists training_sessions_user_routine_trained_unique_idx
  on public.training_sessions(user_id, routine_id, trained_date)
  where deleted_at is null;

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
