-- PERF-06R: reconcile legacy exercises created before the permanent lineage invariant.
-- Local/QA candidate only. A separate read-only PROD audit is mandatory before merge.
-- The invariant migration must commit before this migration can begin.

set local statement_timeout = '15s';
set local lock_timeout = '5s';

do $perf_06r$
declare
  v_invariant_count bigint;
  v_pending_count bigint;
  v_inserted_count bigint := 0;
begin
  -- Stabilize exercise writes and every relation used below before trusting catalog or data.
  lock table public.exercises in share row exclusive mode;
  lock table
    public.routines,
    public.exercise_entries,
    public.training_cycle_exercises,
    public.training_exercise_lineages
  in share row exclusive mode;

  select pg_catalog.count(*)
  into v_invariant_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_trigger t on t.tgfoid = p.oid
  where n.nspname = 'public'
    and p.proname = 'ensure_legacy_exercise_lineage_invariant'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
    and p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
    and p.prosecdef is false
    and p.proconfig = array['search_path=pg_catalog']::pg_catalog.text[]
    and t.tgname = 'exercises_ensure_legacy_lineage'
    and t.tgrelid = 'public.exercises'::pg_catalog.regclass
    and t.tgtype = 21
    and t.tgenabled = 'O'
    and t.tgisinternal is false;

  if v_invariant_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'PERF-06R aborted: required lineage invariant is not installed and enabled';
  end if;

  if exists (
    select 1
    from public.training_exercise_lineages tel
    join public.exercises e
      on e.id = tel.source_legacy_exercise_id
    where tel.user_id <> e.user_id
       or tel.origin_kind <> 'legacy'
       or tel.origin_training_cycle_exercise_id is not null
  ) then
    raise exception using
      errcode = '23514',
      message = 'PERF-06R aborted: incompatible legacy lineage exists';
  end if;

  select pg_catalog.count(*)
  into v_pending_count
  from public.exercises e
  where not exists (
    select 1
    from public.training_exercise_lineages tel
    where tel.user_id = e.user_id
      and tel.source_legacy_exercise_id = e.id
  );

  -- Fail closed: only a fully reconciled database or the audited two-row drift is accepted.
  if v_pending_count not in (0, 2) then
    raise exception using
      errcode = '23514',
      message = pg_catalog.format(
        'PERF-06R aborted: expected 0 or 2 legacy exercises without lineage, found %s',
        v_pending_count
      );
  end if;

  if exists (
    select 1
    from public.exercises e
    where not exists (
      select 1
      from public.training_exercise_lineages tel
      where tel.user_id = e.user_id
        and tel.source_legacy_exercise_id = e.id
    )
      and not exists (
        select 1
        from auth.users u
        where u.id = e.user_id
      )
  ) then
    raise exception using
      errcode = '23503',
      message = 'PERF-06R aborted: owner user does not exist';
  end if;

  if exists (
    select 1
    from public.exercises e
    where not exists (
      select 1
      from public.training_exercise_lineages tel
      where tel.user_id = e.user_id
        and tel.source_legacy_exercise_id = e.id
    )
      and not exists (
        select 1
        from public.routines r
        where r.id = e.routine_id
      )
  ) then
    raise exception using
      errcode = '23503',
      message = 'PERF-06R aborted: parent routine does not exist';
  end if;

  if exists (
    select 1
    from public.exercises e
    join public.routines r on r.id = e.routine_id
    where not exists (
      select 1
      from public.training_exercise_lineages tel
      where tel.user_id = e.user_id
        and tel.source_legacy_exercise_id = e.id
    )
      and r.user_id <> e.user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'PERF-06R aborted: routine and exercise ownership differ';
  end if;

  if exists (
    select 1
    from public.exercises e
    join public.exercise_entries ee on ee.exercise_id = e.id
    where not exists (
      select 1
      from public.training_exercise_lineages tel
      where tel.user_id = e.user_id
        and tel.source_legacy_exercise_id = e.id
    )
  ) then
    raise exception using
      errcode = '23503',
      message = 'PERF-06R aborted: pending exercise has entry references';
  end if;

  if exists (
    select 1
    from public.exercises e
    join public.training_cycle_exercises tce
      on tce.source_legacy_exercise_id = e.id
    where not exists (
      select 1
      from public.training_exercise_lineages tel
      where tel.user_id = e.user_id
        and tel.source_legacy_exercise_id = e.id
    )
  ) then
    raise exception using
      errcode = '23503',
      message = 'PERF-06R aborted: pending exercise has cycle exercise references';
  end if;

  if v_pending_count = 2 then
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
      pg_catalog.jsonb_build_object(
        'reconciliation', 'PERF-06R',
        'source', 'migration-history-normalization',
        'version', 1
      )
    from public.exercises e
    where not exists (
      select 1
      from public.training_exercise_lineages tel
      where tel.user_id = e.user_id
        and tel.source_legacy_exercise_id = e.id
    )
    on conflict (user_id, source_legacy_exercise_id)
      where source_legacy_exercise_id is not null
    do nothing;

    get diagnostics v_inserted_count = row_count;
    if v_inserted_count <> 2 then
      raise exception using
        errcode = '23514',
        message = pg_catalog.format(
          'PERF-06R aborted: expected to insert 2 legacy lineages, inserted %s',
          v_inserted_count
        );
    end if;
  end if;

  if exists (
    select 1
    from public.exercises e
    where not exists (
      select 1
      from public.training_exercise_lineages tel
      where tel.user_id = e.user_id
        and tel.source_legacy_exercise_id = e.id
        and tel.origin_kind = 'legacy'
        and tel.origin_training_cycle_exercise_id is null
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'PERF-06R aborted: legacy exercises remain without compatible lineage';
  end if;
end;
$perf_06r$;

-- Proposed rollback (documentation only; never automatic): after a separate audit confirms
-- that no entry or cycle exercise references the inserted lineages, remove only rows whose
-- metadata marker exactly matches reconciliation=PERF-06R, source=migration-history-normalization,
-- version=1. Any rollback requires separate authorization and must preserve pre-existing rows.
