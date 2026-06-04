-- Fase 2.2AN - Migracion QA candidata modelo cycle-scoped Training.
-- CANDIDATA LOCAL: no aplicar en Production sin autorizacion explicita.
-- Objetivo:
-- - Extender training_cycles con duracion normalizada.
-- - Crear tablas de planificacion por ciclo.
-- - Asociar sesiones y entries al modelo cycle-scoped.
-- - Definir RLS, grants minimos y RPCs transaccionales candidatas.

create extension if not exists "pgcrypto";

alter table public.training_cycles
  add column if not exists duration_weeks integer null,
  add column if not exists planned_start_date date null,
  add column if not exists planned_end_date date null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'training_cycles_duration_weeks_check'
      and conrelid = 'public.training_cycles'::regclass
  ) then
    alter table public.training_cycles
      add constraint training_cycles_duration_weeks_check
      check (duration_weeks is null or duration_weeks > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'training_cycles_planned_dates_check'
      and conrelid = 'public.training_cycles'::regclass
  ) then
    alter table public.training_cycles
      add constraint training_cycles_planned_dates_check
      check (
        planned_start_date is null
        or planned_end_date is null
        or planned_end_date >= planned_start_date
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'training_cycles_id_user_id_unique'
      and conrelid = 'public.training_cycles'::regclass
  ) then
    alter table public.training_cycles
      add constraint training_cycles_id_user_id_unique unique (id, user_id);
  end if;
end $$;

create table if not exists public.training_cycle_routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cycle_id uuid not null references public.training_cycles(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint training_cycle_routines_cycle_user_fk
    foreign key (cycle_id, user_id)
    references public.training_cycles(id, user_id)
    on delete cascade
);

create table if not exists public.training_cycle_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cycle_id uuid not null references public.training_cycles(id) on delete cascade,
  routine_id uuid not null references public.training_cycle_routines(id) on delete restrict,
  week_index integer not null default 1 check (week_index > 0),
  day_code text not null check (
    day_code in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
  ),
  sort_order integer not null default 0 check (sort_order >= 0),
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint training_cycle_days_cycle_user_fk
    foreign key (cycle_id, user_id)
    references public.training_cycles(id, user_id)
    on delete cascade
);

create table if not exists public.training_cycle_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cycle_id uuid not null references public.training_cycles(id) on delete cascade,
  day_id uuid not null references public.training_cycle_days(id) on delete cascade,
  name text not null,
  target_sets integer not null check (target_sets > 0),
  target_reps integer not null check (target_reps > 0),
  base_weight numeric(7,2) not null default 0 check (base_weight >= 0),
  side_weight numeric(7,2) null check (side_weight is null or side_weight >= 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  notes text null,
  source_legacy_exercise_id uuid null references public.exercises(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint training_cycle_exercises_cycle_user_fk
    foreign key (cycle_id, user_id)
    references public.training_cycles(id, user_id)
    on delete cascade
);

alter table public.training_sessions
  add column if not exists cycle_id uuid null references public.training_cycles(id) on delete restrict,
  add column if not exists cycle_day_id uuid null references public.training_cycle_days(id) on delete restrict;

alter table public.exercise_entries
  add column if not exists training_cycle_exercise_id uuid null
  references public.training_cycle_exercises(id) on delete restrict;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'training_sessions_cycle_day_required_check'
      and conrelid = 'public.training_sessions'::regclass
  ) then
    alter table public.training_sessions
      add constraint training_sessions_cycle_day_required_check
      check (cycle_id is null or cycle_day_id is not null);
  end if;
end $$;

create index if not exists training_cycle_routines_user_cycle_idx
  on public.training_cycle_routines(user_id, cycle_id)
  where deleted_at is null;

create unique index if not exists training_cycle_routines_user_cycle_name_idx
  on public.training_cycle_routines(user_id, cycle_id, lower(name))
  where deleted_at is null;

create unique index if not exists training_cycle_days_one_routine_per_day_idx
  on public.training_cycle_days(user_id, cycle_id, week_index, day_code)
  where deleted_at is null;

create index if not exists training_cycle_days_user_cycle_week_day_idx
  on public.training_cycle_days(user_id, cycle_id, week_index, day_code)
  where deleted_at is null;

