-- Named, single-statement queries consumed sequentially by the native pg runner.
-- The runner parses only exact `PERF06_QUERY` headers. Values use pg parameters.

-- PERF06_QUERY identity
select
  current_user::text as current_user,
  session_user::text as session_user,
  current_setting('transaction_isolation') as isolation_level,
  current_setting('transaction_read_only') as read_only,
  current_setting('server_version_num')::integer as server_version_num,
  current_database() as database_name,
  coalesce((select ssl from pg_catalog.pg_stat_ssl where pid = pg_catalog.pg_backend_pid()), false) as tls_active;

-- PERF06_QUERY partial_application
select
  to_regclass('supabase_migrations.schema_migrations') is null as history_absent,
  to_regprocedure('public.prevent_exercise_identity_change()') is null as identity_function_absent,
  to_regprocedure('public.ensure_legacy_exercise_lineage_invariant()') is null as invariant_function_absent,
  to_regprocedure('public.validate_training_exercise_lineage_identity_update()') is null as lineage_function_absent,
  to_regclass('public.exercise_entries_session_user_lineage_created_id_idx') is null as perf_index_absent,
  not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname in (
      'exercises_prevent_identity_change',
      'exercises_ensure_legacy_lineage',
      'training_exercise_lineages_validate_identity_update'
    ) and not tgisinternal
  ) as perf_triggers_absent;

-- PERF06_QUERY lineage_counts
select
  count(*) filter (where not exists (
    select 1 from public.training_exercise_lineages lineage
    where lineage.user_id = exercise.user_id
      and lineage.source_legacy_exercise_id = exercise.id
  ))::integer as pending,
  count(*)::integer as exercise_count
from public.exercises exercise;

-- PERF06_QUERY marker_count
select count(*)::integer as marker_count
from public.training_exercise_lineages
where metadata @> '{"reconciliation":"PERF-06R","source":"migration-history-normalization","version":1}'::jsonb;

-- PERF06_QUERY incompatible_lineages
select count(*)::integer as incompatible_count
from public.training_exercise_lineages lineage
join public.exercises exercise on exercise.id = lineage.source_legacy_exercise_id
where lineage.user_id <> exercise.user_id
   or lineage.origin_kind <> 'legacy'
   or lineage.origin_training_cycle_exercise_id is not null;

-- PERF06_QUERY fixture_identity
select exercise.user_id::text as owner_id, exercise.routine_id::text as routine_id
from public.exercises exercise
join auth.users app_user on app_user.id = exercise.user_id
join public.routines routine on routine.id = exercise.routine_id and routine.user_id = exercise.user_id
order by exercise.id
limit 1;

-- PERF06_QUERY diagnostic_exists
select to_regclass('public.training_session_consolidation_audit') is not null as diagnostic_exists;

-- PERF06_QUERY diagnostic_count
select count(*)::integer as diagnostic_count from public.training_session_consolidation_audit;

-- PERF06_QUERY diagnostic_hash
with diagnostic_lines as (
  select 'relation|' || relation.relkind::text || '|' || relation.relrowsecurity::text || '|' || relation.relforcerowsecurity::text || '|' || coalesce(relation.relacl::text, '') as line
  from pg_catalog.pg_class relation
  where relation.oid = 'public.training_session_consolidation_audit'::regclass
  union all
  select 'column|' || attribute.attnum::text || '|' || attribute.attname || '|' || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) || '|' || attribute.attnotnull::text || '|' || coalesce(pg_catalog.pg_get_expr(attribute_default.adbin, attribute_default.adrelid, true), '')
  from pg_catalog.pg_attribute attribute
  left join pg_catalog.pg_attrdef attribute_default on attribute_default.adrelid = attribute.attrelid and attribute_default.adnum = attribute.attnum
  where attribute.attrelid = 'public.training_session_consolidation_audit'::regclass and attribute.attnum > 0 and not attribute.attisdropped
  union all
  select 'constraint|' || constraint_row.conname || '|' || pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.training_session_consolidation_audit'::regclass
  union all
  select 'index|' || relation.relname || '|' || pg_catalog.pg_get_indexdef(relation.oid)
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class relation on relation.oid = index_row.indexrelid
  where index_row.indrelid = 'public.training_session_consolidation_audit'::regclass
)
select encode(sha256(convert_to(string_agg(line, E'\n' order by line), 'UTF8')), 'hex') as diagnostic_hash
from diagnostic_lines;

-- PERF06_QUERY diagnostic_consumers
select count(*)::integer as consumer_count
from pg_catalog.pg_depend dependency
join pg_catalog.pg_rewrite rewrite_row on dependency.classid = 'pg_catalog.pg_rewrite'::regclass and rewrite_row.oid = dependency.objid
join pg_catalog.pg_class dependent on dependent.oid = rewrite_row.ev_class
where dependency.refobjid = 'public.training_session_consolidation_audit'::regclass
  and dependent.oid <> dependency.refobjid;

-- PERF06_QUERY data_counts
select jsonb_build_object(
  'exercise_entries', (select count(*) from public.exercise_entries),
  'exercises', (select count(*) from public.exercises),
  'profiles', (select count(*) from public.profiles),
  'routines', (select count(*) from public.routines),
  'training_cycle_days', (select count(*) from public.training_cycle_days),
  'training_cycle_exercises', (select count(*) from public.training_cycle_exercises),
  'training_cycle_routines', (select count(*) from public.training_cycle_routines),
  'training_cycles', (select count(*) from public.training_cycles),
  'training_daily_readiness', (select count(*) from public.training_daily_readiness),
  'training_exercise_lineages', (select count(*) from public.training_exercise_lineages),
  'training_sessions', (select count(*) from public.training_sessions),
  'training_workout_readiness', (select count(*) from public.training_workout_readiness)
) as counts;

-- PERF06_QUERY lock_diagnostic
lock table public.training_session_consolidation_audit in share mode;

-- PERF06_QUERY lock_auth_users
lock table auth.users in share mode;

-- PERF06_QUERY lock_exercises
lock table public.exercises in share row exclusive mode;

-- PERF06_QUERY lock_dependents
lock table public.routines, public.exercise_entries, public.training_cycle_exercises, public.training_exercise_lineages in share row exclusive mode;
