-- ORGANIZATECH PERF-06 — PRODUCCIÓN — PREFLIGHT READ-ONLY

-- DESTINO EXCLUSIVO: organizatech PROD (lzycxltqbrtsnwfdotqw).

-- Confirma visualmente nombre y project ref antes de pulsar Run.

-- No aplica migraciones, no crea objetos, no modifica datos y no usa service_role.

-- Si el resultado no es PASS_READY_FOR_PROD_BUNDLE_DESIGN, detente y no reintentes.



begin isolation level repeatable read read only;

set local statement_timeout = '20s';

set local lock_timeout = '3s';

set local idle_in_transaction_session_timeout = '30s';

set local application_name = 'organizatech-perf-06-prod-preflight-readonly';

do $perf06_prod_snapshot$
declare
  v_history_oid oid := pg_catalog.to_regclass('supabase_migrations.schema_migrations');
  v_diagnostic_oid oid := pg_catalog.to_regclass('public.training_session_consolidation_audit');
  v_history_shape_valid boolean := false;
  v_history_versions integer := 0;
  v_history_statements integer := 0;
  v_history_sha256 text;
  v_history_exact boolean := false;
  v_missing_relations jsonb := '[]'::jsonb;
  v_data_counts jsonb := '{}'::jsonb;
  v_lineage jsonb := '{}'::jsonb;
  v_diagnostic jsonb := '{}'::jsonb;
  v_operational jsonb := '{}'::jsonb;
  v_partial jsonb;
  v_relation text;
  v_count bigint;
  v_status_counts jsonb := '{}'::jsonb;
  v_diagnostic_count bigint := 0;
  v_diagnostic_consumers integer := 0;