create index if not exists training_cycle_exercises_user_cycle_day_idx
  on public.training_cycle_exercises(user_id, cycle_id, day_id)
  where deleted_at is null;

create index if not exists training_sessions_user_cycle_idx
  on public.training_sessions(user_id, cycle_id)
  where deleted_at is null;

create index if not exists exercise_entries_user_cycle_exercise_idx
  on public.exercise_entries(user_id, training_cycle_exercise_id)
  where training_cycle_exercise_id is not null;

drop trigger if exists training_cycle_routines_set_updated_at on public.training_cycle_routines;
create trigger training_cycle_routines_set_updated_at
  before update on public.training_cycle_routines
  for each row execute function public.set_updated_at();

drop trigger if exists training_cycle_days_set_updated_at on public.training_cycle_days;
create trigger training_cycle_days_set_updated_at
  before update on public.training_cycle_days
  for each row execute function public.set_updated_at();

drop trigger if exists training_cycle_exercises_set_updated_at on public.training_cycle_exercises;
create trigger training_cycle_exercises_set_updated_at
  before update on public.training_cycle_exercises
  for each row execute function public.set_updated_at();

alter table public.training_cycle_routines enable row level security;
alter table public.training_cycle_days enable row level security;
alter table public.training_cycle_exercises enable row level security;

drop policy if exists "training cycle routines select own rows" on public.training_cycle_routines;
create policy "training cycle routines select own rows" on public.training_cycle_routines
  for select
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
  );

drop policy if exists "training cycle routines insert own rows" on public.training_cycle_routines;
create policy "training cycle routines insert own rows" on public.training_cycle_routines
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
  );

drop policy if exists "training cycle routines update own rows" on public.training_cycle_routines;
create policy "training cycle routines update own rows" on public.training_cycle_routines
  for update
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
  );

drop policy if exists "training cycle days select own rows" on public.training_cycle_days;
create policy "training cycle days select own rows" on public.training_cycle_days
  for select
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
  );

drop policy if exists "training cycle days insert own rows" on public.training_cycle_days;
create policy "training cycle days insert own rows" on public.training_cycle_days
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
    and exists (
      select 1
      from public.training_cycle_routines r
      where r.id = routine_id
        and r.cycle_id = cycle_id
        and r.user_id = auth.uid()
        and r.deleted_at is null
    )
  );

drop policy if exists "training cycle days update own rows" on public.training_cycle_days;
create policy "training cycle days update own rows" on public.training_cycle_days
  for update
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
    and exists (
      select 1
      from public.training_cycle_routines r
      where r.id = routine_id
        and r.cycle_id = cycle_id
        and r.user_id = auth.uid()
        and r.deleted_at is null
    )
  );

drop policy if exists "training cycle exercises select own rows" on public.training_cycle_exercises;
create policy "training cycle exercises select own rows" on public.training_cycle_exercises
  for select
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
  );

drop policy if exists "training cycle exercises insert own rows" on public.training_cycle_exercises;
create policy "training cycle exercises insert own rows" on public.training_cycle_exercises
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.training_cycle_days d
      where d.id = day_id
        and d.cycle_id = cycle_id
        and d.user_id = auth.uid()
        and d.deleted_at is null
    )
  );

drop policy if exists "training cycle exercises update own rows" on public.training_cycle_exercises;
create policy "training cycle exercises update own rows" on public.training_cycle_exercises
  for update
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.training_cycle_days d
      where d.id = day_id
        and d.cycle_id = cycle_id
        and d.user_id = auth.uid()
        and d.deleted_at is null
    )
  );

drop policy if exists "sessions own rows" on public.training_sessions;
create policy "sessions own rows" on public.training_sessions
  for all
  using (
    auth.uid() = user_id
    and (
      cycle_id is null
      or cycle_day_id is not null
    )
    and (
      cycle_id is null
      or exists (
        select 1
        from public.training_cycles c
        where c.id = cycle_id
          and c.user_id = auth.uid()
          and c.deleted_at is null
      )
    )
  )
  with check (
    auth.uid() = user_id
    and (
      cycle_id is null
      or cycle_day_id is not null
    )
    and (
      cycle_id is null
      or exists (
        select 1
        from public.training_cycles c
        where c.id = cycle_id
          and c.user_id = auth.uid()
          and c.deleted_at is null
      )
    )
    and (
      cycle_day_id is null
      or exists (
        select 1
        from public.training_cycle_days d
        where d.id = cycle_day_id
          and d.cycle_id = cycle_id
          and d.user_id = auth.uid()
          and d.deleted_at is null
      )
    )
  );

