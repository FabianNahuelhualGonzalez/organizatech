-- Fase 2.2AQ - Patch candidato QA para corregir policies cycle-scoped.
-- CANDIDATA LOCAL: no aplicar sin autorizacion explicita.
-- Objetivo:
-- - Evitar comparaciones tautologicas en RLS policies.
-- - Evitar mezcla logica entre ciclos del mismo usuario.
-- - Agregar constraints compuestas para coherencia routine/day/session por cycle_id.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'training_cycle_routines_id_cycle_id_unique'
      and conrelid = 'public.training_cycle_routines'::regclass
  ) then
    alter table public.training_cycle_routines
      add constraint training_cycle_routines_id_cycle_id_unique
      unique (id, cycle_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'training_cycle_days_id_cycle_id_unique'
      and conrelid = 'public.training_cycle_days'::regclass
  ) then
    alter table public.training_cycle_days
      add constraint training_cycle_days_id_cycle_id_unique
      unique (id, cycle_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'training_cycle_days_routine_cycle_fk'
      and conrelid = 'public.training_cycle_days'::regclass
  ) then
    alter table public.training_cycle_days
      add constraint training_cycle_days_routine_cycle_fk
      foreign key (routine_id, cycle_id)
      references public.training_cycle_routines(id, cycle_id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'training_cycle_exercises_day_cycle_fk'
      and conrelid = 'public.training_cycle_exercises'::regclass
  ) then
    alter table public.training_cycle_exercises
      add constraint training_cycle_exercises_day_cycle_fk
      foreign key (day_id, cycle_id)
      references public.training_cycle_days(id, cycle_id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'training_sessions_cycle_day_cycle_fk'
      and conrelid = 'public.training_sessions'::regclass
  ) then
    alter table public.training_sessions
      add constraint training_sessions_cycle_day_cycle_fk
      foreign key (cycle_day_id, cycle_id)
      references public.training_cycle_days(id, cycle_id)
      on delete restrict;
  end if;
end $$;

drop policy if exists "training cycle days select own rows" on public.training_cycle_days;
create policy "training cycle days select own rows" on public.training_cycle_days
  for select
  to authenticated
  using (
    auth.uid() = training_cycle_days.user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = training_cycle_days.cycle_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
    and exists (
      select 1
      from public.training_cycle_routines r
      where r.id = training_cycle_days.routine_id
        and r.cycle_id = training_cycle_days.cycle_id
        and r.user_id = auth.uid()
        and r.deleted_at is null
    )
  );

drop policy if exists "training cycle days insert own rows" on public.training_cycle_days;
create policy "training cycle days insert own rows" on public.training_cycle_days
  for insert
  to authenticated
  with check (
    auth.uid() = training_cycle_days.user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = training_cycle_days.cycle_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
    and exists (
      select 1
      from public.training_cycle_routines r
      where r.id = training_cycle_days.routine_id
        and r.cycle_id = training_cycle_days.cycle_id
        and r.user_id = auth.uid()
        and r.deleted_at is null
    )
  );

drop policy if exists "training cycle days update own rows" on public.training_cycle_days;
create policy "training cycle days update own rows" on public.training_cycle_days
  for update
  to authenticated
  using (
    auth.uid() = training_cycle_days.user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = training_cycle_days.cycle_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
    and exists (
      select 1
      from public.training_cycle_routines r
      where r.id = training_cycle_days.routine_id
        and r.cycle_id = training_cycle_days.cycle_id
        and r.user_id = auth.uid()
        and r.deleted_at is null
    )
  )
  with check (
    auth.uid() = training_cycle_days.user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = training_cycle_days.cycle_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
    and exists (
      select 1
      from public.training_cycle_routines r
      where r.id = training_cycle_days.routine_id
        and r.cycle_id = training_cycle_days.cycle_id
        and r.user_id = auth.uid()
        and r.deleted_at is null
    )
  );

drop policy if exists "training cycle exercises select own rows" on public.training_cycle_exercises;
create policy "training cycle exercises select own rows" on public.training_cycle_exercises
  for select
  to authenticated
  using (
    auth.uid() = training_cycle_exercises.user_id
    and exists (
      select 1
      from public.training_cycle_days d
      where d.id = training_cycle_exercises.day_id
        and d.cycle_id = training_cycle_exercises.cycle_id
        and d.user_id = auth.uid()
        and d.deleted_at is null
    )
  );

drop policy if exists "training cycle exercises insert own rows" on public.training_cycle_exercises;
create policy "training cycle exercises insert own rows" on public.training_cycle_exercises
  for insert
  to authenticated
  with check (
    auth.uid() = training_cycle_exercises.user_id
    and exists (
      select 1
      from public.training_cycle_days d
      where d.id = training_cycle_exercises.day_id
        and d.cycle_id = training_cycle_exercises.cycle_id
        and d.user_id = auth.uid()
        and d.deleted_at is null
    )
  );