begin
  select coalesce(pg_catalog.jsonb_agg(schema_name || '.' || relation_name order by schema_name, relation_name), '[]'::jsonb)
  into v_missing_relations
  from (values
      ('auth'::text, 'users'::text),
      ('public'::text, 'exercise_entries'::text),
      ('public'::text, 'exercises'::text),
      ('public'::text, 'profiles'::text),
      ('public'::text, 'routines'::text),
      ('public'::text, 'training_cycle_days'::text),
      ('public'::text, 'training_cycle_exercises'::text),
      ('public'::text, 'training_cycle_routines'::text),
      ('public'::text, 'training_cycles'::text),
      ('public'::text, 'training_daily_readiness'::text),
      ('public'::text, 'training_exercise_lineages'::text),
      ('public'::text, 'training_sessions'::text),
      ('public'::text, 'training_workout_readiness'::text)
  ) as required_relation(schema_name, relation_name)
  where pg_catalog.to_regclass(schema_name || '.' || relation_name) is null;

  if v_history_oid is not null then
    select
      pg_catalog.count(*) filter (where attribute.attname = 'version' and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = 'text') = 1
      and pg_catalog.count(*) filter (where attribute.attname = 'name' and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = 'text') = 1
      and pg_catalog.count(*) filter (where attribute.attname = 'statements' and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = 'text[]') = 1
    into v_history_shape_valid
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = v_history_oid
      and attribute.attnum > 0
      and not attribute.attisdropped;

    if v_history_shape_valid then
      execute $perf06_history_query$
        select
          pg_catalog.count(*)::integer,
          coalesce(pg_catalog.sum(pg_catalog.cardinality(statements)), 0)::integer,
          pg_catalog.encode(
            pg_catalog.sha256(
              pg_catalog.convert_to(
                coalesce(
                  pg_catalog.string_agg(
                    version || pg_catalog.chr(31) || name || pg_catalog.chr(31)
                    || pg_catalog.array_to_string(statements, pg_catalog.chr(30)),
                    E'\n' order by version
                  ),
                  ''
                ),
                'UTF8'
              )
            ),
            'hex'
          )
        from supabase_migrations.schema_migrations
      $perf06_history_query$
      into v_history_versions, v_history_statements, v_history_sha256;

      v_history_exact := v_history_versions = 24
        and v_history_statements = 336
        and v_history_sha256 = '3325f11a1cac1738b9aaa4adb389594d7dfb366b2a5978959ffb7210ffbe9756';
    end if;
  end if;

  foreach v_relation in array array['exercise_entries', 'exercises', 'profiles', 'routines', 'training_cycle_days', 'training_cycle_exercises', 'training_cycle_routines', 'training_cycles', 'training_daily_readiness', 'training_exercise_lineages', 'training_sessions', 'training_workout_readiness']
  loop
    if pg_catalog.to_regclass('public.' || v_relation) is not null then
      execute pg_catalog.format('select pg_catalog.count(*) from public.%I', v_relation)
      into v_count;
      v_data_counts := v_data_counts || pg_catalog.jsonb_build_object(v_relation, v_count);
    end if;
  end loop;

  if v_missing_relations = '[]'::jsonb then
    execute $perf06_lineage_query$
      with pending as (
        select exercise.id, exercise.user_id, exercise.routine_id
        from public.exercises as exercise
        where not exists (
          select 1
          from public.training_exercise_lineages as lineage
          where lineage.user_id = exercise.user_id
            and lineage.source_legacy_exercise_id = exercise.id
        )
      )
      select pg_catalog.jsonb_build_object(
        'pending', (select pg_catalog.count(*) from pending),
        'exercise_count', (select pg_catalog.count(*) from public.exercises),
        'invalid_auth_users', (
          select pg_catalog.count(*)
          from pending
          left join auth.users as app_user on app_user.id = pending.user_id
          where app_user.id is null
        ),
        'invalid_routines', (
          select pg_catalog.count(*)
          from pending
          left join public.routines as routine on routine.id = pending.routine_id
          where routine.id is null or routine.user_id <> pending.user_id
        ),
        'entry_references', (
          select pg_catalog.count(*)
          from public.exercise_entries as entry
          join pending on pending.id = entry.exercise_id
        ),
        'cycle_references', (
          select pg_catalog.count(*)
          from public.training_cycle_exercises as cycle_exercise
          join pending on pending.id = cycle_exercise.source_legacy_exercise_id
        ),
        'cross_owner_source_conflicts', (
          select pg_catalog.count(*)
          from public.training_exercise_lineages as lineage
          join pending on pending.id = lineage.source_legacy_exercise_id
          where lineage.user_id <> pending.user_id
             or lineage.origin_kind <> 'legacy'
             or lineage.origin_training_cycle_exercise_id is not null
        ),
        'incompatible_lineages', (
          select pg_catalog.count(*)
          from public.training_exercise_lineages as lineage
          join public.exercises as exercise on exercise.id = lineage.source_legacy_exercise_id
          where lineage.user_id <> exercise.user_id
             or lineage.origin_kind <> 'legacy'
             or lineage.origin_training_cycle_exercise_id is not null
        ),
        'markers', (
          select pg_catalog.count(*)
          from public.training_exercise_lineages
          where metadata @> '{"reconciliation":"PERF-06R","source":"migration-history-normalization","version":1}'::jsonb
        ),
        'fixtures', (
          (select pg_catalog.count(*) from public.exercises where name like '__perf06_fixture_%')
          + (select pg_catalog.count(*) from public.routines where name like '__perf06_fixture_%')
          + (select pg_catalog.count(*) from public.training_cycles where name like '__perf06_fixture_%')
          + (select pg_catalog.count(*) from public.training_cycle_routines where name like '__perf06_fixture_%')
          + (select pg_catalog.count(*) from public.training_cycle_exercises where name like '__perf06_fixture_%')
          + (select pg_catalog.count(*) from public.training_exercise_lineages where metadata ? 'fixture')
        )
      )
    $perf06_lineage_query$
    into v_lineage;
  end if;

  if v_diagnostic_oid is not null then
    execute $perf06_diagnostic_count$
      select pg_catalog.count(*) from public.training_session_consolidation_audit
    $perf06_diagnostic_count$
    into v_diagnostic_count;

    if exists (
      select 1
      from pg_catalog.pg_attribute
      where attrelid = v_diagnostic_oid
        and attname = 'status'
        and attnum > 0
        and not attisdropped
    ) then
      execute $perf06_diagnostic_status$
        select coalesce(pg_catalog.jsonb_object_agg(status, row_count), '{}'::jsonb)
        from (
          select status::text, pg_catalog.count(*)::bigint as row_count
          from public.training_session_consolidation_audit
          group by status
          order by status
        ) as status_counts
      $perf06_diagnostic_status$
      into v_status_counts;
    end if;

    select pg_catalog.count(*)::integer
    into v_diagnostic_consumers
    from pg_catalog.pg_depend as dependency
    join pg_catalog.pg_rewrite as rewrite_row
      on dependency.classid = 'pg_catalog.pg_rewrite'::pg_catalog.regclass
     and rewrite_row.oid = dependency.objid
    join pg_catalog.pg_class as dependent on dependent.oid = rewrite_row.ev_class
    where dependency.refobjid = v_diagnostic_oid
      and dependent.oid <> dependency.refobjid;
  end if;

  v_partial := pg_catalog.jsonb_build_object(
    'history_absent', v_history_oid is null,
    'identity_function_absent', pg_catalog.to_regprocedure('public.prevent_exercise_identity_change()') is null,
    'invariant_function_absent', pg_catalog.to_regprocedure('public.ensure_legacy_exercise_lineage_invariant()') is null,
    'lineage_function_absent', pg_catalog.to_regprocedure('public.validate_training_exercise_lineage_identity_update()') is null,
    'perf_index_absent', pg_catalog.to_regclass('public.exercise_entries_session_user_lineage_created_id_idx') is null,
    'perf_triggers_absent', not exists (
      select 1
      from pg_catalog.pg_trigger
      where tgname in (
        'exercises_prevent_identity_change',
        'exercises_ensure_legacy_lineage',
        'training_exercise_lineages_validate_identity_update'
      )
        and not tgisinternal
    )
  );

  v_diagnostic := pg_catalog.jsonb_build_object(
    'present', v_diagnostic_oid is not null,
    'rows', v_diagnostic_count,
    'status_counts', v_status_counts,
    'consumers', v_diagnostic_consumers
  );

  select pg_catalog.jsonb_build_object(
    'other_transactions_over_30s', pg_catalog.count(*) filter (
      where activity.xact_start is not null
        and pg_catalog.clock_timestamp() - activity.xact_start > interval '30 seconds'
    ),
    'other_relation_locks', (
      select pg_catalog.count(*)
      from pg_catalog.pg_locks as lock_row
      where lock_row.pid <> pg_catalog.pg_backend_pid()
        and lock_row.database = (select oid from pg_catalog.pg_database where datname = pg_catalog.current_database())
        and lock_row.relation in (
          select relation.oid
          from pg_catalog.pg_class as relation
          join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
          where namespace.nspname in ('public', 'auth')
        )
    ),
    'exercise_entries_heap_bytes', coalesce(pg_catalog.pg_relation_size(pg_catalog.to_regclass('public.exercise_entries')), 0),
    'exercise_entries_total_bytes', coalesce(pg_catalog.pg_total_relation_size(pg_catalog.to_regclass('public.exercise_entries')), 0),
    'exercise_entries_live_rows_estimate', coalesce((
      select stats.n_live_tup from pg_catalog.pg_stat_user_tables as stats
      where stats.relid = pg_catalog.to_regclass('public.exercise_entries')
    ), 0),
    'exercise_entries_dead_rows_estimate', coalesce((
      select stats.n_dead_tup from pg_catalog.pg_stat_user_tables as stats
      where stats.relid = pg_catalog.to_regclass('public.exercise_entries')
    ), 0)
  )
  into v_operational
  from pg_catalog.pg_stat_activity as activity
  where activity.pid <> pg_catalog.pg_backend_pid()
    and activity.datname = pg_catalog.current_database();

  perform pg_catalog.set_config(
    'perf06.prod_preflight_snapshot',
    pg_catalog.jsonb_build_object(
      'history', pg_catalog.jsonb_build_object(
        'present', v_history_oid is not null,
        'shape_valid', v_history_shape_valid,
        'versions', v_history_versions,
        'statements', v_history_statements,
        'sha256', v_history_sha256,
        'exact_final', v_history_exact
      ),
      'missing_relations', v_missing_relations,
      'data_counts', v_data_counts,
      'lineage', v_lineage,
      'diagnostic', v_diagnostic,
      'operational', v_operational,
      'partial_application', v_partial
    )::text,
    true
  );