drop policy if exists "entries own rows" on public.exercise_entries;
create policy "entries own rows" on public.exercise_entries
  for all
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.training_sessions s
      where s.id = session_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.exercises e
      where e.id = exercise_id
        and e.user_id = auth.uid()
    )
    and (
      training_cycle_exercise_id is null
      or exists (
        select 1
        from public.training_cycle_exercises tce
        join public.training_sessions s
          on s.id = session_id
          and s.user_id = auth.uid()
        where tce.id = training_cycle_exercise_id
          and tce.user_id = auth.uid()
          and tce.deleted_at is null
          and s.cycle_id is not null
          and s.cycle_id = tce.cycle_id
          and (s.cycle_day_id is null or s.cycle_day_id = tce.day_id)
      )
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.training_sessions s
      where s.id = session_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.exercises e
      where e.id = exercise_id
        and e.user_id = auth.uid()
    )
    and (
      training_cycle_exercise_id is null
      or exists (
        select 1
        from public.training_cycle_exercises tce
        join public.training_sessions s
          on s.id = session_id
          and s.user_id = auth.uid()
        where tce.id = training_cycle_exercise_id
          and tce.user_id = auth.uid()
          and tce.deleted_at is null
          and s.cycle_id is not null
          and s.cycle_id = tce.cycle_id
          and (s.cycle_day_id is null or s.cycle_day_id = tce.day_id)
      )
    )
  );

-- Normalizacion explicita de permisos QA.
-- 2.2AP detecto grants amplios existentes en tablas legacy de ejecucion.
revoke all on table public.training_sessions from anon;
revoke all on table public.exercise_entries from anon;
revoke all on table public.training_cycle_routines from anon;
revoke all on table public.training_cycle_days from anon;
revoke all on table public.training_cycle_exercises from anon;

revoke delete, truncate, references, trigger on table public.training_sessions from authenticated;
revoke delete, truncate, references, trigger on table public.exercise_entries from authenticated;
revoke delete, truncate, references, trigger on table public.training_cycle_routines from authenticated;
revoke delete, truncate, references, trigger on table public.training_cycle_days from authenticated;
revoke delete, truncate, references, trigger on table public.training_cycle_exercises from authenticated;

grant select, insert, update on table public.training_cycle_routines to authenticated;
grant select, insert, update on table public.training_cycle_days to authenticated;
grant select, insert, update on table public.training_cycle_exercises to authenticated;
grant select, insert, update on table public.training_cycles to authenticated;
grant select, insert, update on table public.training_sessions to authenticated;
grant select, insert, update on table public.exercise_entries to authenticated;

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
      'source', 'cycle-scoped-qa',
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
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_entry jsonb;
  v_cycle_exercise_id uuid;
  v_legacy_exercise_id uuid;
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
  ) then
    raise exception 'El dia no pertenece al ciclo del usuario';
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

      if nullif(v_entry->>'exercise_id', '') is null then
        raise exception 'Cada entry requiere exercise_id legacy en esta fase';
      end if;

      v_cycle_exercise_id := (v_entry->>'training_cycle_exercise_id')::uuid;
      v_legacy_exercise_id := (v_entry->>'exercise_id')::uuid;

      if not exists (
        select 1
        from public.exercises e
        where e.id = v_legacy_exercise_id
          and e.user_id = v_user_id
      ) then
        raise exception 'El ejercicio legacy no pertenece al usuario';
      end if;

      if not exists (
        select 1
        from public.training_cycle_exercises tce
        where tce.id = v_cycle_exercise_id
          and tce.user_id = v_user_id
          and tce.cycle_id = p_cycle_id
          and tce.day_id = p_cycle_day_id
          and tce.deleted_at is null
          and (
            tce.source_legacy_exercise_id is null
            or tce.source_legacy_exercise_id = v_legacy_exercise_id
          )
      ) then
        raise exception 'El ejercicio planificado no pertenece al ciclo/dia del usuario o no corresponde al ejercicio legacy';
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

-- No se concede delete a authenticated.
-- No se conceden privilegios a anon para el modelo cycle-scoped.
