-- Named postcheck queries consumed by the native pg runner.

-- PERF06_QUERY history
select version, name, statements
from supabase_migrations.schema_migrations
order by version;

-- PERF06_QUERY lineage_state
select
  (select count(*) from public.exercises exercise where not exists (
    select 1 from public.training_exercise_lineages lineage
    where lineage.user_id = exercise.user_id
      and lineage.source_legacy_exercise_id = exercise.id
      and lineage.origin_kind = 'legacy'
      and lineage.origin_training_cycle_exercise_id is null
  ))::integer as pending,
  (select count(*) from public.training_exercise_lineages
   where metadata @> '{"reconciliation":"PERF-06R","source":"migration-history-normalization","version":1}'::jsonb
  )::integer as markers;

-- PERF06_QUERY fixtures
select
  not exists (select 1 from public.exercises where name like '__perf06_fixture_%')
  and not exists (select 1 from public.routines where name like '__perf06_fixture_%')
  and not exists (select 1 from public.training_cycles where name like '__perf06_fixture_%')
  and not exists (select 1 from public.training_cycle_routines where name like '__perf06_fixture_%')
  and not exists (select 1 from public.training_cycle_exercises where name like '__perf06_fixture_%')
  and not exists (select 1 from public.training_exercise_lineages where metadata ? 'fixture')
  as valid;

-- PERF06_QUERY diagnostic
select to_regclass('public.training_session_consolidation_audit') is not null as present,
       (select count(*) from public.training_session_consolidation_audit)::integer as row_count;
