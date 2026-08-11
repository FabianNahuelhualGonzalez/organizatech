-- PERF-06C: evaluate auth.uid() once per statement through a PostgreSQL initplan.
-- ALTER POLICY preserves each policy name, command, role list and permissive mode.

alter policy "profiles own rows" on public.profiles
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

alter policy "routines own rows" on public.routines
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "exercises own rows" on public.exercises
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.routines r
      where r.id = routine_id
        and r.user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.routines r
      where r.id = routine_id
        and r.user_id = (select auth.uid())
    )
  );

alter policy "training cycles select own rows" on public.training_cycles
  using ((select auth.uid()) = user_id);

alter policy "training cycles insert own rows" on public.training_cycles
  with check ((select auth.uid()) = user_id);

alter policy "training cycles update own rows" on public.training_cycles
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "training cycle routines select own rows" on public.training_cycle_routines
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = (select auth.uid())
        and c.deleted_at is null
    )
  );

alter policy "training cycle routines insert own rows" on public.training_cycle_routines
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = (select auth.uid())
        and c.deleted_at is null
    )
  );

alter policy "training cycle routines update own rows" on public.training_cycle_routines
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = (select auth.uid())
        and c.deleted_at is null
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = (select auth.uid())
        and c.deleted_at is null
    )
  );

alter policy "training cycle days select own rows" on public.training_cycle_days
  using (
    (select auth.uid()) = training_cycle_days.user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = training_cycle_days.cycle_id
        and c.user_id = (select auth.uid())
        and c.deleted_at is null
    )
    and exists (
      select 1
      from public.training_cycle_routines r
      where r.id = training_cycle_days.routine_id
        and r.cycle_id = training_cycle_days.cycle_id
        and r.user_id = (select auth.uid())
        and r.deleted_at is null
    )
  );

alter policy "training cycle days insert own rows" on public.training_cycle_days
  with check (
    (select auth.uid()) = training_cycle_days.user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = training_cycle_days.cycle_id
        and c.user_id = (select auth.uid())
        and c.deleted_at is null
    )
    and exists (
      select 1
      from public.training_cycle_routines r
      where r.id = training_cycle_days.routine_id
        and r.cycle_id = training_cycle_days.cycle_id
        and r.user_id = (select auth.uid())
        and r.deleted_at is null
    )
  );

alter policy "training cycle days update own rows" on public.training_cycle_days
  using (
    (select auth.uid()) = training_cycle_days.user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = training_cycle_days.cycle_id
        and c.user_id = (select auth.uid())
        and c.deleted_at is null
    )
    and exists (
      select 1
      from public.training_cycle_routines r
      where r.id = training_cycle_days.routine_id
        and r.cycle_id = training_cycle_days.cycle_id
        and r.user_id = (select auth.uid())
        and r.deleted_at is null
    )
  )
  with check (
    (select auth.uid()) = training_cycle_days.user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = training_cycle_days.cycle_id
        and c.user_id = (select auth.uid())
        and c.deleted_at is null
    )
    and exists (
      select 1
      from public.training_cycle_routines r
      where r.id = training_cycle_days.routine_id
        and r.cycle_id = training_cycle_days.cycle_id
        and r.user_id = (select auth.uid())
        and r.deleted_at is null
    )
  );

alter policy "training cycle exercises select own rows" on public.training_cycle_exercises
  using (
    (select auth.uid()) = training_cycle_exercises.user_id
    and exists (
      select 1
      from public.training_cycle_days d
      where d.id = training_cycle_exercises.day_id
        and d.cycle_id = training_cycle_exercises.cycle_id
        and d.user_id = (select auth.uid())
        and d.deleted_at is null
    )
  );

alter policy "training cycle exercises insert own rows" on public.training_cycle_exercises
  with check (
    (select auth.uid()) = training_cycle_exercises.user_id
    and exists (
      select 1
      from public.training_cycle_days d
      where d.id = training_cycle_exercises.day_id
        and d.cycle_id = training_cycle_exercises.cycle_id
        and d.user_id = (select auth.uid())
        and d.deleted_at is null
    )
  );

alter policy "training cycle exercises update own rows" on public.training_cycle_exercises
  using (
    (select auth.uid()) = training_cycle_exercises.user_id
    and exists (
      select 1
      from public.training_cycle_days d
      where d.id = training_cycle_exercises.day_id
        and d.cycle_id = training_cycle_exercises.cycle_id
        and d.user_id = (select auth.uid())
        and d.deleted_at is null
    )
  )
  with check (
    (select auth.uid()) = training_cycle_exercises.user_id
    and exists (
      select 1
      from public.training_cycle_days d
      where d.id = training_cycle_exercises.day_id
        and d.cycle_id = training_cycle_exercises.cycle_id
        and d.user_id = (select auth.uid())
        and d.deleted_at is null
    )
  );

