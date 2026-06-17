-- Fase 2.2CQ: stable cross-cycle exercise lineage.
-- This migration is a local candidate. Do not apply to QA/Production without a separate gate.

create table if not exists public.training_exercise_lineages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_legacy_exercise_id uuid null references public.exercises(id) on delete set null,
  origin_kind text not null default 'scoped'
    check (origin_kind in ('legacy', 'scoped')),
  origin_training_cycle_exercise_id uuid null references public.training_cycle_exercises(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_exercise_lineages_user_id_id_key unique (user_id, id)
);

create unique index if not exists training_exercise_lineages_user_legacy_unique_idx
  on public.training_exercise_lineages (user_id, source_legacy_exercise_id)
  where source_legacy_exercise_id is not null;

create unique index if not exists training_exercise_lineages_user_origin_cycle_exercise_unique_idx
  on public.training_exercise_lineages (user_id, origin_training_cycle_exercise_id)
  where origin_training_cycle_exercise_id is not null;

create index if not exists training_exercise_lineages_user_idx
  on public.training_exercise_lineages (user_id);

drop trigger if exists set_training_exercise_lineages_updated_at on public.training_exercise_lineages;
create trigger set_training_exercise_lineages_updated_at
  before update on public.training_exercise_lineages
  for each row execute function public.set_updated_at();

alter table public.training_cycle_exercises
  add column if not exists exercise_lineage_id uuid null;

alter table public.exercise_entries
  add column if not exists exercise_lineage_id uuid null;

insert into public.training_exercise_lineages (
  user_id,
  source_legacy_exercise_id,
  origin_kind,
  metadata
)
select
  e.user_id,
  e.id,
  'legacy',
  jsonb_build_object('backfill', 'legacy_exercise')
from public.exercises e
on conflict (user_id, source_legacy_exercise_id)
  where source_legacy_exercise_id is not null
do nothing;

update public.training_cycle_exercises tce
set exercise_lineage_id = tel.id
from public.training_exercise_lineages tel
where tce.exercise_lineage_id is null
  and tce.source_legacy_exercise_id is not null
  and tel.user_id = tce.user_id
  and tel.source_legacy_exercise_id = tce.source_legacy_exercise_id;

insert into public.training_exercise_lineages (
  user_id,
  origin_kind,
  origin_training_cycle_exercise_id,
  metadata
)
select
  tce.user_id,
  'scoped',
  tce.id,
  jsonb_build_object('backfill', 'training_cycle_exercise')
from public.training_cycle_exercises tce
where tce.exercise_lineage_id is null
  and tce.deleted_at is null
on conflict (user_id, origin_training_cycle_exercise_id)
  where origin_training_cycle_exercise_id is not null
do nothing;

update public.training_cycle_exercises tce
set exercise_lineage_id = tel.id
from public.training_exercise_lineages tel
where tce.exercise_lineage_id is null
  and tel.user_id = tce.user_id
  and tel.origin_training_cycle_exercise_id = tce.id;

update public.exercise_entries ee
set exercise_lineage_id = tce.exercise_lineage_id
from public.training_cycle_exercises tce
where ee.exercise_lineage_id is null
  and ee.training_cycle_exercise_id = tce.id
  and ee.user_id = tce.user_id
  and tce.exercise_lineage_id is not null;

update public.exercise_entries ee
set exercise_lineage_id = tel.id
from public.training_exercise_lineages tel
where ee.exercise_lineage_id is null
  and ee.exercise_id is not null
  and tel.user_id = ee.user_id
  and tel.source_legacy_exercise_id = ee.exercise_id;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'training_cycle_exercises_exercise_lineage_user_fk'
      and conrelid = 'public.training_cycle_exercises'::regclass
  ) then
    alter table public.training_cycle_exercises
      add constraint training_cycle_exercises_exercise_lineage_user_fk
      foreign key (user_id, exercise_lineage_id)
      references public.training_exercise_lineages (user_id, id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'exercise_entries_exercise_lineage_user_fk'
      and conrelid = 'public.exercise_entries'::regclass
  ) then
    alter table public.exercise_entries
      add constraint exercise_entries_exercise_lineage_user_fk
      foreign key (user_id, exercise_lineage_id)
      references public.training_exercise_lineages (user_id, id)
      on delete restrict;
  end if;
end $$;

create index if not exists training_cycle_exercises_user_lineage_idx
  on public.training_cycle_exercises (user_id, exercise_lineage_id)
  where exercise_lineage_id is not null and deleted_at is null;

create index if not exists exercise_entries_user_lineage_created_idx
  on public.exercise_entries (user_id, exercise_lineage_id, created_at desc)
  where exercise_lineage_id is not null;