drop policy if exists "training cycle exercises update own rows" on public.training_cycle_exercises;
create policy "training cycle exercises update own rows" on public.training_cycle_exercises
  for update
  to authenticated
  using (
    auth.uid() = training_cycle_exercises.user_id
    and exists (
      select 1
      from public.training_cycle_days d
      where d.id = training_cycle_exercises.day_id
        and d.cycle_id = training_cycle_exercises.cycle_id
        and d.user_id = auth.uid()
        and d.deleted_at is null
    )
  )
  with check (
    auth.uid() = training_cycle_exercises.user_id
    and exists (
      select 1
      from public.training_cycle_days d
      where d.id = training_cycle_exercises.day_id
        and d.cycle_id = training_cycle_exercises.cycle_id
        and d.user_id = auth.uid()
        and d.deleted_at is null
    )
  );

drop policy if exists "sessions own rows" on public.training_sessions;
create policy "sessions own rows" on public.training_sessions
  for all
  to authenticated
  using (
    auth.uid() = training_sessions.user_id
    and (
      (
        training_sessions.cycle_id is null
        and training_sessions.cycle_day_id is null
      )
      or (
        training_sessions.cycle_id is not null
        and training_sessions.cycle_day_id is not null
        and exists (
          select 1
          from public.training_cycles c
          where c.id = training_sessions.cycle_id
            and c.user_id = auth.uid()
            and c.deleted_at is null
        )
        and exists (
          select 1
          from public.training_cycle_days d
          where d.id = training_sessions.cycle_day_id
            and d.cycle_id = training_sessions.cycle_id
            and d.user_id = auth.uid()
            and d.deleted_at is null
        )
      )
    )
  )
  with check (
    auth.uid() = training_sessions.user_id
    and (
      (
        training_sessions.cycle_id is null
        and training_sessions.cycle_day_id is null
      )
      or (
        training_sessions.cycle_id is not null
        and training_sessions.cycle_day_id is not null
        and exists (
          select 1
          from public.training_cycles c
          where c.id = training_sessions.cycle_id
            and c.user_id = auth.uid()
            and c.deleted_at is null
        )
        and exists (
          select 1
          from public.training_cycle_days d
          where d.id = training_sessions.cycle_day_id
            and d.cycle_id = training_sessions.cycle_id
            and d.user_id = auth.uid()
            and d.deleted_at is null
        )
      )
    )
  );

drop policy if exists "entries own rows" on public.exercise_entries;
create policy "entries own rows" on public.exercise_entries
  for all
  to authenticated
  using (
    auth.uid() = exercise_entries.user_id
    and exists (
      select 1
      from public.training_sessions s
      where s.id = exercise_entries.session_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.exercises e
      where e.id = exercise_entries.exercise_id
        and e.user_id = auth.uid()
    )
    and (
      exercise_entries.training_cycle_exercise_id is null
      or exists (
        select 1
        from public.training_sessions s
        join public.training_cycle_exercises tce
          on tce.id = exercise_entries.training_cycle_exercise_id
        where s.id = exercise_entries.session_id
          and s.user_id = auth.uid()
          and s.cycle_id is not null
          and s.cycle_day_id is not null
          and s.cycle_id = tce.cycle_id
          and s.cycle_day_id = tce.day_id
          and tce.user_id = auth.uid()
          and tce.deleted_at is null
          and (
            tce.source_legacy_exercise_id is null
            or tce.source_legacy_exercise_id = exercise_entries.exercise_id
          )
      )
    )
  )
  with check (
    auth.uid() = exercise_entries.user_id
    and exists (
      select 1
      from public.training_sessions s
      where s.id = exercise_entries.session_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.exercises e
      where e.id = exercise_entries.exercise_id
        and e.user_id = auth.uid()
    )
    and (
      exercise_entries.training_cycle_exercise_id is null
      or exists (
        select 1
        from public.training_sessions s
        join public.training_cycle_exercises tce
          on tce.id = exercise_entries.training_cycle_exercise_id
        where s.id = exercise_entries.session_id
          and s.user_id = auth.uid()
          and s.cycle_id is not null
          and s.cycle_day_id is not null
          and s.cycle_id = tce.cycle_id
          and s.cycle_day_id = tce.day_id
          and tce.user_id = auth.uid()
          and tce.deleted_at is null
          and (
            tce.source_legacy_exercise_id is null
            or tce.source_legacy_exercise_id = exercise_entries.exercise_id
          )
      )
    )
  );
