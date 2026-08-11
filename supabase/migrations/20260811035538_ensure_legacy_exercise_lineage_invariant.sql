-- PERF-06R: permanent lineage invariant for legacy exercise writes.
-- Local/QA candidate only. Do not apply to PROD without its separate read-only audit.
--
-- Effective product writes before this migration:
-- - createTrainingExerciseLineage() inserts an allowlisted legacy/scoped lineage;
-- - create_training_cycle_with_plan(), as SECURITY INVOKER, performs a no-op conflict
--   UPDATE of updated_at to recover an existing legacy lineage and the one legitimate
--   identity update: binding a new scoped lineage from a NULL origin to the cycle exercise
--   that already references it.
-- Full UPDATE is not used by product and is removed below. INSERT and the one-column
-- binding remain protected by relational RLS and an immutable-identity trigger.

set local statement_timeout = '15s';
set local lock_timeout = '5s';

-- CREATE TRIGGER also locks the table, but taking the write-conflicting lock first makes
-- the installation boundary explicit: pre-lock commits are handled by the later
-- compensatory migration; post-lock writes can only finish after this trigger exists.
lock table public.exercises in share row exclusive mode;
lock table public.training_exercise_lineages in share row exclusive mode;

drop policy if exists "lineages own rows select" on public.training_exercise_lineages;
drop policy if exists "lineages own rows insert" on public.training_exercise_lineages;
drop policy if exists "lineages own rows update" on public.training_exercise_lineages;

create policy "lineages own rows select"
  on public.training_exercise_lineages
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (
      (
        origin_kind = 'legacy'
        and source_legacy_exercise_id is not null
        and origin_training_cycle_exercise_id is null
        and exists (
          select 1
          from public.exercises e
          where e.id = source_legacy_exercise_id
            and e.user_id = (select auth.uid())
        )
      )
      or
      (
        origin_kind = 'scoped'
        and source_legacy_exercise_id is null
        and (
          origin_training_cycle_exercise_id is null
          or exists (
            select 1
            from public.training_cycle_exercises tce
            where tce.id = origin_training_cycle_exercise_id
              and tce.user_id = (select auth.uid())
              and tce.exercise_lineage_id = training_exercise_lineages.id
          )
        )
      )
    )
  );

create policy "lineages own rows insert"
  on public.training_exercise_lineages
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      (
        origin_kind = 'legacy'
        and source_legacy_exercise_id is not null
        and origin_training_cycle_exercise_id is null
        and exists (
          select 1
          from public.exercises e
          where e.id = source_legacy_exercise_id
            and e.user_id = (select auth.uid())
        )
      )
      or
      (
        origin_kind = 'scoped'
        and source_legacy_exercise_id is null
        and (
          origin_training_cycle_exercise_id is null
          or exists (
            select 1
            from public.training_cycle_exercises tce
            where tce.id = origin_training_cycle_exercise_id
              and tce.user_id = (select auth.uid())
              and tce.exercise_lineage_id = training_exercise_lineages.id
          )
        )
      )
    )
  );

create policy "lineages own rows update"
  on public.training_exercise_lineages
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and (
      (
        origin_kind = 'legacy'
        and source_legacy_exercise_id is not null
        and origin_training_cycle_exercise_id is null
        and exists (
          select 1
          from public.exercises e
          where e.id = source_legacy_exercise_id
            and e.user_id = (select auth.uid())
        )
      )
      or
      (
        origin_kind = 'scoped'
        and source_legacy_exercise_id is null
        and (
          origin_training_cycle_exercise_id is null
          or exists (
            select 1
            from public.training_cycle_exercises tce
            where tce.id = origin_training_cycle_exercise_id
              and tce.user_id = (select auth.uid())
              and tce.exercise_lineage_id = training_exercise_lineages.id
          )
        )
      )
    )
  )
  with check (
    user_id = (select auth.uid())
    and (
      (
        origin_kind = 'legacy'
        and source_legacy_exercise_id is not null
        and origin_training_cycle_exercise_id is null
        and exists (
          select 1
          from public.exercises e
          where e.id = source_legacy_exercise_id
            and e.user_id = (select auth.uid())
        )
      )
      or
      (
        origin_kind = 'scoped'
        and source_legacy_exercise_id is null
        and (
          origin_training_cycle_exercise_id is null
          or exists (
            select 1
            from public.training_cycle_exercises tce
            where tce.id = origin_training_cycle_exercise_id
              and tce.user_id = (select auth.uid())
              and tce.exercise_lineage_id = training_exercise_lineages.id
          )
        )
      )
    )
  );

revoke all on table public.training_exercise_lineages from anon;
revoke all on table public.training_exercise_lineages from authenticated;
grant select, insert on table public.training_exercise_lineages to authenticated;
grant update (origin_training_cycle_exercise_id, updated_at)
  on table public.training_exercise_lineages
  to authenticated;