alter table public.training_exercise_lineages enable row level security;

drop policy if exists "lineages own rows select" on public.training_exercise_lineages;
drop policy if exists "lineages own rows insert" on public.training_exercise_lineages;
drop policy if exists "lineages own rows update" on public.training_exercise_lineages;

create policy "lineages own rows select"
  on public.training_exercise_lineages
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "lineages own rows insert"
  on public.training_exercise_lineages
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "lineages own rows update"
  on public.training_exercise_lineages
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on table public.training_exercise_lineages from anon;
revoke all on table public.training_exercise_lineages from authenticated;
grant select, insert, update on table public.training_exercise_lineages to authenticated;

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
  v_source_legacy_exercise_id uuid;
  v_exercise_lineage_id uuid;
  v_new_cycle_exercise_id uuid;
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

        v_source_legacy_exercise_id := nullif(v_exercise->>'source_legacy_exercise_id', '')::uuid;
        v_exercise_lineage_id := nullif(v_exercise->>'exercise_lineage_id', '')::uuid;

        if v_source_legacy_exercise_id is not null and not exists (
          select 1
          from public.exercises e
          where e.id = v_source_legacy_exercise_id
            and e.user_id = v_user_id
        ) then
          raise exception 'El ejercicio legacy no pertenece al usuario';
        end if;

        if v_exercise_lineage_id is not null and not exists (
          select 1
          from public.training_exercise_lineages tel
          where tel.id = v_exercise_lineage_id
            and tel.user_id = v_user_id
            and (
              v_source_legacy_exercise_id is null
              or tel.source_legacy_exercise_id is null
              or tel.source_legacy_exercise_id = v_source_legacy_exercise_id
            )
        ) then
          raise exception 'La identidad historica del ejercicio no pertenece al usuario';
        end if;

        if v_exercise_lineage_id is null and v_source_legacy_exercise_id is not null then
          insert into public.training_exercise_lineages (
            user_id,
            source_legacy_exercise_id,
            origin_kind,
            metadata
          )
          values (
            v_user_id,
            v_source_legacy_exercise_id,
            'legacy',
            jsonb_build_object('source', 'create_training_cycle_with_plan')
          )
          on conflict (user_id, source_legacy_exercise_id)
            where source_legacy_exercise_id is not null
          do update set updated_at = public.training_exercise_lineages.updated_at
          returning id into v_exercise_lineage_id;
        end if;

        if v_exercise_lineage_id is null then
          insert into public.training_exercise_lineages (
            user_id,
            origin_kind,
            metadata
          )
          values (
            v_user_id,
            'scoped',
            jsonb_build_object('source', 'create_training_cycle_with_plan')
          )
          returning id into v_exercise_lineage_id;
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
          v_source_legacy_exercise_id,
          v_exercise_lineage_id
        )
        returning id into v_new_cycle_exercise_id;

        update public.training_exercise_lineages
        set origin_training_cycle_exercise_id = coalesce(origin_training_cycle_exercise_id, v_new_cycle_exercise_id)
        where id = v_exercise_lineage_id
          and user_id = v_user_id
          and origin_kind = 'scoped';
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
$$;

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

-- Suggested read-only prechecks before any remote execution:
-- select to_regclass('public.training_exercise_lineages') as lineage_table;
-- select count(*) filter (where exercise_lineage_id is null) as tce_without_lineage from public.training_cycle_exercises where deleted_at is null;
-- select count(*) filter (where exercise_lineage_id is null) as entries_without_lineage from public.exercise_entries;
-- select count(*) from public.exercise_entries where training_cycle_exercise_id is not null and exercise_lineage_id is null;

-- Suggested read-only postchecks after a separately authorized execution:
-- select to_regclass('public.training_exercise_lineages') as lineage_table;
-- select column_name from information_schema.columns where table_schema = 'public' and table_name in ('training_cycle_exercises', 'exercise_entries') and column_name = 'exercise_lineage_id';
-- select policyname, cmd, roles from pg_policies where schemaname = 'public' and tablename = 'training_exercise_lineages';
-- select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'training_exercise_lineages' order by grantee, privilege_type;
-- select count(*) from public.training_cycle_exercises where deleted_at is null and exercise_lineage_id is null;
-- select count(*) from public.exercise_entries where (training_cycle_exercise_id is not null or exercise_id is not null) and exercise_lineage_id is null;

-- Rollback note:
-- Do not drop lineage columns after entries are created with exercise_lineage_id unless a forward-fix or explicitly
-- authorized cleanup plan preserves historical identity. A safe rollback first restores previous RPC definitions,
-- then revokes lineage table grants, and only then evaluates whether new lineage-only rows can be removed.