end;
$perf06_prod_snapshot$;

with
runtime as (
  select
    current_user::text as current_user,
    session_user::text as session_user,
    pg_catalog.current_setting('transaction_isolation') as isolation_level,
    pg_catalog.current_setting('transaction_read_only') as read_only,
    pg_catalog.current_setting('server_version_num')::integer as server_version_num,
    pg_catalog.current_database() as database_name,
    coalesce((select ssl from pg_catalog.pg_stat_ssl where pid = pg_catalog.pg_backend_pid()), false) as tls_active
),
snapshot as (
  select pg_catalog.current_setting('perf06.prod_preflight_snapshot', false)::jsonb as value
),
fingerprint as (
-- PERF-06R deterministic schema fingerprint, algorithm v1.
-- Read-only: this query reads catalogs, not rows from application/auth/storage tables.
-- The sole relation exclusion is public.training_session_consolidation_audit.
-- Each category hashes UTF-8 string_agg(line, E'\n' ORDER BY line), without a final LF.
-- OVERALL hashes UTF-8 string_agg(category || '|' || line, E'\n'
-- ORDER BY category, line), also without a final LF.

with excluded_relation(schema_name, relation_name) as (
  values ('public'::name, 'training_session_consolidation_audit'::name)
),
target_rel as (
  select
    relation.oid,
    namespace.nspname,
    relation.relname,
    relation.relkind,
    relation.relrowsecurity,
    relation.relforcerowsecurity,
    relation.relacl
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind in ('r', 'p', 'v', 'm', 'S')
    and not exists (
      select 1
      from excluded_relation as excluded
      where excluded.schema_name = namespace.nspname
        and excluded.relation_name = relation.relname
    )
),
manifest as (
  select
    'relation'::text as category,
    pg_catalog.concat_ws(
      '|',
      target.nspname,
      target.relname,
      target.relkind::text,
      target.relrowsecurity::text,
      target.relforcerowsecurity::text
    ) as line
  from target_rel as target

  union all

  select
    'column',
    pg_catalog.concat_ws(
      '|',
      target.nspname,
      target.relname,
      attribute.attnum::text,
      attribute.attname,
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
      attribute.attnotnull::text,
      attribute.attidentity::text,
      attribute.attgenerated::text,
      coalesce(pg_catalog.pg_get_expr(attribute_default.adbin, attribute_default.adrelid, true), '')
    )
  from target_rel as target
  join pg_catalog.pg_attribute as attribute
    on attribute.attrelid = target.oid
   and attribute.attnum > 0
   and not attribute.attisdropped
  left join pg_catalog.pg_attrdef as attribute_default
    on attribute_default.adrelid = attribute.attrelid
   and attribute_default.adnum = attribute.attnum

  union all

  select
    'constraint',
    pg_catalog.concat_ws(
      '|',
      namespace.nspname,
      relation.relname,
      constraint_row.conname,
      constraint_row.contype::text,
      constraint_row.convalidated::text,
      pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
    )
  from pg_catalog.pg_constraint as constraint_row
  join pg_catalog.pg_class as relation on relation.oid = constraint_row.conrelid
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and not exists (
      select 1
      from excluded_relation as excluded
      where excluded.schema_name = namespace.nspname
        and excluded.relation_name = relation.relname
    )

  union all

  select
    'index',
    pg_catalog.concat_ws(
      '|',
      namespace.nspname,
      target_table.relname,
      index_relation.relname,
      pg_catalog.regexp_replace(
        pg_catalog.pg_get_indexdef(index_relation.oid),
        '[[:space:]]+',
        ' ',
        'g'
      )
    )
  from pg_catalog.pg_index as index_row
  join pg_catalog.pg_class as index_relation on index_relation.oid = index_row.indexrelid
  join pg_catalog.pg_class as target_table on target_table.oid = index_row.indrelid
  join pg_catalog.pg_namespace as namespace on namespace.oid = target_table.relnamespace
  where namespace.nspname = 'public'
    and not exists (
      select 1
      from excluded_relation as excluded
      where excluded.schema_name = namespace.nspname
        and excluded.relation_name = target_table.relname
    )

  union all

  select
    'policy',
    pg_catalog.concat_ws(
      '|',
      namespace.nspname,
      relation.relname,
      policy.polname,
      policy.polcmd::text,
      policy.polpermissive::text,
      coalesce(
        (
          select pg_catalog.string_agg(role.rolname, ',' order by role.rolname)
          from pg_catalog.unnest(policy.polroles) as policy_role(role_oid)
          join pg_catalog.pg_roles as role on role.oid = policy_role.role_oid
        ),
        ''
      ),
      coalesce(
        pg_catalog.regexp_replace(
          pg_catalog.pg_get_expr(policy.polqual, policy.polrelid, true),
          '[[:space:]]+',
          ' ',
          'g'
        ),
        ''
      ),
      coalesce(
        pg_catalog.regexp_replace(
          pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid, true),
          '[[:space:]]+',
          ' ',
          'g'
        ),
        ''
      )
    )
  from pg_catalog.pg_policy as policy
  join pg_catalog.pg_class as relation on relation.oid = policy.polrelid
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where (
      namespace.nspname = 'public'
      and not exists (
        select 1
        from excluded_relation as excluded
        where excluded.schema_name = namespace.nspname
          and excluded.relation_name = relation.relname
      )
    )
    or (namespace.nspname = 'storage' and relation.relname = 'objects')

  union all

  select
    'function',
    pg_catalog.concat_ws(
      '|',
      namespace.nspname,
      procedure.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid),
      procedure.prosecdef::text,
      coalesce(pg_catalog.array_to_string(procedure.proconfig, ','), ''),
      coalesce(
        (
          select pg_catalog.string_agg(acl_item::text, ',' order by acl_item::text)
          from pg_catalog.unnest(
            coalesce(procedure.proacl, '{}'::pg_catalog.aclitem[])
          ) as acl_item
        ),
        ''
      ),
      pg_catalog.regexp_replace(
        pg_catalog.pg_get_functiondef(procedure.oid),
        '[[:space:]]+',
        ' ',
        'g'
      )
    )
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'

  union all

  select
    'trigger',
    pg_catalog.concat_ws(
      '|',
      namespace.nspname,
      relation.relname,
      trigger_row.tgname,
      trigger_row.tgenabled::text,
      pg_catalog.regexp_replace(
        pg_catalog.pg_get_triggerdef(trigger_row.oid, true),
        '[[:space:]]+',
        ' ',
        'g'
      )
    )
  from pg_catalog.pg_trigger as trigger_row
  join pg_catalog.pg_class as relation on relation.oid = trigger_row.tgrelid
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where not trigger_row.tgisinternal
    and (
      (
        namespace.nspname = 'public'
        and not exists (
          select 1
          from excluded_relation as excluded
          where excluded.schema_name = namespace.nspname
            and excluded.relation_name = relation.relname
        )
      )
      or (namespace.nspname = 'auth' and relation.relname = 'users')
    )

  union all

  select
    'table_acl',
    pg_catalog.concat_ws(
      '|',
      target.nspname,
      target.relname,
      coalesce(
        (
          select pg_catalog.string_agg(acl_item::text, ',' order by acl_item::text)
          from pg_catalog.unnest(
            coalesce(target.relacl, '{}'::pg_catalog.aclitem[])
          ) as acl_item
        ),
        ''
      )
    )
  from target_rel as target

  union all

  select
    'column_acl',
    pg_catalog.concat_ws(
      '|',
      target.nspname,
      target.relname,
      attribute.attname,
      coalesce(
        (
          select pg_catalog.string_agg(acl_item::text, ',' order by acl_item::text)
          from pg_catalog.unnest(
            coalesce(attribute.attacl, '{}'::pg_catalog.aclitem[])
          ) as acl_item
        ),
        ''
      )
    )
  from target_rel as target
  join pg_catalog.pg_attribute as attribute
    on attribute.attrelid = target.oid
   and attribute.attnum > 0
   and not attribute.attisdropped
  where attribute.attacl is not null
),
category_hashes as (
  select
    category,
    count(*) as item_count,
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          pg_catalog.string_agg(line, E'\n' order by line),
          'UTF8'
        )
      ),
      'hex'
    ) as sha256
  from manifest
  group by category
),
overall as (
  select
    count(*) as item_count,
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          pg_catalog.string_agg(
            category || '|' || line,
            E'\n'
            order by category, line
          ),
          'UTF8'
        )
      ),
      'hex'
    ) as sha256
  from manifest
)
select category, item_count, sha256
from category_hashes
union all
select 'OVERALL', item_count, sha256
from overall
order by category
),
overall as (
  select item_count, sha256 from fingerprint where category = 'OVERALL'
),
evaluation as (
  select
    case
      when runtime.current_user <> 'postgres'
        or runtime.session_user <> 'postgres'
        or runtime.read_only <> 'on'
        or runtime.isolation_level <> 'repeatable read'
      then 'BLOCKED_IDENTITY_OR_TRANSACTION'
      when overall.item_count = 377
        and overall.sha256 = '833c2db78f0caeb776bf04b54d05e9c52c2adb0ee1e03cdbc0f479fe2ea76bc9'
        and snapshot.value -> 'partial_application' = '{"history_absent":false,"identity_function_absent":false,"invariant_function_absent":false,"lineage_function_absent":false,"perf_index_absent":false,"perf_triggers_absent":false}'::jsonb
        and coalesce((snapshot.value #>> '{history,exact_final}')::boolean, false) is true
        and coalesce((snapshot.value #>> '{lineage,pending}')::integer, -1) = 0
      then 'ALREADY_APPLIED'
      when overall.item_count = 346
        and overall.sha256 = 'ebd6b8bb930d222700d7af69c0a9c69236bc9135ee123e5f7129599c8d7105f1'
        and snapshot.value -> 'partial_application' = '{"history_absent":true,"identity_function_absent":true,"invariant_function_absent":true,"lineage_function_absent":true,"perf_index_absent":true,"perf_triggers_absent":true}'::jsonb
        and coalesce((snapshot.value #>> '{history,present}')::boolean, true) is false
        and snapshot.value -> 'missing_relations' = '[]'::jsonb
        and coalesce((snapshot.value #>> '{lineage,invalid_auth_users}')::integer, -1) = 0
        and coalesce((snapshot.value #>> '{lineage,invalid_routines}')::integer, -1) = 0
        and coalesce((snapshot.value #>> '{lineage,cross_owner_source_conflicts}')::integer, -1) = 0
        and coalesce((snapshot.value #>> '{lineage,incompatible_lineages}')::integer, -1) = 0
        and coalesce((snapshot.value #>> '{lineage,markers}')::integer, -1) = 0
        and coalesce((snapshot.value #>> '{lineage,fixtures}')::integer, -1) = 0
      then 'PASS_READY_FOR_PROD_BUNDLE_DESIGN'
      else 'BLOCKED'
    end as verdict
  from runtime cross join snapshot cross join overall
)
select
  evaluation.verdict,
  'lzycxltqbrtsnwfdotqw'::text as expected_project_ref,
  true as visual_project_confirmation_required,
  runtime.current_user,
  runtime.session_user,
  runtime.isolation_level,
  runtime.read_only as transaction_read_only,
  runtime.server_version_num,
  runtime.database_name,
  runtime.tls_active,
  overall.item_count as fingerprint_items,
  overall.sha256 as fingerprint,
  snapshot.value -> 'history' as history,
  '3325f11a1cac1738b9aaa4adb389594d7dfb366b2a5978959ffb7210ffbe9756'::text as expected_final_history_sha256,
  snapshot.value -> 'partial_application' as partial_application,
  snapshot.value -> 'missing_relations' as missing_relations,
  snapshot.value -> 'lineage' as lineage,
  snapshot.value -> 'diagnostic' as diagnostic,
  snapshot.value -> 'operational' as operational,
  snapshot.value -> 'data_counts' as data_counts,
  '2955e5eeb0e4b08060970803ac27c4811f76a304f75d99fded65642847a39848'::text as expected_manifest_sha256
from runtime cross join snapshot cross join overall cross join evaluation;

rollback;