create function public.validate_training_exercise_lineage_identity_update()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  if new.user_id is distinct from old.user_id
    or new.origin_kind is distinct from old.origin_kind
    or new.source_legacy_exercise_id is distinct from old.source_legacy_exercise_id
  then
    raise exception using
      errcode = '23514',
      message = 'PERF-06R lineage identity fields are immutable';
  end if;

  if new.origin_training_cycle_exercise_id is distinct from old.origin_training_cycle_exercise_id then
    if old.origin_training_cycle_exercise_id is not null
      or new.origin_training_cycle_exercise_id is null
      or new.origin_kind <> 'scoped'
      or not exists (
        select 1
        from public.training_cycle_exercises tce
        where tce.id = new.origin_training_cycle_exercise_id
          and tce.user_id = new.user_id
          and tce.exercise_lineage_id = new.id
      )
    then
      raise exception using
        errcode = '23514',
        message = 'PERF-06R scoped lineage origin binding is incompatible';
    end if;
  end if;

  return new;
end;
$function$;

create trigger training_exercise_lineages_validate_identity_update
  before update on public.training_exercise_lineages
  for each row execute function public.validate_training_exercise_lineage_identity_update();

create function public.ensure_legacy_exercise_lineage_invariant()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_compatible_count bigint;
begin
  if new.user_id is null then
    raise exception using
      errcode = '23502',
      message = 'PERF-06R invariant: exercise user_id is required';
  end if;

  if v_actor_id is null or v_actor_id <> new.user_id then
    raise exception using
      errcode = '42501',
      message = 'PERF-06R invariant: exercise ownership does not match auth.uid()';
  end if;

  if not exists (
    select 1
    from public.routines r
    where r.id = new.routine_id
      and r.user_id = new.user_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'PERF-06R invariant: parent routine is missing or has incompatible ownership';
  end if;

  if exists (
    select 1
    from public.training_exercise_lineages tel
    where tel.source_legacy_exercise_id = new.id
      and (
        tel.user_id <> new.user_id
        or tel.origin_kind <> 'legacy'
        or tel.origin_training_cycle_exercise_id is not null
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'PERF-06R invariant: incompatible lineage exists';
  end if;

  select pg_catalog.count(*)
  into v_compatible_count
  from public.training_exercise_lineages tel
  where tel.user_id = new.user_id
    and tel.source_legacy_exercise_id = new.id
    and tel.origin_kind = 'legacy'
    and tel.origin_training_cycle_exercise_id is null;

  if v_compatible_count = 0 then
    insert into public.training_exercise_lineages (
      user_id,
      source_legacy_exercise_id,
      origin_kind,
      metadata
    )
    values (
      new.user_id,
      new.id,
      'legacy',
      pg_catalog.jsonb_build_object(
        'invariant', 'legacy-exercise-lineage-trigger',
        'version', 1
      )
    )
    on conflict (user_id, source_legacy_exercise_id)
      where source_legacy_exercise_id is not null
    do nothing;
  elsif v_compatible_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'PERF-06R invariant: expected at most one compatible lineage before insert';
  end if;

  select pg_catalog.count(*)
  into v_compatible_count
  from public.training_exercise_lineages tel
  where tel.user_id = new.user_id
    and tel.source_legacy_exercise_id = new.id
    and tel.origin_kind = 'legacy'
    and tel.origin_training_cycle_exercise_id is null;

  if v_compatible_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'PERF-06R invariant: exactly one compatible lineage is required';
  end if;

  return new;
end;
$function$;

-- PostgreSQL checks EXECUTE when CREATE TRIGGER runs. Revoking direct execution after
-- trigger creation keeps it out of the Data API without disabling trigger invocation.
create trigger exercises_ensure_legacy_lineage
  after insert or update on public.exercises
  for each row execute function public.ensure_legacy_exercise_lineage_invariant();

revoke execute on function public.ensure_legacy_exercise_lineage_invariant() from public;
revoke execute on function public.ensure_legacy_exercise_lineage_invariant() from anon;
revoke execute on function public.ensure_legacy_exercise_lineage_invariant() from authenticated;
revoke execute on function public.validate_training_exercise_lineage_identity_update() from public;
revoke execute on function public.validate_training_exercise_lineage_identity_update() from anon;
revoke execute on function public.validate_training_exercise_lineage_identity_update() from authenticated;

-- Atomicity: the AFTER trigger runs inside the original exercise write transaction.
-- If the write rolls back, its lineage INSERT rolls back with it. An UPDATE of an older
-- exercise without lineage runs the same repair and must satisfy the same postcondition.
--
-- Proposed rollback (documentation only; separate authorization required): in one
-- transaction, drop public.exercises.exercises_ensure_legacy_lineage and then drop
-- public.ensure_legacy_exercise_lineage_invariant(). Existing lineage rows are data and
-- must not be removed by the invariant rollback.
