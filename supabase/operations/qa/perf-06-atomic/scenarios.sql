-- Named, parameterized scenario queries. SAVEPOINT lifecycle and exact SQLSTATE
-- handling live in the native pg runner; this file contains no client metacommands.

-- PERF06_QUERY catalog
select
  to_regprocedure('public.prevent_exercise_identity_change()') is not null
  and to_regprocedure('public.ensure_legacy_exercise_lineage_invariant()') is not null
  and to_regprocedure('public.validate_training_exercise_lineage_identity_update()') is not null
  and to_regclass('public.exercise_entries_session_user_lineage_created_id_idx') is not null
  and (select count(*) from pg_catalog.pg_trigger where tgname in ('exercises_prevent_identity_change', 'exercises_ensure_legacy_lineage', 'training_exercise_lineages_validate_identity_update') and tgenabled = 'O' and not tgisinternal) = 3
  and (select count(*) from pg_catalog.pg_policy where polrelid = 'public.training_exercise_lineages'::regclass) = 3
  and has_table_privilege('authenticated', 'public.training_exercise_lineages', 'SELECT')
  and has_table_privilege('authenticated', 'public.training_exercise_lineages', 'INSERT')
  and not has_table_privilege('authenticated', 'public.training_exercise_lineages', 'DELETE')
  and has_column_privilege('authenticated', 'public.training_exercise_lineages', 'origin_training_cycle_exercise_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.training_exercise_lineages', 'user_id', 'UPDATE')
  as valid;

-- PERF06_QUERY set_actor
select set_config('request.jwt.claim.sub', $1, true);

-- PERF06_QUERY insert_exercise
insert into public.exercises (id, user_id, routine_id, name, target_sets, target_reps, base_weight)
values ($1::uuid, $2::uuid, $3::uuid, $4::text, 1, 1, 0);

-- PERF06_QUERY lineage_for_exercise
select count(*)::integer as lineage_count
from public.training_exercise_lineages
where user_id = $1::uuid and source_legacy_exercise_id = $2::uuid
  and origin_kind = 'legacy' and origin_training_cycle_exercise_id is null;

-- PERF06_QUERY delete_lineage
delete from public.training_exercise_lineages where source_legacy_exercise_id = $1::uuid;

-- PERF06_QUERY touch_exercise
update public.exercises set notes = notes where id = $1::uuid;

-- PERF06_QUERY update_exercise_owner
update public.exercises set user_id = $2::uuid where id = $1::uuid;

-- PERF06_QUERY update_lineage_owner
update public.training_exercise_lineages set user_id = $2::uuid
where source_legacy_exercise_id = $1::uuid;

-- PERF06_QUERY rebind_legacy_lineage
update public.training_exercise_lineages set origin_training_cycle_exercise_id = $2::uuid
where source_legacy_exercise_id = $1::uuid;

-- PERF06_QUERY conflict_legacy_lineage
insert into public.training_exercise_lineages (user_id, source_legacy_exercise_id, origin_kind, metadata)
values ($1::uuid, $2::uuid, 'legacy', '{"fixture":"g-conflict"}'::jsonb)
on conflict (user_id, source_legacy_exercise_id) where source_legacy_exercise_id is not null
do update set updated_at = excluded.updated_at;

-- PERF06_QUERY insert_cycle
insert into public.training_cycles (id, user_id, name, cycle_number, started_at, status)
values ($1::uuid, $2::uuid, $3::text, 999999, now(), 'cancelled');

-- PERF06_QUERY insert_cycle_routine
insert into public.training_cycle_routines (id, user_id, cycle_id, name)
values ($1::uuid, $2::uuid, $3::uuid, $4::text);

-- PERF06_QUERY insert_cycle_day
insert into public.training_cycle_days (id, user_id, cycle_id, routine_id, week_index, day_code)
values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 1, 'monday');

-- PERF06_QUERY insert_scoped_lineage
insert into public.training_exercise_lineages (id, user_id, origin_kind, metadata)
values ($1::uuid, $2::uuid, 'scoped', '{"fixture":"g-scoped"}'::jsonb);

-- PERF06_QUERY insert_cycle_exercise
insert into public.training_cycle_exercises (
  id, user_id, cycle_id, day_id, name, target_sets, target_reps, base_weight, exercise_lineage_id
) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, 1, 1, 0, $6::uuid);

-- PERF06_QUERY bind_scoped_lineage
update public.training_exercise_lineages
set origin_training_cycle_exercise_id = $2::uuid
where id = $1::uuid;

-- PERF06_QUERY verify_scenario_g
select
  (select count(*) from public.training_exercise_lineages where source_legacy_exercise_id = $1::uuid) = 1
  and (select origin_training_cycle_exercise_id from public.training_exercise_lineages where id = $2::uuid) = $3::uuid
  as valid;

-- PERF06_QUERY marker_count
select count(*)::integer as marker_count
from public.training_exercise_lineages
where metadata @> '{"reconciliation":"PERF-06R","source":"migration-history-normalization","version":1}'::jsonb;

-- PERF06_QUERY delete_lineages_for_two
delete from public.training_exercise_lineages
where source_legacy_exercise_id in ($1::uuid, $2::uuid);

-- PERF06_QUERY verify_two_marked
select count(*)::integer as marker_count
from public.training_exercise_lineages
where source_legacy_exercise_id in ($1::uuid, $2::uuid)
  and metadata @> '{"reconciliation":"PERF-06R","source":"migration-history-normalization","version":1}'::jsonb;

-- PERF06_QUERY fixture_absent
select not exists (select 1 from public.exercises where name like '__perf06_fixture_%') as valid;

-- PERF06_QUERY complete_state
select
  (select count(*) from supabase_migrations.schema_migrations) = 24
  and (select coalesce(sum(cardinality(statements)), 0) from supabase_migrations.schema_migrations) = 336
  and (select count(*) from public.exercises exercise where not exists (
    select 1 from public.training_exercise_lineages lineage
    where lineage.user_id = exercise.user_id and lineage.source_legacy_exercise_id = exercise.id
  )) = 0
  and has_function_privilege('authenticated', 'public.save_daily_training_readiness(jsonb)', 'EXECUTE')
  and has_function_privilege('postgres', 'public.save_daily_training_readiness(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.save_daily_training_readiness(jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.save_daily_training_readiness(jsonb)', 'EXECUTE')
  as valid;