alter policy "sessions own rows" on public.training_sessions
  using (
    (select auth.uid()) = training_sessions.user_id
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
            and c.user_id = (select auth.uid())
            and c.deleted_at is null
        )
        and exists (
          select 1
          from public.training_cycle_days d
          where d.id = training_sessions.cycle_day_id
            and d.cycle_id = training_sessions.cycle_id
            and d.user_id = (select auth.uid())
            and d.deleted_at is null
        )
      )
    )
  )
  with check (
    (select auth.uid()) = training_sessions.user_id
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
            and c.user_id = (select auth.uid())
            and c.deleted_at is null
        )
        and exists (
          select 1
          from public.training_cycle_days d
          where d.id = training_sessions.cycle_day_id
            and d.cycle_id = training_sessions.cycle_id
            and d.user_id = (select auth.uid())
            and d.deleted_at is null
        )
      )
    )
  );

alter policy "entries own rows" on public.exercise_entries
  using (
    (select auth.uid()) = exercise_entries.user_id
    and exists (
      select 1
      from public.training_sessions s
      where s.id = exercise_entries.session_id
        and s.user_id = (select auth.uid())
        and (
          (
            s.cycle_id is null
            and s.cycle_day_id is null
            and exercise_entries.training_cycle_exercise_id is null
            and exercise_entries.exercise_id is not null
            and exists (
              select 1
              from public.exercises e
              where e.id = exercise_entries.exercise_id
                and e.user_id = (select auth.uid())
            )
          )
          or
          (
            s.cycle_id is not null
            and s.cycle_day_id is not null
            and exercise_entries.training_cycle_exercise_id is not null
            and exists (
              select 1
              from public.training_cycle_exercises tce
              where tce.id = exercise_entries.training_cycle_exercise_id
                and tce.user_id = (select auth.uid())
                and tce.cycle_id = s.cycle_id
                and tce.day_id = s.cycle_day_id
                and tce.deleted_at is null
                and (
                  exercise_entries.exercise_id is null
                  or (
                    tce.source_legacy_exercise_id = exercise_entries.exercise_id
                    and exists (
                      select 1
                      from public.exercises e
                      where e.id = exercise_entries.exercise_id
                        and e.user_id = (select auth.uid())
                    )
                  )
                )
            )
          )
        )
    )
  )
  with check (
    (select auth.uid()) = exercise_entries.user_id
    and exists (
      select 1
      from public.training_sessions s
      where s.id = exercise_entries.session_id
        and s.user_id = (select auth.uid())
        and (
          (
            s.cycle_id is null
            and s.cycle_day_id is null
            and exercise_entries.training_cycle_exercise_id is null
            and exercise_entries.exercise_id is not null
            and exists (
              select 1
              from public.exercises e
              where e.id = exercise_entries.exercise_id
                and e.user_id = (select auth.uid())
            )
          )
          or
          (
            s.cycle_id is not null
            and s.cycle_day_id is not null
            and exercise_entries.training_cycle_exercise_id is not null
            and exists (
              select 1
              from public.training_cycle_exercises tce
              where tce.id = exercise_entries.training_cycle_exercise_id
                and tce.user_id = (select auth.uid())
                and tce.cycle_id = s.cycle_id
                and tce.day_id = s.cycle_day_id
                and tce.deleted_at is null
                and (
                  exercise_entries.exercise_id is null
                  or (
                    tce.source_legacy_exercise_id = exercise_entries.exercise_id
                    and exists (
                      select 1
                      from public.exercises e
                      where e.id = exercise_entries.exercise_id
                        and e.user_id = (select auth.uid())
                    )
                  )
                )
            )
          )
        )
    )
  );

alter policy "daily readiness own select" on public.training_daily_readiness
  using ((select auth.uid()) = user_id);

alter policy "lineages own rows select" on public.training_exercise_lineages
  using (user_id = (select auth.uid()));

alter policy "lineages own rows insert" on public.training_exercise_lineages
  with check (user_id = (select auth.uid()));

alter policy "lineages own rows update" on public.training_exercise_lineages
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "workout readiness own select" on public.training_workout_readiness
  using ((select auth.uid()) = user_id);
