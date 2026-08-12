-- ORGANIZATECH PERF-06 — PRODUCCIÓN — SUPABASE SQL EDITOR — VALIDACIÓN TRANSACCIONAL CON ROLLBACK
-- DESTINO EXCLUSIVO: organizatech PROD (lzycxltqbrtsnwfdotqw)
-- Antes de pulsar Run, confirma visualmente el proyecto y la ref en Supabase.
-- Este archivo sólo valida la operación PROD y termina con ROLLBACK verificable.
-- Generado desde el manifiesto auditado 2955e5eeb0e4b08060970803ac27c4811f76a304f75d99fded65642847a39848.
-- No contiene contraseñas, tokens, service_role ni metacomandos de cliente.


begin isolation level read committed read write;

set local statement_timeout = '15s';

set local lock_timeout = '5s';

set local idle_in_transaction_session_timeout = '60s';

set local application_name = 'organizatech-perf-06-prod-sql-editor-rollback';

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('organizatech:prod:PERF-06:lzycxltqbrtsnwfdotqw', 0));

create temporary table perf06_sql_editor_context (

  initial_snapshot jsonb not null,

  locked_snapshot jsonb,

  final_snapshot jsonb

) on commit drop;

insert into pg_temp.perf06_sql_editor_context (initial_snapshot)
with
identity as (
select
  current_user::text as current_user,
  session_user::text as session_user,
  current_setting('transaction_isolation') as isolation_level,
  current_setting('transaction_read_only') as read_only,
  current_setting('server_version_num')::integer as server_version_num,
  current_database() as database_name,
  coalesce((select ssl from pg_catalog.pg_stat_ssl where pid = pg_catalog.pg_backend_pid()), false) as tls_active
),
partial_application as (
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
  ) as perf_triggers_absent
),
lineage_counts as (
select
  count(*) filter (where not exists (
    select 1 from public.training_exercise_lineages lineage
    where lineage.user_id = exercise.user_id
      and lineage.source_legacy_exercise_id = exercise.id
  ))::integer as pending,
  count(*)::integer as exercise_count
from public.exercises exercise
),
marker_count as (
select count(*)::integer as marker_count
from public.training_exercise_lineages
where metadata @> '{"reconciliation":"PERF-06R","source":"migration-history-normalization","version":1}'::jsonb
),
incompatible_lineages as (
select count(*)::integer as incompatible_count
from public.training_exercise_lineages lineage
join public.exercises exercise on exercise.id = lineage.source_legacy_exercise_id
where lineage.user_id <> exercise.user_id
   or lineage.origin_kind <> 'legacy'
   or lineage.origin_training_cycle_exercise_id is not null
),
fixture_identity as (
select exercise.user_id::text as owner_id, exercise.routine_id::text as routine_id
from public.exercises exercise
join auth.users app_user on app_user.id = exercise.user_id
join public.routines routine on routine.id = exercise.routine_id and routine.user_id = exercise.user_id
order by exercise.id
limit 1
),
diagnostic_exists as (
select to_regclass('public.training_session_consolidation_audit') is not null as diagnostic_exists
),
diagnostic_count as (
select
  pg_catalog.count(*)::integer as diagnostic_count,
  pg_catalog.count(*) filter (where status::text = 'executed')::integer as diagnostic_executed_count
from public.training_session_consolidation_audit
),
diagnostic_hash as (
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
  union all
  select 'row|' || pg_catalog.to_jsonb(diagnostic)::text
  from public.training_session_consolidation_audit as diagnostic
)
select pg_catalog.encode(
  pg_catalog.sha256(
    pg_catalog.convert_to(pg_catalog.string_agg(line, E'\n' order by line), 'UTF8')
  ),
  'hex'
) as diagnostic_hash
from diagnostic_lines
),
diagnostic_consumers as (
select count(*)::integer as consumer_count
from pg_catalog.pg_depend dependency
join pg_catalog.pg_rewrite rewrite_row on dependency.classid = 'pg_catalog.pg_rewrite'::regclass and rewrite_row.oid = dependency.objid
join pg_catalog.pg_class dependent on dependent.oid = rewrite_row.ev_class
where dependency.refobjid = 'public.training_session_consolidation_audit'::regclass
  and dependent.oid <> dependency.refobjid
),
data_counts as (
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
) as counts
),
fixtures as (
select
  not exists (select 1 from public.exercises where name like '__perf06_fixture_%')
  and not exists (select 1 from public.routines where name like '__perf06_fixture_%')
  and not exists (select 1 from public.training_cycles where name like '__perf06_fixture_%')
  and not exists (select 1 from public.training_cycle_routines where name like '__perf06_fixture_%')
  and not exists (select 1 from public.training_cycle_exercises where name like '__perf06_fixture_%')
  and not exists (select 1 from public.training_exercise_lineages where metadata ? 'fixture')
  as valid
),
prod_guard as (
with target_function as (
  select
    procedure.oid,
    procedure.proowner,
    owner_role.rolname as owner_name,
    language.lanname as language_name,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.proacl,
    pg_catalog.format_type(procedure.prorettype, null) as return_type,
    pg_catalog.pg_get_function_identity_arguments(procedure.oid) as identity_arguments,
    pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g') as normalized_definition,
    pg_catalog.concat_ws(
      '|',
      namespace.nspname,
      procedure.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid),
      procedure.prosecdef::text,
      coalesce(pg_catalog.array_to_string(procedure.proconfig, ','), ''),
      coalesce((
        select pg_catalog.string_agg(acl_item::text, ',' order by acl_item::text)
        from pg_catalog.unnest(coalesce(procedure.proacl, '{}'::pg_catalog.aclitem[])) as acl_item
      ), ''),
      pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g')
    ) as fingerprint_line
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  join pg_catalog.pg_roles as owner_role on owner_role.oid = procedure.proowner
  join pg_catalog.pg_language as language on language.oid = procedure.prolang
  where namespace.nspname = 'public'
    and procedure.proname = 'rls_auto_enable'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''
),
function_snapshot as (
  select
    pg_catalog.count(*)::integer as function_count,
    pg_catalog.min(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('function|' || fingerprint_line, 'UTF8')), 'hex')) as function_item_sha256,
    pg_catalog.min(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized_definition, 'UTF8')), 'hex')) as definition_sha256,
    coalesce(pg_catalog.bool_and(owner_name = 'postgres'), false) as owner_is_postgres,
    coalesce(pg_catalog.bool_and(language_name = 'plpgsql'), false) as language_is_plpgsql,
    coalesce(pg_catalog.bool_and(prosecdef), false) as security_definer,
    coalesce(pg_catalog.bool_and(coalesce(proconfig, '{}'::text[]) @> array['search_path=pg_catalog']::text[]), false) as search_path_pg_catalog,
    coalesce(pg_catalog.bool_and(return_type = 'event_trigger'), false) as returns_event_trigger,
    coalesce(pg_catalog.bool_and(identity_arguments = ''), false) as zero_arguments
  from target_function
),
target_event_triggers as (
  select
    event_trigger.evtname,
    event_trigger.evtevent,
    event_trigger.evtenabled,
    event_trigger.evttags,
    event_owner.rolname as owner_name,
    event_trigger.evtfoid,
    target.oid as target_function_oid
  from pg_catalog.pg_event_trigger as event_trigger
  join pg_catalog.pg_roles as event_owner on event_owner.oid = event_trigger.evtowner
  left join target_function as target on target.oid = event_trigger.evtfoid
  where event_trigger.evtname = 'ensure_rls' or target.oid is not null
),
event_snapshot as (
  select
    pg_catalog.count(*) filter (where evtname = 'ensure_rls')::integer as ensure_rls_count,
    pg_catalog.count(*) filter (where target_function_oid is not null)::integer as triggers_using_function,
    coalesce(pg_catalog.bool_and(owner_name = 'postgres') filter (where evtname = 'ensure_rls'), false) as owner_is_postgres,
    coalesce(pg_catalog.bool_and(evtevent = 'ddl_command_end') filter (where evtname = 'ensure_rls'), false) as event_is_ddl_command_end,
    coalesce(pg_catalog.bool_and(evtenabled = 'O') filter (where evtname = 'ensure_rls'), false) as enabled_for_origin,
    coalesce(pg_catalog.bool_and(evtfoid = target_function_oid) filter (where evtname = 'ensure_rls'), false) as calls_target_function,
    coalesce(pg_catalog.bool_and(
      evttags @> array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']::text[]
      and evttags <@ array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']::text[]
    ) filter (where evtname = 'ensure_rls'), false) as tags_exact,
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'name', evtname,
      'event', evtevent,
      'enabled', evtenabled,
      'tags', evttags,
      'owner', owner_name,
      'calls_target', evtfoid = target_function_oid
    ) order by evtname), '[]'::jsonb) as event_triggers
  from target_event_triggers
),
dependency_rows as (
  select 'inbound'::text as direction, dependency.classid::pg_catalog.regclass::text as catalog_name, dependency.deptype::text as dependency_type
  from pg_catalog.pg_depend as dependency
  join target_function as target
    on dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass and dependency.refobjid = target.oid
  union all
  select 'outbound', dependency.refclassid::pg_catalog.regclass::text, dependency.deptype::text
  from pg_catalog.pg_depend as dependency
  join target_function as target
    on dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass and dependency.objid = target.oid
),
dependency_snapshot as (
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'direction', direction,
    'catalog', catalog_name,
    'dependency_type', dependency_type,
    'count', dependency_count
  ) order by direction, catalog_name, dependency_type), '[]'::jsonb) as dependencies
  from (
    select direction, catalog_name, dependency_type, pg_catalog.count(*) as dependency_count
    from dependency_rows
    group by direction, catalog_name, dependency_type
  ) as grouped_dependencies
),
evaluation as (
  select
    function_snapshot.function_item_sha256,
    function_snapshot.definition_sha256,
    event_snapshot.event_triggers,
    dependency_snapshot.dependencies,
    function_snapshot.function_count = 1
      and function_snapshot.function_item_sha256 = 'ebaddb158c298b7eae7866253693d743cac3092c141ccc1a4f312cd32498ca47'
      and function_snapshot.definition_sha256 = '5d4290d1e54f4cee0080882c635a4fd6f669629322cfd8f963ef02da4eee5541'
      and function_snapshot.owner_is_postgres
      and function_snapshot.language_is_plpgsql
      and function_snapshot.security_definer
      and function_snapshot.search_path_pg_catalog
      and function_snapshot.returns_event_trigger
      and function_snapshot.zero_arguments
      and event_snapshot.ensure_rls_count = 1
      and event_snapshot.triggers_using_function = 1
      and event_snapshot.owner_is_postgres
      and event_snapshot.event_is_ddl_command_end
      and event_snapshot.enabled_for_origin
      and event_snapshot.calls_target_function
      and event_snapshot.tags_exact
      and dependency_snapshot.dependencies = '[{"count":1,"catalog":"pg_event_trigger","direction":"inbound","dependency_type":"n"},{"count":1,"catalog":"pg_language","direction":"outbound","dependency_type":"n"},{"count":1,"catalog":"pg_namespace","direction":"outbound","dependency_type":"n"}]'::jsonb
      as valid
  from function_snapshot, event_snapshot, dependency_snapshot
)
select
  valid,
  function_item_sha256,
  definition_sha256,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.concat_ws('|', function_item_sha256, definition_sha256, event_triggers::text, dependencies::text),
    'UTF8'
  )), 'hex') as guard_hash
from evaluation
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
    and not (
      procedure.proname = 'rls_auto_enable'
      and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''
    )

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
)
select jsonb_build_object(
  'current_user', (select identity."current_user" from identity),
  'session_user', (select identity."session_user" from identity),
  'isolation_level', (select isolation_level from identity),
  'read_only', (select read_only from identity),
  'server_version_num', (select server_version_num from identity),
  'database_name', (select database_name from identity),
  'partial_application', (select to_jsonb(partial_application) from partial_application),
  'pending', (select pending from lineage_counts),
  'exercise_count', (select exercise_count from lineage_counts),
  'marker_count', (select marker_count from marker_count),
  'incompatible_count', (select incompatible_count from incompatible_lineages),
  'owner_id', (select owner_id from fixture_identity),
  'routine_id', (select routine_id from fixture_identity),
  'fixture_free', (select valid from fixtures),
  'diagnostic_present', (select diagnostic_exists from diagnostic_exists),
  'diagnostic_count', (select diagnostic_count from diagnostic_count),
  'diagnostic_executed_count', (select diagnostic_executed_count from diagnostic_count),
  'diagnostic_hash', (select diagnostic_hash from diagnostic_hash),
  'diagnostic_consumers', (select consumer_count from diagnostic_consumers),
  'data_counts', (select counts from data_counts),
  'prod_guard_valid', (select valid from prod_guard),
  'prod_guard_hash', (select guard_hash from prod_guard),
  'prod_function_item_sha256', (select function_item_sha256 from prod_guard),
  'prod_function_definition_sha256', (select definition_sha256 from prod_guard),
  'fingerprint_count', (select item_count from fingerprint where category = 'OVERALL'),
  'fingerprint_hash', (select sha256 from fingerprint where category = 'OVERALL')
) as snapshot;

do $perf06_initial$
declare
  v_snapshot jsonb;
begin
  select initial_snapshot
  into v_snapshot
  from pg_temp.perf06_sql_editor_context;

  if v_snapshot is null
    or v_snapshot ->> 'current_user' <> 'postgres'
    or v_snapshot ->> 'session_user' <> 'postgres'
    or v_snapshot ->> 'isolation_level' <> 'read committed'
    or v_snapshot ->> 'read_only' <> 'off'
    or (v_snapshot ->> 'server_version_num')::integer <> 170006
    or v_snapshot ->> 'database_name' <> 'postgres'
    or v_snapshot -> 'partial_application' <> '{"history_absent":true,"identity_function_absent":true,"invariant_function_absent":true,"lineage_function_absent":true,"perf_index_absent":true,"perf_triggers_absent":true}'::jsonb
    or (v_snapshot ->> 'pending')::integer not in (0, 2)
    or (v_snapshot ->> 'exercise_count')::integer <= 0
    or (v_snapshot ->> 'marker_count')::integer <> 0
    or (v_snapshot ->> 'incompatible_count')::integer <> 0
    or coalesce((v_snapshot ->> 'fixture_free')::boolean, false) is not true
    or coalesce((v_snapshot ->> 'diagnostic_present')::boolean, false) is not true
    or (v_snapshot ->> 'diagnostic_count')::integer <> 3
    or (v_snapshot ->> 'diagnostic_executed_count')::integer <> 3
    or pg_catalog.length(coalesce(v_snapshot ->> 'diagnostic_hash', '')) <> 64
    or coalesce((v_snapshot ->> 'prod_guard_valid')::boolean, false) is not true
    or v_snapshot ->> 'prod_function_item_sha256' <> 'ebaddb158c298b7eae7866253693d743cac3092c141ccc1a4f312cd32498ca47'
    or v_snapshot ->> 'prod_function_definition_sha256' <> '5d4290d1e54f4cee0080882c635a4fd6f669629322cfd8f963ef02da4eee5541'
    or pg_catalog.length(coalesce(v_snapshot ->> 'prod_guard_hash', '')) <> 64
    or (v_snapshot ->> 'diagnostic_consumers')::integer <> 0
    or coalesce(v_snapshot ->> 'owner_id', '') = ''
    or coalesce(v_snapshot ->> 'routine_id', '') = ''
    or (v_snapshot ->> 'fingerprint_count')::integer <> 346
    or v_snapshot ->> 'fingerprint_hash' <> '4216b822625f6fbeea326d09312fc2f77bb268995b552280b6e4d2951870b210'
  then
    raise exception using
      errcode = '55000',
      message = 'PERF-06 SQL Editor aborted: initial baseline gate failed';
  end if;
end;
$perf06_initial$;

lock table public.training_session_consolidation_audit in share mode;

lock table auth.users in share mode;

lock table public.exercises in share row exclusive mode;

lock table public.routines, public.exercise_entries, public.training_cycle_exercises, public.training_exercise_lineages in share row exclusive mode;

update pg_temp.perf06_sql_editor_context
set locked_snapshot = (
with
identity as (
select
  current_user::text as current_user,
  session_user::text as session_user,
  current_setting('transaction_isolation') as isolation_level,
  current_setting('transaction_read_only') as read_only,
  current_setting('server_version_num')::integer as server_version_num,
  current_database() as database_name,
  coalesce((select ssl from pg_catalog.pg_stat_ssl where pid = pg_catalog.pg_backend_pid()), false) as tls_active
),
partial_application as (
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
  ) as perf_triggers_absent
),
lineage_counts as (
select
  count(*) filter (where not exists (
    select 1 from public.training_exercise_lineages lineage
    where lineage.user_id = exercise.user_id
      and lineage.source_legacy_exercise_id = exercise.id
  ))::integer as pending,
  count(*)::integer as exercise_count
from public.exercises exercise
),
marker_count as (
select count(*)::integer as marker_count
from public.training_exercise_lineages
where metadata @> '{"reconciliation":"PERF-06R","source":"migration-history-normalization","version":1}'::jsonb
),
incompatible_lineages as (
select count(*)::integer as incompatible_count
from public.training_exercise_lineages lineage
join public.exercises exercise on exercise.id = lineage.source_legacy_exercise_id
where lineage.user_id <> exercise.user_id
   or lineage.origin_kind <> 'legacy'
   or lineage.origin_training_cycle_exercise_id is not null
),
fixture_identity as (
select exercise.user_id::text as owner_id, exercise.routine_id::text as routine_id
from public.exercises exercise
join auth.users app_user on app_user.id = exercise.user_id
join public.routines routine on routine.id = exercise.routine_id and routine.user_id = exercise.user_id
order by exercise.id
limit 1
),
diagnostic_exists as (
select to_regclass('public.training_session_consolidation_audit') is not null as diagnostic_exists
),
diagnostic_count as (
select
  pg_catalog.count(*)::integer as diagnostic_count,
  pg_catalog.count(*) filter (where status::text = 'executed')::integer as diagnostic_executed_count
from public.training_session_consolidation_audit
),
diagnostic_hash as (
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
  union all
  select 'row|' || pg_catalog.to_jsonb(diagnostic)::text
  from public.training_session_consolidation_audit as diagnostic
)
select pg_catalog.encode(
  pg_catalog.sha256(
    pg_catalog.convert_to(pg_catalog.string_agg(line, E'\n' order by line), 'UTF8')
  ),
  'hex'
) as diagnostic_hash
from diagnostic_lines
),
diagnostic_consumers as (
select count(*)::integer as consumer_count
from pg_catalog.pg_depend dependency
join pg_catalog.pg_rewrite rewrite_row on dependency.classid = 'pg_catalog.pg_rewrite'::regclass and rewrite_row.oid = dependency.objid
join pg_catalog.pg_class dependent on dependent.oid = rewrite_row.ev_class
where dependency.refobjid = 'public.training_session_consolidation_audit'::regclass
  and dependent.oid <> dependency.refobjid
),
data_counts as (
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
) as counts
),
fixtures as (
select
  not exists (select 1 from public.exercises where name like '__perf06_fixture_%')
  and not exists (select 1 from public.routines where name like '__perf06_fixture_%')
  and not exists (select 1 from public.training_cycles where name like '__perf06_fixture_%')
  and not exists (select 1 from public.training_cycle_routines where name like '__perf06_fixture_%')
  and not exists (select 1 from public.training_cycle_exercises where name like '__perf06_fixture_%')
  and not exists (select 1 from public.training_exercise_lineages where metadata ? 'fixture')
  as valid
),
prod_guard as (
with target_function as (
  select
    procedure.oid,
    procedure.proowner,
    owner_role.rolname as owner_name,
    language.lanname as language_name,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.proacl,
    pg_catalog.format_type(procedure.prorettype, null) as return_type,
    pg_catalog.pg_get_function_identity_arguments(procedure.oid) as identity_arguments,
    pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g') as normalized_definition,
    pg_catalog.concat_ws(
      '|',
      namespace.nspname,
      procedure.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid),
      procedure.prosecdef::text,
      coalesce(pg_catalog.array_to_string(procedure.proconfig, ','), ''),
      coalesce((
        select pg_catalog.string_agg(acl_item::text, ',' order by acl_item::text)
        from pg_catalog.unnest(coalesce(procedure.proacl, '{}'::pg_catalog.aclitem[])) as acl_item
      ), ''),
      pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g')
    ) as fingerprint_line
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  join pg_catalog.pg_roles as owner_role on owner_role.oid = procedure.proowner
  join pg_catalog.pg_language as language on language.oid = procedure.prolang
  where namespace.nspname = 'public'
    and procedure.proname = 'rls_auto_enable'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''
),
function_snapshot as (
  select
    pg_catalog.count(*)::integer as function_count,
    pg_catalog.min(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('function|' || fingerprint_line, 'UTF8')), 'hex')) as function_item_sha256,
    pg_catalog.min(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized_definition, 'UTF8')), 'hex')) as definition_sha256,
    coalesce(pg_catalog.bool_and(owner_name = 'postgres'), false) as owner_is_postgres,
    coalesce(pg_catalog.bool_and(language_name = 'plpgsql'), false) as language_is_plpgsql,
    coalesce(pg_catalog.bool_and(prosecdef), false) as security_definer,
    coalesce(pg_catalog.bool_and(coalesce(proconfig, '{}'::text[]) @> array['search_path=pg_catalog']::text[]), false) as search_path_pg_catalog,
    coalesce(pg_catalog.bool_and(return_type = 'event_trigger'), false) as returns_event_trigger,
    coalesce(pg_catalog.bool_and(identity_arguments = ''), false) as zero_arguments
  from target_function
),
target_event_triggers as (
  select
    event_trigger.evtname,
    event_trigger.evtevent,
    event_trigger.evtenabled,
    event_trigger.evttags,
    event_owner.rolname as owner_name,
    event_trigger.evtfoid,
    target.oid as target_function_oid
  from pg_catalog.pg_event_trigger as event_trigger
  join pg_catalog.pg_roles as event_owner on event_owner.oid = event_trigger.evtowner
  left join target_function as target on target.oid = event_trigger.evtfoid
  where event_trigger.evtname = 'ensure_rls' or target.oid is not null
),
event_snapshot as (
  select
    pg_catalog.count(*) filter (where evtname = 'ensure_rls')::integer as ensure_rls_count,
    pg_catalog.count(*) filter (where target_function_oid is not null)::integer as triggers_using_function,
    coalesce(pg_catalog.bool_and(owner_name = 'postgres') filter (where evtname = 'ensure_rls'), false) as owner_is_postgres,
    coalesce(pg_catalog.bool_and(evtevent = 'ddl_command_end') filter (where evtname = 'ensure_rls'), false) as event_is_ddl_command_end,
    coalesce(pg_catalog.bool_and(evtenabled = 'O') filter (where evtname = 'ensure_rls'), false) as enabled_for_origin,
    coalesce(pg_catalog.bool_and(evtfoid = target_function_oid) filter (where evtname = 'ensure_rls'), false) as calls_target_function,
    coalesce(pg_catalog.bool_and(
      evttags @> array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']::text[]
      and evttags <@ array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']::text[]
    ) filter (where evtname = 'ensure_rls'), false) as tags_exact,
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'name', evtname,
      'event', evtevent,
      'enabled', evtenabled,
      'tags', evttags,
      'owner', owner_name,
      'calls_target', evtfoid = target_function_oid
    ) order by evtname), '[]'::jsonb) as event_triggers
  from target_event_triggers
),
dependency_rows as (
  select 'inbound'::text as direction, dependency.classid::pg_catalog.regclass::text as catalog_name, dependency.deptype::text as dependency_type
  from pg_catalog.pg_depend as dependency
  join target_function as target
    on dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass and dependency.refobjid = target.oid
  union all
  select 'outbound', dependency.refclassid::pg_catalog.regclass::text, dependency.deptype::text
  from pg_catalog.pg_depend as dependency
  join target_function as target
    on dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass and dependency.objid = target.oid
),
dependency_snapshot as (
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'direction', direction,
    'catalog', catalog_name,
    'dependency_type', dependency_type,
    'count', dependency_count
  ) order by direction, catalog_name, dependency_type), '[]'::jsonb) as dependencies
  from (
    select direction, catalog_name, dependency_type, pg_catalog.count(*) as dependency_count
    from dependency_rows
    group by direction, catalog_name, dependency_type
  ) as grouped_dependencies
),
evaluation as (
  select
    function_snapshot.function_item_sha256,
    function_snapshot.definition_sha256,
    event_snapshot.event_triggers,
    dependency_snapshot.dependencies,
    function_snapshot.function_count = 1
      and function_snapshot.function_item_sha256 = 'ebaddb158c298b7eae7866253693d743cac3092c141ccc1a4f312cd32498ca47'
      and function_snapshot.definition_sha256 = '5d4290d1e54f4cee0080882c635a4fd6f669629322cfd8f963ef02da4eee5541'
      and function_snapshot.owner_is_postgres
      and function_snapshot.language_is_plpgsql
      and function_snapshot.security_definer
      and function_snapshot.search_path_pg_catalog
      and function_snapshot.returns_event_trigger
      and function_snapshot.zero_arguments
      and event_snapshot.ensure_rls_count = 1
      and event_snapshot.triggers_using_function = 1
      and event_snapshot.owner_is_postgres
      and event_snapshot.event_is_ddl_command_end
      and event_snapshot.enabled_for_origin
      and event_snapshot.calls_target_function
      and event_snapshot.tags_exact
      and dependency_snapshot.dependencies = '[{"count":1,"catalog":"pg_event_trigger","direction":"inbound","dependency_type":"n"},{"count":1,"catalog":"pg_language","direction":"outbound","dependency_type":"n"},{"count":1,"catalog":"pg_namespace","direction":"outbound","dependency_type":"n"}]'::jsonb
      as valid
  from function_snapshot, event_snapshot, dependency_snapshot
)
select
  valid,
  function_item_sha256,
  definition_sha256,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.concat_ws('|', function_item_sha256, definition_sha256, event_triggers::text, dependencies::text),
    'UTF8'
  )), 'hex') as guard_hash
from evaluation
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
    and not (
      procedure.proname = 'rls_auto_enable'
      and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''
    )

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
)
select jsonb_build_object(
  'current_user', (select identity."current_user" from identity),
  'session_user', (select identity."session_user" from identity),
  'isolation_level', (select isolation_level from identity),
  'read_only', (select read_only from identity),
  'server_version_num', (select server_version_num from identity),
  'database_name', (select database_name from identity),
  'partial_application', (select to_jsonb(partial_application) from partial_application),
  'pending', (select pending from lineage_counts),
  'exercise_count', (select exercise_count from lineage_counts),
  'marker_count', (select marker_count from marker_count),
  'incompatible_count', (select incompatible_count from incompatible_lineages),
  'owner_id', (select owner_id from fixture_identity),
  'routine_id', (select routine_id from fixture_identity),
  'fixture_free', (select valid from fixtures),
  'diagnostic_present', (select diagnostic_exists from diagnostic_exists),
  'diagnostic_count', (select diagnostic_count from diagnostic_count),
  'diagnostic_executed_count', (select diagnostic_executed_count from diagnostic_count),
  'diagnostic_hash', (select diagnostic_hash from diagnostic_hash),
  'diagnostic_consumers', (select consumer_count from diagnostic_consumers),
  'data_counts', (select counts from data_counts),
  'prod_guard_valid', (select valid from prod_guard),
  'prod_guard_hash', (select guard_hash from prod_guard),
  'prod_function_item_sha256', (select function_item_sha256 from prod_guard),
  'prod_function_definition_sha256', (select definition_sha256 from prod_guard),
  'fingerprint_count', (select item_count from fingerprint where category = 'OVERALL'),
  'fingerprint_hash', (select sha256 from fingerprint where category = 'OVERALL')
) as snapshot
);

do $perf06_locked$
declare
  v_snapshot jsonb;
begin
  select locked_snapshot
  into v_snapshot
  from pg_temp.perf06_sql_editor_context;

  if v_snapshot is null
    or v_snapshot ->> 'current_user' <> 'postgres'
    or v_snapshot ->> 'session_user' <> 'postgres'
    or v_snapshot ->> 'isolation_level' <> 'read committed'
    or v_snapshot ->> 'read_only' <> 'off'
    or (v_snapshot ->> 'server_version_num')::integer <> 170006
    or v_snapshot ->> 'database_name' <> 'postgres'
    or v_snapshot -> 'partial_application' <> '{"history_absent":true,"identity_function_absent":true,"invariant_function_absent":true,"lineage_function_absent":true,"perf_index_absent":true,"perf_triggers_absent":true}'::jsonb
    or (v_snapshot ->> 'pending')::integer not in (0, 2)
    or (v_snapshot ->> 'exercise_count')::integer <= 0
    or (v_snapshot ->> 'marker_count')::integer <> 0
    or (v_snapshot ->> 'incompatible_count')::integer <> 0
    or coalesce((v_snapshot ->> 'fixture_free')::boolean, false) is not true
    or coalesce((v_snapshot ->> 'diagnostic_present')::boolean, false) is not true
    or (v_snapshot ->> 'diagnostic_count')::integer <> 3
    or (v_snapshot ->> 'diagnostic_executed_count')::integer <> 3
    or pg_catalog.length(coalesce(v_snapshot ->> 'diagnostic_hash', '')) <> 64
    or coalesce((v_snapshot ->> 'prod_guard_valid')::boolean, false) is not true
    or v_snapshot ->> 'prod_function_item_sha256' <> 'ebaddb158c298b7eae7866253693d743cac3092c141ccc1a4f312cd32498ca47'
    or v_snapshot ->> 'prod_function_definition_sha256' <> '5d4290d1e54f4cee0080882c635a4fd6f669629322cfd8f963ef02da4eee5541'
    or pg_catalog.length(coalesce(v_snapshot ->> 'prod_guard_hash', '')) <> 64
    or (v_snapshot ->> 'diagnostic_consumers')::integer <> 0
    or coalesce(v_snapshot ->> 'owner_id', '') = ''
    or coalesce(v_snapshot ->> 'routine_id', '') = ''
    or (v_snapshot ->> 'fingerprint_count')::integer <> 346
    or v_snapshot ->> 'fingerprint_hash' <> '4216b822625f6fbeea326d09312fc2f77bb268995b552280b6e4d2951870b210'
  then
    raise exception using
      errcode = '55000',
      message = 'PERF-06 SQL Editor aborted: locked baseline gate failed';
  end if;
end;
$perf06_locked$;

do $perf06_same_precheck$

begin

  if (select initial_snapshot is distinct from locked_snapshot from pg_temp.perf06_sql_editor_context) then

    raise exception using errcode = '55000', message = 'PERF-06 SQL Editor aborted: baseline changed while locks were acquired';

  end if;

end;

$perf06_same_precheck$;

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text not null primary key);
alter table supabase_migrations.schema_migrations add column if not exists statements text[];
alter table supabase_migrations.schema_migrations add column if not exists name text;
insert into supabase_migrations.schema_migrations (version, name, statements)
values
  ('20260513000001', 'add_exercise_day', array[
      $perf06_history_0_0$alter table public.exercises
  add column if not exists day text$perf06_history_0_0$
    ]::text[]),
  ('20260527000002', 'training_sessions_source_of_truth', array[
      $perf06_history_1_0$alter table public.routines
  add column if not exists deleted_at timestamptz$perf06_history_1_0$,
      $perf06_history_1_1$alter table public.training_sessions
  add column if not exists routine_id uuid references public.routines(id) on delete restrict,
  add column if not exists calendar_week_start date,
  add column if not exists planned_day text,
  add column if not exists planned_date date,
  add column if not exists trained_date date,
  add column if not exists status text not null default 'completed',
  add column if not exists completed_at timestamptz,
  add column if not exists deleted_at timestamptz$perf06_history_1_1$,
      $perf06_history_1_2$alter table public.training_sessions
  drop constraint if exists training_sessions_status_check$perf06_history_1_2$,
      $perf06_history_1_3$alter table public.training_sessions
  add constraint training_sessions_status_check
  check (status in ('completed', 'skipped'))$perf06_history_1_3$,
      $perf06_history_1_4$alter table public.training_sessions
  drop constraint if exists training_sessions_planned_day_check$perf06_history_1_4$,
      $perf06_history_1_5$alter table public.training_sessions
  add constraint training_sessions_planned_day_check
  check (
    planned_day is null
    or planned_day in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
  )$perf06_history_1_5$,
      $perf06_history_1_6$create index if not exists training_sessions_user_trained_date_idx
  on public.training_sessions(user_id, trained_date)$perf06_history_1_6$,
      $perf06_history_1_7$create index if not exists training_sessions_user_calendar_week_idx
  on public.training_sessions(user_id, calendar_week_start)$perf06_history_1_7$,
      $perf06_history_1_8$create index if not exists training_sessions_user_routine_week_idx
  on public.training_sessions(user_id, routine_id, calendar_week_start)$perf06_history_1_8$,
      $perf06_history_1_9$create index if not exists training_sessions_user_status_idx
  on public.training_sessions(user_id, status)$perf06_history_1_9$,
      $perf06_history_1_10$create index if not exists training_sessions_user_deleted_at_idx
  on public.training_sessions(user_id, deleted_at)$perf06_history_1_10$,
      $perf06_history_1_11$-- Legacy rows with routine_id IS NULL do not participate in this unique index.
-- New training writes must provide routine_id through create_training_session_with_entries.
create unique index if not exists training_sessions_user_routine_trained_unique_idx
  on public.training_sessions(user_id, routine_id, trained_date)
  where deleted_at is null$perf06_history_1_11$,
      $perf06_history_1_12$create or replace function public.create_training_session_with_entries(
  p_routine_id uuid,
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
  v_calendar_week_start date;
  v_session_id uuid;
  v_entry jsonb;
  v_exercise_id uuid;
  v_reps jsonb;
  v_seen_exercises uuid[] := array[]::uuid[];
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_routine_id is null then
    raise exception 'La rutina es obligatoria';
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

  if not exists (
    select 1
    from public.routines r
    where r.id = p_routine_id
      and r.user_id = v_user_id
      and r.deleted_at is null
  ) then
    raise exception 'La rutina no existe o no pertenece al usuario';
  end if;

  if p_status = 'completed' and jsonb_array_length(v_entries) = 0 then
    raise exception 'Un entrenamiento completado requiere ejercicios';
  end if;

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.routine_id = p_routine_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para esta rutina y fecha';
  end if;

  v_calendar_week_start := p_trained_date - (extract(isodow from p_trained_date)::integer - 1);

  insert into public.training_sessions (
    user_id,
    routine_id,
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
    p_routine_id,
    coalesce(p_week_number, 1),
    p_trained_date,
    v_calendar_week_start,
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
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception 'Cada ejercicio debe ser un objeto JSON';
      end if;

      if nullif(v_entry->>'exercise_id', '') is null then
        raise exception 'Cada ejercicio requiere exercise_id';
      end if;

      begin
        v_exercise_id := (v_entry->>'exercise_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'exercise_id invalido';
      end;

      if v_exercise_id = any(v_seen_exercises) then
        raise exception 'El entrenamiento contiene ejercicios duplicados';
      end if;
      v_seen_exercises := array_append(v_seen_exercises, v_exercise_id);

      v_reps := v_entry->'reps';
      if v_reps is null or jsonb_typeof(v_reps) <> 'array' then
        raise exception 'Cada ejercicio requiere reps como arreglo';
      end if;

      if jsonb_array_length(v_reps) = 0 then
        raise exception 'Cada ejercicio requiere al menos una repeticion';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation then
          raise exception 'reps debe contener enteros validos';
      end;

      if not exists (
        select 1
        from public.exercises e
        where e.id = v_exercise_id
          and e.user_id = v_user_id
          and e.routine_id = p_routine_id
      ) then
        raise exception 'Un ejercicio no pertenece a la rutina del usuario';
      end if;

      insert into public.exercise_entries (
        id,
        user_id,
        session_id,
        exercise_id,
        weight,
        previous_weight,
        reps,
        rir,
        notes
      )
      values (
        coalesce((v_entry->>'id')::uuid, gen_random_uuid()),
        v_user_id,
        v_session_id,
        v_exercise_id,
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
$$$perf06_history_1_12$
    ]::text[]),
  ('20260531000001', 'training_cycles', array[
      $perf06_history_2_0$-- Fase 2.2J - Migracion productiva controlada para ciclos de Training.
-- Validada previamente en QA durante Fase 2.2C.
-- No toca public.training_sessions.
-- No toca public.exercise_entries.
-- No migra localStorage.
-- No crea datos iniciales.
--
-- Rollback conceptual, no ejecutar aqui:
-- 1. drop policy if exists ... on public.training_cycles;
-- 2. drop trigger if exists training_cycles_set_updated_at on public.training_cycles;
-- 3. drop index if exists training_cycles_one_active_per_user_idx;
-- 4. drop index if exists training_cycles_user_deleted_at_idx;
-- 5. drop index if exists training_cycles_user_created_idx;
-- 6. drop index if exists training_cycles_user_status_idx;
-- 7. drop table if exists public.training_cycles;

create table if not exists public.training_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  cycle_number integer not null check (cycle_number > 0),
  cycle_type text null,
  goal text null,
  started_at timestamptz not null,
  ended_at timestamptz null,
  status text not null check (status in ('active', 'completed', 'cancelled')),
  plan_snapshot jsonb not null default '{}'::jsonb,
  summary_snapshot jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
)$perf06_history_2_0$,
      $perf06_history_2_1$create index if not exists training_cycles_user_status_idx
  on public.training_cycles(user_id, status)$perf06_history_2_1$,
      $perf06_history_2_2$create index if not exists training_cycles_user_created_idx
  on public.training_cycles(user_id, created_at)$perf06_history_2_2$,
      $perf06_history_2_3$create index if not exists training_cycles_user_deleted_at_idx
  on public.training_cycles(user_id, deleted_at)$perf06_history_2_3$,
      $perf06_history_2_4$create unique index if not exists training_cycles_one_active_per_user_idx
  on public.training_cycles(user_id)
  where status = 'active' and deleted_at is null$perf06_history_2_4$,
      $perf06_history_2_5$drop trigger if exists training_cycles_set_updated_at on public.training_cycles$perf06_history_2_5$,
      $perf06_history_2_6$create trigger training_cycles_set_updated_at
  before update on public.training_cycles
  for each row execute function public.set_updated_at()$perf06_history_2_6$,
      $perf06_history_2_7$alter table public.training_cycles enable row level security$perf06_history_2_7$,
      $perf06_history_2_8$drop policy if exists "training cycles select own rows" on public.training_cycles$perf06_history_2_8$,
      $perf06_history_2_9$create policy "training cycles select own rows" on public.training_cycles
  for select
  using (auth.uid() = user_id)$perf06_history_2_9$,
      $perf06_history_2_10$drop policy if exists "training cycles insert own rows" on public.training_cycles$perf06_history_2_10$,
      $perf06_history_2_11$create policy "training cycles insert own rows" on public.training_cycles
  for insert
  with check (auth.uid() = user_id)$perf06_history_2_11$,
      $perf06_history_2_12$drop policy if exists "training cycles update own rows" on public.training_cycles$perf06_history_2_12$,
      $perf06_history_2_13$create policy "training cycles update own rows" on public.training_cycles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id)$perf06_history_2_13$,
      $perf06_history_2_14$-- No se crea policy de delete para authenticated.
-- No se agregan grants explicitos porque el repo no los define para tablas existentes con RLS.$perf06_history_2_14$
    ]::text[]),
  ('20260604000001', 'training_cycle_scoped_model', array[
      $perf06_history_3_0$-- Fase 2.2AN - Migracion QA candidata modelo cycle-scoped Training.
-- CANDIDATA LOCAL: no aplicar en Production sin autorizacion explicita.
-- Objetivo:
-- - Extender training_cycles con duracion normalizada.
-- - Crear tablas de planificacion por ciclo.
-- - Asociar sesiones y entries al modelo cycle-scoped.
-- - Definir RLS, grants minimos y RPCs transaccionales candidatas.

create extension if not exists "pgcrypto"$perf06_history_3_0$,
      $perf06_history_3_1$alter table public.training_cycles
  add column if not exists duration_weeks integer null,
  add column if not exists planned_start_date date null,
  add column if not exists planned_end_date date null$perf06_history_3_1$,
      $perf06_history_3_2$do $$
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
end $$$perf06_history_3_2$,
      $perf06_history_3_3$create table if not exists public.training_cycle_routines (
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
)$perf06_history_3_3$,
      $perf06_history_3_4$create table if not exists public.training_cycle_days (
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
)$perf06_history_3_4$,
      $perf06_history_3_5$create table if not exists public.training_cycle_exercises (
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
)$perf06_history_3_5$,
      $perf06_history_3_6$alter table public.training_sessions
  add column if not exists cycle_id uuid null references public.training_cycles(id) on delete restrict,
  add column if not exists cycle_day_id uuid null references public.training_cycle_days(id) on delete restrict$perf06_history_3_6$,
      $perf06_history_3_7$alter table public.exercise_entries
  add column if not exists training_cycle_exercise_id uuid null
  references public.training_cycle_exercises(id) on delete restrict$perf06_history_3_7$,
      $perf06_history_3_8$do $$
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
end $$$perf06_history_3_8$,
      $perf06_history_3_9$create index if not exists training_cycle_routines_user_cycle_idx
  on public.training_cycle_routines(user_id, cycle_id)
  where deleted_at is null$perf06_history_3_9$,
      $perf06_history_3_10$create unique index if not exists training_cycle_routines_user_cycle_name_idx
  on public.training_cycle_routines(user_id, cycle_id, lower(name))
  where deleted_at is null$perf06_history_3_10$,
      $perf06_history_3_11$create unique index if not exists training_cycle_days_one_routine_per_day_idx
  on public.training_cycle_days(user_id, cycle_id, week_index, day_code)
  where deleted_at is null$perf06_history_3_11$,
      $perf06_history_3_12$create index if not exists training_cycle_days_user_cycle_week_day_idx
  on public.training_cycle_days(user_id, cycle_id, week_index, day_code)
  where deleted_at is null$perf06_history_3_12$,
      $perf06_history_3_13$create index if not exists training_cycle_exercises_user_cycle_day_idx
  on public.training_cycle_exercises(user_id, cycle_id, day_id)
  where deleted_at is null$perf06_history_3_13$,
      $perf06_history_3_14$create index if not exists training_sessions_user_cycle_idx
  on public.training_sessions(user_id, cycle_id)
  where deleted_at is null$perf06_history_3_14$,
      $perf06_history_3_15$create index if not exists exercise_entries_user_cycle_exercise_idx
  on public.exercise_entries(user_id, training_cycle_exercise_id)
  where training_cycle_exercise_id is not null$perf06_history_3_15$,
      $perf06_history_3_16$drop trigger if exists training_cycle_routines_set_updated_at on public.training_cycle_routines$perf06_history_3_16$,
      $perf06_history_3_17$create trigger training_cycle_routines_set_updated_at
  before update on public.training_cycle_routines
  for each row execute function public.set_updated_at()$perf06_history_3_17$,
      $perf06_history_3_18$drop trigger if exists training_cycle_days_set_updated_at on public.training_cycle_days$perf06_history_3_18$,
      $perf06_history_3_19$create trigger training_cycle_days_set_updated_at
  before update on public.training_cycle_days
  for each row execute function public.set_updated_at()$perf06_history_3_19$,
      $perf06_history_3_20$drop trigger if exists training_cycle_exercises_set_updated_at on public.training_cycle_exercises$perf06_history_3_20$,
      $perf06_history_3_21$create trigger training_cycle_exercises_set_updated_at
  before update on public.training_cycle_exercises
  for each row execute function public.set_updated_at()$perf06_history_3_21$,
      $perf06_history_3_22$alter table public.training_cycle_routines enable row level security$perf06_history_3_22$,
      $perf06_history_3_23$alter table public.training_cycle_days enable row level security$perf06_history_3_23$,
      $perf06_history_3_24$alter table public.training_cycle_exercises enable row level security$perf06_history_3_24$,
      $perf06_history_3_25$alter table public.training_cycles enable row level security$perf06_history_3_25$,
      $perf06_history_3_26$drop policy if exists "training cycles select own rows" on public.training_cycles$perf06_history_3_26$,
      $perf06_history_3_27$create policy "training cycles select own rows" on public.training_cycles
  for select
  to authenticated
  using (auth.uid() = user_id)$perf06_history_3_27$,
      $perf06_history_3_28$drop policy if exists "training cycles insert own rows" on public.training_cycles$perf06_history_3_28$,
      $perf06_history_3_29$create policy "training cycles insert own rows" on public.training_cycles
  for insert
  to authenticated
  with check (auth.uid() = user_id)$perf06_history_3_29$,
      $perf06_history_3_30$drop policy if exists "training cycles update own rows" on public.training_cycles$perf06_history_3_30$,
      $perf06_history_3_31$create policy "training cycles update own rows" on public.training_cycles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id)$perf06_history_3_31$,
      $perf06_history_3_32$drop policy if exists "training cycle routines select own rows" on public.training_cycle_routines$perf06_history_3_32$,
      $perf06_history_3_33$create policy "training cycle routines select own rows" on public.training_cycle_routines
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
  )$perf06_history_3_33$,
      $perf06_history_3_34$drop policy if exists "training cycle routines insert own rows" on public.training_cycle_routines$perf06_history_3_34$,
      $perf06_history_3_35$create policy "training cycle routines insert own rows" on public.training_cycle_routines
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
  )$perf06_history_3_35$,
      $perf06_history_3_36$drop policy if exists "training cycle routines update own rows" on public.training_cycle_routines$perf06_history_3_36$,
      $perf06_history_3_37$create policy "training cycle routines update own rows" on public.training_cycle_routines
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
  )$perf06_history_3_37$,
      $perf06_history_3_38$drop policy if exists "training cycle days select own rows" on public.training_cycle_days$perf06_history_3_38$,
      $perf06_history_3_39$create policy "training cycle days select own rows" on public.training_cycle_days
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
  )$perf06_history_3_39$,
      $perf06_history_3_40$drop policy if exists "training cycle days insert own rows" on public.training_cycle_days$perf06_history_3_40$,
      $perf06_history_3_41$create policy "training cycle days insert own rows" on public.training_cycle_days
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
  )$perf06_history_3_41$,
      $perf06_history_3_42$drop policy if exists "training cycle days update own rows" on public.training_cycle_days$perf06_history_3_42$,
      $perf06_history_3_43$create policy "training cycle days update own rows" on public.training_cycle_days
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
  )$perf06_history_3_43$,
      $perf06_history_3_44$drop policy if exists "training cycle exercises select own rows" on public.training_cycle_exercises$perf06_history_3_44$,
      $perf06_history_3_45$create policy "training cycle exercises select own rows" on public.training_cycle_exercises
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
  )$perf06_history_3_45$,
      $perf06_history_3_46$drop policy if exists "training cycle exercises insert own rows" on public.training_cycle_exercises$perf06_history_3_46$,
      $perf06_history_3_47$create policy "training cycle exercises insert own rows" on public.training_cycle_exercises
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
  )$perf06_history_3_47$,
      $perf06_history_3_48$drop policy if exists "training cycle exercises update own rows" on public.training_cycle_exercises$perf06_history_3_48$,
      $perf06_history_3_49$create policy "training cycle exercises update own rows" on public.training_cycle_exercises
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
  )$perf06_history_3_49$,
      $perf06_history_3_50$drop policy if exists "sessions own rows" on public.training_sessions$perf06_history_3_50$,
      $perf06_history_3_51$create policy "sessions own rows" on public.training_sessions
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
  )$perf06_history_3_51$,
      $perf06_history_3_52$drop policy if exists "entries own rows" on public.exercise_entries$perf06_history_3_52$,
      $perf06_history_3_53$create policy "entries own rows" on public.exercise_entries
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
  )$perf06_history_3_53$,
      $perf06_history_3_54$-- Normalizacion explicita de permisos QA.
-- 2.2AP detecto grants amplios existentes en tablas legacy de ejecucion.
revoke all on table public.training_sessions from anon$perf06_history_3_54$,
      $perf06_history_3_55$revoke all on table public.exercise_entries from anon$perf06_history_3_55$,
      $perf06_history_3_56$revoke all on table public.training_cycles from anon$perf06_history_3_56$,
      $perf06_history_3_57$revoke all on table public.training_cycle_routines from anon$perf06_history_3_57$,
      $perf06_history_3_58$revoke all on table public.training_cycle_days from anon$perf06_history_3_58$,
      $perf06_history_3_59$revoke all on table public.training_cycle_exercises from anon$perf06_history_3_59$,
      $perf06_history_3_60$revoke delete, truncate, references, trigger on table public.training_sessions from authenticated$perf06_history_3_60$,
      $perf06_history_3_61$revoke delete, truncate, references, trigger on table public.exercise_entries from authenticated$perf06_history_3_61$,
      $perf06_history_3_62$revoke delete, truncate, references, trigger on table public.training_cycles from authenticated$perf06_history_3_62$,
      $perf06_history_3_63$revoke delete, truncate, references, trigger on table public.training_cycle_routines from authenticated$perf06_history_3_63$,
      $perf06_history_3_64$revoke delete, truncate, references, trigger on table public.training_cycle_days from authenticated$perf06_history_3_64$,
      $perf06_history_3_65$revoke delete, truncate, references, trigger on table public.training_cycle_exercises from authenticated$perf06_history_3_65$,
      $perf06_history_3_66$grant select, insert, update on table public.training_cycle_routines to authenticated$perf06_history_3_66$,
      $perf06_history_3_67$grant select, insert, update on table public.training_cycle_days to authenticated$perf06_history_3_67$,
      $perf06_history_3_68$grant select, insert, update on table public.training_cycle_exercises to authenticated$perf06_history_3_68$,
      $perf06_history_3_69$grant select, insert, update on table public.training_cycles to authenticated$perf06_history_3_69$,
      $perf06_history_3_70$grant select, insert, update on table public.training_sessions to authenticated$perf06_history_3_70$,
      $perf06_history_3_71$grant select, insert, update on table public.exercise_entries to authenticated$perf06_history_3_71$,
      $perf06_history_3_72$create or replace function public.create_training_cycle_with_plan(
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
$$$perf06_history_3_72$,
      $perf06_history_3_73$create or replace function public.create_training_session_with_cycle_entries(
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
$$$perf06_history_3_73$,
      $perf06_history_3_74$grant execute on function public.create_training_cycle_with_plan(
  text,
  integer,
  text,
  text,
  integer,
  date,
  date,
  jsonb
) to authenticated$perf06_history_3_74$,
      $perf06_history_3_75$grant execute on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) to authenticated$perf06_history_3_75$,
      $perf06_history_3_76$-- No se concede delete a authenticated.
-- No se conceden privilegios a anon para el modelo cycle-scoped.$perf06_history_3_76$
    ]::text[]),
  ('20260604000002', 'training_cycle_scoped_policy_fix', array[
      $perf06_history_4_0$-- Fase 2.2AQ - Patch candidato QA para corregir policies cycle-scoped.
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
end $$$perf06_history_4_0$,
      $perf06_history_4_1$do $$
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
end $$$perf06_history_4_1$,
      $perf06_history_4_2$drop policy if exists "training cycle days select own rows" on public.training_cycle_days$perf06_history_4_2$,
      $perf06_history_4_3$create policy "training cycle days select own rows" on public.training_cycle_days
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
  )$perf06_history_4_3$,
      $perf06_history_4_4$drop policy if exists "training cycle days insert own rows" on public.training_cycle_days$perf06_history_4_4$,
      $perf06_history_4_5$create policy "training cycle days insert own rows" on public.training_cycle_days
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
  )$perf06_history_4_5$,
      $perf06_history_4_6$drop policy if exists "training cycle days update own rows" on public.training_cycle_days$perf06_history_4_6$,
      $perf06_history_4_7$create policy "training cycle days update own rows" on public.training_cycle_days
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
  )$perf06_history_4_7$,
      $perf06_history_4_8$drop policy if exists "training cycle exercises select own rows" on public.training_cycle_exercises$perf06_history_4_8$,
      $perf06_history_4_9$create policy "training cycle exercises select own rows" on public.training_cycle_exercises
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
  )$perf06_history_4_9$,
      $perf06_history_4_10$drop policy if exists "training cycle exercises insert own rows" on public.training_cycle_exercises$perf06_history_4_10$,
      $perf06_history_4_11$create policy "training cycle exercises insert own rows" on public.training_cycle_exercises
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
  )$perf06_history_4_11$,
      $perf06_history_4_12$drop policy if exists "training cycle exercises update own rows" on public.training_cycle_exercises$perf06_history_4_12$,
      $perf06_history_4_13$create policy "training cycle exercises update own rows" on public.training_cycle_exercises
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
  )$perf06_history_4_13$,
      $perf06_history_4_14$drop policy if exists "sessions own rows" on public.training_sessions$perf06_history_4_14$,
      $perf06_history_4_15$create policy "sessions own rows" on public.training_sessions
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
  )$perf06_history_4_15$,
      $perf06_history_4_16$drop policy if exists "entries own rows" on public.exercise_entries$perf06_history_4_16$,
      $perf06_history_4_17$create policy "entries own rows" on public.exercise_entries
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
  )$perf06_history_4_17$
    ]::text[]),
  ('20260605000001', 'training_cycle_scoped_session_entries_contract', array[
      $perf06_history_5_0$-- Fase 2.2AW-SQL - Patch candidato QA para persistencia cycle-scoped pura.
-- CANDIDATA LOCAL: no aplicar sin autorizacion explicita.
-- Objetivo:
-- - Permitir exercise_entries sin exercise_id legacy cuando existe training_cycle_exercise_id.
-- - Mantener compatibilidad legacy para entries con exercise_id.
-- - Evitar mezcla artificial entre legacy y cycle-scoped.
-- - Reemplazar la RPC de guardado de sesiones cycle-scoped sin tocar Production.

alter table public.exercise_entries
  alter column exercise_id drop not null$perf06_history_5_0$,
      $perf06_history_5_1$do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'exercise_entries_exercise_or_cycle_exercise_check'
      and conrelid = 'public.exercise_entries'::regclass
  ) then
    alter table public.exercise_entries
      add constraint exercise_entries_exercise_or_cycle_exercise_check
      check (
        exercise_id is not null
        or training_cycle_exercise_id is not null
      );
  end if;
end $$$perf06_history_5_1$,
      $perf06_history_5_2$drop policy if exists "entries own rows" on public.exercise_entries$perf06_history_5_2$,
      $perf06_history_5_3$create policy "entries own rows" on public.exercise_entries
  for all
  to authenticated
  using (
    auth.uid() = exercise_entries.user_id
    and exists (
      select 1
      from public.training_sessions s
      where s.id = exercise_entries.session_id
        and s.user_id = auth.uid()
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
                and e.user_id = auth.uid()
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
                and tce.user_id = auth.uid()
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
                        and e.user_id = auth.uid()
                    )
                  )
                )
            )
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
                and e.user_id = auth.uid()
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
                and tce.user_id = auth.uid()
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
                        and e.user_id = auth.uid()
                    )
                  )
                )
            )
          )
        )
    )
  )$perf06_history_5_3$,
      $perf06_history_5_4$create or replace function public.create_training_session_with_cycle_entries(
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

      if v_legacy_exercise_id is not null and not exists (
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
            v_legacy_exercise_id is null
            or tce.source_legacy_exercise_id = v_legacy_exercise_id
          )
      ) then
        raise exception 'El ejercicio planificado no pertenece al ciclo/dia del usuario o no corresponde al ejercicio legacy informado';
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
$$$perf06_history_5_4$,
      $perf06_history_5_5$grant execute on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) to authenticated$perf06_history_5_5$,
      $perf06_history_5_6$-- Rollback QA sugerido, no ejecutar sin autorizacion:
-- 1. Apagar feature flag QA.
-- 2. Preservar evidencia de sesiones/entries creadas por la prueba.
-- 3. Si existen exercise_entries con exercise_id null, no se puede restaurar NOT NULL
--    sin limpiar o corregir esos datos QA con autorizacion explicita.
-- 4. Dropear la constraint nueva si se vuelve al contrato anterior:
--    alter table public.exercise_entries
--      drop constraint if exists exercise_entries_exercise_or_cycle_exercise_check;
-- 5. Reinstalar la version previa de public.create_training_session_with_cycle_entries
--    desde 20260604_training_cycle_scoped_model.sql si se requiere volver al contrato anterior.
-- 6. Reinstalar la policy "entries own rows" previa si se requiere volver al contrato legacy estricto.$perf06_history_5_6$
    ]::text[]),
  ('20260607000001', 'training_cycle_scoped_snapshot_source', array[
      $perf06_history_6_0$-- Fase 2.2BU: normalize the external cycle-scoped snapshot marker for new cycles.
-- Historical/QA cycles can keep plan_snapshot.source = "cycle-scoped-qa".
-- New cycles created through this RPC use plan_snapshot.source = "cycle-scoped".

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
$$$perf06_history_6_0$,
      $perf06_history_6_1$grant execute on function public.create_training_cycle_with_plan(
  text,
  integer,
  text,
  text,
  integer,
  date,
  date,
  jsonb
) to authenticated$perf06_history_6_1$
    ]::text[]),
  ('20260608000001', 'training_daily_readiness', array[
      $perf06_history_7_0$-- Fase 2.2CO: idempotencia diaria del formulario de motivacion/readiness.
-- No toca training_sessions, exercise_entries ni training_cycles.

create table if not exists public.training_daily_readiness (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_daily_readiness_user_local_date_key unique (user_id, local_date),
  constraint training_daily_readiness_payload_check check (
    jsonb_typeof(payload) = 'object'
    and payload ? 'skipped'
    and jsonb_typeof(payload->'skipped') = 'boolean'
    and (
      (payload->>'skipped')::boolean = true
      or (
        jsonb_typeof(payload->'motivation') = 'number'
        and jsonb_typeof(payload->'hydration') = 'number'
        and jsonb_typeof(payload->'sleep') = 'number'
        and jsonb_typeof(payload->'energy') = 'number'
        and (payload->>'motivation')::integer between 1 and 7
        and (payload->>'hydration')::integer between 1 and 7
        and (payload->>'sleep')::integer between 1 and 7
        and (payload->>'energy')::integer between 1 and 7
        and (payload->>'motivation')::numeric = (payload->>'motivation')::integer
        and (payload->>'hydration')::numeric = (payload->>'hydration')::integer
        and (payload->>'sleep')::numeric = (payload->>'sleep')::integer
        and (payload->>'energy')::numeric = (payload->>'energy')::integer
      )
    )
  )
)$perf06_history_7_0$,
      $perf06_history_7_1$drop trigger if exists training_daily_readiness_set_updated_at on public.training_daily_readiness$perf06_history_7_1$,
      $perf06_history_7_2$create trigger training_daily_readiness_set_updated_at
  before update on public.training_daily_readiness
  for each row execute function public.set_updated_at()$perf06_history_7_2$,
      $perf06_history_7_3$alter table public.training_daily_readiness enable row level security$perf06_history_7_3$,
      $perf06_history_7_4$drop policy if exists "daily readiness own select" on public.training_daily_readiness$perf06_history_7_4$,
      $perf06_history_7_5$create policy "daily readiness own select" on public.training_daily_readiness
  for select
  to authenticated
  using (auth.uid() = user_id)$perf06_history_7_5$,
      $perf06_history_7_6$-- No DELETE policy: users cannot remove daily readiness records through the API.
-- No direct INSERT/UPDATE grants: writes go through save_daily_training_readiness.

revoke all on table public.training_daily_readiness from public$perf06_history_7_6$,
      $perf06_history_7_7$revoke all on table public.training_daily_readiness from anon$perf06_history_7_7$,
      $perf06_history_7_8$revoke all on table public.training_daily_readiness from authenticated$perf06_history_7_8$,
      $perf06_history_7_9$grant select on table public.training_daily_readiness to authenticated$perf06_history_7_9$,
      $perf06_history_7_10$drop function if exists public.save_daily_training_readiness(jsonb, date)$perf06_history_7_10$,
      $perf06_history_7_11$create or replace function public.save_daily_training_readiness(
  p_payload jsonb
)
returns table (
  id uuid,
  local_date date,
  payload jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_local_date date := (now() at time zone 'America/Santiago')::date;
  v_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
  v_updated_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload de readiness invalido';
  end if;

  if not (p_payload ? 'skipped') or jsonb_typeof(p_payload->'skipped') <> 'boolean' then
    raise exception 'Payload de readiness invalido';
  end if;

  if coalesce((p_payload->>'skipped')::boolean, false) = false then
    if jsonb_typeof(p_payload->'motivation') <> 'number'
      or jsonb_typeof(p_payload->'hydration') <> 'number'
      or jsonb_typeof(p_payload->'sleep') <> 'number'
      or jsonb_typeof(p_payload->'energy') <> 'number'
      or (p_payload->>'motivation')::integer not between 1 and 7
      or (p_payload->>'hydration')::integer not between 1 and 7
      or (p_payload->>'sleep')::integer not between 1 and 7
      or (p_payload->>'energy')::integer not between 1 and 7
      or (p_payload->>'motivation')::numeric <> (p_payload->>'motivation')::integer
      or (p_payload->>'hydration')::numeric <> (p_payload->>'hydration')::integer
      or (p_payload->>'sleep')::numeric <> (p_payload->>'sleep')::integer
      or (p_payload->>'energy')::numeric <> (p_payload->>'energy')::integer then
      raise exception 'Payload de readiness invalido';
    end if;
  end if;

  return query
  insert into public.training_daily_readiness as readiness (
    user_id,
    local_date,
    payload
  )
  values (
    v_user_id,
    v_local_date,
    p_payload
  )
  on conflict (user_id, local_date) do nothing
  returning
    readiness.id,
    readiness.local_date,
    readiness.payload,
    readiness.created_at,
    readiness.updated_at;

  if found then
    return;
  end if;

  select
    readiness.id,
    readiness.payload,
    readiness.created_at,
    readiness.updated_at
  into
    v_id,
    v_payload,
    v_created_at,
    v_updated_at
  from public.training_daily_readiness as readiness
  where readiness.user_id = v_user_id
    and readiness.local_date = v_local_date;

  if v_id is null then
    raise exception 'No se pudo confirmar el readiness diario existente';
  end if;

  id := v_id;
  local_date := v_local_date;
  payload := v_payload;
  created_at := v_created_at;
  updated_at := v_updated_at;
  return next;
end;
$$$perf06_history_7_11$,
      $perf06_history_7_12$revoke all on function public.save_daily_training_readiness(jsonb) from public$perf06_history_7_12$,
      $perf06_history_7_13$revoke all on function public.save_daily_training_readiness(jsonb) from anon$perf06_history_7_13$,
      $perf06_history_7_14$grant execute on function public.save_daily_training_readiness(jsonb) to authenticated$perf06_history_7_14$
    ]::text[]),
  ('20260609000001', 'fix_training_daily_readiness_rpc_ambiguity', array[
      $perf06_history_8_0$create or replace function public.save_daily_training_readiness(
  p_payload jsonb
)
returns table (
  id uuid,
  local_date date,
  payload jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_local_date date := (now() at time zone 'America/Santiago')::date;
  v_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
  v_updated_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload de readiness invalido';
  end if;

  if not (p_payload ? 'skipped') or jsonb_typeof(p_payload->'skipped') <> 'boolean' then
    raise exception 'Payload de readiness invalido';
  end if;

  if coalesce((p_payload->>'skipped')::boolean, false) = false then
    if jsonb_typeof(p_payload->'motivation') <> 'number'
      or jsonb_typeof(p_payload->'hydration') <> 'number'
      or jsonb_typeof(p_payload->'sleep') <> 'number'
      or jsonb_typeof(p_payload->'energy') <> 'number'
      or (p_payload->>'motivation')::integer not between 1 and 7
      or (p_payload->>'hydration')::integer not between 1 and 7
      or (p_payload->>'sleep')::integer not between 1 and 7
      or (p_payload->>'energy')::integer not between 1 and 7
      or (p_payload->>'motivation')::numeric <> (p_payload->>'motivation')::integer
      or (p_payload->>'hydration')::numeric <> (p_payload->>'hydration')::integer
      or (p_payload->>'sleep')::numeric <> (p_payload->>'sleep')::integer
      or (p_payload->>'energy')::numeric <> (p_payload->>'energy')::integer then
      raise exception 'Payload de readiness invalido';
    end if;
  end if;

  insert into public.training_daily_readiness as readiness (
    user_id,
    local_date,
    payload
  )
  values (
    v_user_id,
    v_local_date,
    p_payload
  )
  on conflict on constraint training_daily_readiness_user_local_date_key
  do nothing
  returning
    readiness.id,
    readiness.payload,
    readiness.created_at,
    readiness.updated_at
  into
    v_id,
    v_payload,
    v_created_at,
    v_updated_at;

  if v_id is not null then
    id := v_id;
    local_date := v_local_date;
    payload := v_payload;
    created_at := v_created_at;
    updated_at := v_updated_at;
    return next;
    return;
  end if;

  select
    readiness.id,
    readiness.payload,
    readiness.created_at,
    readiness.updated_at
  into
    v_id,
    v_payload,
    v_created_at,
    v_updated_at
  from public.training_daily_readiness as readiness
  where readiness.user_id = v_user_id
    and readiness.local_date = v_local_date;

  if v_id is null then
    raise exception 'No se pudo confirmar el readiness diario existente';
  end if;

  id := v_id;
  local_date := v_local_date;
  payload := v_payload;
  created_at := v_created_at;
  updated_at := v_updated_at;
  return next;
end;
$$$perf06_history_8_0$
    ]::text[]),
  ('20260610000001', 'training_exercise_lineage', array[
      $perf06_history_9_0$-- Fase 2.2CQ: stable cross-cycle exercise lineage.
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
)$perf06_history_9_0$,
      $perf06_history_9_1$create unique index if not exists training_exercise_lineages_user_legacy_unique_idx
  on public.training_exercise_lineages (user_id, source_legacy_exercise_id)
  where source_legacy_exercise_id is not null$perf06_history_9_1$,
      $perf06_history_9_2$create unique index if not exists training_exercise_lineages_user_origin_cycle_exercise_unique_idx
  on public.training_exercise_lineages (user_id, origin_training_cycle_exercise_id)
  where origin_training_cycle_exercise_id is not null$perf06_history_9_2$,
      $perf06_history_9_3$create index if not exists training_exercise_lineages_user_idx
  on public.training_exercise_lineages (user_id)$perf06_history_9_3$,
      $perf06_history_9_4$drop trigger if exists set_training_exercise_lineages_updated_at on public.training_exercise_lineages$perf06_history_9_4$,
      $perf06_history_9_5$create trigger set_training_exercise_lineages_updated_at
  before update on public.training_exercise_lineages
  for each row execute function public.set_updated_at()$perf06_history_9_5$,
      $perf06_history_9_6$alter table public.training_cycle_exercises
  add column if not exists exercise_lineage_id uuid null$perf06_history_9_6$,
      $perf06_history_9_7$alter table public.exercise_entries
  add column if not exists exercise_lineage_id uuid null$perf06_history_9_7$,
      $perf06_history_9_8$insert into public.training_exercise_lineages (
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
do nothing$perf06_history_9_8$,
      $perf06_history_9_9$update public.training_cycle_exercises tce
set exercise_lineage_id = tel.id
from public.training_exercise_lineages tel
where tce.exercise_lineage_id is null
  and tce.source_legacy_exercise_id is not null
  and tel.user_id = tce.user_id
  and tel.source_legacy_exercise_id = tce.source_legacy_exercise_id$perf06_history_9_9$,
      $perf06_history_9_10$insert into public.training_exercise_lineages (
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
do nothing$perf06_history_9_10$,
      $perf06_history_9_11$update public.training_cycle_exercises tce
set exercise_lineage_id = tel.id
from public.training_exercise_lineages tel
where tce.exercise_lineage_id is null
  and tel.user_id = tce.user_id
  and tel.origin_training_cycle_exercise_id = tce.id$perf06_history_9_11$,
      $perf06_history_9_12$update public.exercise_entries ee
set exercise_lineage_id = tce.exercise_lineage_id
from public.training_cycle_exercises tce
where ee.exercise_lineage_id is null
  and ee.training_cycle_exercise_id = tce.id
  and ee.user_id = tce.user_id
  and tce.exercise_lineage_id is not null$perf06_history_9_12$,
      $perf06_history_9_13$update public.exercise_entries ee
set exercise_lineage_id = tel.id
from public.training_exercise_lineages tel
where ee.exercise_lineage_id is null
  and ee.exercise_id is not null
  and tel.user_id = ee.user_id
  and tel.source_legacy_exercise_id = ee.exercise_id$perf06_history_9_13$,
      $perf06_history_9_14$do $$
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
end $$$perf06_history_9_14$,
      $perf06_history_9_15$create index if not exists training_cycle_exercises_user_lineage_idx
  on public.training_cycle_exercises (user_id, exercise_lineage_id)
  where exercise_lineage_id is not null and deleted_at is null$perf06_history_9_15$,
      $perf06_history_9_16$create index if not exists exercise_entries_user_lineage_created_idx
  on public.exercise_entries (user_id, exercise_lineage_id, created_at desc)
  where exercise_lineage_id is not null$perf06_history_9_16$,
      $perf06_history_9_17$alter table public.training_exercise_lineages enable row level security$perf06_history_9_17$,
      $perf06_history_9_18$drop policy if exists "lineages own rows select" on public.training_exercise_lineages$perf06_history_9_18$,
      $perf06_history_9_19$drop policy if exists "lineages own rows insert" on public.training_exercise_lineages$perf06_history_9_19$,
      $perf06_history_9_20$drop policy if exists "lineages own rows update" on public.training_exercise_lineages$perf06_history_9_20$,
      $perf06_history_9_21$create policy "lineages own rows select"
  on public.training_exercise_lineages
  for select
  to authenticated
  using (user_id = auth.uid())$perf06_history_9_21$,
      $perf06_history_9_22$create policy "lineages own rows insert"
  on public.training_exercise_lineages
  for insert
  to authenticated
  with check (user_id = auth.uid())$perf06_history_9_22$,
      $perf06_history_9_23$create policy "lineages own rows update"
  on public.training_exercise_lineages
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid())$perf06_history_9_23$,
      $perf06_history_9_24$revoke all on table public.training_exercise_lineages from anon$perf06_history_9_24$,
      $perf06_history_9_25$revoke all on table public.training_exercise_lineages from authenticated$perf06_history_9_25$,
      $perf06_history_9_26$grant select, insert, update on table public.training_exercise_lineages to authenticated$perf06_history_9_26$,
      $perf06_history_9_27$create or replace function public.create_training_cycle_with_plan(
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
$$$perf06_history_9_27$,
      $perf06_history_9_28$grant execute on function public.create_training_cycle_with_plan(
  text,
  integer,
  text,
  text,
  integer,
  date,
  date,
  jsonb
) to authenticated$perf06_history_9_28$,
      $perf06_history_9_29$create or replace function public.create_training_session_with_cycle_entries(
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
$$$perf06_history_9_29$,
      $perf06_history_9_30$grant execute on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) to authenticated$perf06_history_9_30$,
      $perf06_history_9_31$-- Suggested read-only prechecks before any remote execution:
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
-- then revokes lineage table grants, and only then evaluates whether new lineage-only rows can be removed.$perf06_history_9_31$
    ]::text[]),
  ('20260620000001', 'training_workout_readiness', array[
      $perf06_history_10_0$-- Release B - D2: readiness tied to a concrete workout attempt.
-- Additive only: keeps legacy training_daily_readiness and save_daily_training_readiness(jsonb) intact.
--
-- Manual rollback concept, only with separate authorization:
-- 1. drop function public.link_training_workout_readiness_session_v2(uuid, uuid);
-- 2. drop function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb);
-- 3. drop table public.training_workout_readiness;

create table if not exists public.training_workout_readiness (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_attempt_id uuid not null,
  cycle_id uuid not null,
  cycle_day_id uuid not null,
  workout_started_at timestamptz not null,
  local_date date not null,
  payload jsonb not null,
  training_session_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_workout_readiness_user_attempt_key unique (user_id, workout_attempt_id),
  constraint training_workout_readiness_cycle_user_fk
    foreign key (cycle_id, user_id)
    references public.training_cycles(id, user_id)
    on delete restrict,
  constraint training_workout_readiness_cycle_day_cycle_fk
    foreign key (cycle_day_id, cycle_id)
    references public.training_cycle_days(id, cycle_id)
    on delete restrict,
  constraint training_workout_readiness_session_fk
    foreign key (training_session_id)
    references public.training_sessions(id)
    on delete restrict,
  constraint training_workout_readiness_payload_check check (
    jsonb_typeof(payload) = 'object'
    and payload ? 'skipped'
    and jsonb_typeof(payload->'skipped') = 'boolean'
    and (
      (payload->>'skipped')::boolean = true
      or (
        jsonb_typeof(payload->'motivation') = 'number'
        and jsonb_typeof(payload->'hydration') = 'number'
        and jsonb_typeof(payload->'sleep') = 'number'
        and jsonb_typeof(payload->'energy') = 'number'
        and (payload->>'motivation')::integer between 1 and 7
        and (payload->>'hydration')::integer between 1 and 7
        and (payload->>'sleep')::integer between 1 and 7
        and (payload->>'energy')::integer between 1 and 7
        and (payload->>'motivation')::numeric = (payload->>'motivation')::integer
        and (payload->>'hydration')::numeric = (payload->>'hydration')::integer
        and (payload->>'sleep')::numeric = (payload->>'sleep')::integer
        and (payload->>'energy')::numeric = (payload->>'energy')::integer
      )
    )
  )
)$perf06_history_10_0$,
      $perf06_history_10_1$create unique index if not exists training_workout_readiness_session_key
  on public.training_workout_readiness(training_session_id)
  where training_session_id is not null$perf06_history_10_1$,
      $perf06_history_10_2$create index if not exists training_workout_readiness_user_created_idx
  on public.training_workout_readiness(user_id, created_at desc)$perf06_history_10_2$,
      $perf06_history_10_3$create index if not exists training_workout_readiness_cycle_day_created_idx
  on public.training_workout_readiness(user_id, cycle_id, cycle_day_id, created_at desc)$perf06_history_10_3$,
      $perf06_history_10_4$drop trigger if exists training_workout_readiness_set_updated_at on public.training_workout_readiness$perf06_history_10_4$,
      $perf06_history_10_5$create trigger training_workout_readiness_set_updated_at
  before update on public.training_workout_readiness
  for each row execute function public.set_updated_at()$perf06_history_10_5$,
      $perf06_history_10_6$alter table public.training_workout_readiness enable row level security$perf06_history_10_6$,
      $perf06_history_10_7$drop policy if exists "workout readiness own select" on public.training_workout_readiness$perf06_history_10_7$,
      $perf06_history_10_8$create policy "workout readiness own select" on public.training_workout_readiness
  for select
  to authenticated
  using (auth.uid() = user_id)$perf06_history_10_8$,
      $perf06_history_10_9$revoke all on table public.training_workout_readiness from public$perf06_history_10_9$,
      $perf06_history_10_10$revoke all on table public.training_workout_readiness from anon$perf06_history_10_10$,
      $perf06_history_10_11$revoke all on table public.training_workout_readiness from authenticated$perf06_history_10_11$,
      $perf06_history_10_12$revoke all on table public.training_workout_readiness from service_role$perf06_history_10_12$,
      $perf06_history_10_13$grant select on table public.training_workout_readiness to authenticated$perf06_history_10_13$,
      $perf06_history_10_14$create or replace function public.save_training_workout_readiness_v2(
  p_workout_attempt_id uuid,
  p_cycle_id uuid,
  p_cycle_day_id uuid,
  p_workout_started_at timestamptz,
  p_payload jsonb
)
returns table (
  id uuid,
  user_id uuid,
  workout_attempt_id uuid,
  cycle_id uuid,
  cycle_day_id uuid,
  workout_started_at timestamptz,
  local_date date,
  payload jsonb,
  training_session_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  context_mismatch boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_local_date date;
  v_id uuid;
  v_persisted_user_id uuid;
  v_persisted_workout_attempt_id uuid;
  v_persisted_cycle_id uuid;
  v_persisted_cycle_day_id uuid;
  v_persisted_workout_started_at timestamptz;
  v_persisted_local_date date;
  v_training_session_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
  v_updated_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_workout_attempt_id is null then
    raise exception 'workout_attempt_id requerido';
  end if;

  if p_cycle_id is null then
    raise exception 'cycle_id requerido';
  end if;

  if p_cycle_day_id is null then
    raise exception 'cycle_day_id requerido';
  end if;

  if p_workout_started_at is null then
    raise exception 'workout_started_at requerido';
  end if;

  v_local_date := (p_workout_started_at at time zone 'America/Santiago')::date;

  select
    readiness.id,
    readiness.user_id,
    readiness.workout_attempt_id,
    readiness.cycle_id,
    readiness.cycle_day_id,
    readiness.workout_started_at,
    readiness.local_date,
    readiness.payload,
    readiness.training_session_id,
    readiness.created_at,
    readiness.updated_at,
    (
      readiness.cycle_id is distinct from p_cycle_id
      or readiness.cycle_day_id is distinct from p_cycle_day_id
      or readiness.workout_started_at is distinct from p_workout_started_at
      or readiness.local_date is distinct from v_local_date
      or readiness.payload is distinct from p_payload
    )
  into
    v_id,
    v_persisted_user_id,
    v_persisted_workout_attempt_id,
    v_persisted_cycle_id,
    v_persisted_cycle_day_id,
    v_persisted_workout_started_at,
    v_persisted_local_date,
    v_payload,
    v_training_session_id,
    v_created_at,
    v_updated_at,
    context_mismatch
  from public.training_workout_readiness as readiness
  where readiness.user_id = v_user_id
    and readiness.workout_attempt_id = p_workout_attempt_id;

  if v_id is not null then
    id := v_id;
    user_id := v_persisted_user_id;
    workout_attempt_id := v_persisted_workout_attempt_id;
    cycle_id := v_persisted_cycle_id;
    cycle_day_id := v_persisted_cycle_day_id;
    workout_started_at := v_persisted_workout_started_at;
    local_date := v_persisted_local_date;
    payload := v_payload;
    training_session_id := v_training_session_id;
    created_at := v_created_at;
    updated_at := v_updated_at;
    return next;
    return;
  end if;

  if p_workout_started_at > now() + interval '5 minutes'
    or p_workout_started_at < now() - interval '36 hours' then
    raise exception 'workout_started_at fuera de ventana permitida';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload de readiness invalido';
  end if;

  if not (p_payload ? 'skipped') or jsonb_typeof(p_payload->'skipped') <> 'boolean' then
    raise exception 'Payload de readiness invalido';
  end if;

  if coalesce((p_payload->>'skipped')::boolean, false) = false then
    if jsonb_typeof(p_payload->'motivation') <> 'number'
      or jsonb_typeof(p_payload->'hydration') <> 'number'
      or jsonb_typeof(p_payload->'sleep') <> 'number'
      or jsonb_typeof(p_payload->'energy') <> 'number'
      or (p_payload->>'motivation')::integer not between 1 and 7
      or (p_payload->>'hydration')::integer not between 1 and 7
      or (p_payload->>'sleep')::integer not between 1 and 7
      or (p_payload->>'energy')::integer not between 1 and 7
      or (p_payload->>'motivation')::numeric <> (p_payload->>'motivation')::integer
      or (p_payload->>'hydration')::numeric <> (p_payload->>'hydration')::integer
      or (p_payload->>'sleep')::numeric <> (p_payload->>'sleep')::integer
      or (p_payload->>'energy')::numeric <> (p_payload->>'energy')::integer then
      raise exception 'Payload de readiness invalido';
    end if;
  end if;

  if not exists (
    select 1
    from public.training_cycles as cycle
    where cycle.id = p_cycle_id
      and cycle.user_id = v_user_id
      and cycle.deleted_at is null
  ) then
    raise exception 'El ciclo no pertenece al usuario autenticado';
  end if;

  if not exists (
    select 1
    from public.training_cycle_days as day
    where day.id = p_cycle_day_id
      and day.cycle_id = p_cycle_id
      and day.deleted_at is null
  ) then
    raise exception 'El dia no pertenece al ciclo indicado';
  end if;

  insert into public.training_workout_readiness as readiness (
    user_id,
    workout_attempt_id,
    cycle_id,
    cycle_day_id,
    workout_started_at,
    local_date,
    payload
  )
  values (
    v_user_id,
    p_workout_attempt_id,
    p_cycle_id,
    p_cycle_day_id,
    p_workout_started_at,
    v_local_date,
    p_payload
  )
  on conflict on constraint training_workout_readiness_user_attempt_key
  do nothing
  returning
    readiness.id,
    readiness.user_id,
    readiness.workout_attempt_id,
    readiness.cycle_id,
    readiness.cycle_day_id,
    readiness.workout_started_at,
    readiness.local_date,
    readiness.training_session_id,
    readiness.payload,
    readiness.created_at,
    readiness.updated_at
  into
    v_id,
    v_persisted_user_id,
    v_persisted_workout_attempt_id,
    v_persisted_cycle_id,
    v_persisted_cycle_day_id,
    v_persisted_workout_started_at,
    v_persisted_local_date,
    v_training_session_id,
    v_payload,
    v_created_at,
    v_updated_at;

  if v_id is null then
    select
      readiness.id,
      readiness.user_id,
      readiness.workout_attempt_id,
      readiness.cycle_id,
      readiness.cycle_day_id,
      readiness.workout_started_at,
      readiness.local_date,
      readiness.training_session_id,
      readiness.payload,
      readiness.created_at,
      readiness.updated_at,
      (
        readiness.cycle_id is distinct from p_cycle_id
        or readiness.cycle_day_id is distinct from p_cycle_day_id
        or readiness.workout_started_at is distinct from p_workout_started_at
        or readiness.local_date is distinct from v_local_date
        or readiness.payload is distinct from p_payload
      )
    into
      v_id,
      v_persisted_user_id,
      v_persisted_workout_attempt_id,
      v_persisted_cycle_id,
      v_persisted_cycle_day_id,
      v_persisted_workout_started_at,
      v_persisted_local_date,
      v_training_session_id,
      v_payload,
      v_created_at,
      v_updated_at,
      context_mismatch
    from public.training_workout_readiness as readiness
    where readiness.user_id = v_user_id
      and readiness.workout_attempt_id = p_workout_attempt_id;
  else
    context_mismatch := false;
  end if;

  if v_id is null then
    raise exception 'No se pudo confirmar readiness de entrenamiento';
  end if;

  id := v_id;
  user_id := v_persisted_user_id;
  workout_attempt_id := v_persisted_workout_attempt_id;
  cycle_id := v_persisted_cycle_id;
  cycle_day_id := v_persisted_cycle_day_id;
  workout_started_at := v_persisted_workout_started_at;
  local_date := v_persisted_local_date;
  payload := v_payload;
  training_session_id := v_training_session_id;
  created_at := v_created_at;
  updated_at := v_updated_at;
  return next;
end;
$function$$perf06_history_10_14$,
      $perf06_history_10_15$create or replace function public.link_training_workout_readiness_session_v2(
  p_workout_attempt_id uuid,
  p_training_session_id uuid
)
returns table (
  id uuid,
  workout_attempt_id uuid,
  training_session_id uuid,
  linked boolean,
  already_linked boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_readiness public.training_workout_readiness%rowtype;
  v_session record;
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_workout_attempt_id is null then
    raise exception 'workout_attempt_id requerido';
  end if;

  if p_training_session_id is null then
    raise exception 'training_session_id requerido';
  end if;

  select *
    into v_readiness
  from public.training_workout_readiness as readiness
  where readiness.user_id = v_user_id
    and readiness.workout_attempt_id = p_workout_attempt_id
  for update;

  if v_readiness.id is null then
    raise exception 'Readiness de entrenamiento no encontrado';
  end if;

  if v_readiness.training_session_id = p_training_session_id then
    id := v_readiness.id;
    workout_attempt_id := v_readiness.workout_attempt_id;
    training_session_id := v_readiness.training_session_id;
    linked := true;
    already_linked := true;
    return next;
    return;
  end if;

  if v_readiness.training_session_id is not null then
    raise exception 'Readiness ya enlazado a otra sesion';
  end if;

  select
    session.id,
    session.user_id,
    session.cycle_id,
    session.cycle_day_id,
    session.created_at
  into v_session
  from public.training_sessions as session
  where session.id = p_training_session_id
    and session.deleted_at is null;

  if v_session.id is null then
    raise exception 'Sesion no encontrada';
  end if;

  if v_session.user_id <> v_user_id then
    raise exception 'Sesion ajena al usuario autenticado';
  end if;

  if v_session.cycle_id is distinct from v_readiness.cycle_id then
    raise exception 'Sesion corresponde a otro ciclo';
  end if;

  if v_session.cycle_day_id is distinct from v_readiness.cycle_day_id then
    raise exception 'Sesion corresponde a otro dia del ciclo';
  end if;

  if v_session.created_at < v_readiness.workout_started_at - interval '5 minutes'
    or v_session.created_at > v_readiness.workout_started_at + interval '36 hours' then
    raise exception 'Sesion fuera de ventana temporal del intento';
  end if;

  if exists (
    select 1
    from public.training_workout_readiness as other_readiness
    where other_readiness.training_session_id = p_training_session_id
      and other_readiness.id <> v_readiness.id
  ) then
    raise exception 'Sesion ya enlazada a otro readiness';
  end if;

  update public.training_workout_readiness as readiness
  set training_session_id = p_training_session_id
  where readiness.id = v_readiness.id
  returning readiness.id, readiness.workout_attempt_id, readiness.training_session_id
  into id, workout_attempt_id, training_session_id;

  linked := true;
  already_linked := false;
  return next;
end;
$function$$perf06_history_10_15$,
      $perf06_history_10_16$revoke all on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) from public$perf06_history_10_16$,
      $perf06_history_10_17$revoke all on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) from anon$perf06_history_10_17$,
      $perf06_history_10_18$revoke all on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) from service_role$perf06_history_10_18$,
      $perf06_history_10_19$grant execute on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) to authenticated$perf06_history_10_19$,
      $perf06_history_10_20$revoke all on function public.link_training_workout_readiness_session_v2(uuid, uuid) from public$perf06_history_10_20$,
      $perf06_history_10_21$revoke all on function public.link_training_workout_readiness_session_v2(uuid, uuid) from anon$perf06_history_10_21$,
      $perf06_history_10_22$revoke all on function public.link_training_workout_readiness_session_v2(uuid, uuid) from service_role$perf06_history_10_22$,
      $perf06_history_10_23$grant execute on function public.link_training_workout_readiness_session_v2(uuid, uuid) to authenticated$perf06_history_10_23$
    ]::text[]),
  ('20260706000001', 'profile_avatar_fields', array[
      $perf06_history_11_0$alter table public.profiles
  add column if not exists avatar_path text,
  add column if not exists avatar_updated_at timestamptz$perf06_history_11_0$,
      $perf06_history_11_1$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']$perf06_history_11_1$,
      $perf06_history_11_2$do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile avatars own read'
  ) then
    create policy "profile avatars own read"
      on storage.objects
      for select
      to authenticated
      using (
        bucket_id = 'profile-avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile avatars own insert'
  ) then
    create policy "profile avatars own insert"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'profile-avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile avatars own update'
  ) then
    create policy "profile avatars own update"
      on storage.objects
      for update
      to authenticated
      using (
        bucket_id = 'profile-avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      )
      with check (
        bucket_id = 'profile-avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile avatars own delete'
  ) then
    create policy "profile avatars own delete"
      on storage.objects
      for delete
      to authenticated
      using (
        bucket_id = 'profile-avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;
end $$$perf06_history_11_2$
    ]::text[]),
  ('20260706000002', 'profile_personal_fields', array[
      $perf06_history_12_0$alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists birth_date date,
  add column if not exists gender text default 'not_specified'$perf06_history_12_0$,
      $perf06_history_12_1$do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_gender_allowed'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_gender_allowed
      check (
        gender is null or gender in (
          'male',
          'female',
          'non_binary',
          'prefer_not_to_say',
          'not_specified'
        )
      );
  end if;
end $$$perf06_history_12_1$
    ]::text[]),
  ('20260707000001', 'profile_phone_number', array[
      $perf06_history_13_0$alter table public.profiles
  add column if not exists phone_number text$perf06_history_13_0$
    ]::text[]),
  ('20260709000001', 'p0_d1_harden_training_session_entries_writes', array[
      $perf06_history_14_0$-- P0-D.1: harden training session/entry writes behind RPCs.
-- Local migration candidate only. Do not apply to Production without the QA gate.
--
-- Goal:
-- - Keep the public RPC signatures unchanged.
-- - Preserve existing ownership and business validations.
-- - Let the RPC owner perform the table writes, then remove direct INSERT/UPDATE
--   access for authenticated clients on training_sessions and exercise_entries.
-- - service_role is deliberately revoked because these RPCs are exclusively for
--   the authenticated user flow and have no current server-side dependency.
--
-- Rollback:
-- - A concrete rollback SQL block is included at the end of this file.
-- - Do not execute rollback without separate, explicit authorization.

begin$perf06_history_14_0$,
      $perf06_history_14_1$-- Do not consolidate duplicate data automatically. Abort before adding the
-- concurrency guard so any existing cycle-scoped duplicates can be reviewed.
do $$
begin
  if exists (
    select 1
    from public.training_sessions s
    where s.cycle_day_id is not null
      and s.deleted_at is null
    group by s.user_id, s.cycle_day_id, s.trained_date
    having count(*) > 1
  ) then
    raise exception 'No se puede aplicar P0-D.1: existen sesiones cycle-scoped duplicadas activas para el mismo usuario, dia de ciclo y fecha';
  end if;
end;
$$$perf06_history_14_1$,
      $perf06_history_14_2$-- The legacy routine-based unique index does not cover cycle_day_id rows.
-- This partial unique index is the database-level concurrency guard for the
-- cycle-scoped session contract.
create unique index training_sessions_user_cycle_day_trained_unique_idx
  on public.training_sessions(user_id, cycle_day_id, trained_date)
  where cycle_day_id is not null
    and deleted_at is null$perf06_history_14_2$,
      $perf06_history_14_3$create or replace function public.create_training_session_with_entries(
  p_routine_id uuid,
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
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_calendar_week_start date;
  v_session_id uuid;
  v_entry jsonb;
  v_exercise_id uuid;
  v_reps jsonb;
  v_seen_exercises uuid[] := array[]::uuid[];
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_routine_id is null then
    raise exception 'La rutina es obligatoria';
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

  if not exists (
    select 1
    from public.routines r
    where r.id = p_routine_id
      and r.user_id = v_user_id
      and r.deleted_at is null
  ) then
    raise exception 'La rutina no existe o no pertenece al usuario';
  end if;

  if p_status = 'completed' and jsonb_array_length(v_entries) = 0 then
    raise exception 'Un entrenamiento completado requiere ejercicios';
  end if;

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.routine_id = p_routine_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para esta rutina y fecha';
  end if;

  v_calendar_week_start := p_trained_date - (extract(isodow from p_trained_date)::integer - 1);

  insert into public.training_sessions (
    user_id,
    routine_id,
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
    p_routine_id,
    coalesce(p_week_number, 1),
    p_trained_date,
    v_calendar_week_start,
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
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception 'Cada ejercicio debe ser un objeto JSON';
      end if;

      if nullif(v_entry->>'exercise_id', '') is null then
        raise exception 'Cada ejercicio requiere exercise_id';
      end if;

      begin
        v_exercise_id := (v_entry->>'exercise_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'exercise_id invalido';
      end;

      if v_exercise_id = any(v_seen_exercises) then
        raise exception 'El entrenamiento contiene ejercicios duplicados';
      end if;
      v_seen_exercises := array_append(v_seen_exercises, v_exercise_id);

      v_reps := v_entry->'reps';
      if v_reps is null or jsonb_typeof(v_reps) <> 'array' then
        raise exception 'Cada ejercicio requiere reps como arreglo';
      end if;

      if jsonb_array_length(v_reps) = 0 then
        raise exception 'Cada ejercicio requiere al menos una repeticion';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation then
          raise exception 'reps debe contener enteros validos';
      end;

      if not exists (
        select 1
        from public.exercises e
        where e.id = v_exercise_id
          and e.user_id = v_user_id
          and e.routine_id = p_routine_id
      ) then
        raise exception 'Un ejercicio no pertenece a la rutina del usuario';
      end if;

      insert into public.exercise_entries (
        id,
        user_id,
        session_id,
        exercise_id,
        weight,
        previous_weight,
        reps,
        rir,
        notes
      )
      values (
        coalesce((v_entry->>'id')::uuid, gen_random_uuid()),
        v_user_id,
        v_session_id,
        v_exercise_id,
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
$$$perf06_history_14_3$,
      $perf06_history_14_4$create or replace function public.create_training_session_with_cycle_entries(
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
security definer
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

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.cycle_day_id = p_cycle_day_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para este dia y fecha';
  end if;

  begin
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
  exception
    when unique_violation then
      raise exception 'Ya existe un entrenamiento registrado para este dia y fecha';
  end;

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

      if exists (
        select 1
        from jsonb_array_elements_text(v_reps) as reps(rep_value)
        where rep_value is null
      ) then
        raise exception 'reps debe contener enteros validos';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'reps debe contener enteros validos';
      end;

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
$$$perf06_history_14_4$,
      $perf06_history_14_5$revoke all on function public.create_training_session_with_entries(
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from public$perf06_history_14_5$,
      $perf06_history_14_6$revoke all on function public.create_training_session_with_entries(
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from anon$perf06_history_14_6$,
      $perf06_history_14_7$revoke all on function public.create_training_session_with_entries(
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from service_role$perf06_history_14_7$,
      $perf06_history_14_8$grant execute on function public.create_training_session_with_entries(
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) to authenticated$perf06_history_14_8$,
      $perf06_history_14_9$revoke all on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from public$perf06_history_14_9$,
      $perf06_history_14_10$revoke all on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from anon$perf06_history_14_10$,
      $perf06_history_14_11$revoke all on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from service_role$perf06_history_14_11$,
      $perf06_history_14_12$grant execute on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) to authenticated$perf06_history_14_12$,
      $perf06_history_14_13$revoke insert, update on table public.training_sessions from authenticated$perf06_history_14_13$,
      $perf06_history_14_14$revoke insert, update on table public.exercise_entries from authenticated$perf06_history_14_14$,
      $perf06_history_14_15$revoke delete on table public.training_sessions from authenticated$perf06_history_14_15$,
      $perf06_history_14_16$revoke delete on table public.exercise_entries from authenticated$perf06_history_14_16$,
      $perf06_history_14_17$commit$perf06_history_14_17$,
      $perf06_history_14_18$/*
Rollback P0-D.1 - SQL concreto aplicable solo con autorizacion explicita.

Objetivo del rollback:
- Volver al modelo anterior donde las RPCs son SECURITY INVOKER.
- Restaurar SELECT, INSERT, UPDATE directos para authenticated sobre training_sessions y exercise_entries.
- Mantener DELETE sin conceder a authenticated.
- Restaurar EXECUTE para authenticated, que es el caller real de la app.

begin;

drop index if exists public.training_sessions_user_cycle_day_trained_unique_idx;

create or replace function public.create_training_session_with_entries(
  p_routine_id uuid,
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
as $rollback$
declare
  v_user_id uuid := auth.uid();
  v_calendar_week_start date;
  v_session_id uuid;
  v_entry jsonb;
  v_exercise_id uuid;
  v_reps jsonb;
  v_seen_exercises uuid[] := array[]::uuid[];
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_routine_id is null then
    raise exception 'La rutina es obligatoria';
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

  if not exists (
    select 1
    from public.routines r
    where r.id = p_routine_id
      and r.user_id = v_user_id
      and r.deleted_at is null
  ) then
    raise exception 'La rutina no existe o no pertenece al usuario';
  end if;

  if p_status = 'completed' and jsonb_array_length(v_entries) = 0 then
    raise exception 'Un entrenamiento completado requiere ejercicios';
  end if;

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.routine_id = p_routine_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para esta rutina y fecha';
  end if;

  v_calendar_week_start := p_trained_date - (extract(isodow from p_trained_date)::integer - 1);

  insert into public.training_sessions (
    user_id,
    routine_id,
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
    p_routine_id,
    coalesce(p_week_number, 1),
    p_trained_date,
    v_calendar_week_start,
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
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception 'Cada ejercicio debe ser un objeto JSON';
      end if;

      if nullif(v_entry->>'exercise_id', '') is null then
        raise exception 'Cada ejercicio requiere exercise_id';
      end if;

      begin
        v_exercise_id := (v_entry->>'exercise_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'exercise_id invalido';
      end;

      if v_exercise_id = any(v_seen_exercises) then
        raise exception 'El entrenamiento contiene ejercicios duplicados';
      end if;
      v_seen_exercises := array_append(v_seen_exercises, v_exercise_id);

      v_reps := v_entry->'reps';
      if v_reps is null or jsonb_typeof(v_reps) <> 'array' then
        raise exception 'Cada ejercicio requiere reps como arreglo';
      end if;

      if jsonb_array_length(v_reps) = 0 then
        raise exception 'Cada ejercicio requiere al menos una repeticion';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation then
          raise exception 'reps debe contener enteros validos';
      end;

      if not exists (
        select 1
        from public.exercises e
        where e.id = v_exercise_id
          and e.user_id = v_user_id
          and e.routine_id = p_routine_id
      ) then
        raise exception 'Un ejercicio no pertenece a la rutina del usuario';
      end if;

      insert into public.exercise_entries (
        id,
        user_id,
        session_id,
        exercise_id,
        weight,
        previous_weight,
        reps,
        rir,
        notes
      )
      values (
        coalesce((v_entry->>'id')::uuid, gen_random_uuid()),
        v_user_id,
        v_session_id,
        v_exercise_id,
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
$rollback$;

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
as $rollback$
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
$rollback$;

grant select, insert, update on table public.training_sessions to authenticated;
grant select, insert, update on table public.exercise_entries to authenticated;
revoke delete on table public.training_sessions from authenticated;
revoke delete on table public.exercise_entries from authenticated;

grant execute on function public.create_training_session_with_entries(
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
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

commit;
*/$perf06_history_14_18$
    ]::text[]),
  ('20260713000001', 'p0_h_profile_avatar_hardening', array[
      $perf06_history_15_0$-- P0-H: harden the private profile avatar contract.
--
-- Preconditions are intentionally strict. Apply to QA first and stop if any
-- drift is detected; this migration does not rewrite profile rows or objects.

begin$perf06_history_15_0$,
      $perf06_history_15_1$do $$
declare
  v_bucket storage.buckets%rowtype;
  v_count bigint;
begin
  select *
  into v_bucket
  from storage.buckets
  where id = 'profile-avatars';

  if not found then
    raise exception 'P0-H: bucket profile-avatars does not exist';
  end if;

  if v_bucket.public then
    raise exception 'P0-H: bucket profile-avatars must remain private';
  end if;

  if v_bucket.file_size_limit is distinct from 2097152 then
    raise exception 'P0-H: unexpected profile-avatars file_size_limit: %', v_bucket.file_size_limit;
  end if;

  if v_bucket.allowed_mime_types is null
    or cardinality(v_bucket.allowed_mime_types) <> 3
    or not v_bucket.allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']::text[]
    or not array['image/jpeg', 'image/png', 'image/webp']::text[] @> v_bucket.allowed_mime_types
  then
    raise exception 'P0-H: unexpected profile-avatars allowed_mime_types';
  end if;

  select count(*)
  into v_count
  from public.profiles p
  where p.avatar_path is not null
    and p.avatar_path <> p.id::text || '/avatar';

  if v_count <> 0 then
    raise exception 'P0-H: found % noncanonical profiles.avatar_path values', v_count;
  end if;

  select count(*)
  into v_count
  from storage.objects o
  where o.bucket_id = 'profile-avatars'
    and o.name !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/avatar$';

  if v_count <> 0 then
    raise exception 'P0-H: found % noncanonical profile avatar objects', v_count;
  end if;

  select count(*)
  into v_count
  from storage.objects o
  left join public.profiles p
    on o.name = p.id::text || '/avatar'
  where o.bucket_id = 'profile-avatars'
    and p.id is null;

  if v_count <> 0 then
    raise exception 'P0-H: found % orphan profile avatar objects', v_count;
  end if;

  select count(*)
  into v_count
  from public.profiles p
  left join storage.objects o
    on o.bucket_id = 'profile-avatars'
   and o.name = p.avatar_path
  where p.avatar_path is not null
    and o.id is null;

  if v_count <> 0 then
    raise exception 'P0-H: found % broken profile avatar references', v_count;
  end if;
end;
$$$perf06_history_15_1$,
      $perf06_history_15_2$do $$
declare
  v_constraint_expression text;
  v_normalized_expression text;
begin
  select pg_get_expr(c.conbin, c.conrelid, true)
  into v_constraint_expression
  from pg_constraint c
  where c.conrelid = 'public.profiles'::regclass
    and c.conname = 'profiles_avatar_path_canonical_check'
    and c.contype = 'c';

  if v_constraint_expression is null then
    if exists (
      select 1
      from pg_constraint c
      where c.conrelid = 'public.profiles'::regclass
        and c.conname = 'profiles_avatar_path_canonical_check'
    ) then
      raise exception 'P0-H: profiles_avatar_path_canonical_check exists but is not a CHECK constraint';
    end if;

    alter table public.profiles
      add constraint profiles_avatar_path_canonical_check
      check (
        avatar_path is null
        or avatar_path = id::text || '/avatar'
      ) not valid;
  else
    v_normalized_expression := replace(
      lower(regexp_replace(v_constraint_expression, '[[:space:]()]', '', 'g')),
      '::text',
      ''
    );

    if v_normalized_expression <> 'avatar_pathisnulloravatar_path=id||''/avatar''' then
      raise exception 'P0-H: profiles_avatar_path_canonical_check has an unexpected definition: %', v_constraint_expression;
    end if;
  end if;
end;
$$$perf06_history_15_2$,
      $perf06_history_15_3$alter table public.profiles
  validate constraint profiles_avatar_path_canonical_check$perf06_history_15_3$,
      $perf06_history_15_4$drop policy if exists "profile avatars own read" on storage.objects$perf06_history_15_4$,
      $perf06_history_15_5$drop policy if exists "profile avatars own insert" on storage.objects$perf06_history_15_5$,
      $perf06_history_15_6$drop policy if exists "profile avatars own update" on storage.objects$perf06_history_15_6$,
      $perf06_history_15_7$drop policy if exists "profile avatars own delete" on storage.objects$perf06_history_15_7$,
      $perf06_history_15_8$create policy "profile avatars own read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar'
  )$perf06_history_15_8$,
      $perf06_history_15_9$create policy "profile avatars own insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar'
  )$perf06_history_15_9$,
      $perf06_history_15_10$create policy "profile avatars own update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar'
  )
  with check (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar'
  )$perf06_history_15_10$,
      $perf06_history_15_11$create policy "profile avatars own delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar'
  )$perf06_history_15_11$,
      $perf06_history_15_12$do $$
declare
  v_count bigint;
  v_exact_policy_count integer;
  v_expected_expression constant text := 'bucket_id=''profile-avatars''andname=auth.uid||''/avatar''';
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.conname = 'profiles_avatar_path_canonical_check'
      and c.contype = 'c'
      and c.convalidated
  ) then
    raise exception 'P0-H: canonical avatar_path constraint is missing or not validated';
  end if;

  select count(*)
  into v_exact_policy_count
  from pg_policies p
  where p.schemaname = 'storage'
    and p.tablename = 'objects'
    and p.roles = array['authenticated']::name[]
    and (
      (
        p.policyname = 'profile avatars own read'
        and p.cmd = 'SELECT'
        and replace(lower(regexp_replace(coalesce(p.qual, ''), '[[:space:]()]', '', 'g')), '::text', '') = v_expected_expression
        and p.with_check is null
      )
      or (
        p.policyname = 'profile avatars own insert'
        and p.cmd = 'INSERT'
        and p.qual is null
        and replace(lower(regexp_replace(coalesce(p.with_check, ''), '[[:space:]()]', '', 'g')), '::text', '') = v_expected_expression
      )
      or (
        p.policyname = 'profile avatars own update'
        and p.cmd = 'UPDATE'
        and replace(lower(regexp_replace(coalesce(p.qual, ''), '[[:space:]()]', '', 'g')), '::text', '') = v_expected_expression
        and replace(lower(regexp_replace(coalesce(p.with_check, ''), '[[:space:]()]', '', 'g')), '::text', '') = v_expected_expression
      )
      or (
        p.policyname = 'profile avatars own delete'
        and p.cmd = 'DELETE'
        and replace(lower(regexp_replace(coalesce(p.qual, ''), '[[:space:]()]', '', 'g')), '::text', '') = v_expected_expression
        and p.with_check is null
      )
    );

  if v_exact_policy_count <> 4 then
    raise exception 'P0-H: expected 4 exact canonical avatar policies, found %', v_exact_policy_count;
  end if;

  select count(*)
  into v_count
  from public.profiles p
  where p.avatar_path is not null
    and p.avatar_path <> p.id::text || '/avatar';
  if v_count <> 0 then
    raise exception 'P0-H postcheck: found % noncanonical profiles.avatar_path values', v_count;
  end if;

  select count(*)
  into v_count
  from storage.objects o
  where o.bucket_id = 'profile-avatars'
    and o.name !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/avatar$';
  if v_count <> 0 then
    raise exception 'P0-H postcheck: found % noncanonical profile avatar objects', v_count;
  end if;

  select count(*)
  into v_count
  from storage.objects o
  left join public.profiles p
    on o.name = p.id::text || '/avatar'
  where o.bucket_id = 'profile-avatars'
    and p.id is null;
  if v_count <> 0 then
    raise exception 'P0-H postcheck: found % orphan profile avatar objects', v_count;
  end if;

  select count(*)
  into v_count
  from public.profiles p
  left join storage.objects o
    on o.bucket_id = 'profile-avatars'
   and o.name = p.avatar_path
  where p.avatar_path is not null
    and o.id is null;
  if v_count <> 0 then
    raise exception 'P0-H postcheck: found % broken profile avatar references', v_count;
  end if;
end;
$$$perf06_history_15_12$,
      $perf06_history_15_13$commit$perf06_history_15_13$,
      $perf06_history_15_14$/*
Rollback P0-H - execute only with separate, explicit authorization.

begin;

alter table public.profiles
  drop constraint if exists profiles_avatar_path_canonical_check;

drop policy if exists "profile avatars own read" on storage.objects;
drop policy if exists "profile avatars own insert" on storage.objects;
drop policy if exists "profile avatars own update" on storage.objects;
drop policy if exists "profile avatars own delete" on storage.objects;

create policy "profile avatars own read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "profile avatars own insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "profile avatars own update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'profile-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "profile avatars own delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

commit;
*/$perf06_history_15_14$
    ]::text[]),
  ('20260718000001', 'exercise_entries_observation', array[
      $perf06_history_16_0$-- OBS-1: add a single free-text observation per exercise entry.
-- Local migration candidate only. Do not apply to Production without the QA gate.
--
-- Goal:
-- - exercise_entries already holds exactly one row per exercise executed in a
--   session (one weight, one reps[] array, one notes value per row). This
--   migration adds a sibling nullable column, `observation`, so the same row
--   can carry exactly one free-text observation for that exercise/session.
-- - Keep both RPC signatures unchanged (still jsonb `p_entries`).
-- - `observation` travels as an optional property inside each entry object,
--   normalized the same way `notes` already is: nullif(btrim(...), '').
-- - Do not touch `notes`, RLS, indexes, or grants: the existing
--   "entries own rows" row-level policy already covers the new column
--   because RLS is per-row, not per-column, and the function signatures
--   (therefore their existing grants) are unchanged.
--
-- Rollback:
-- - A concrete rollback SQL block is included at the end of this file.
-- - Do not execute rollback without separate, explicit authorization.

begin$perf06_history_16_0$,
      $perf06_history_16_1$alter table public.exercise_entries
  add column if not exists observation text null$perf06_history_16_1$,
      $perf06_history_16_2$create or replace function public.create_training_session_with_entries(
  p_routine_id uuid,
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
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_calendar_week_start date;
  v_session_id uuid;
  v_entry jsonb;
  v_exercise_id uuid;
  v_reps jsonb;
  v_seen_exercises uuid[] := array[]::uuid[];
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_routine_id is null then
    raise exception 'La rutina es obligatoria';
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

  if not exists (
    select 1
    from public.routines r
    where r.id = p_routine_id
      and r.user_id = v_user_id
      and r.deleted_at is null
  ) then
    raise exception 'La rutina no existe o no pertenece al usuario';
  end if;

  if p_status = 'completed' and jsonb_array_length(v_entries) = 0 then
    raise exception 'Un entrenamiento completado requiere ejercicios';
  end if;

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.routine_id = p_routine_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para esta rutina y fecha';
  end if;

  v_calendar_week_start := p_trained_date - (extract(isodow from p_trained_date)::integer - 1);

  insert into public.training_sessions (
    user_id,
    routine_id,
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
    p_routine_id,
    coalesce(p_week_number, 1),
    p_trained_date,
    v_calendar_week_start,
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
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception 'Cada ejercicio debe ser un objeto JSON';
      end if;

      if nullif(v_entry->>'exercise_id', '') is null then
        raise exception 'Cada ejercicio requiere exercise_id';
      end if;

      begin
        v_exercise_id := (v_entry->>'exercise_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'exercise_id invalido';
      end;

      if v_exercise_id = any(v_seen_exercises) then
        raise exception 'El entrenamiento contiene ejercicios duplicados';
      end if;
      v_seen_exercises := array_append(v_seen_exercises, v_exercise_id);

      v_reps := v_entry->'reps';
      if v_reps is null or jsonb_typeof(v_reps) <> 'array' then
        raise exception 'Cada ejercicio requiere reps como arreglo';
      end if;

      if jsonb_array_length(v_reps) = 0 then
        raise exception 'Cada ejercicio requiere al menos una repeticion';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation then
          raise exception 'reps debe contener enteros validos';
      end;

      if not exists (
        select 1
        from public.exercises e
        where e.id = v_exercise_id
          and e.user_id = v_user_id
          and e.routine_id = p_routine_id
      ) then
        raise exception 'Un ejercicio no pertenece a la rutina del usuario';
      end if;

      insert into public.exercise_entries (
        id,
        user_id,
        session_id,
        exercise_id,
        weight,
        previous_weight,
        reps,
        rir,
        notes,
        observation
      )
      values (
        coalesce((v_entry->>'id')::uuid, gen_random_uuid()),
        v_user_id,
        v_session_id,
        v_exercise_id,
        coalesce((v_entry->>'weight')::numeric, 0),
        coalesce((v_entry->>'previous_weight')::numeric, 0),
        array(select rep_value::integer from jsonb_array_elements_text(v_reps) as reps(rep_value)),
        nullif(v_entry->>'rir', ''),
        nullif(v_entry->>'notes', ''),
        nullif(btrim(v_entry->>'observation'), '')
      );
    end loop;
  end if;

  return v_session_id;
end;
$$$perf06_history_16_2$,
      $perf06_history_16_3$create or replace function public.create_training_session_with_cycle_entries(
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
security definer
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

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.cycle_day_id = p_cycle_day_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para este dia y fecha';
  end if;

  begin
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
  exception
    when unique_violation then
      raise exception 'Ya existe un entrenamiento registrado para este dia y fecha';
  end;

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

      if exists (
        select 1
        from jsonb_array_elements_text(v_reps) as reps(rep_value)
        where rep_value is null
      ) then
        raise exception 'reps debe contener enteros validos';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'reps debe contener enteros validos';
      end;

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
        notes,
        observation
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
        nullif(v_entry->>'notes', ''),
        nullif(btrim(v_entry->>'observation'), '')
      );
    end loop;
  end if;

  return v_session_id;
end;
$$$perf06_history_16_3$,
      $perf06_history_16_4$commit$perf06_history_16_4$,
      $perf06_history_16_5$/*
Rollback OBS-1 - SQL concreto aplicable solo con autorizacion explicita.

Objetivo del rollback:
- Restaurar ambas RPCs a la version vigente antes de OBS-1 (sin observation),
  identica a la definida en 20260709_p0_d1_harden_training_session_entries_writes.sql.
- Eliminar unicamente la columna exercise_entries.observation.
- No tocar notes, RLS, indices ni grants: no fueron modificados por esta migracion.

begin;

create or replace function public.create_training_session_with_entries(
  p_routine_id uuid,
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
security definer
set search_path = public, pg_temp
as $rollback$
declare
  v_user_id uuid := auth.uid();
  v_calendar_week_start date;
  v_session_id uuid;
  v_entry jsonb;
  v_exercise_id uuid;
  v_reps jsonb;
  v_seen_exercises uuid[] := array[]::uuid[];
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_routine_id is null then
    raise exception 'La rutina es obligatoria';
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

  if not exists (
    select 1
    from public.routines r
    where r.id = p_routine_id
      and r.user_id = v_user_id
      and r.deleted_at is null
  ) then
    raise exception 'La rutina no existe o no pertenece al usuario';
  end if;

  if p_status = 'completed' and jsonb_array_length(v_entries) = 0 then
    raise exception 'Un entrenamiento completado requiere ejercicios';
  end if;

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.routine_id = p_routine_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para esta rutina y fecha';
  end if;

  v_calendar_week_start := p_trained_date - (extract(isodow from p_trained_date)::integer - 1);

  insert into public.training_sessions (
    user_id,
    routine_id,
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
    p_routine_id,
    coalesce(p_week_number, 1),
    p_trained_date,
    v_calendar_week_start,
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
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception 'Cada ejercicio debe ser un objeto JSON';
      end if;

      if nullif(v_entry->>'exercise_id', '') is null then
        raise exception 'Cada ejercicio requiere exercise_id';
      end if;

      begin
        v_exercise_id := (v_entry->>'exercise_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'exercise_id invalido';
      end;

      if v_exercise_id = any(v_seen_exercises) then
        raise exception 'El entrenamiento contiene ejercicios duplicados';
      end if;
      v_seen_exercises := array_append(v_seen_exercises, v_exercise_id);

      v_reps := v_entry->'reps';
      if v_reps is null or jsonb_typeof(v_reps) <> 'array' then
        raise exception 'Cada ejercicio requiere reps como arreglo';
      end if;

      if jsonb_array_length(v_reps) = 0 then
        raise exception 'Cada ejercicio requiere al menos una repeticion';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation then
          raise exception 'reps debe contener enteros validos';
      end;

      if not exists (
        select 1
        from public.exercises e
        where e.id = v_exercise_id
          and e.user_id = v_user_id
          and e.routine_id = p_routine_id
      ) then
        raise exception 'Un ejercicio no pertenece a la rutina del usuario';
      end if;

      insert into public.exercise_entries (
        id,
        user_id,
        session_id,
        exercise_id,
        weight,
        previous_weight,
        reps,
        rir,
        notes
      )
      values (
        coalesce((v_entry->>'id')::uuid, gen_random_uuid()),
        v_user_id,
        v_session_id,
        v_exercise_id,
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
$rollback$;

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
security definer
set search_path = public, pg_temp
as $rollback$
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

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.cycle_day_id = p_cycle_day_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para este dia y fecha';
  end if;

  begin
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
  exception
    when unique_violation then
      raise exception 'Ya existe un entrenamiento registrado para este dia y fecha';
  end;

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
$rollback$;

alter table public.exercise_entries
  drop column if exists observation;

commit;
*/$perf06_history_16_5$
    ]::text[]),
  ('20260718000002', 'exercise_entries_observation_legacy_lineage', array[
      $perf06_history_17_0$-- OBS-2A.1: resolve exercise_lineage_id server-side for legacy session entries.
-- Local migration candidate only. Do not apply to Production without the QA gate.
--
-- Goal:
-- - create_training_session_with_cycle_entries already resolves and stores
--   exercise_lineage_id for every entry it inserts. create_training_session_with_entries
--   (the legacy, routine-scoped RPC) still inserts exercise_id but leaves
--   exercise_lineage_id null, which breaks the "last observation"/"last
--   performance" lookups for legacy entries (both are keyed exclusively by
--   exercise_lineage_id, with no fallback by name or exercise_id).
-- - This migration replaces ONLY public.create_training_session_with_entries
--   so it resolves exercise_lineage_id server-side, from
--   training_exercise_lineages, using the already-validated v_exercise_id.
--   The lineage is never trusted from the client: no exercise_lineage_id
--   field is read from p_entries in this RPC.
-- - If a legacy exercise has no matching row in training_exercise_lineages,
--   the RPC aborts with a stable, explicit error instead of inserting a
--   historical entry without lineage.
-- - Keep the RPC signature unchanged (still jsonb `p_entries`).
-- - Do not touch public.create_training_session_with_cycle_entries: it is not
--   redefined by this migration.
-- - Do not touch `notes`, `observation`, RLS, indexes, or grants: the
--   function signature (therefore its existing grants) is unchanged, and the
--   existing "entries own rows" row-level policy already covers
--   exercise_lineage_id because RLS is per-row, not per-column.
--
-- Rollback:
-- - A concrete rollback SQL block is included at the end of this file.
-- - Do not execute rollback without separate, explicit authorization.

begin$perf06_history_17_0$,
      $perf06_history_17_1$create or replace function public.create_training_session_with_entries(
  p_routine_id uuid,
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
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_calendar_week_start date;
  v_session_id uuid;
  v_entry jsonb;
  v_exercise_id uuid;
  v_exercise_lineage_id uuid;
  v_reps jsonb;
  v_seen_exercises uuid[] := array[]::uuid[];
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_routine_id is null then
    raise exception 'La rutina es obligatoria';
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

  if not exists (
    select 1
    from public.routines r
    where r.id = p_routine_id
      and r.user_id = v_user_id
      and r.deleted_at is null
  ) then
    raise exception 'La rutina no existe o no pertenece al usuario';
  end if;

  if p_status = 'completed' and jsonb_array_length(v_entries) = 0 then
    raise exception 'Un entrenamiento completado requiere ejercicios';
  end if;

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.routine_id = p_routine_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para esta rutina y fecha';
  end if;

  v_calendar_week_start := p_trained_date - (extract(isodow from p_trained_date)::integer - 1);

  insert into public.training_sessions (
    user_id,
    routine_id,
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
    p_routine_id,
    coalesce(p_week_number, 1),
    p_trained_date,
    v_calendar_week_start,
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
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception 'Cada ejercicio debe ser un objeto JSON';
      end if;

      if nullif(v_entry->>'exercise_id', '') is null then
        raise exception 'Cada ejercicio requiere exercise_id';
      end if;

      begin
        v_exercise_id := (v_entry->>'exercise_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'exercise_id invalido';
      end;

      if v_exercise_id = any(v_seen_exercises) then
        raise exception 'El entrenamiento contiene ejercicios duplicados';
      end if;
      v_seen_exercises := array_append(v_seen_exercises, v_exercise_id);

      v_reps := v_entry->'reps';
      if v_reps is null or jsonb_typeof(v_reps) <> 'array' then
        raise exception 'Cada ejercicio requiere reps como arreglo';
      end if;

      if jsonb_array_length(v_reps) = 0 then
        raise exception 'Cada ejercicio requiere al menos una repeticion';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation then
          raise exception 'reps debe contener enteros validos';
      end;

      if not exists (
        select 1
        from public.exercises e
        where e.id = v_exercise_id
          and e.user_id = v_user_id
          and e.routine_id = p_routine_id
      ) then
        raise exception 'Un ejercicio no pertenece a la rutina del usuario';
      end if;

      select tel.id
      into v_exercise_lineage_id
      from public.training_exercise_lineages tel
      where tel.user_id = v_user_id
        and tel.source_legacy_exercise_id = v_exercise_id;

      if v_exercise_lineage_id is null then
        raise exception 'El ejercicio legacy no tiene identidad historica (exercise_lineage_id) registrada';
      end if;

      insert into public.exercise_entries (
        id,
        user_id,
        session_id,
        exercise_id,
        exercise_lineage_id,
        weight,
        previous_weight,
        reps,
        rir,
        notes,
        observation
      )
      values (
        coalesce((v_entry->>'id')::uuid, gen_random_uuid()),
        v_user_id,
        v_session_id,
        v_exercise_id,
        v_exercise_lineage_id,
        coalesce((v_entry->>'weight')::numeric, 0),
        coalesce((v_entry->>'previous_weight')::numeric, 0),
        array(select rep_value::integer from jsonb_array_elements_text(v_reps) as reps(rep_value)),
        nullif(v_entry->>'rir', ''),
        nullif(v_entry->>'notes', ''),
        nullif(btrim(v_entry->>'observation'), '')
      );
    end loop;
  end if;

  return v_session_id;
end;
$$$perf06_history_17_1$,
      $perf06_history_17_2$commit$perf06_history_17_2$,
      $perf06_history_17_3$/*
Rollback OBS-2A.1 - SQL concreto aplicable solo con autorizacion explicita.

Objetivo del rollback:
- Restaurar public.create_training_session_with_entries a la version vigente
  de OBS-1 (definida en 20260718_exercise_entries_observation.sql): sigue
  guardando observation, pero deja de resolver e insertar
  exercise_lineage_id en la ruta legacy.
- No eliminar la columna exercise_entries.observation.
- No modificar public.create_training_session_with_cycle_entries: no fue
  tocada por esta migracion y el rollback tampoco la toca.
- No tocar tablas, training_exercise_lineages, RLS, indices ni grants.

begin;

create or replace function public.create_training_session_with_entries(
  p_routine_id uuid,
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
security definer
set search_path = public, pg_temp
as $rollback$
declare
  v_user_id uuid := auth.uid();
  v_calendar_week_start date;
  v_session_id uuid;
  v_entry jsonb;
  v_exercise_id uuid;
  v_reps jsonb;
  v_seen_exercises uuid[] := array[]::uuid[];
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_routine_id is null then
    raise exception 'La rutina es obligatoria';
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

  if not exists (
    select 1
    from public.routines r
    where r.id = p_routine_id
      and r.user_id = v_user_id
      and r.deleted_at is null
  ) then
    raise exception 'La rutina no existe o no pertenece al usuario';
  end if;

  if p_status = 'completed' and jsonb_array_length(v_entries) = 0 then
    raise exception 'Un entrenamiento completado requiere ejercicios';
  end if;

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.routine_id = p_routine_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para esta rutina y fecha';
  end if;

  v_calendar_week_start := p_trained_date - (extract(isodow from p_trained_date)::integer - 1);

  insert into public.training_sessions (
    user_id,
    routine_id,
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
    p_routine_id,
    coalesce(p_week_number, 1),
    p_trained_date,
    v_calendar_week_start,
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
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception 'Cada ejercicio debe ser un objeto JSON';
      end if;

      if nullif(v_entry->>'exercise_id', '') is null then
        raise exception 'Cada ejercicio requiere exercise_id';
      end if;

      begin
        v_exercise_id := (v_entry->>'exercise_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'exercise_id invalido';
      end;

      if v_exercise_id = any(v_seen_exercises) then
        raise exception 'El entrenamiento contiene ejercicios duplicados';
      end if;
      v_seen_exercises := array_append(v_seen_exercises, v_exercise_id);

      v_reps := v_entry->'reps';
      if v_reps is null or jsonb_typeof(v_reps) <> 'array' then
        raise exception 'Cada ejercicio requiere reps como arreglo';
      end if;

      if jsonb_array_length(v_reps) = 0 then
        raise exception 'Cada ejercicio requiere al menos una repeticion';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation then
          raise exception 'reps debe contener enteros validos';
      end;

      if not exists (
        select 1
        from public.exercises e
        where e.id = v_exercise_id
          and e.user_id = v_user_id
          and e.routine_id = p_routine_id
      ) then
        raise exception 'Un ejercicio no pertenece a la rutina del usuario';
      end if;

      insert into public.exercise_entries (
        id,
        user_id,
        session_id,
        exercise_id,
        weight,
        previous_weight,
        reps,
        rir,
        notes,
        observation
      )
      values (
        coalesce((v_entry->>'id')::uuid, gen_random_uuid()),
        v_user_id,
        v_session_id,
        v_exercise_id,
        coalesce((v_entry->>'weight')::numeric, 0),
        coalesce((v_entry->>'previous_weight')::numeric, 0),
        array(select rep_value::integer from jsonb_array_elements_text(v_reps) as reps(rep_value)),
        nullif(v_entry->>'rir', ''),
        nullif(v_entry->>'notes', ''),
        nullif(btrim(v_entry->>'observation'), '')
      );
    end loop;
  end if;

  return v_session_id;
end;
$rollback$;

commit;
*/$perf06_history_17_3$
    ]::text[])
;
do $perf06_history_gate$
declare
  v_versions integer;
  v_statements integer;
begin
  select count(*)::integer, coalesce(sum(cardinality(statements)), 0)::integer
  into v_versions, v_statements
  from supabase_migrations.schema_migrations;
  if v_versions <> 18 or v_statements <> 255 then
    raise exception using errcode = '55000', message = 'PERF-06 SQL Editor aborted: historical bootstrap gate failed';
  end if;
end;
$perf06_history_gate$;

-- PERF06_SQL_EDITOR_MIGRATION APPLY 20260810225819 perf_06a_security_hardening

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 1/24
-- PERF-06A: least-privilege hardening for the legacy client-facing tables.
--
-- Static frontend write audit (2026-08-10):
-- - profiles: fallback INSERT; UPDATE email, personal fields and avatar metadata.
-- - routines: INSERT user_id/name only.
-- - exercises: INSERT/UPSERT the explicit exercise payload, UPDATE notes and DELETE.
--   Identity columns (id, user_id) are guarded by trigger, not by column ACL.
--
-- RLS policies are intentionally left unchanged. Table privileges are reset before
-- granting only the operations and columns used by those flows.

revoke all privileges on table public.profiles from anon
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 2/24
revoke all privileges on table public.routines from anon
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 3/24
revoke all privileges on table public.exercises from anon
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 4/24
revoke all privileges on table public.profiles from authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 5/24
revoke all privileges on table public.routines from authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 6/24
revoke all privileges on table public.exercises from authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 7/24
grant select on table public.profiles to authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 8/24
grant insert (id, display_name, email, gender)
  on table public.profiles to authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 9/24
grant update (
  display_name,
  email,
  first_name,
  last_name,
  birth_date,
  gender,
  phone_number,
  avatar_path,
  avatar_updated_at
) on table public.profiles to authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 10/24
grant select on table public.routines to authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 11/24
grant insert (user_id, name)
  on table public.routines to authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 12/24
grant select on table public.exercises to authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 13/24
grant insert (
  id,
  user_id,
  routine_id,
  name,
  target_sets,
  target_reps,
  base_weight,
  side_weight,
  day,
  notes
) on table public.exercises to authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 14/24
grant update (
  id,
  user_id,
  routine_id,
  name,
  target_sets,
  target_reps,
  base_weight,
  side_weight,
  day,
  notes
) on table public.exercises to authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 15/24
grant delete on table public.exercises to authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 16/24
-- The legacy exercises upsert sends the full payload, including id and user_id,
-- and PostgREST may replay any of those columns in the ON CONFLICT DO UPDATE SET
-- list. Rather than depending on which columns PostgREST emits, both identity
-- columns stay writable at the ACL level and the invariant is enforced
-- fail-closed by the trigger below: repeating the same value is allowed, any
-- real change to id or user_id aborts the statement. This is the single
-- canonical identity-protection mechanism for public.exercises.
create function public.prevent_exercise_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  if new.id is distinct from old.id then
    raise exception using
      errcode = '42501',
      message = 'exercise identity cannot be changed';
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception using
      errcode = '42501',
      message = 'exercise ownership cannot be changed';
  end if;

  return new;
end;
$function$
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 17/24
revoke execute on function public.prevent_exercise_identity_change() from public
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 18/24
revoke execute on function public.prevent_exercise_identity_change() from anon
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 19/24
revoke execute on function public.prevent_exercise_identity_change() from authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 20/24
-- Unconditional BEFORE UPDATE: the guard never depends on which columns a
-- client happens to list in the SET clause.
create trigger exercises_prevent_identity_change
  before update on public.exercises
  for each row execute function public.prevent_exercise_identity_change()
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 21/24
-- Trigger functions do not need to remain callable through the Data API. Revoking
-- direct execution does not remove or replace the existing auth.users trigger.
revoke execute on function public.handle_new_user() from public
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 22/24
revoke execute on function public.handle_new_user() from anon
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 23/24
revoke execute on function public.handle_new_user() from authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810225819 24/24
-- Existing definition only assigns NEW.updated_at = now() and references no
-- application relation. pg_catalog is therefore the minimal fixed search path.
alter function public.set_updated_at() set search_path = pg_catalog
;

-- PERF06_SQL_EDITOR_HISTORY 20260810225819 perf_06a_security_hardening
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260810225819', 'perf_06a_security_hardening', array[
      $perf06_history_18_0$-- PERF-06A: least-privilege hardening for the legacy client-facing tables.
--
-- Static frontend write audit (2026-08-10):
-- - profiles: fallback INSERT; UPDATE email, personal fields and avatar metadata.
-- - routines: INSERT user_id/name only.
-- - exercises: INSERT/UPSERT the explicit exercise payload, UPDATE notes and DELETE.
--   Identity columns (id, user_id) are guarded by trigger, not by column ACL.
--
-- RLS policies are intentionally left unchanged. Table privileges are reset before
-- granting only the operations and columns used by those flows.

revoke all privileges on table public.profiles from anon$perf06_history_18_0$,
      $perf06_history_18_1$revoke all privileges on table public.routines from anon$perf06_history_18_1$,
      $perf06_history_18_2$revoke all privileges on table public.exercises from anon$perf06_history_18_2$,
      $perf06_history_18_3$revoke all privileges on table public.profiles from authenticated$perf06_history_18_3$,
      $perf06_history_18_4$revoke all privileges on table public.routines from authenticated$perf06_history_18_4$,
      $perf06_history_18_5$revoke all privileges on table public.exercises from authenticated$perf06_history_18_5$,
      $perf06_history_18_6$grant select on table public.profiles to authenticated$perf06_history_18_6$,
      $perf06_history_18_7$grant insert (id, display_name, email, gender)
  on table public.profiles to authenticated$perf06_history_18_7$,
      $perf06_history_18_8$grant update (
  display_name,
  email,
  first_name,
  last_name,
  birth_date,
  gender,
  phone_number,
  avatar_path,
  avatar_updated_at
) on table public.profiles to authenticated$perf06_history_18_8$,
      $perf06_history_18_9$grant select on table public.routines to authenticated$perf06_history_18_9$,
      $perf06_history_18_10$grant insert (user_id, name)
  on table public.routines to authenticated$perf06_history_18_10$,
      $perf06_history_18_11$grant select on table public.exercises to authenticated$perf06_history_18_11$,
      $perf06_history_18_12$grant insert (
  id,
  user_id,
  routine_id,
  name,
  target_sets,
  target_reps,
  base_weight,
  side_weight,
  day,
  notes
) on table public.exercises to authenticated$perf06_history_18_12$,
      $perf06_history_18_13$grant update (
  id,
  user_id,
  routine_id,
  name,
  target_sets,
  target_reps,
  base_weight,
  side_weight,
  day,
  notes
) on table public.exercises to authenticated$perf06_history_18_13$,
      $perf06_history_18_14$grant delete on table public.exercises to authenticated$perf06_history_18_14$,
      $perf06_history_18_15$-- The legacy exercises upsert sends the full payload, including id and user_id,
-- and PostgREST may replay any of those columns in the ON CONFLICT DO UPDATE SET
-- list. Rather than depending on which columns PostgREST emits, both identity
-- columns stay writable at the ACL level and the invariant is enforced
-- fail-closed by the trigger below: repeating the same value is allowed, any
-- real change to id or user_id aborts the statement. This is the single
-- canonical identity-protection mechanism for public.exercises.
create function public.prevent_exercise_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  if new.id is distinct from old.id then
    raise exception using
      errcode = '42501',
      message = 'exercise identity cannot be changed';
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception using
      errcode = '42501',
      message = 'exercise ownership cannot be changed';
  end if;

  return new;
end;
$function$$perf06_history_18_15$,
      $perf06_history_18_16$revoke execute on function public.prevent_exercise_identity_change() from public$perf06_history_18_16$,
      $perf06_history_18_17$revoke execute on function public.prevent_exercise_identity_change() from anon$perf06_history_18_17$,
      $perf06_history_18_18$revoke execute on function public.prevent_exercise_identity_change() from authenticated$perf06_history_18_18$,
      $perf06_history_18_19$-- Unconditional BEFORE UPDATE: the guard never depends on which columns a
-- client happens to list in the SET clause.
create trigger exercises_prevent_identity_change
  before update on public.exercises
  for each row execute function public.prevent_exercise_identity_change()$perf06_history_18_19$,
      $perf06_history_18_20$-- Trigger functions do not need to remain callable through the Data API. Revoking
-- direct execution does not remove or replace the existing auth.users trigger.
revoke execute on function public.handle_new_user() from public$perf06_history_18_20$,
      $perf06_history_18_21$revoke execute on function public.handle_new_user() from anon$perf06_history_18_21$,
      $perf06_history_18_22$revoke execute on function public.handle_new_user() from authenticated$perf06_history_18_22$,
      $perf06_history_18_23$-- Existing definition only assigns NEW.updated_at = now() and references no
-- application relation. pg_catalog is therefore the minimal fixed search path.
alter function public.set_updated_at() set search_path = pg_catalog$perf06_history_18_23$
    ]::text[]);

-- PERF06_SQL_EDITOR_MIGRATION APPLY 20260810230014 perf_06c_rls_initplan

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 1/22
-- PERF-06C: evaluate auth.uid() once per statement through a PostgreSQL initplan.
-- ALTER POLICY preserves each policy name, command, role list and permissive mode.

alter policy "profiles own rows" on public.profiles
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id)
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 2/22
alter policy "routines own rows" on public.routines
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id)
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 3/22
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
  )
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 4/22
alter policy "training cycles select own rows" on public.training_cycles
  using ((select auth.uid()) = user_id)
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 5/22
alter policy "training cycles insert own rows" on public.training_cycles
  with check ((select auth.uid()) = user_id)
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 6/22
alter policy "training cycles update own rows" on public.training_cycles
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id)
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 7/22
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
  )
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 8/22
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
  )
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 9/22
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
  )
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 10/22
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
  )
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 11/22
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
  )
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 12/22
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
  )
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 13/22
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
  )
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 14/22
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
  )
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 15/22
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
  )
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 16/22
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
  )
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 17/22
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
  )
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 18/22
alter policy "daily readiness own select" on public.training_daily_readiness
  using ((select auth.uid()) = user_id)
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 19/22
alter policy "lineages own rows select" on public.training_exercise_lineages
  using (user_id = (select auth.uid()))
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 20/22
alter policy "lineages own rows insert" on public.training_exercise_lineages
  with check (user_id = (select auth.uid()))
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 21/22
alter policy "lineages own rows update" on public.training_exercise_lineages
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()))
;

-- PERF06_SQL_EDITOR_STATEMENT 20260810230014 22/22
alter policy "workout readiness own select" on public.training_workout_readiness
  using ((select auth.uid()) = user_id)
;

-- PERF06_SQL_EDITOR_HISTORY 20260810230014 perf_06c_rls_initplan
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260810230014', 'perf_06c_rls_initplan', array[
      $perf06_history_19_0$-- PERF-06C: evaluate auth.uid() once per statement through a PostgreSQL initplan.
-- ALTER POLICY preserves each policy name, command, role list and permissive mode.

alter policy "profiles own rows" on public.profiles
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id)$perf06_history_19_0$,
      $perf06_history_19_1$alter policy "routines own rows" on public.routines
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id)$perf06_history_19_1$,
      $perf06_history_19_2$alter policy "exercises own rows" on public.exercises
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
  )$perf06_history_19_2$,
      $perf06_history_19_3$alter policy "training cycles select own rows" on public.training_cycles
  using ((select auth.uid()) = user_id)$perf06_history_19_3$,
      $perf06_history_19_4$alter policy "training cycles insert own rows" on public.training_cycles
  with check ((select auth.uid()) = user_id)$perf06_history_19_4$,
      $perf06_history_19_5$alter policy "training cycles update own rows" on public.training_cycles
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id)$perf06_history_19_5$,
      $perf06_history_19_6$alter policy "training cycle routines select own rows" on public.training_cycle_routines
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = (select auth.uid())
        and c.deleted_at is null
    )
  )$perf06_history_19_6$,
      $perf06_history_19_7$alter policy "training cycle routines insert own rows" on public.training_cycle_routines
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = (select auth.uid())
        and c.deleted_at is null
    )
  )$perf06_history_19_7$,
      $perf06_history_19_8$alter policy "training cycle routines update own rows" on public.training_cycle_routines
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
  )$perf06_history_19_8$,
      $perf06_history_19_9$alter policy "training cycle days select own rows" on public.training_cycle_days
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
  )$perf06_history_19_9$,
      $perf06_history_19_10$alter policy "training cycle days insert own rows" on public.training_cycle_days
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
  )$perf06_history_19_10$,
      $perf06_history_19_11$alter policy "training cycle days update own rows" on public.training_cycle_days
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
  )$perf06_history_19_11$,
      $perf06_history_19_12$alter policy "training cycle exercises select own rows" on public.training_cycle_exercises
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
  )$perf06_history_19_12$,
      $perf06_history_19_13$alter policy "training cycle exercises insert own rows" on public.training_cycle_exercises
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
  )$perf06_history_19_13$,
      $perf06_history_19_14$alter policy "training cycle exercises update own rows" on public.training_cycle_exercises
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
  )$perf06_history_19_14$,
      $perf06_history_19_15$alter policy "sessions own rows" on public.training_sessions
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
  )$perf06_history_19_15$,
      $perf06_history_19_16$alter policy "entries own rows" on public.exercise_entries
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
  )$perf06_history_19_16$,
      $perf06_history_19_17$alter policy "daily readiness own select" on public.training_daily_readiness
  using ((select auth.uid()) = user_id)$perf06_history_19_17$,
      $perf06_history_19_18$alter policy "lineages own rows select" on public.training_exercise_lineages
  using (user_id = (select auth.uid()))$perf06_history_19_18$,
      $perf06_history_19_19$alter policy "lineages own rows insert" on public.training_exercise_lineages
  with check (user_id = (select auth.uid()))$perf06_history_19_19$,
      $perf06_history_19_20$alter policy "lineages own rows update" on public.training_exercise_lineages
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()))$perf06_history_19_20$,
      $perf06_history_19_21$alter policy "workout readiness own select" on public.training_workout_readiness
  using ((select auth.uid()) = user_id)$perf06_history_19_21$
    ]::text[]);

-- PERF06_SQL_EDITOR_MIGRATION APPLY 20260810230028 perf_06b_exercise_entries_user_session_created_id_index

-- PERF06_SQL_EDITOR_STATEMENT 20260810230028 1/1
create index exercise_entries_session_user_lineage_created_id_idx
  on public.exercise_entries (session_id, user_id, exercise_lineage_id, created_at, id)
;

-- PERF06_SQL_EDITOR_HISTORY 20260810230028 perf_06b_exercise_entries_user_session_created_id_index
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260810230028', 'perf_06b_exercise_entries_user_session_created_id_index', array[
      $perf06_history_20_0$create index exercise_entries_session_user_lineage_created_id_idx
  on public.exercise_entries (session_id, user_id, exercise_lineage_id, created_at, id)$perf06_history_20_0$
    ]::text[]);

-- PERF06_SQL_EDITOR_MIGRATION APPLY 20260811035538 ensure_legacy_exercise_lineage_invariant

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 1/25
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

set local statement_timeout = '15s'
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 2/25
set local lock_timeout = '5s'
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 3/25
-- CREATE TRIGGER also locks the table, but taking the write-conflicting lock first makes
-- the installation boundary explicit: pre-lock commits are handled by the later
-- compensatory migration; post-lock writes can only finish after this trigger exists.
lock table public.exercises in share row exclusive mode
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 4/25
lock table public.training_exercise_lineages in share row exclusive mode
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 5/25
drop policy if exists "lineages own rows select" on public.training_exercise_lineages
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 6/25
drop policy if exists "lineages own rows insert" on public.training_exercise_lineages
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 7/25
drop policy if exists "lineages own rows update" on public.training_exercise_lineages
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 8/25
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
  )
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 9/25
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
  )
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 10/25
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
  )
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 11/25
revoke all on table public.training_exercise_lineages from anon
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 12/25
revoke all on table public.training_exercise_lineages from authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 13/25
grant select, insert on table public.training_exercise_lineages to authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 14/25
grant update (origin_training_cycle_exercise_id, updated_at)
  on table public.training_exercise_lineages
  to authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 15/25
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
$function$
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 16/25
create trigger training_exercise_lineages_validate_identity_update
  before update on public.training_exercise_lineages
  for each row execute function public.validate_training_exercise_lineage_identity_update()
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 17/25
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
$function$
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 18/25
-- PostgreSQL checks EXECUTE when CREATE TRIGGER runs. Revoking direct execution after
-- trigger creation keeps it out of the Data API without disabling trigger invocation.
create trigger exercises_ensure_legacy_lineage
  after insert or update on public.exercises
  for each row execute function public.ensure_legacy_exercise_lineage_invariant()
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 19/25
revoke execute on function public.ensure_legacy_exercise_lineage_invariant() from public
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 20/25
revoke execute on function public.ensure_legacy_exercise_lineage_invariant() from anon
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 21/25
revoke execute on function public.ensure_legacy_exercise_lineage_invariant() from authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 22/25
revoke execute on function public.validate_training_exercise_lineage_identity_update() from public
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 23/25
revoke execute on function public.validate_training_exercise_lineage_identity_update() from anon
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 24/25
revoke execute on function public.validate_training_exercise_lineage_identity_update() from authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035538 25/25
-- Atomicity: the AFTER trigger runs inside the original exercise write transaction.
-- If the write rolls back, its lineage INSERT rolls back with it. An UPDATE of an older
-- exercise without lineage runs the same repair and must satisfy the same postcondition.
--
-- Proposed rollback (documentation only; separate authorization required): in one
-- transaction, drop public.exercises.exercises_ensure_legacy_lineage and then drop
-- public.ensure_legacy_exercise_lineage_invariant(). Existing lineage rows are data and
-- must not be removed by the invariant rollback.
;

-- PERF06_SQL_EDITOR_HISTORY 20260811035538 ensure_legacy_exercise_lineage_invariant
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260811035538', 'ensure_legacy_exercise_lineage_invariant', array[
      $perf06_history_21_0$-- PERF-06R: permanent lineage invariant for legacy exercise writes.
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

set local statement_timeout = '15s'$perf06_history_21_0$,
      $perf06_history_21_1$set local lock_timeout = '5s'$perf06_history_21_1$,
      $perf06_history_21_2$-- CREATE TRIGGER also locks the table, but taking the write-conflicting lock first makes
-- the installation boundary explicit: pre-lock commits are handled by the later
-- compensatory migration; post-lock writes can only finish after this trigger exists.
lock table public.exercises in share row exclusive mode$perf06_history_21_2$,
      $perf06_history_21_3$lock table public.training_exercise_lineages in share row exclusive mode$perf06_history_21_3$,
      $perf06_history_21_4$drop policy if exists "lineages own rows select" on public.training_exercise_lineages$perf06_history_21_4$,
      $perf06_history_21_5$drop policy if exists "lineages own rows insert" on public.training_exercise_lineages$perf06_history_21_5$,
      $perf06_history_21_6$drop policy if exists "lineages own rows update" on public.training_exercise_lineages$perf06_history_21_6$,
      $perf06_history_21_7$create policy "lineages own rows select"
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
  )$perf06_history_21_7$,
      $perf06_history_21_8$create policy "lineages own rows insert"
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
  )$perf06_history_21_8$,
      $perf06_history_21_9$create policy "lineages own rows update"
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
  )$perf06_history_21_9$,
      $perf06_history_21_10$revoke all on table public.training_exercise_lineages from anon$perf06_history_21_10$,
      $perf06_history_21_11$revoke all on table public.training_exercise_lineages from authenticated$perf06_history_21_11$,
      $perf06_history_21_12$grant select, insert on table public.training_exercise_lineages to authenticated$perf06_history_21_12$,
      $perf06_history_21_13$grant update (origin_training_cycle_exercise_id, updated_at)
  on table public.training_exercise_lineages
  to authenticated$perf06_history_21_13$,
      $perf06_history_21_14$create function public.validate_training_exercise_lineage_identity_update()
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
$function$$perf06_history_21_14$,
      $perf06_history_21_15$create trigger training_exercise_lineages_validate_identity_update
  before update on public.training_exercise_lineages
  for each row execute function public.validate_training_exercise_lineage_identity_update()$perf06_history_21_15$,
      $perf06_history_21_16$create function public.ensure_legacy_exercise_lineage_invariant()
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
$function$$perf06_history_21_16$,
      $perf06_history_21_17$-- PostgreSQL checks EXECUTE when CREATE TRIGGER runs. Revoking direct execution after
-- trigger creation keeps it out of the Data API without disabling trigger invocation.
create trigger exercises_ensure_legacy_lineage
  after insert or update on public.exercises
  for each row execute function public.ensure_legacy_exercise_lineage_invariant()$perf06_history_21_17$,
      $perf06_history_21_18$revoke execute on function public.ensure_legacy_exercise_lineage_invariant() from public$perf06_history_21_18$,
      $perf06_history_21_19$revoke execute on function public.ensure_legacy_exercise_lineage_invariant() from anon$perf06_history_21_19$,
      $perf06_history_21_20$revoke execute on function public.ensure_legacy_exercise_lineage_invariant() from authenticated$perf06_history_21_20$,
      $perf06_history_21_21$revoke execute on function public.validate_training_exercise_lineage_identity_update() from public$perf06_history_21_21$,
      $perf06_history_21_22$revoke execute on function public.validate_training_exercise_lineage_identity_update() from anon$perf06_history_21_22$,
      $perf06_history_21_23$revoke execute on function public.validate_training_exercise_lineage_identity_update() from authenticated$perf06_history_21_23$,
      $perf06_history_21_24$-- Atomicity: the AFTER trigger runs inside the original exercise write transaction.
-- If the write rolls back, its lineage INSERT rolls back with it. An UPDATE of an older
-- exercise without lineage runs the same repair and must satisfy the same postcondition.
--
-- Proposed rollback (documentation only; separate authorization required): in one
-- transaction, drop public.exercises.exercises_ensure_legacy_lineage and then drop
-- public.ensure_legacy_exercise_lineage_invariant(). Existing lineage rows are data and
-- must not be removed by the invariant rollback.$perf06_history_21_24$
    ]::text[]);

-- PERF06_SQL_EDITOR_MIGRATION APPLY 20260811035542 reconcile_legacy_exercise_lineages

-- PERF06_SQL_EDITOR_STATEMENT 20260811035542 1/4
-- PERF-06R: reconcile legacy exercises created before the permanent lineage invariant.
-- Local/QA candidate only. A separate read-only PROD audit is mandatory before merge.
-- The invariant migration must commit before this migration can begin.

set local statement_timeout = '15s'
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035542 2/4
set local lock_timeout = '5s'
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035542 3/4
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
$perf_06r$
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035542 4/4
-- Proposed rollback (documentation only; never automatic): after a separate audit confirms
-- that no entry or cycle exercise references the inserted lineages, remove only rows whose
-- metadata marker exactly matches reconciliation=PERF-06R, source=migration-history-normalization,
-- version=1. Any rollback requires separate authorization and must preserve pre-existing rows.
;

-- PERF06_SQL_EDITOR_HISTORY 20260811035542 reconcile_legacy_exercise_lineages
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260811035542', 'reconcile_legacy_exercise_lineages', array[
      $perf06_history_22_0$-- PERF-06R: reconcile legacy exercises created before the permanent lineage invariant.
-- Local/QA candidate only. A separate read-only PROD audit is mandatory before merge.
-- The invariant migration must commit before this migration can begin.

set local statement_timeout = '15s'$perf06_history_22_0$,
      $perf06_history_22_1$set local lock_timeout = '5s'$perf06_history_22_1$,
      $perf06_history_22_2$do $perf_06r$
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
$perf_06r$$perf06_history_22_2$,
      $perf06_history_22_3$-- Proposed rollback (documentation only; never automatic): after a separate audit confirms
-- that no entry or cycle exercise references the inserted lineages, remove only rows whose
-- metadata marker exactly matches reconciliation=PERF-06R, source=migration-history-normalization,
-- version=1. Any rollback requires separate authorization and must preserve pre-existing rows.$perf06_history_22_3$
    ]::text[]);

-- PERF06_SQL_EDITOR_MIGRATION APPLY 20260811190144 perf_06r_daily_readiness_acl_normalization

-- PERF06_SQL_EDITOR_STATEMENT 20260811190144 1/5
-- PERF-06R: normalize the executable ACL of the daily readiness RPC.
-- This migration changes privileges only; it does not replace the function.

revoke all on function public.save_daily_training_readiness(jsonb) from public
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811190144 2/5
revoke all on function public.save_daily_training_readiness(jsonb) from anon
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811190144 3/5
revoke all on function public.save_daily_training_readiness(jsonb) from service_role
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811190144 4/5
grant execute on function public.save_daily_training_readiness(jsonb) to authenticated
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811190144 5/5
grant execute on function public.save_daily_training_readiness(jsonb) to postgres
;

-- PERF06_SQL_EDITOR_HISTORY 20260811190144 perf_06r_daily_readiness_acl_normalization
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260811190144', 'perf_06r_daily_readiness_acl_normalization', array[
      $perf06_history_23_0$-- PERF-06R: normalize the executable ACL of the daily readiness RPC.
-- This migration changes privileges only; it does not replace the function.

revoke all on function public.save_daily_training_readiness(jsonb) from public$perf06_history_23_0$,
      $perf06_history_23_1$revoke all on function public.save_daily_training_readiness(jsonb) from anon$perf06_history_23_1$,
      $perf06_history_23_2$revoke all on function public.save_daily_training_readiness(jsonb) from service_role$perf06_history_23_2$,
      $perf06_history_23_3$grant execute on function public.save_daily_training_readiness(jsonb) to authenticated$perf06_history_23_3$,
      $perf06_history_23_4$grant execute on function public.save_daily_training_readiness(jsonb) to postgres$perf06_history_23_4$
    ]::text[]);

-- PERF06_SQL_EDITOR_MIGRATION SECOND_COMPENSATION_NOOP 20260811035542 reconcile_legacy_exercise_lineages

-- PERF06_SQL_EDITOR_STATEMENT 20260811035542 1/4
-- PERF-06R: reconcile legacy exercises created before the permanent lineage invariant.
-- Local/QA candidate only. A separate read-only PROD audit is mandatory before merge.
-- The invariant migration must commit before this migration can begin.

set local statement_timeout = '15s'
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035542 2/4
set local lock_timeout = '5s'
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035542 3/4
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
$perf_06r$
;

-- PERF06_SQL_EDITOR_STATEMENT 20260811035542 4/4
-- Proposed rollback (documentation only; never automatic): after a separate audit confirms
-- that no entry or cycle exercise references the inserted lineages, remove only rows whose
-- metadata marker exactly matches reconciliation=PERF-06R, source=migration-history-normalization,
-- version=1. Any rollback requires separate authorization and must preserve pre-existing rows.
;

update pg_temp.perf06_sql_editor_context
set final_snapshot = (
with
identity as (
select
  current_user::text as current_user,
  session_user::text as session_user,
  current_setting('transaction_isolation') as isolation_level,
  current_setting('transaction_read_only') as read_only,
  current_setting('server_version_num')::integer as server_version_num,
  current_database() as database_name,
  coalesce((select ssl from pg_catalog.pg_stat_ssl where pid = pg_catalog.pg_backend_pid()), false) as tls_active
),
partial_application as (
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
  ) as perf_triggers_absent
),
lineage_counts as (
select
  count(*) filter (where not exists (
    select 1 from public.training_exercise_lineages lineage
    where lineage.user_id = exercise.user_id
      and lineage.source_legacy_exercise_id = exercise.id
  ))::integer as pending,
  count(*)::integer as exercise_count
from public.exercises exercise
),
marker_count as (
select count(*)::integer as marker_count
from public.training_exercise_lineages
where metadata @> '{"reconciliation":"PERF-06R","source":"migration-history-normalization","version":1}'::jsonb
),
incompatible_lineages as (
select count(*)::integer as incompatible_count
from public.training_exercise_lineages lineage
join public.exercises exercise on exercise.id = lineage.source_legacy_exercise_id
where lineage.user_id <> exercise.user_id
   or lineage.origin_kind <> 'legacy'
   or lineage.origin_training_cycle_exercise_id is not null
),
fixture_identity as (
select exercise.user_id::text as owner_id, exercise.routine_id::text as routine_id
from public.exercises exercise
join auth.users app_user on app_user.id = exercise.user_id
join public.routines routine on routine.id = exercise.routine_id and routine.user_id = exercise.user_id
order by exercise.id
limit 1
),
diagnostic_exists as (
select to_regclass('public.training_session_consolidation_audit') is not null as diagnostic_exists
),
diagnostic_count as (
select
  pg_catalog.count(*)::integer as diagnostic_count,
  pg_catalog.count(*) filter (where status::text = 'executed')::integer as diagnostic_executed_count
from public.training_session_consolidation_audit
),
diagnostic_hash as (
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
  union all
  select 'row|' || pg_catalog.to_jsonb(diagnostic)::text
  from public.training_session_consolidation_audit as diagnostic
)
select pg_catalog.encode(
  pg_catalog.sha256(
    pg_catalog.convert_to(pg_catalog.string_agg(line, E'\n' order by line), 'UTF8')
  ),
  'hex'
) as diagnostic_hash
from diagnostic_lines
),
diagnostic_consumers as (
select count(*)::integer as consumer_count
from pg_catalog.pg_depend dependency
join pg_catalog.pg_rewrite rewrite_row on dependency.classid = 'pg_catalog.pg_rewrite'::regclass and rewrite_row.oid = dependency.objid
join pg_catalog.pg_class dependent on dependent.oid = rewrite_row.ev_class
where dependency.refobjid = 'public.training_session_consolidation_audit'::regclass
  and dependent.oid <> dependency.refobjid
),
data_counts as (
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
) as counts
),
fixtures as (
select
  not exists (select 1 from public.exercises where name like '__perf06_fixture_%')
  and not exists (select 1 from public.routines where name like '__perf06_fixture_%')
  and not exists (select 1 from public.training_cycles where name like '__perf06_fixture_%')
  and not exists (select 1 from public.training_cycle_routines where name like '__perf06_fixture_%')
  and not exists (select 1 from public.training_cycle_exercises where name like '__perf06_fixture_%')
  and not exists (select 1 from public.training_exercise_lineages where metadata ? 'fixture')
  as valid
),
prod_guard as (
with target_function as (
  select
    procedure.oid,
    procedure.proowner,
    owner_role.rolname as owner_name,
    language.lanname as language_name,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.proacl,
    pg_catalog.format_type(procedure.prorettype, null) as return_type,
    pg_catalog.pg_get_function_identity_arguments(procedure.oid) as identity_arguments,
    pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g') as normalized_definition,
    pg_catalog.concat_ws(
      '|',
      namespace.nspname,
      procedure.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid),
      procedure.prosecdef::text,
      coalesce(pg_catalog.array_to_string(procedure.proconfig, ','), ''),
      coalesce((
        select pg_catalog.string_agg(acl_item::text, ',' order by acl_item::text)
        from pg_catalog.unnest(coalesce(procedure.proacl, '{}'::pg_catalog.aclitem[])) as acl_item
      ), ''),
      pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g')
    ) as fingerprint_line
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  join pg_catalog.pg_roles as owner_role on owner_role.oid = procedure.proowner
  join pg_catalog.pg_language as language on language.oid = procedure.prolang
  where namespace.nspname = 'public'
    and procedure.proname = 'rls_auto_enable'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''
),
function_snapshot as (
  select
    pg_catalog.count(*)::integer as function_count,
    pg_catalog.min(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('function|' || fingerprint_line, 'UTF8')), 'hex')) as function_item_sha256,
    pg_catalog.min(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized_definition, 'UTF8')), 'hex')) as definition_sha256,
    coalesce(pg_catalog.bool_and(owner_name = 'postgres'), false) as owner_is_postgres,
    coalesce(pg_catalog.bool_and(language_name = 'plpgsql'), false) as language_is_plpgsql,
    coalesce(pg_catalog.bool_and(prosecdef), false) as security_definer,
    coalesce(pg_catalog.bool_and(coalesce(proconfig, '{}'::text[]) @> array['search_path=pg_catalog']::text[]), false) as search_path_pg_catalog,
    coalesce(pg_catalog.bool_and(return_type = 'event_trigger'), false) as returns_event_trigger,
    coalesce(pg_catalog.bool_and(identity_arguments = ''), false) as zero_arguments
  from target_function
),
target_event_triggers as (
  select
    event_trigger.evtname,
    event_trigger.evtevent,
    event_trigger.evtenabled,
    event_trigger.evttags,
    event_owner.rolname as owner_name,
    event_trigger.evtfoid,
    target.oid as target_function_oid
  from pg_catalog.pg_event_trigger as event_trigger
  join pg_catalog.pg_roles as event_owner on event_owner.oid = event_trigger.evtowner
  left join target_function as target on target.oid = event_trigger.evtfoid
  where event_trigger.evtname = 'ensure_rls' or target.oid is not null
),
event_snapshot as (
  select
    pg_catalog.count(*) filter (where evtname = 'ensure_rls')::integer as ensure_rls_count,
    pg_catalog.count(*) filter (where target_function_oid is not null)::integer as triggers_using_function,
    coalesce(pg_catalog.bool_and(owner_name = 'postgres') filter (where evtname = 'ensure_rls'), false) as owner_is_postgres,
    coalesce(pg_catalog.bool_and(evtevent = 'ddl_command_end') filter (where evtname = 'ensure_rls'), false) as event_is_ddl_command_end,
    coalesce(pg_catalog.bool_and(evtenabled = 'O') filter (where evtname = 'ensure_rls'), false) as enabled_for_origin,
    coalesce(pg_catalog.bool_and(evtfoid = target_function_oid) filter (where evtname = 'ensure_rls'), false) as calls_target_function,
    coalesce(pg_catalog.bool_and(
      evttags @> array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']::text[]
      and evttags <@ array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']::text[]
    ) filter (where evtname = 'ensure_rls'), false) as tags_exact,
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'name', evtname,
      'event', evtevent,
      'enabled', evtenabled,
      'tags', evttags,
      'owner', owner_name,
      'calls_target', evtfoid = target_function_oid
    ) order by evtname), '[]'::jsonb) as event_triggers
  from target_event_triggers
),
dependency_rows as (
  select 'inbound'::text as direction, dependency.classid::pg_catalog.regclass::text as catalog_name, dependency.deptype::text as dependency_type
  from pg_catalog.pg_depend as dependency
  join target_function as target
    on dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass and dependency.refobjid = target.oid
  union all
  select 'outbound', dependency.refclassid::pg_catalog.regclass::text, dependency.deptype::text
  from pg_catalog.pg_depend as dependency
  join target_function as target
    on dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass and dependency.objid = target.oid
),
dependency_snapshot as (
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'direction', direction,
    'catalog', catalog_name,
    'dependency_type', dependency_type,
    'count', dependency_count
  ) order by direction, catalog_name, dependency_type), '[]'::jsonb) as dependencies
  from (
    select direction, catalog_name, dependency_type, pg_catalog.count(*) as dependency_count
    from dependency_rows
    group by direction, catalog_name, dependency_type
  ) as grouped_dependencies
),
evaluation as (
  select
    function_snapshot.function_item_sha256,
    function_snapshot.definition_sha256,
    event_snapshot.event_triggers,
    dependency_snapshot.dependencies,
    function_snapshot.function_count = 1
      and function_snapshot.function_item_sha256 = 'ebaddb158c298b7eae7866253693d743cac3092c141ccc1a4f312cd32498ca47'
      and function_snapshot.definition_sha256 = '5d4290d1e54f4cee0080882c635a4fd6f669629322cfd8f963ef02da4eee5541'
      and function_snapshot.owner_is_postgres
      and function_snapshot.language_is_plpgsql
      and function_snapshot.security_definer
      and function_snapshot.search_path_pg_catalog
      and function_snapshot.returns_event_trigger
      and function_snapshot.zero_arguments
      and event_snapshot.ensure_rls_count = 1
      and event_snapshot.triggers_using_function = 1
      and event_snapshot.owner_is_postgres
      and event_snapshot.event_is_ddl_command_end
      and event_snapshot.enabled_for_origin
      and event_snapshot.calls_target_function
      and event_snapshot.tags_exact
      and dependency_snapshot.dependencies = '[{"count":1,"catalog":"pg_event_trigger","direction":"inbound","dependency_type":"n"},{"count":1,"catalog":"pg_language","direction":"outbound","dependency_type":"n"},{"count":1,"catalog":"pg_namespace","direction":"outbound","dependency_type":"n"}]'::jsonb
      as valid
  from function_snapshot, event_snapshot, dependency_snapshot
)
select
  valid,
  function_item_sha256,
  definition_sha256,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.concat_ws('|', function_item_sha256, definition_sha256, event_triggers::text, dependencies::text),
    'UTF8'
  )), 'hex') as guard_hash
from evaluation
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
    and not (
      procedure.proname = 'rls_auto_enable'
      and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''
    )

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
expected_history(version, name, statements) as (
  values
    ('20260513000001', 'add_exercise_day', array[
      $perf06_history_0_0$alter table public.exercises
  add column if not exists day text$perf06_history_0_0$
    ]::text[]),
    ('20260527000002', 'training_sessions_source_of_truth', array[
      $perf06_history_1_0$alter table public.routines
  add column if not exists deleted_at timestamptz$perf06_history_1_0$,
      $perf06_history_1_1$alter table public.training_sessions
  add column if not exists routine_id uuid references public.routines(id) on delete restrict,
  add column if not exists calendar_week_start date,
  add column if not exists planned_day text,
  add column if not exists planned_date date,
  add column if not exists trained_date date,
  add column if not exists status text not null default 'completed',
  add column if not exists completed_at timestamptz,
  add column if not exists deleted_at timestamptz$perf06_history_1_1$,
      $perf06_history_1_2$alter table public.training_sessions
  drop constraint if exists training_sessions_status_check$perf06_history_1_2$,
      $perf06_history_1_3$alter table public.training_sessions
  add constraint training_sessions_status_check
  check (status in ('completed', 'skipped'))$perf06_history_1_3$,
      $perf06_history_1_4$alter table public.training_sessions
  drop constraint if exists training_sessions_planned_day_check$perf06_history_1_4$,
      $perf06_history_1_5$alter table public.training_sessions
  add constraint training_sessions_planned_day_check
  check (
    planned_day is null
    or planned_day in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
  )$perf06_history_1_5$,
      $perf06_history_1_6$create index if not exists training_sessions_user_trained_date_idx
  on public.training_sessions(user_id, trained_date)$perf06_history_1_6$,
      $perf06_history_1_7$create index if not exists training_sessions_user_calendar_week_idx
  on public.training_sessions(user_id, calendar_week_start)$perf06_history_1_7$,
      $perf06_history_1_8$create index if not exists training_sessions_user_routine_week_idx
  on public.training_sessions(user_id, routine_id, calendar_week_start)$perf06_history_1_8$,
      $perf06_history_1_9$create index if not exists training_sessions_user_status_idx
  on public.training_sessions(user_id, status)$perf06_history_1_9$,
      $perf06_history_1_10$create index if not exists training_sessions_user_deleted_at_idx
  on public.training_sessions(user_id, deleted_at)$perf06_history_1_10$,
      $perf06_history_1_11$-- Legacy rows with routine_id IS NULL do not participate in this unique index.
-- New training writes must provide routine_id through create_training_session_with_entries.
create unique index if not exists training_sessions_user_routine_trained_unique_idx
  on public.training_sessions(user_id, routine_id, trained_date)
  where deleted_at is null$perf06_history_1_11$,
      $perf06_history_1_12$create or replace function public.create_training_session_with_entries(
  p_routine_id uuid,
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
  v_calendar_week_start date;
  v_session_id uuid;
  v_entry jsonb;
  v_exercise_id uuid;
  v_reps jsonb;
  v_seen_exercises uuid[] := array[]::uuid[];
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_routine_id is null then
    raise exception 'La rutina es obligatoria';
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

  if not exists (
    select 1
    from public.routines r
    where r.id = p_routine_id
      and r.user_id = v_user_id
      and r.deleted_at is null
  ) then
    raise exception 'La rutina no existe o no pertenece al usuario';
  end if;

  if p_status = 'completed' and jsonb_array_length(v_entries) = 0 then
    raise exception 'Un entrenamiento completado requiere ejercicios';
  end if;

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.routine_id = p_routine_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para esta rutina y fecha';
  end if;

  v_calendar_week_start := p_trained_date - (extract(isodow from p_trained_date)::integer - 1);

  insert into public.training_sessions (
    user_id,
    routine_id,
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
    p_routine_id,
    coalesce(p_week_number, 1),
    p_trained_date,
    v_calendar_week_start,
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
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception 'Cada ejercicio debe ser un objeto JSON';
      end if;

      if nullif(v_entry->>'exercise_id', '') is null then
        raise exception 'Cada ejercicio requiere exercise_id';
      end if;

      begin
        v_exercise_id := (v_entry->>'exercise_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'exercise_id invalido';
      end;

      if v_exercise_id = any(v_seen_exercises) then
        raise exception 'El entrenamiento contiene ejercicios duplicados';
      end if;
      v_seen_exercises := array_append(v_seen_exercises, v_exercise_id);

      v_reps := v_entry->'reps';
      if v_reps is null or jsonb_typeof(v_reps) <> 'array' then
        raise exception 'Cada ejercicio requiere reps como arreglo';
      end if;

      if jsonb_array_length(v_reps) = 0 then
        raise exception 'Cada ejercicio requiere al menos una repeticion';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation then
          raise exception 'reps debe contener enteros validos';
      end;

      if not exists (
        select 1
        from public.exercises e
        where e.id = v_exercise_id
          and e.user_id = v_user_id
          and e.routine_id = p_routine_id
      ) then
        raise exception 'Un ejercicio no pertenece a la rutina del usuario';
      end if;

      insert into public.exercise_entries (
        id,
        user_id,
        session_id,
        exercise_id,
        weight,
        previous_weight,
        reps,
        rir,
        notes
      )
      values (
        coalesce((v_entry->>'id')::uuid, gen_random_uuid()),
        v_user_id,
        v_session_id,
        v_exercise_id,
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
$$$perf06_history_1_12$
    ]::text[]),
    ('20260531000001', 'training_cycles', array[
      $perf06_history_2_0$-- Fase 2.2J - Migracion productiva controlada para ciclos de Training.
-- Validada previamente en QA durante Fase 2.2C.
-- No toca public.training_sessions.
-- No toca public.exercise_entries.
-- No migra localStorage.
-- No crea datos iniciales.
--
-- Rollback conceptual, no ejecutar aqui:
-- 1. drop policy if exists ... on public.training_cycles;
-- 2. drop trigger if exists training_cycles_set_updated_at on public.training_cycles;
-- 3. drop index if exists training_cycles_one_active_per_user_idx;
-- 4. drop index if exists training_cycles_user_deleted_at_idx;
-- 5. drop index if exists training_cycles_user_created_idx;
-- 6. drop index if exists training_cycles_user_status_idx;
-- 7. drop table if exists public.training_cycles;

create table if not exists public.training_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  cycle_number integer not null check (cycle_number > 0),
  cycle_type text null,
  goal text null,
  started_at timestamptz not null,
  ended_at timestamptz null,
  status text not null check (status in ('active', 'completed', 'cancelled')),
  plan_snapshot jsonb not null default '{}'::jsonb,
  summary_snapshot jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
)$perf06_history_2_0$,
      $perf06_history_2_1$create index if not exists training_cycles_user_status_idx
  on public.training_cycles(user_id, status)$perf06_history_2_1$,
      $perf06_history_2_2$create index if not exists training_cycles_user_created_idx
  on public.training_cycles(user_id, created_at)$perf06_history_2_2$,
      $perf06_history_2_3$create index if not exists training_cycles_user_deleted_at_idx
  on public.training_cycles(user_id, deleted_at)$perf06_history_2_3$,
      $perf06_history_2_4$create unique index if not exists training_cycles_one_active_per_user_idx
  on public.training_cycles(user_id)
  where status = 'active' and deleted_at is null$perf06_history_2_4$,
      $perf06_history_2_5$drop trigger if exists training_cycles_set_updated_at on public.training_cycles$perf06_history_2_5$,
      $perf06_history_2_6$create trigger training_cycles_set_updated_at
  before update on public.training_cycles
  for each row execute function public.set_updated_at()$perf06_history_2_6$,
      $perf06_history_2_7$alter table public.training_cycles enable row level security$perf06_history_2_7$,
      $perf06_history_2_8$drop policy if exists "training cycles select own rows" on public.training_cycles$perf06_history_2_8$,
      $perf06_history_2_9$create policy "training cycles select own rows" on public.training_cycles
  for select
  using (auth.uid() = user_id)$perf06_history_2_9$,
      $perf06_history_2_10$drop policy if exists "training cycles insert own rows" on public.training_cycles$perf06_history_2_10$,
      $perf06_history_2_11$create policy "training cycles insert own rows" on public.training_cycles
  for insert
  with check (auth.uid() = user_id)$perf06_history_2_11$,
      $perf06_history_2_12$drop policy if exists "training cycles update own rows" on public.training_cycles$perf06_history_2_12$,
      $perf06_history_2_13$create policy "training cycles update own rows" on public.training_cycles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id)$perf06_history_2_13$,
      $perf06_history_2_14$-- No se crea policy de delete para authenticated.
-- No se agregan grants explicitos porque el repo no los define para tablas existentes con RLS.$perf06_history_2_14$
    ]::text[]),
    ('20260604000001', 'training_cycle_scoped_model', array[
      $perf06_history_3_0$-- Fase 2.2AN - Migracion QA candidata modelo cycle-scoped Training.
-- CANDIDATA LOCAL: no aplicar en Production sin autorizacion explicita.
-- Objetivo:
-- - Extender training_cycles con duracion normalizada.
-- - Crear tablas de planificacion por ciclo.
-- - Asociar sesiones y entries al modelo cycle-scoped.
-- - Definir RLS, grants minimos y RPCs transaccionales candidatas.

create extension if not exists "pgcrypto"$perf06_history_3_0$,
      $perf06_history_3_1$alter table public.training_cycles
  add column if not exists duration_weeks integer null,
  add column if not exists planned_start_date date null,
  add column if not exists planned_end_date date null$perf06_history_3_1$,
      $perf06_history_3_2$do $$
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
end $$$perf06_history_3_2$,
      $perf06_history_3_3$create table if not exists public.training_cycle_routines (
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
)$perf06_history_3_3$,
      $perf06_history_3_4$create table if not exists public.training_cycle_days (
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
)$perf06_history_3_4$,
      $perf06_history_3_5$create table if not exists public.training_cycle_exercises (
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
)$perf06_history_3_5$,
      $perf06_history_3_6$alter table public.training_sessions
  add column if not exists cycle_id uuid null references public.training_cycles(id) on delete restrict,
  add column if not exists cycle_day_id uuid null references public.training_cycle_days(id) on delete restrict$perf06_history_3_6$,
      $perf06_history_3_7$alter table public.exercise_entries
  add column if not exists training_cycle_exercise_id uuid null
  references public.training_cycle_exercises(id) on delete restrict$perf06_history_3_7$,
      $perf06_history_3_8$do $$
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
end $$$perf06_history_3_8$,
      $perf06_history_3_9$create index if not exists training_cycle_routines_user_cycle_idx
  on public.training_cycle_routines(user_id, cycle_id)
  where deleted_at is null$perf06_history_3_9$,
      $perf06_history_3_10$create unique index if not exists training_cycle_routines_user_cycle_name_idx
  on public.training_cycle_routines(user_id, cycle_id, lower(name))
  where deleted_at is null$perf06_history_3_10$,
      $perf06_history_3_11$create unique index if not exists training_cycle_days_one_routine_per_day_idx
  on public.training_cycle_days(user_id, cycle_id, week_index, day_code)
  where deleted_at is null$perf06_history_3_11$,
      $perf06_history_3_12$create index if not exists training_cycle_days_user_cycle_week_day_idx
  on public.training_cycle_days(user_id, cycle_id, week_index, day_code)
  where deleted_at is null$perf06_history_3_12$,
      $perf06_history_3_13$create index if not exists training_cycle_exercises_user_cycle_day_idx
  on public.training_cycle_exercises(user_id, cycle_id, day_id)
  where deleted_at is null$perf06_history_3_13$,
      $perf06_history_3_14$create index if not exists training_sessions_user_cycle_idx
  on public.training_sessions(user_id, cycle_id)
  where deleted_at is null$perf06_history_3_14$,
      $perf06_history_3_15$create index if not exists exercise_entries_user_cycle_exercise_idx
  on public.exercise_entries(user_id, training_cycle_exercise_id)
  where training_cycle_exercise_id is not null$perf06_history_3_15$,
      $perf06_history_3_16$drop trigger if exists training_cycle_routines_set_updated_at on public.training_cycle_routines$perf06_history_3_16$,
      $perf06_history_3_17$create trigger training_cycle_routines_set_updated_at
  before update on public.training_cycle_routines
  for each row execute function public.set_updated_at()$perf06_history_3_17$,
      $perf06_history_3_18$drop trigger if exists training_cycle_days_set_updated_at on public.training_cycle_days$perf06_history_3_18$,
      $perf06_history_3_19$create trigger training_cycle_days_set_updated_at
  before update on public.training_cycle_days
  for each row execute function public.set_updated_at()$perf06_history_3_19$,
      $perf06_history_3_20$drop trigger if exists training_cycle_exercises_set_updated_at on public.training_cycle_exercises$perf06_history_3_20$,
      $perf06_history_3_21$create trigger training_cycle_exercises_set_updated_at
  before update on public.training_cycle_exercises
  for each row execute function public.set_updated_at()$perf06_history_3_21$,
      $perf06_history_3_22$alter table public.training_cycle_routines enable row level security$perf06_history_3_22$,
      $perf06_history_3_23$alter table public.training_cycle_days enable row level security$perf06_history_3_23$,
      $perf06_history_3_24$alter table public.training_cycle_exercises enable row level security$perf06_history_3_24$,
      $perf06_history_3_25$alter table public.training_cycles enable row level security$perf06_history_3_25$,
      $perf06_history_3_26$drop policy if exists "training cycles select own rows" on public.training_cycles$perf06_history_3_26$,
      $perf06_history_3_27$create policy "training cycles select own rows" on public.training_cycles
  for select
  to authenticated
  using (auth.uid() = user_id)$perf06_history_3_27$,
      $perf06_history_3_28$drop policy if exists "training cycles insert own rows" on public.training_cycles$perf06_history_3_28$,
      $perf06_history_3_29$create policy "training cycles insert own rows" on public.training_cycles
  for insert
  to authenticated
  with check (auth.uid() = user_id)$perf06_history_3_29$,
      $perf06_history_3_30$drop policy if exists "training cycles update own rows" on public.training_cycles$perf06_history_3_30$,
      $perf06_history_3_31$create policy "training cycles update own rows" on public.training_cycles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id)$perf06_history_3_31$,
      $perf06_history_3_32$drop policy if exists "training cycle routines select own rows" on public.training_cycle_routines$perf06_history_3_32$,
      $perf06_history_3_33$create policy "training cycle routines select own rows" on public.training_cycle_routines
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
  )$perf06_history_3_33$,
      $perf06_history_3_34$drop policy if exists "training cycle routines insert own rows" on public.training_cycle_routines$perf06_history_3_34$,
      $perf06_history_3_35$create policy "training cycle routines insert own rows" on public.training_cycle_routines
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
  )$perf06_history_3_35$,
      $perf06_history_3_36$drop policy if exists "training cycle routines update own rows" on public.training_cycle_routines$perf06_history_3_36$,
      $perf06_history_3_37$create policy "training cycle routines update own rows" on public.training_cycle_routines
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
  )$perf06_history_3_37$,
      $perf06_history_3_38$drop policy if exists "training cycle days select own rows" on public.training_cycle_days$perf06_history_3_38$,
      $perf06_history_3_39$create policy "training cycle days select own rows" on public.training_cycle_days
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
  )$perf06_history_3_39$,
      $perf06_history_3_40$drop policy if exists "training cycle days insert own rows" on public.training_cycle_days$perf06_history_3_40$,
      $perf06_history_3_41$create policy "training cycle days insert own rows" on public.training_cycle_days
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
  )$perf06_history_3_41$,
      $perf06_history_3_42$drop policy if exists "training cycle days update own rows" on public.training_cycle_days$perf06_history_3_42$,
      $perf06_history_3_43$create policy "training cycle days update own rows" on public.training_cycle_days
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
  )$perf06_history_3_43$,
      $perf06_history_3_44$drop policy if exists "training cycle exercises select own rows" on public.training_cycle_exercises$perf06_history_3_44$,
      $perf06_history_3_45$create policy "training cycle exercises select own rows" on public.training_cycle_exercises
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
  )$perf06_history_3_45$,
      $perf06_history_3_46$drop policy if exists "training cycle exercises insert own rows" on public.training_cycle_exercises$perf06_history_3_46$,
      $perf06_history_3_47$create policy "training cycle exercises insert own rows" on public.training_cycle_exercises
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
  )$perf06_history_3_47$,
      $perf06_history_3_48$drop policy if exists "training cycle exercises update own rows" on public.training_cycle_exercises$perf06_history_3_48$,
      $perf06_history_3_49$create policy "training cycle exercises update own rows" on public.training_cycle_exercises
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
  )$perf06_history_3_49$,
      $perf06_history_3_50$drop policy if exists "sessions own rows" on public.training_sessions$perf06_history_3_50$,
      $perf06_history_3_51$create policy "sessions own rows" on public.training_sessions
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
  )$perf06_history_3_51$,
      $perf06_history_3_52$drop policy if exists "entries own rows" on public.exercise_entries$perf06_history_3_52$,
      $perf06_history_3_53$create policy "entries own rows" on public.exercise_entries
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
  )$perf06_history_3_53$,
      $perf06_history_3_54$-- Normalizacion explicita de permisos QA.
-- 2.2AP detecto grants amplios existentes en tablas legacy de ejecucion.
revoke all on table public.training_sessions from anon$perf06_history_3_54$,
      $perf06_history_3_55$revoke all on table public.exercise_entries from anon$perf06_history_3_55$,
      $perf06_history_3_56$revoke all on table public.training_cycles from anon$perf06_history_3_56$,
      $perf06_history_3_57$revoke all on table public.training_cycle_routines from anon$perf06_history_3_57$,
      $perf06_history_3_58$revoke all on table public.training_cycle_days from anon$perf06_history_3_58$,
      $perf06_history_3_59$revoke all on table public.training_cycle_exercises from anon$perf06_history_3_59$,
      $perf06_history_3_60$revoke delete, truncate, references, trigger on table public.training_sessions from authenticated$perf06_history_3_60$,
      $perf06_history_3_61$revoke delete, truncate, references, trigger on table public.exercise_entries from authenticated$perf06_history_3_61$,
      $perf06_history_3_62$revoke delete, truncate, references, trigger on table public.training_cycles from authenticated$perf06_history_3_62$,
      $perf06_history_3_63$revoke delete, truncate, references, trigger on table public.training_cycle_routines from authenticated$perf06_history_3_63$,
      $perf06_history_3_64$revoke delete, truncate, references, trigger on table public.training_cycle_days from authenticated$perf06_history_3_64$,
      $perf06_history_3_65$revoke delete, truncate, references, trigger on table public.training_cycle_exercises from authenticated$perf06_history_3_65$,
      $perf06_history_3_66$grant select, insert, update on table public.training_cycle_routines to authenticated$perf06_history_3_66$,
      $perf06_history_3_67$grant select, insert, update on table public.training_cycle_days to authenticated$perf06_history_3_67$,
      $perf06_history_3_68$grant select, insert, update on table public.training_cycle_exercises to authenticated$perf06_history_3_68$,
      $perf06_history_3_69$grant select, insert, update on table public.training_cycles to authenticated$perf06_history_3_69$,
      $perf06_history_3_70$grant select, insert, update on table public.training_sessions to authenticated$perf06_history_3_70$,
      $perf06_history_3_71$grant select, insert, update on table public.exercise_entries to authenticated$perf06_history_3_71$,
      $perf06_history_3_72$create or replace function public.create_training_cycle_with_plan(
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
$$$perf06_history_3_72$,
      $perf06_history_3_73$create or replace function public.create_training_session_with_cycle_entries(
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
$$$perf06_history_3_73$,
      $perf06_history_3_74$grant execute on function public.create_training_cycle_with_plan(
  text,
  integer,
  text,
  text,
  integer,
  date,
  date,
  jsonb
) to authenticated$perf06_history_3_74$,
      $perf06_history_3_75$grant execute on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) to authenticated$perf06_history_3_75$,
      $perf06_history_3_76$-- No se concede delete a authenticated.
-- No se conceden privilegios a anon para el modelo cycle-scoped.$perf06_history_3_76$
    ]::text[]),
    ('20260604000002', 'training_cycle_scoped_policy_fix', array[
      $perf06_history_4_0$-- Fase 2.2AQ - Patch candidato QA para corregir policies cycle-scoped.
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
end $$$perf06_history_4_0$,
      $perf06_history_4_1$do $$
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
end $$$perf06_history_4_1$,
      $perf06_history_4_2$drop policy if exists "training cycle days select own rows" on public.training_cycle_days$perf06_history_4_2$,
      $perf06_history_4_3$create policy "training cycle days select own rows" on public.training_cycle_days
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
  )$perf06_history_4_3$,
      $perf06_history_4_4$drop policy if exists "training cycle days insert own rows" on public.training_cycle_days$perf06_history_4_4$,
      $perf06_history_4_5$create policy "training cycle days insert own rows" on public.training_cycle_days
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
  )$perf06_history_4_5$,
      $perf06_history_4_6$drop policy if exists "training cycle days update own rows" on public.training_cycle_days$perf06_history_4_6$,
      $perf06_history_4_7$create policy "training cycle days update own rows" on public.training_cycle_days
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
  )$perf06_history_4_7$,
      $perf06_history_4_8$drop policy if exists "training cycle exercises select own rows" on public.training_cycle_exercises$perf06_history_4_8$,
      $perf06_history_4_9$create policy "training cycle exercises select own rows" on public.training_cycle_exercises
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
  )$perf06_history_4_9$,
      $perf06_history_4_10$drop policy if exists "training cycle exercises insert own rows" on public.training_cycle_exercises$perf06_history_4_10$,
      $perf06_history_4_11$create policy "training cycle exercises insert own rows" on public.training_cycle_exercises
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
  )$perf06_history_4_11$,
      $perf06_history_4_12$drop policy if exists "training cycle exercises update own rows" on public.training_cycle_exercises$perf06_history_4_12$,
      $perf06_history_4_13$create policy "training cycle exercises update own rows" on public.training_cycle_exercises
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
  )$perf06_history_4_13$,
      $perf06_history_4_14$drop policy if exists "sessions own rows" on public.training_sessions$perf06_history_4_14$,
      $perf06_history_4_15$create policy "sessions own rows" on public.training_sessions
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
  )$perf06_history_4_15$,
      $perf06_history_4_16$drop policy if exists "entries own rows" on public.exercise_entries$perf06_history_4_16$,
      $perf06_history_4_17$create policy "entries own rows" on public.exercise_entries
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
  )$perf06_history_4_17$
    ]::text[]),
    ('20260605000001', 'training_cycle_scoped_session_entries_contract', array[
      $perf06_history_5_0$-- Fase 2.2AW-SQL - Patch candidato QA para persistencia cycle-scoped pura.
-- CANDIDATA LOCAL: no aplicar sin autorizacion explicita.
-- Objetivo:
-- - Permitir exercise_entries sin exercise_id legacy cuando existe training_cycle_exercise_id.
-- - Mantener compatibilidad legacy para entries con exercise_id.
-- - Evitar mezcla artificial entre legacy y cycle-scoped.
-- - Reemplazar la RPC de guardado de sesiones cycle-scoped sin tocar Production.

alter table public.exercise_entries
  alter column exercise_id drop not null$perf06_history_5_0$,
      $perf06_history_5_1$do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'exercise_entries_exercise_or_cycle_exercise_check'
      and conrelid = 'public.exercise_entries'::regclass
  ) then
    alter table public.exercise_entries
      add constraint exercise_entries_exercise_or_cycle_exercise_check
      check (
        exercise_id is not null
        or training_cycle_exercise_id is not null
      );
  end if;
end $$$perf06_history_5_1$,
      $perf06_history_5_2$drop policy if exists "entries own rows" on public.exercise_entries$perf06_history_5_2$,
      $perf06_history_5_3$create policy "entries own rows" on public.exercise_entries
  for all
  to authenticated
  using (
    auth.uid() = exercise_entries.user_id
    and exists (
      select 1
      from public.training_sessions s
      where s.id = exercise_entries.session_id
        and s.user_id = auth.uid()
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
                and e.user_id = auth.uid()
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
                and tce.user_id = auth.uid()
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
                        and e.user_id = auth.uid()
                    )
                  )
                )
            )
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
                and e.user_id = auth.uid()
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
                and tce.user_id = auth.uid()
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
                        and e.user_id = auth.uid()
                    )
                  )
                )
            )
          )
        )
    )
  )$perf06_history_5_3$,
      $perf06_history_5_4$create or replace function public.create_training_session_with_cycle_entries(
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

      if v_legacy_exercise_id is not null and not exists (
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
            v_legacy_exercise_id is null
            or tce.source_legacy_exercise_id = v_legacy_exercise_id
          )
      ) then
        raise exception 'El ejercicio planificado no pertenece al ciclo/dia del usuario o no corresponde al ejercicio legacy informado';
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
$$$perf06_history_5_4$,
      $perf06_history_5_5$grant execute on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) to authenticated$perf06_history_5_5$,
      $perf06_history_5_6$-- Rollback QA sugerido, no ejecutar sin autorizacion:
-- 1. Apagar feature flag QA.
-- 2. Preservar evidencia de sesiones/entries creadas por la prueba.
-- 3. Si existen exercise_entries con exercise_id null, no se puede restaurar NOT NULL
--    sin limpiar o corregir esos datos QA con autorizacion explicita.
-- 4. Dropear la constraint nueva si se vuelve al contrato anterior:
--    alter table public.exercise_entries
--      drop constraint if exists exercise_entries_exercise_or_cycle_exercise_check;
-- 5. Reinstalar la version previa de public.create_training_session_with_cycle_entries
--    desde 20260604_training_cycle_scoped_model.sql si se requiere volver al contrato anterior.
-- 6. Reinstalar la policy "entries own rows" previa si se requiere volver al contrato legacy estricto.$perf06_history_5_6$
    ]::text[]),
    ('20260607000001', 'training_cycle_scoped_snapshot_source', array[
      $perf06_history_6_0$-- Fase 2.2BU: normalize the external cycle-scoped snapshot marker for new cycles.
-- Historical/QA cycles can keep plan_snapshot.source = "cycle-scoped-qa".
-- New cycles created through this RPC use plan_snapshot.source = "cycle-scoped".

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
$$$perf06_history_6_0$,
      $perf06_history_6_1$grant execute on function public.create_training_cycle_with_plan(
  text,
  integer,
  text,
  text,
  integer,
  date,
  date,
  jsonb
) to authenticated$perf06_history_6_1$
    ]::text[]),
    ('20260608000001', 'training_daily_readiness', array[
      $perf06_history_7_0$-- Fase 2.2CO: idempotencia diaria del formulario de motivacion/readiness.
-- No toca training_sessions, exercise_entries ni training_cycles.

create table if not exists public.training_daily_readiness (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_daily_readiness_user_local_date_key unique (user_id, local_date),
  constraint training_daily_readiness_payload_check check (
    jsonb_typeof(payload) = 'object'
    and payload ? 'skipped'
    and jsonb_typeof(payload->'skipped') = 'boolean'
    and (
      (payload->>'skipped')::boolean = true
      or (
        jsonb_typeof(payload->'motivation') = 'number'
        and jsonb_typeof(payload->'hydration') = 'number'
        and jsonb_typeof(payload->'sleep') = 'number'
        and jsonb_typeof(payload->'energy') = 'number'
        and (payload->>'motivation')::integer between 1 and 7
        and (payload->>'hydration')::integer between 1 and 7
        and (payload->>'sleep')::integer between 1 and 7
        and (payload->>'energy')::integer between 1 and 7
        and (payload->>'motivation')::numeric = (payload->>'motivation')::integer
        and (payload->>'hydration')::numeric = (payload->>'hydration')::integer
        and (payload->>'sleep')::numeric = (payload->>'sleep')::integer
        and (payload->>'energy')::numeric = (payload->>'energy')::integer
      )
    )
  )
)$perf06_history_7_0$,
      $perf06_history_7_1$drop trigger if exists training_daily_readiness_set_updated_at on public.training_daily_readiness$perf06_history_7_1$,
      $perf06_history_7_2$create trigger training_daily_readiness_set_updated_at
  before update on public.training_daily_readiness
  for each row execute function public.set_updated_at()$perf06_history_7_2$,
      $perf06_history_7_3$alter table public.training_daily_readiness enable row level security$perf06_history_7_3$,
      $perf06_history_7_4$drop policy if exists "daily readiness own select" on public.training_daily_readiness$perf06_history_7_4$,
      $perf06_history_7_5$create policy "daily readiness own select" on public.training_daily_readiness
  for select
  to authenticated
  using (auth.uid() = user_id)$perf06_history_7_5$,
      $perf06_history_7_6$-- No DELETE policy: users cannot remove daily readiness records through the API.
-- No direct INSERT/UPDATE grants: writes go through save_daily_training_readiness.

revoke all on table public.training_daily_readiness from public$perf06_history_7_6$,
      $perf06_history_7_7$revoke all on table public.training_daily_readiness from anon$perf06_history_7_7$,
      $perf06_history_7_8$revoke all on table public.training_daily_readiness from authenticated$perf06_history_7_8$,
      $perf06_history_7_9$grant select on table public.training_daily_readiness to authenticated$perf06_history_7_9$,
      $perf06_history_7_10$drop function if exists public.save_daily_training_readiness(jsonb, date)$perf06_history_7_10$,
      $perf06_history_7_11$create or replace function public.save_daily_training_readiness(
  p_payload jsonb
)
returns table (
  id uuid,
  local_date date,
  payload jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_local_date date := (now() at time zone 'America/Santiago')::date;
  v_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
  v_updated_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload de readiness invalido';
  end if;

  if not (p_payload ? 'skipped') or jsonb_typeof(p_payload->'skipped') <> 'boolean' then
    raise exception 'Payload de readiness invalido';
  end if;

  if coalesce((p_payload->>'skipped')::boolean, false) = false then
    if jsonb_typeof(p_payload->'motivation') <> 'number'
      or jsonb_typeof(p_payload->'hydration') <> 'number'
      or jsonb_typeof(p_payload->'sleep') <> 'number'
      or jsonb_typeof(p_payload->'energy') <> 'number'
      or (p_payload->>'motivation')::integer not between 1 and 7
      or (p_payload->>'hydration')::integer not between 1 and 7
      or (p_payload->>'sleep')::integer not between 1 and 7
      or (p_payload->>'energy')::integer not between 1 and 7
      or (p_payload->>'motivation')::numeric <> (p_payload->>'motivation')::integer
      or (p_payload->>'hydration')::numeric <> (p_payload->>'hydration')::integer
      or (p_payload->>'sleep')::numeric <> (p_payload->>'sleep')::integer
      or (p_payload->>'energy')::numeric <> (p_payload->>'energy')::integer then
      raise exception 'Payload de readiness invalido';
    end if;
  end if;

  return query
  insert into public.training_daily_readiness as readiness (
    user_id,
    local_date,
    payload
  )
  values (
    v_user_id,
    v_local_date,
    p_payload
  )
  on conflict (user_id, local_date) do nothing
  returning
    readiness.id,
    readiness.local_date,
    readiness.payload,
    readiness.created_at,
    readiness.updated_at;

  if found then
    return;
  end if;

  select
    readiness.id,
    readiness.payload,
    readiness.created_at,
    readiness.updated_at
  into
    v_id,
    v_payload,
    v_created_at,
    v_updated_at
  from public.training_daily_readiness as readiness
  where readiness.user_id = v_user_id
    and readiness.local_date = v_local_date;

  if v_id is null then
    raise exception 'No se pudo confirmar el readiness diario existente';
  end if;

  id := v_id;
  local_date := v_local_date;
  payload := v_payload;
  created_at := v_created_at;
  updated_at := v_updated_at;
  return next;
end;
$$$perf06_history_7_11$,
      $perf06_history_7_12$revoke all on function public.save_daily_training_readiness(jsonb) from public$perf06_history_7_12$,
      $perf06_history_7_13$revoke all on function public.save_daily_training_readiness(jsonb) from anon$perf06_history_7_13$,
      $perf06_history_7_14$grant execute on function public.save_daily_training_readiness(jsonb) to authenticated$perf06_history_7_14$
    ]::text[]),
    ('20260609000001', 'fix_training_daily_readiness_rpc_ambiguity', array[
      $perf06_history_8_0$create or replace function public.save_daily_training_readiness(
  p_payload jsonb
)
returns table (
  id uuid,
  local_date date,
  payload jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_local_date date := (now() at time zone 'America/Santiago')::date;
  v_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
  v_updated_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload de readiness invalido';
  end if;

  if not (p_payload ? 'skipped') or jsonb_typeof(p_payload->'skipped') <> 'boolean' then
    raise exception 'Payload de readiness invalido';
  end if;

  if coalesce((p_payload->>'skipped')::boolean, false) = false then
    if jsonb_typeof(p_payload->'motivation') <> 'number'
      or jsonb_typeof(p_payload->'hydration') <> 'number'
      or jsonb_typeof(p_payload->'sleep') <> 'number'
      or jsonb_typeof(p_payload->'energy') <> 'number'
      or (p_payload->>'motivation')::integer not between 1 and 7
      or (p_payload->>'hydration')::integer not between 1 and 7
      or (p_payload->>'sleep')::integer not between 1 and 7
      or (p_payload->>'energy')::integer not between 1 and 7
      or (p_payload->>'motivation')::numeric <> (p_payload->>'motivation')::integer
      or (p_payload->>'hydration')::numeric <> (p_payload->>'hydration')::integer
      or (p_payload->>'sleep')::numeric <> (p_payload->>'sleep')::integer
      or (p_payload->>'energy')::numeric <> (p_payload->>'energy')::integer then
      raise exception 'Payload de readiness invalido';
    end if;
  end if;

  insert into public.training_daily_readiness as readiness (
    user_id,
    local_date,
    payload
  )
  values (
    v_user_id,
    v_local_date,
    p_payload
  )
  on conflict on constraint training_daily_readiness_user_local_date_key
  do nothing
  returning
    readiness.id,
    readiness.payload,
    readiness.created_at,
    readiness.updated_at
  into
    v_id,
    v_payload,
    v_created_at,
    v_updated_at;

  if v_id is not null then
    id := v_id;
    local_date := v_local_date;
    payload := v_payload;
    created_at := v_created_at;
    updated_at := v_updated_at;
    return next;
    return;
  end if;

  select
    readiness.id,
    readiness.payload,
    readiness.created_at,
    readiness.updated_at
  into
    v_id,
    v_payload,
    v_created_at,
    v_updated_at
  from public.training_daily_readiness as readiness
  where readiness.user_id = v_user_id
    and readiness.local_date = v_local_date;

  if v_id is null then
    raise exception 'No se pudo confirmar el readiness diario existente';
  end if;

  id := v_id;
  local_date := v_local_date;
  payload := v_payload;
  created_at := v_created_at;
  updated_at := v_updated_at;
  return next;
end;
$$$perf06_history_8_0$
    ]::text[]),
    ('20260610000001', 'training_exercise_lineage', array[
      $perf06_history_9_0$-- Fase 2.2CQ: stable cross-cycle exercise lineage.
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
)$perf06_history_9_0$,
      $perf06_history_9_1$create unique index if not exists training_exercise_lineages_user_legacy_unique_idx
  on public.training_exercise_lineages (user_id, source_legacy_exercise_id)
  where source_legacy_exercise_id is not null$perf06_history_9_1$,
      $perf06_history_9_2$create unique index if not exists training_exercise_lineages_user_origin_cycle_exercise_unique_idx
  on public.training_exercise_lineages (user_id, origin_training_cycle_exercise_id)
  where origin_training_cycle_exercise_id is not null$perf06_history_9_2$,
      $perf06_history_9_3$create index if not exists training_exercise_lineages_user_idx
  on public.training_exercise_lineages (user_id)$perf06_history_9_3$,
      $perf06_history_9_4$drop trigger if exists set_training_exercise_lineages_updated_at on public.training_exercise_lineages$perf06_history_9_4$,
      $perf06_history_9_5$create trigger set_training_exercise_lineages_updated_at
  before update on public.training_exercise_lineages
  for each row execute function public.set_updated_at()$perf06_history_9_5$,
      $perf06_history_9_6$alter table public.training_cycle_exercises
  add column if not exists exercise_lineage_id uuid null$perf06_history_9_6$,
      $perf06_history_9_7$alter table public.exercise_entries
  add column if not exists exercise_lineage_id uuid null$perf06_history_9_7$,
      $perf06_history_9_8$insert into public.training_exercise_lineages (
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
do nothing$perf06_history_9_8$,
      $perf06_history_9_9$update public.training_cycle_exercises tce
set exercise_lineage_id = tel.id
from public.training_exercise_lineages tel
where tce.exercise_lineage_id is null
  and tce.source_legacy_exercise_id is not null
  and tel.user_id = tce.user_id
  and tel.source_legacy_exercise_id = tce.source_legacy_exercise_id$perf06_history_9_9$,
      $perf06_history_9_10$insert into public.training_exercise_lineages (
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
do nothing$perf06_history_9_10$,
      $perf06_history_9_11$update public.training_cycle_exercises tce
set exercise_lineage_id = tel.id
from public.training_exercise_lineages tel
where tce.exercise_lineage_id is null
  and tel.user_id = tce.user_id
  and tel.origin_training_cycle_exercise_id = tce.id$perf06_history_9_11$,
      $perf06_history_9_12$update public.exercise_entries ee
set exercise_lineage_id = tce.exercise_lineage_id
from public.training_cycle_exercises tce
where ee.exercise_lineage_id is null
  and ee.training_cycle_exercise_id = tce.id
  and ee.user_id = tce.user_id
  and tce.exercise_lineage_id is not null$perf06_history_9_12$,
      $perf06_history_9_13$update public.exercise_entries ee
set exercise_lineage_id = tel.id
from public.training_exercise_lineages tel
where ee.exercise_lineage_id is null
  and ee.exercise_id is not null
  and tel.user_id = ee.user_id
  and tel.source_legacy_exercise_id = ee.exercise_id$perf06_history_9_13$,
      $perf06_history_9_14$do $$
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
end $$$perf06_history_9_14$,
      $perf06_history_9_15$create index if not exists training_cycle_exercises_user_lineage_idx
  on public.training_cycle_exercises (user_id, exercise_lineage_id)
  where exercise_lineage_id is not null and deleted_at is null$perf06_history_9_15$,
      $perf06_history_9_16$create index if not exists exercise_entries_user_lineage_created_idx
  on public.exercise_entries (user_id, exercise_lineage_id, created_at desc)
  where exercise_lineage_id is not null$perf06_history_9_16$,
      $perf06_history_9_17$alter table public.training_exercise_lineages enable row level security$perf06_history_9_17$,
      $perf06_history_9_18$drop policy if exists "lineages own rows select" on public.training_exercise_lineages$perf06_history_9_18$,
      $perf06_history_9_19$drop policy if exists "lineages own rows insert" on public.training_exercise_lineages$perf06_history_9_19$,
      $perf06_history_9_20$drop policy if exists "lineages own rows update" on public.training_exercise_lineages$perf06_history_9_20$,
      $perf06_history_9_21$create policy "lineages own rows select"
  on public.training_exercise_lineages
  for select
  to authenticated
  using (user_id = auth.uid())$perf06_history_9_21$,
      $perf06_history_9_22$create policy "lineages own rows insert"
  on public.training_exercise_lineages
  for insert
  to authenticated
  with check (user_id = auth.uid())$perf06_history_9_22$,
      $perf06_history_9_23$create policy "lineages own rows update"
  on public.training_exercise_lineages
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid())$perf06_history_9_23$,
      $perf06_history_9_24$revoke all on table public.training_exercise_lineages from anon$perf06_history_9_24$,
      $perf06_history_9_25$revoke all on table public.training_exercise_lineages from authenticated$perf06_history_9_25$,
      $perf06_history_9_26$grant select, insert, update on table public.training_exercise_lineages to authenticated$perf06_history_9_26$,
      $perf06_history_9_27$create or replace function public.create_training_cycle_with_plan(
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
$$$perf06_history_9_27$,
      $perf06_history_9_28$grant execute on function public.create_training_cycle_with_plan(
  text,
  integer,
  text,
  text,
  integer,
  date,
  date,
  jsonb
) to authenticated$perf06_history_9_28$,
      $perf06_history_9_29$create or replace function public.create_training_session_with_cycle_entries(
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
$$$perf06_history_9_29$,
      $perf06_history_9_30$grant execute on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) to authenticated$perf06_history_9_30$,
      $perf06_history_9_31$-- Suggested read-only prechecks before any remote execution:
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
-- then revokes lineage table grants, and only then evaluates whether new lineage-only rows can be removed.$perf06_history_9_31$
    ]::text[]),
    ('20260620000001', 'training_workout_readiness', array[
      $perf06_history_10_0$-- Release B - D2: readiness tied to a concrete workout attempt.
-- Additive only: keeps legacy training_daily_readiness and save_daily_training_readiness(jsonb) intact.
--
-- Manual rollback concept, only with separate authorization:
-- 1. drop function public.link_training_workout_readiness_session_v2(uuid, uuid);
-- 2. drop function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb);
-- 3. drop table public.training_workout_readiness;

create table if not exists public.training_workout_readiness (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_attempt_id uuid not null,
  cycle_id uuid not null,
  cycle_day_id uuid not null,
  workout_started_at timestamptz not null,
  local_date date not null,
  payload jsonb not null,
  training_session_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_workout_readiness_user_attempt_key unique (user_id, workout_attempt_id),
  constraint training_workout_readiness_cycle_user_fk
    foreign key (cycle_id, user_id)
    references public.training_cycles(id, user_id)
    on delete restrict,
  constraint training_workout_readiness_cycle_day_cycle_fk
    foreign key (cycle_day_id, cycle_id)
    references public.training_cycle_days(id, cycle_id)
    on delete restrict,
  constraint training_workout_readiness_session_fk
    foreign key (training_session_id)
    references public.training_sessions(id)
    on delete restrict,
  constraint training_workout_readiness_payload_check check (
    jsonb_typeof(payload) = 'object'
    and payload ? 'skipped'
    and jsonb_typeof(payload->'skipped') = 'boolean'
    and (
      (payload->>'skipped')::boolean = true
      or (
        jsonb_typeof(payload->'motivation') = 'number'
        and jsonb_typeof(payload->'hydration') = 'number'
        and jsonb_typeof(payload->'sleep') = 'number'
        and jsonb_typeof(payload->'energy') = 'number'
        and (payload->>'motivation')::integer between 1 and 7
        and (payload->>'hydration')::integer between 1 and 7
        and (payload->>'sleep')::integer between 1 and 7
        and (payload->>'energy')::integer between 1 and 7
        and (payload->>'motivation')::numeric = (payload->>'motivation')::integer
        and (payload->>'hydration')::numeric = (payload->>'hydration')::integer
        and (payload->>'sleep')::numeric = (payload->>'sleep')::integer
        and (payload->>'energy')::numeric = (payload->>'energy')::integer
      )
    )
  )
)$perf06_history_10_0$,
      $perf06_history_10_1$create unique index if not exists training_workout_readiness_session_key
  on public.training_workout_readiness(training_session_id)
  where training_session_id is not null$perf06_history_10_1$,
      $perf06_history_10_2$create index if not exists training_workout_readiness_user_created_idx
  on public.training_workout_readiness(user_id, created_at desc)$perf06_history_10_2$,
      $perf06_history_10_3$create index if not exists training_workout_readiness_cycle_day_created_idx
  on public.training_workout_readiness(user_id, cycle_id, cycle_day_id, created_at desc)$perf06_history_10_3$,
      $perf06_history_10_4$drop trigger if exists training_workout_readiness_set_updated_at on public.training_workout_readiness$perf06_history_10_4$,
      $perf06_history_10_5$create trigger training_workout_readiness_set_updated_at
  before update on public.training_workout_readiness
  for each row execute function public.set_updated_at()$perf06_history_10_5$,
      $perf06_history_10_6$alter table public.training_workout_readiness enable row level security$perf06_history_10_6$,
      $perf06_history_10_7$drop policy if exists "workout readiness own select" on public.training_workout_readiness$perf06_history_10_7$,
      $perf06_history_10_8$create policy "workout readiness own select" on public.training_workout_readiness
  for select
  to authenticated
  using (auth.uid() = user_id)$perf06_history_10_8$,
      $perf06_history_10_9$revoke all on table public.training_workout_readiness from public$perf06_history_10_9$,
      $perf06_history_10_10$revoke all on table public.training_workout_readiness from anon$perf06_history_10_10$,
      $perf06_history_10_11$revoke all on table public.training_workout_readiness from authenticated$perf06_history_10_11$,
      $perf06_history_10_12$revoke all on table public.training_workout_readiness from service_role$perf06_history_10_12$,
      $perf06_history_10_13$grant select on table public.training_workout_readiness to authenticated$perf06_history_10_13$,
      $perf06_history_10_14$create or replace function public.save_training_workout_readiness_v2(
  p_workout_attempt_id uuid,
  p_cycle_id uuid,
  p_cycle_day_id uuid,
  p_workout_started_at timestamptz,
  p_payload jsonb
)
returns table (
  id uuid,
  user_id uuid,
  workout_attempt_id uuid,
  cycle_id uuid,
  cycle_day_id uuid,
  workout_started_at timestamptz,
  local_date date,
  payload jsonb,
  training_session_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  context_mismatch boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_local_date date;
  v_id uuid;
  v_persisted_user_id uuid;
  v_persisted_workout_attempt_id uuid;
  v_persisted_cycle_id uuid;
  v_persisted_cycle_day_id uuid;
  v_persisted_workout_started_at timestamptz;
  v_persisted_local_date date;
  v_training_session_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
  v_updated_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_workout_attempt_id is null then
    raise exception 'workout_attempt_id requerido';
  end if;

  if p_cycle_id is null then
    raise exception 'cycle_id requerido';
  end if;

  if p_cycle_day_id is null then
    raise exception 'cycle_day_id requerido';
  end if;

  if p_workout_started_at is null then
    raise exception 'workout_started_at requerido';
  end if;

  v_local_date := (p_workout_started_at at time zone 'America/Santiago')::date;

  select
    readiness.id,
    readiness.user_id,
    readiness.workout_attempt_id,
    readiness.cycle_id,
    readiness.cycle_day_id,
    readiness.workout_started_at,
    readiness.local_date,
    readiness.payload,
    readiness.training_session_id,
    readiness.created_at,
    readiness.updated_at,
    (
      readiness.cycle_id is distinct from p_cycle_id
      or readiness.cycle_day_id is distinct from p_cycle_day_id
      or readiness.workout_started_at is distinct from p_workout_started_at
      or readiness.local_date is distinct from v_local_date
      or readiness.payload is distinct from p_payload
    )
  into
    v_id,
    v_persisted_user_id,
    v_persisted_workout_attempt_id,
    v_persisted_cycle_id,
    v_persisted_cycle_day_id,
    v_persisted_workout_started_at,
    v_persisted_local_date,
    v_payload,
    v_training_session_id,
    v_created_at,
    v_updated_at,
    context_mismatch
  from public.training_workout_readiness as readiness
  where readiness.user_id = v_user_id
    and readiness.workout_attempt_id = p_workout_attempt_id;

  if v_id is not null then
    id := v_id;
    user_id := v_persisted_user_id;
    workout_attempt_id := v_persisted_workout_attempt_id;
    cycle_id := v_persisted_cycle_id;
    cycle_day_id := v_persisted_cycle_day_id;
    workout_started_at := v_persisted_workout_started_at;
    local_date := v_persisted_local_date;
    payload := v_payload;
    training_session_id := v_training_session_id;
    created_at := v_created_at;
    updated_at := v_updated_at;
    return next;
    return;
  end if;

  if p_workout_started_at > now() + interval '5 minutes'
    or p_workout_started_at < now() - interval '36 hours' then
    raise exception 'workout_started_at fuera de ventana permitida';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload de readiness invalido';
  end if;

  if not (p_payload ? 'skipped') or jsonb_typeof(p_payload->'skipped') <> 'boolean' then
    raise exception 'Payload de readiness invalido';
  end if;

  if coalesce((p_payload->>'skipped')::boolean, false) = false then
    if jsonb_typeof(p_payload->'motivation') <> 'number'
      or jsonb_typeof(p_payload->'hydration') <> 'number'
      or jsonb_typeof(p_payload->'sleep') <> 'number'
      or jsonb_typeof(p_payload->'energy') <> 'number'
      or (p_payload->>'motivation')::integer not between 1 and 7
      or (p_payload->>'hydration')::integer not between 1 and 7
      or (p_payload->>'sleep')::integer not between 1 and 7
      or (p_payload->>'energy')::integer not between 1 and 7
      or (p_payload->>'motivation')::numeric <> (p_payload->>'motivation')::integer
      or (p_payload->>'hydration')::numeric <> (p_payload->>'hydration')::integer
      or (p_payload->>'sleep')::numeric <> (p_payload->>'sleep')::integer
      or (p_payload->>'energy')::numeric <> (p_payload->>'energy')::integer then
      raise exception 'Payload de readiness invalido';
    end if;
  end if;

  if not exists (
    select 1
    from public.training_cycles as cycle
    where cycle.id = p_cycle_id
      and cycle.user_id = v_user_id
      and cycle.deleted_at is null
  ) then
    raise exception 'El ciclo no pertenece al usuario autenticado';
  end if;

  if not exists (
    select 1
    from public.training_cycle_days as day
    where day.id = p_cycle_day_id
      and day.cycle_id = p_cycle_id
      and day.deleted_at is null
  ) then
    raise exception 'El dia no pertenece al ciclo indicado';
  end if;

  insert into public.training_workout_readiness as readiness (
    user_id,
    workout_attempt_id,
    cycle_id,
    cycle_day_id,
    workout_started_at,
    local_date,
    payload
  )
  values (
    v_user_id,
    p_workout_attempt_id,
    p_cycle_id,
    p_cycle_day_id,
    p_workout_started_at,
    v_local_date,
    p_payload
  )
  on conflict on constraint training_workout_readiness_user_attempt_key
  do nothing
  returning
    readiness.id,
    readiness.user_id,
    readiness.workout_attempt_id,
    readiness.cycle_id,
    readiness.cycle_day_id,
    readiness.workout_started_at,
    readiness.local_date,
    readiness.training_session_id,
    readiness.payload,
    readiness.created_at,
    readiness.updated_at
  into
    v_id,
    v_persisted_user_id,
    v_persisted_workout_attempt_id,
    v_persisted_cycle_id,
    v_persisted_cycle_day_id,
    v_persisted_workout_started_at,
    v_persisted_local_date,
    v_training_session_id,
    v_payload,
    v_created_at,
    v_updated_at;

  if v_id is null then
    select
      readiness.id,
      readiness.user_id,
      readiness.workout_attempt_id,
      readiness.cycle_id,
      readiness.cycle_day_id,
      readiness.workout_started_at,
      readiness.local_date,
      readiness.training_session_id,
      readiness.payload,
      readiness.created_at,
      readiness.updated_at,
      (
        readiness.cycle_id is distinct from p_cycle_id
        or readiness.cycle_day_id is distinct from p_cycle_day_id
        or readiness.workout_started_at is distinct from p_workout_started_at
        or readiness.local_date is distinct from v_local_date
        or readiness.payload is distinct from p_payload
      )
    into
      v_id,
      v_persisted_user_id,
      v_persisted_workout_attempt_id,
      v_persisted_cycle_id,
      v_persisted_cycle_day_id,
      v_persisted_workout_started_at,
      v_persisted_local_date,
      v_training_session_id,
      v_payload,
      v_created_at,
      v_updated_at,
      context_mismatch
    from public.training_workout_readiness as readiness
    where readiness.user_id = v_user_id
      and readiness.workout_attempt_id = p_workout_attempt_id;
  else
    context_mismatch := false;
  end if;

  if v_id is null then
    raise exception 'No se pudo confirmar readiness de entrenamiento';
  end if;

  id := v_id;
  user_id := v_persisted_user_id;
  workout_attempt_id := v_persisted_workout_attempt_id;
  cycle_id := v_persisted_cycle_id;
  cycle_day_id := v_persisted_cycle_day_id;
  workout_started_at := v_persisted_workout_started_at;
  local_date := v_persisted_local_date;
  payload := v_payload;
  training_session_id := v_training_session_id;
  created_at := v_created_at;
  updated_at := v_updated_at;
  return next;
end;
$function$$perf06_history_10_14$,
      $perf06_history_10_15$create or replace function public.link_training_workout_readiness_session_v2(
  p_workout_attempt_id uuid,
  p_training_session_id uuid
)
returns table (
  id uuid,
  workout_attempt_id uuid,
  training_session_id uuid,
  linked boolean,
  already_linked boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_readiness public.training_workout_readiness%rowtype;
  v_session record;
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_workout_attempt_id is null then
    raise exception 'workout_attempt_id requerido';
  end if;

  if p_training_session_id is null then
    raise exception 'training_session_id requerido';
  end if;

  select *
    into v_readiness
  from public.training_workout_readiness as readiness
  where readiness.user_id = v_user_id
    and readiness.workout_attempt_id = p_workout_attempt_id
  for update;

  if v_readiness.id is null then
    raise exception 'Readiness de entrenamiento no encontrado';
  end if;

  if v_readiness.training_session_id = p_training_session_id then
    id := v_readiness.id;
    workout_attempt_id := v_readiness.workout_attempt_id;
    training_session_id := v_readiness.training_session_id;
    linked := true;
    already_linked := true;
    return next;
    return;
  end if;

  if v_readiness.training_session_id is not null then
    raise exception 'Readiness ya enlazado a otra sesion';
  end if;

  select
    session.id,
    session.user_id,
    session.cycle_id,
    session.cycle_day_id,
    session.created_at
  into v_session
  from public.training_sessions as session
  where session.id = p_training_session_id
    and session.deleted_at is null;

  if v_session.id is null then
    raise exception 'Sesion no encontrada';
  end if;

  if v_session.user_id <> v_user_id then
    raise exception 'Sesion ajena al usuario autenticado';
  end if;

  if v_session.cycle_id is distinct from v_readiness.cycle_id then
    raise exception 'Sesion corresponde a otro ciclo';
  end if;

  if v_session.cycle_day_id is distinct from v_readiness.cycle_day_id then
    raise exception 'Sesion corresponde a otro dia del ciclo';
  end if;

  if v_session.created_at < v_readiness.workout_started_at - interval '5 minutes'
    or v_session.created_at > v_readiness.workout_started_at + interval '36 hours' then
    raise exception 'Sesion fuera de ventana temporal del intento';
  end if;

  if exists (
    select 1
    from public.training_workout_readiness as other_readiness
    where other_readiness.training_session_id = p_training_session_id
      and other_readiness.id <> v_readiness.id
  ) then
    raise exception 'Sesion ya enlazada a otro readiness';
  end if;

  update public.training_workout_readiness as readiness
  set training_session_id = p_training_session_id
  where readiness.id = v_readiness.id
  returning readiness.id, readiness.workout_attempt_id, readiness.training_session_id
  into id, workout_attempt_id, training_session_id;

  linked := true;
  already_linked := false;
  return next;
end;
$function$$perf06_history_10_15$,
      $perf06_history_10_16$revoke all on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) from public$perf06_history_10_16$,
      $perf06_history_10_17$revoke all on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) from anon$perf06_history_10_17$,
      $perf06_history_10_18$revoke all on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) from service_role$perf06_history_10_18$,
      $perf06_history_10_19$grant execute on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) to authenticated$perf06_history_10_19$,
      $perf06_history_10_20$revoke all on function public.link_training_workout_readiness_session_v2(uuid, uuid) from public$perf06_history_10_20$,
      $perf06_history_10_21$revoke all on function public.link_training_workout_readiness_session_v2(uuid, uuid) from anon$perf06_history_10_21$,
      $perf06_history_10_22$revoke all on function public.link_training_workout_readiness_session_v2(uuid, uuid) from service_role$perf06_history_10_22$,
      $perf06_history_10_23$grant execute on function public.link_training_workout_readiness_session_v2(uuid, uuid) to authenticated$perf06_history_10_23$
    ]::text[]),
    ('20260706000001', 'profile_avatar_fields', array[
      $perf06_history_11_0$alter table public.profiles
  add column if not exists avatar_path text,
  add column if not exists avatar_updated_at timestamptz$perf06_history_11_0$,
      $perf06_history_11_1$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']$perf06_history_11_1$,
      $perf06_history_11_2$do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile avatars own read'
  ) then
    create policy "profile avatars own read"
      on storage.objects
      for select
      to authenticated
      using (
        bucket_id = 'profile-avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile avatars own insert'
  ) then
    create policy "profile avatars own insert"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'profile-avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile avatars own update'
  ) then
    create policy "profile avatars own update"
      on storage.objects
      for update
      to authenticated
      using (
        bucket_id = 'profile-avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      )
      with check (
        bucket_id = 'profile-avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile avatars own delete'
  ) then
    create policy "profile avatars own delete"
      on storage.objects
      for delete
      to authenticated
      using (
        bucket_id = 'profile-avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;
end $$$perf06_history_11_2$
    ]::text[]),
    ('20260706000002', 'profile_personal_fields', array[
      $perf06_history_12_0$alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists birth_date date,
  add column if not exists gender text default 'not_specified'$perf06_history_12_0$,
      $perf06_history_12_1$do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_gender_allowed'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_gender_allowed
      check (
        gender is null or gender in (
          'male',
          'female',
          'non_binary',
          'prefer_not_to_say',
          'not_specified'
        )
      );
  end if;
end $$$perf06_history_12_1$
    ]::text[]),
    ('20260707000001', 'profile_phone_number', array[
      $perf06_history_13_0$alter table public.profiles
  add column if not exists phone_number text$perf06_history_13_0$
    ]::text[]),
    ('20260709000001', 'p0_d1_harden_training_session_entries_writes', array[
      $perf06_history_14_0$-- P0-D.1: harden training session/entry writes behind RPCs.
-- Local migration candidate only. Do not apply to Production without the QA gate.
--
-- Goal:
-- - Keep the public RPC signatures unchanged.
-- - Preserve existing ownership and business validations.
-- - Let the RPC owner perform the table writes, then remove direct INSERT/UPDATE
--   access for authenticated clients on training_sessions and exercise_entries.
-- - service_role is deliberately revoked because these RPCs are exclusively for
--   the authenticated user flow and have no current server-side dependency.
--
-- Rollback:
-- - A concrete rollback SQL block is included at the end of this file.
-- - Do not execute rollback without separate, explicit authorization.

begin$perf06_history_14_0$,
      $perf06_history_14_1$-- Do not consolidate duplicate data automatically. Abort before adding the
-- concurrency guard so any existing cycle-scoped duplicates can be reviewed.
do $$
begin
  if exists (
    select 1
    from public.training_sessions s
    where s.cycle_day_id is not null
      and s.deleted_at is null
    group by s.user_id, s.cycle_day_id, s.trained_date
    having count(*) > 1
  ) then
    raise exception 'No se puede aplicar P0-D.1: existen sesiones cycle-scoped duplicadas activas para el mismo usuario, dia de ciclo y fecha';
  end if;
end;
$$$perf06_history_14_1$,
      $perf06_history_14_2$-- The legacy routine-based unique index does not cover cycle_day_id rows.
-- This partial unique index is the database-level concurrency guard for the
-- cycle-scoped session contract.
create unique index training_sessions_user_cycle_day_trained_unique_idx
  on public.training_sessions(user_id, cycle_day_id, trained_date)
  where cycle_day_id is not null
    and deleted_at is null$perf06_history_14_2$,
      $perf06_history_14_3$create or replace function public.create_training_session_with_entries(
  p_routine_id uuid,
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
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_calendar_week_start date;
  v_session_id uuid;
  v_entry jsonb;
  v_exercise_id uuid;
  v_reps jsonb;
  v_seen_exercises uuid[] := array[]::uuid[];
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_routine_id is null then
    raise exception 'La rutina es obligatoria';
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

  if not exists (
    select 1
    from public.routines r
    where r.id = p_routine_id
      and r.user_id = v_user_id
      and r.deleted_at is null
  ) then
    raise exception 'La rutina no existe o no pertenece al usuario';
  end if;

  if p_status = 'completed' and jsonb_array_length(v_entries) = 0 then
    raise exception 'Un entrenamiento completado requiere ejercicios';
  end if;

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.routine_id = p_routine_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para esta rutina y fecha';
  end if;

  v_calendar_week_start := p_trained_date - (extract(isodow from p_trained_date)::integer - 1);

  insert into public.training_sessions (
    user_id,
    routine_id,
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
    p_routine_id,
    coalesce(p_week_number, 1),
    p_trained_date,
    v_calendar_week_start,
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
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception 'Cada ejercicio debe ser un objeto JSON';
      end if;

      if nullif(v_entry->>'exercise_id', '') is null then
        raise exception 'Cada ejercicio requiere exercise_id';
      end if;

      begin
        v_exercise_id := (v_entry->>'exercise_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'exercise_id invalido';
      end;

      if v_exercise_id = any(v_seen_exercises) then
        raise exception 'El entrenamiento contiene ejercicios duplicados';
      end if;
      v_seen_exercises := array_append(v_seen_exercises, v_exercise_id);

      v_reps := v_entry->'reps';
      if v_reps is null or jsonb_typeof(v_reps) <> 'array' then
        raise exception 'Cada ejercicio requiere reps como arreglo';
      end if;

      if jsonb_array_length(v_reps) = 0 then
        raise exception 'Cada ejercicio requiere al menos una repeticion';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation then
          raise exception 'reps debe contener enteros validos';
      end;

      if not exists (
        select 1
        from public.exercises e
        where e.id = v_exercise_id
          and e.user_id = v_user_id
          and e.routine_id = p_routine_id
      ) then
        raise exception 'Un ejercicio no pertenece a la rutina del usuario';
      end if;

      insert into public.exercise_entries (
        id,
        user_id,
        session_id,
        exercise_id,
        weight,
        previous_weight,
        reps,
        rir,
        notes
      )
      values (
        coalesce((v_entry->>'id')::uuid, gen_random_uuid()),
        v_user_id,
        v_session_id,
        v_exercise_id,
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
$$$perf06_history_14_3$,
      $perf06_history_14_4$create or replace function public.create_training_session_with_cycle_entries(
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
security definer
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

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.cycle_day_id = p_cycle_day_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para este dia y fecha';
  end if;

  begin
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
  exception
    when unique_violation then
      raise exception 'Ya existe un entrenamiento registrado para este dia y fecha';
  end;

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

      if exists (
        select 1
        from jsonb_array_elements_text(v_reps) as reps(rep_value)
        where rep_value is null
      ) then
        raise exception 'reps debe contener enteros validos';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'reps debe contener enteros validos';
      end;

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
$$$perf06_history_14_4$,
      $perf06_history_14_5$revoke all on function public.create_training_session_with_entries(
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from public$perf06_history_14_5$,
      $perf06_history_14_6$revoke all on function public.create_training_session_with_entries(
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from anon$perf06_history_14_6$,
      $perf06_history_14_7$revoke all on function public.create_training_session_with_entries(
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from service_role$perf06_history_14_7$,
      $perf06_history_14_8$grant execute on function public.create_training_session_with_entries(
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) to authenticated$perf06_history_14_8$,
      $perf06_history_14_9$revoke all on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from public$perf06_history_14_9$,
      $perf06_history_14_10$revoke all on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from anon$perf06_history_14_10$,
      $perf06_history_14_11$revoke all on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) from service_role$perf06_history_14_11$,
      $perf06_history_14_12$grant execute on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) to authenticated$perf06_history_14_12$,
      $perf06_history_14_13$revoke insert, update on table public.training_sessions from authenticated$perf06_history_14_13$,
      $perf06_history_14_14$revoke insert, update on table public.exercise_entries from authenticated$perf06_history_14_14$,
      $perf06_history_14_15$revoke delete on table public.training_sessions from authenticated$perf06_history_14_15$,
      $perf06_history_14_16$revoke delete on table public.exercise_entries from authenticated$perf06_history_14_16$,
      $perf06_history_14_17$commit$perf06_history_14_17$,
      $perf06_history_14_18$/*
Rollback P0-D.1 - SQL concreto aplicable solo con autorizacion explicita.

Objetivo del rollback:
- Volver al modelo anterior donde las RPCs son SECURITY INVOKER.
- Restaurar SELECT, INSERT, UPDATE directos para authenticated sobre training_sessions y exercise_entries.
- Mantener DELETE sin conceder a authenticated.
- Restaurar EXECUTE para authenticated, que es el caller real de la app.

begin;

drop index if exists public.training_sessions_user_cycle_day_trained_unique_idx;

create or replace function public.create_training_session_with_entries(
  p_routine_id uuid,
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
as $rollback$
declare
  v_user_id uuid := auth.uid();
  v_calendar_week_start date;
  v_session_id uuid;
  v_entry jsonb;
  v_exercise_id uuid;
  v_reps jsonb;
  v_seen_exercises uuid[] := array[]::uuid[];
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_routine_id is null then
    raise exception 'La rutina es obligatoria';
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

  if not exists (
    select 1
    from public.routines r
    where r.id = p_routine_id
      and r.user_id = v_user_id
      and r.deleted_at is null
  ) then
    raise exception 'La rutina no existe o no pertenece al usuario';
  end if;

  if p_status = 'completed' and jsonb_array_length(v_entries) = 0 then
    raise exception 'Un entrenamiento completado requiere ejercicios';
  end if;

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.routine_id = p_routine_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para esta rutina y fecha';
  end if;

  v_calendar_week_start := p_trained_date - (extract(isodow from p_trained_date)::integer - 1);

  insert into public.training_sessions (
    user_id,
    routine_id,
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
    p_routine_id,
    coalesce(p_week_number, 1),
    p_trained_date,
    v_calendar_week_start,
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
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception 'Cada ejercicio debe ser un objeto JSON';
      end if;

      if nullif(v_entry->>'exercise_id', '') is null then
        raise exception 'Cada ejercicio requiere exercise_id';
      end if;

      begin
        v_exercise_id := (v_entry->>'exercise_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'exercise_id invalido';
      end;

      if v_exercise_id = any(v_seen_exercises) then
        raise exception 'El entrenamiento contiene ejercicios duplicados';
      end if;
      v_seen_exercises := array_append(v_seen_exercises, v_exercise_id);

      v_reps := v_entry->'reps';
      if v_reps is null or jsonb_typeof(v_reps) <> 'array' then
        raise exception 'Cada ejercicio requiere reps como arreglo';
      end if;

      if jsonb_array_length(v_reps) = 0 then
        raise exception 'Cada ejercicio requiere al menos una repeticion';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation then
          raise exception 'reps debe contener enteros validos';
      end;

      if not exists (
        select 1
        from public.exercises e
        where e.id = v_exercise_id
          and e.user_id = v_user_id
          and e.routine_id = p_routine_id
      ) then
        raise exception 'Un ejercicio no pertenece a la rutina del usuario';
      end if;

      insert into public.exercise_entries (
        id,
        user_id,
        session_id,
        exercise_id,
        weight,
        previous_weight,
        reps,
        rir,
        notes
      )
      values (
        coalesce((v_entry->>'id')::uuid, gen_random_uuid()),
        v_user_id,
        v_session_id,
        v_exercise_id,
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
$rollback$;

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
as $rollback$
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
$rollback$;

grant select, insert, update on table public.training_sessions to authenticated;
grant select, insert, update on table public.exercise_entries to authenticated;
revoke delete on table public.training_sessions from authenticated;
revoke delete on table public.exercise_entries from authenticated;

grant execute on function public.create_training_session_with_entries(
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
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

commit;
*/$perf06_history_14_18$
    ]::text[]),
    ('20260713000001', 'p0_h_profile_avatar_hardening', array[
      $perf06_history_15_0$-- P0-H: harden the private profile avatar contract.
--
-- Preconditions are intentionally strict. Apply to QA first and stop if any
-- drift is detected; this migration does not rewrite profile rows or objects.

begin$perf06_history_15_0$,
      $perf06_history_15_1$do $$
declare
  v_bucket storage.buckets%rowtype;
  v_count bigint;
begin
  select *
  into v_bucket
  from storage.buckets
  where id = 'profile-avatars';

  if not found then
    raise exception 'P0-H: bucket profile-avatars does not exist';
  end if;

  if v_bucket.public then
    raise exception 'P0-H: bucket profile-avatars must remain private';
  end if;

  if v_bucket.file_size_limit is distinct from 2097152 then
    raise exception 'P0-H: unexpected profile-avatars file_size_limit: %', v_bucket.file_size_limit;
  end if;

  if v_bucket.allowed_mime_types is null
    or cardinality(v_bucket.allowed_mime_types) <> 3
    or not v_bucket.allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']::text[]
    or not array['image/jpeg', 'image/png', 'image/webp']::text[] @> v_bucket.allowed_mime_types
  then
    raise exception 'P0-H: unexpected profile-avatars allowed_mime_types';
  end if;

  select count(*)
  into v_count
  from public.profiles p
  where p.avatar_path is not null
    and p.avatar_path <> p.id::text || '/avatar';

  if v_count <> 0 then
    raise exception 'P0-H: found % noncanonical profiles.avatar_path values', v_count;
  end if;

  select count(*)
  into v_count
  from storage.objects o
  where o.bucket_id = 'profile-avatars'
    and o.name !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/avatar$';

  if v_count <> 0 then
    raise exception 'P0-H: found % noncanonical profile avatar objects', v_count;
  end if;

  select count(*)
  into v_count
  from storage.objects o
  left join public.profiles p
    on o.name = p.id::text || '/avatar'
  where o.bucket_id = 'profile-avatars'
    and p.id is null;

  if v_count <> 0 then
    raise exception 'P0-H: found % orphan profile avatar objects', v_count;
  end if;

  select count(*)
  into v_count
  from public.profiles p
  left join storage.objects o
    on o.bucket_id = 'profile-avatars'
   and o.name = p.avatar_path
  where p.avatar_path is not null
    and o.id is null;

  if v_count <> 0 then
    raise exception 'P0-H: found % broken profile avatar references', v_count;
  end if;
end;
$$$perf06_history_15_1$,
      $perf06_history_15_2$do $$
declare
  v_constraint_expression text;
  v_normalized_expression text;
begin
  select pg_get_expr(c.conbin, c.conrelid, true)
  into v_constraint_expression
  from pg_constraint c
  where c.conrelid = 'public.profiles'::regclass
    and c.conname = 'profiles_avatar_path_canonical_check'
    and c.contype = 'c';

  if v_constraint_expression is null then
    if exists (
      select 1
      from pg_constraint c
      where c.conrelid = 'public.profiles'::regclass
        and c.conname = 'profiles_avatar_path_canonical_check'
    ) then
      raise exception 'P0-H: profiles_avatar_path_canonical_check exists but is not a CHECK constraint';
    end if;

    alter table public.profiles
      add constraint profiles_avatar_path_canonical_check
      check (
        avatar_path is null
        or avatar_path = id::text || '/avatar'
      ) not valid;
  else
    v_normalized_expression := replace(
      lower(regexp_replace(v_constraint_expression, '[[:space:]()]', '', 'g')),
      '::text',
      ''
    );

    if v_normalized_expression <> 'avatar_pathisnulloravatar_path=id||''/avatar''' then
      raise exception 'P0-H: profiles_avatar_path_canonical_check has an unexpected definition: %', v_constraint_expression;
    end if;
  end if;
end;
$$$perf06_history_15_2$,
      $perf06_history_15_3$alter table public.profiles
  validate constraint profiles_avatar_path_canonical_check$perf06_history_15_3$,
      $perf06_history_15_4$drop policy if exists "profile avatars own read" on storage.objects$perf06_history_15_4$,
      $perf06_history_15_5$drop policy if exists "profile avatars own insert" on storage.objects$perf06_history_15_5$,
      $perf06_history_15_6$drop policy if exists "profile avatars own update" on storage.objects$perf06_history_15_6$,
      $perf06_history_15_7$drop policy if exists "profile avatars own delete" on storage.objects$perf06_history_15_7$,
      $perf06_history_15_8$create policy "profile avatars own read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar'
  )$perf06_history_15_8$,
      $perf06_history_15_9$create policy "profile avatars own insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar'
  )$perf06_history_15_9$,
      $perf06_history_15_10$create policy "profile avatars own update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar'
  )
  with check (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar'
  )$perf06_history_15_10$,
      $perf06_history_15_11$create policy "profile avatars own delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar'
  )$perf06_history_15_11$,
      $perf06_history_15_12$do $$
declare
  v_count bigint;
  v_exact_policy_count integer;
  v_expected_expression constant text := 'bucket_id=''profile-avatars''andname=auth.uid||''/avatar''';
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.conname = 'profiles_avatar_path_canonical_check'
      and c.contype = 'c'
      and c.convalidated
  ) then
    raise exception 'P0-H: canonical avatar_path constraint is missing or not validated';
  end if;

  select count(*)
  into v_exact_policy_count
  from pg_policies p
  where p.schemaname = 'storage'
    and p.tablename = 'objects'
    and p.roles = array['authenticated']::name[]
    and (
      (
        p.policyname = 'profile avatars own read'
        and p.cmd = 'SELECT'
        and replace(lower(regexp_replace(coalesce(p.qual, ''), '[[:space:]()]', '', 'g')), '::text', '') = v_expected_expression
        and p.with_check is null
      )
      or (
        p.policyname = 'profile avatars own insert'
        and p.cmd = 'INSERT'
        and p.qual is null
        and replace(lower(regexp_replace(coalesce(p.with_check, ''), '[[:space:]()]', '', 'g')), '::text', '') = v_expected_expression
      )
      or (
        p.policyname = 'profile avatars own update'
        and p.cmd = 'UPDATE'
        and replace(lower(regexp_replace(coalesce(p.qual, ''), '[[:space:]()]', '', 'g')), '::text', '') = v_expected_expression
        and replace(lower(regexp_replace(coalesce(p.with_check, ''), '[[:space:]()]', '', 'g')), '::text', '') = v_expected_expression
      )
      or (
        p.policyname = 'profile avatars own delete'
        and p.cmd = 'DELETE'
        and replace(lower(regexp_replace(coalesce(p.qual, ''), '[[:space:]()]', '', 'g')), '::text', '') = v_expected_expression
        and p.with_check is null
      )
    );

  if v_exact_policy_count <> 4 then
    raise exception 'P0-H: expected 4 exact canonical avatar policies, found %', v_exact_policy_count;
  end if;

  select count(*)
  into v_count
  from public.profiles p
  where p.avatar_path is not null
    and p.avatar_path <> p.id::text || '/avatar';
  if v_count <> 0 then
    raise exception 'P0-H postcheck: found % noncanonical profiles.avatar_path values', v_count;
  end if;

  select count(*)
  into v_count
  from storage.objects o
  where o.bucket_id = 'profile-avatars'
    and o.name !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/avatar$';
  if v_count <> 0 then
    raise exception 'P0-H postcheck: found % noncanonical profile avatar objects', v_count;
  end if;

  select count(*)
  into v_count
  from storage.objects o
  left join public.profiles p
    on o.name = p.id::text || '/avatar'
  where o.bucket_id = 'profile-avatars'
    and p.id is null;
  if v_count <> 0 then
    raise exception 'P0-H postcheck: found % orphan profile avatar objects', v_count;
  end if;

  select count(*)
  into v_count
  from public.profiles p
  left join storage.objects o
    on o.bucket_id = 'profile-avatars'
   and o.name = p.avatar_path
  where p.avatar_path is not null
    and o.id is null;
  if v_count <> 0 then
    raise exception 'P0-H postcheck: found % broken profile avatar references', v_count;
  end if;
end;
$$$perf06_history_15_12$,
      $perf06_history_15_13$commit$perf06_history_15_13$,
      $perf06_history_15_14$/*
Rollback P0-H - execute only with separate, explicit authorization.

begin;

alter table public.profiles
  drop constraint if exists profiles_avatar_path_canonical_check;

drop policy if exists "profile avatars own read" on storage.objects;
drop policy if exists "profile avatars own insert" on storage.objects;
drop policy if exists "profile avatars own update" on storage.objects;
drop policy if exists "profile avatars own delete" on storage.objects;

create policy "profile avatars own read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "profile avatars own insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "profile avatars own update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'profile-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "profile avatars own delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

commit;
*/$perf06_history_15_14$
    ]::text[]),
    ('20260718000001', 'exercise_entries_observation', array[
      $perf06_history_16_0$-- OBS-1: add a single free-text observation per exercise entry.
-- Local migration candidate only. Do not apply to Production without the QA gate.
--
-- Goal:
-- - exercise_entries already holds exactly one row per exercise executed in a
--   session (one weight, one reps[] array, one notes value per row). This
--   migration adds a sibling nullable column, `observation`, so the same row
--   can carry exactly one free-text observation for that exercise/session.
-- - Keep both RPC signatures unchanged (still jsonb `p_entries`).
-- - `observation` travels as an optional property inside each entry object,
--   normalized the same way `notes` already is: nullif(btrim(...), '').
-- - Do not touch `notes`, RLS, indexes, or grants: the existing
--   "entries own rows" row-level policy already covers the new column
--   because RLS is per-row, not per-column, and the function signatures
--   (therefore their existing grants) are unchanged.
--
-- Rollback:
-- - A concrete rollback SQL block is included at the end of this file.
-- - Do not execute rollback without separate, explicit authorization.

begin$perf06_history_16_0$,
      $perf06_history_16_1$alter table public.exercise_entries
  add column if not exists observation text null$perf06_history_16_1$,
      $perf06_history_16_2$create or replace function public.create_training_session_with_entries(
  p_routine_id uuid,
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
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_calendar_week_start date;
  v_session_id uuid;
  v_entry jsonb;
  v_exercise_id uuid;
  v_reps jsonb;
  v_seen_exercises uuid[] := array[]::uuid[];
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_routine_id is null then
    raise exception 'La rutina es obligatoria';
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

  if not exists (
    select 1
    from public.routines r
    where r.id = p_routine_id
      and r.user_id = v_user_id
      and r.deleted_at is null
  ) then
    raise exception 'La rutina no existe o no pertenece al usuario';
  end if;

  if p_status = 'completed' and jsonb_array_length(v_entries) = 0 then
    raise exception 'Un entrenamiento completado requiere ejercicios';
  end if;

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.routine_id = p_routine_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para esta rutina y fecha';
  end if;

  v_calendar_week_start := p_trained_date - (extract(isodow from p_trained_date)::integer - 1);

  insert into public.training_sessions (
    user_id,
    routine_id,
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
    p_routine_id,
    coalesce(p_week_number, 1),
    p_trained_date,
    v_calendar_week_start,
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
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception 'Cada ejercicio debe ser un objeto JSON';
      end if;

      if nullif(v_entry->>'exercise_id', '') is null then
        raise exception 'Cada ejercicio requiere exercise_id';
      end if;

      begin
        v_exercise_id := (v_entry->>'exercise_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'exercise_id invalido';
      end;

      if v_exercise_id = any(v_seen_exercises) then
        raise exception 'El entrenamiento contiene ejercicios duplicados';
      end if;
      v_seen_exercises := array_append(v_seen_exercises, v_exercise_id);

      v_reps := v_entry->'reps';
      if v_reps is null or jsonb_typeof(v_reps) <> 'array' then
        raise exception 'Cada ejercicio requiere reps como arreglo';
      end if;

      if jsonb_array_length(v_reps) = 0 then
        raise exception 'Cada ejercicio requiere al menos una repeticion';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation then
          raise exception 'reps debe contener enteros validos';
      end;

      if not exists (
        select 1
        from public.exercises e
        where e.id = v_exercise_id
          and e.user_id = v_user_id
          and e.routine_id = p_routine_id
      ) then
        raise exception 'Un ejercicio no pertenece a la rutina del usuario';
      end if;

      insert into public.exercise_entries (
        id,
        user_id,
        session_id,
        exercise_id,
        weight,
        previous_weight,
        reps,
        rir,
        notes,
        observation
      )
      values (
        coalesce((v_entry->>'id')::uuid, gen_random_uuid()),
        v_user_id,
        v_session_id,
        v_exercise_id,
        coalesce((v_entry->>'weight')::numeric, 0),
        coalesce((v_entry->>'previous_weight')::numeric, 0),
        array(select rep_value::integer from jsonb_array_elements_text(v_reps) as reps(rep_value)),
        nullif(v_entry->>'rir', ''),
        nullif(v_entry->>'notes', ''),
        nullif(btrim(v_entry->>'observation'), '')
      );
    end loop;
  end if;

  return v_session_id;
end;
$$$perf06_history_16_2$,
      $perf06_history_16_3$create or replace function public.create_training_session_with_cycle_entries(
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
security definer
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

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.cycle_day_id = p_cycle_day_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para este dia y fecha';
  end if;

  begin
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
  exception
    when unique_violation then
      raise exception 'Ya existe un entrenamiento registrado para este dia y fecha';
  end;

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

      if exists (
        select 1
        from jsonb_array_elements_text(v_reps) as reps(rep_value)
        where rep_value is null
      ) then
        raise exception 'reps debe contener enteros validos';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'reps debe contener enteros validos';
      end;

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
        notes,
        observation
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
        nullif(v_entry->>'notes', ''),
        nullif(btrim(v_entry->>'observation'), '')
      );
    end loop;
  end if;

  return v_session_id;
end;
$$$perf06_history_16_3$,
      $perf06_history_16_4$commit$perf06_history_16_4$,
      $perf06_history_16_5$/*
Rollback OBS-1 - SQL concreto aplicable solo con autorizacion explicita.

Objetivo del rollback:
- Restaurar ambas RPCs a la version vigente antes de OBS-1 (sin observation),
  identica a la definida en 20260709_p0_d1_harden_training_session_entries_writes.sql.
- Eliminar unicamente la columna exercise_entries.observation.
- No tocar notes, RLS, indices ni grants: no fueron modificados por esta migracion.

begin;

create or replace function public.create_training_session_with_entries(
  p_routine_id uuid,
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
security definer
set search_path = public, pg_temp
as $rollback$
declare
  v_user_id uuid := auth.uid();
  v_calendar_week_start date;
  v_session_id uuid;
  v_entry jsonb;
  v_exercise_id uuid;
  v_reps jsonb;
  v_seen_exercises uuid[] := array[]::uuid[];
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_routine_id is null then
    raise exception 'La rutina es obligatoria';
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

  if not exists (
    select 1
    from public.routines r
    where r.id = p_routine_id
      and r.user_id = v_user_id
      and r.deleted_at is null
  ) then
    raise exception 'La rutina no existe o no pertenece al usuario';
  end if;

  if p_status = 'completed' and jsonb_array_length(v_entries) = 0 then
    raise exception 'Un entrenamiento completado requiere ejercicios';
  end if;

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.routine_id = p_routine_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para esta rutina y fecha';
  end if;

  v_calendar_week_start := p_trained_date - (extract(isodow from p_trained_date)::integer - 1);

  insert into public.training_sessions (
    user_id,
    routine_id,
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
    p_routine_id,
    coalesce(p_week_number, 1),
    p_trained_date,
    v_calendar_week_start,
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
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception 'Cada ejercicio debe ser un objeto JSON';
      end if;

      if nullif(v_entry->>'exercise_id', '') is null then
        raise exception 'Cada ejercicio requiere exercise_id';
      end if;

      begin
        v_exercise_id := (v_entry->>'exercise_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'exercise_id invalido';
      end;

      if v_exercise_id = any(v_seen_exercises) then
        raise exception 'El entrenamiento contiene ejercicios duplicados';
      end if;
      v_seen_exercises := array_append(v_seen_exercises, v_exercise_id);

      v_reps := v_entry->'reps';
      if v_reps is null or jsonb_typeof(v_reps) <> 'array' then
        raise exception 'Cada ejercicio requiere reps como arreglo';
      end if;

      if jsonb_array_length(v_reps) = 0 then
        raise exception 'Cada ejercicio requiere al menos una repeticion';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation then
          raise exception 'reps debe contener enteros validos';
      end;

      if not exists (
        select 1
        from public.exercises e
        where e.id = v_exercise_id
          and e.user_id = v_user_id
          and e.routine_id = p_routine_id
      ) then
        raise exception 'Un ejercicio no pertenece a la rutina del usuario';
      end if;

      insert into public.exercise_entries (
        id,
        user_id,
        session_id,
        exercise_id,
        weight,
        previous_weight,
        reps,
        rir,
        notes
      )
      values (
        coalesce((v_entry->>'id')::uuid, gen_random_uuid()),
        v_user_id,
        v_session_id,
        v_exercise_id,
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
$rollback$;

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
security definer
set search_path = public, pg_temp
as $rollback$
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

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.cycle_day_id = p_cycle_day_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para este dia y fecha';
  end if;

  begin
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
  exception
    when unique_violation then
      raise exception 'Ya existe un entrenamiento registrado para este dia y fecha';
  end;

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
$rollback$;

alter table public.exercise_entries
  drop column if exists observation;

commit;
*/$perf06_history_16_5$
    ]::text[]),
    ('20260718000002', 'exercise_entries_observation_legacy_lineage', array[
      $perf06_history_17_0$-- OBS-2A.1: resolve exercise_lineage_id server-side for legacy session entries.
-- Local migration candidate only. Do not apply to Production without the QA gate.
--
-- Goal:
-- - create_training_session_with_cycle_entries already resolves and stores
--   exercise_lineage_id for every entry it inserts. create_training_session_with_entries
--   (the legacy, routine-scoped RPC) still inserts exercise_id but leaves
--   exercise_lineage_id null, which breaks the "last observation"/"last
--   performance" lookups for legacy entries (both are keyed exclusively by
--   exercise_lineage_id, with no fallback by name or exercise_id).
-- - This migration replaces ONLY public.create_training_session_with_entries
--   so it resolves exercise_lineage_id server-side, from
--   training_exercise_lineages, using the already-validated v_exercise_id.
--   The lineage is never trusted from the client: no exercise_lineage_id
--   field is read from p_entries in this RPC.
-- - If a legacy exercise has no matching row in training_exercise_lineages,
--   the RPC aborts with a stable, explicit error instead of inserting a
--   historical entry without lineage.
-- - Keep the RPC signature unchanged (still jsonb `p_entries`).
-- - Do not touch public.create_training_session_with_cycle_entries: it is not
--   redefined by this migration.
-- - Do not touch `notes`, `observation`, RLS, indexes, or grants: the
--   function signature (therefore its existing grants) is unchanged, and the
--   existing "entries own rows" row-level policy already covers
--   exercise_lineage_id because RLS is per-row, not per-column.
--
-- Rollback:
-- - A concrete rollback SQL block is included at the end of this file.
-- - Do not execute rollback without separate, explicit authorization.

begin$perf06_history_17_0$,
      $perf06_history_17_1$create or replace function public.create_training_session_with_entries(
  p_routine_id uuid,
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
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_calendar_week_start date;
  v_session_id uuid;
  v_entry jsonb;
  v_exercise_id uuid;
  v_exercise_lineage_id uuid;
  v_reps jsonb;
  v_seen_exercises uuid[] := array[]::uuid[];
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_routine_id is null then
    raise exception 'La rutina es obligatoria';
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

  if not exists (
    select 1
    from public.routines r
    where r.id = p_routine_id
      and r.user_id = v_user_id
      and r.deleted_at is null
  ) then
    raise exception 'La rutina no existe o no pertenece al usuario';
  end if;

  if p_status = 'completed' and jsonb_array_length(v_entries) = 0 then
    raise exception 'Un entrenamiento completado requiere ejercicios';
  end if;

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.routine_id = p_routine_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para esta rutina y fecha';
  end if;

  v_calendar_week_start := p_trained_date - (extract(isodow from p_trained_date)::integer - 1);

  insert into public.training_sessions (
    user_id,
    routine_id,
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
    p_routine_id,
    coalesce(p_week_number, 1),
    p_trained_date,
    v_calendar_week_start,
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
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception 'Cada ejercicio debe ser un objeto JSON';
      end if;

      if nullif(v_entry->>'exercise_id', '') is null then
        raise exception 'Cada ejercicio requiere exercise_id';
      end if;

      begin
        v_exercise_id := (v_entry->>'exercise_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'exercise_id invalido';
      end;

      if v_exercise_id = any(v_seen_exercises) then
        raise exception 'El entrenamiento contiene ejercicios duplicados';
      end if;
      v_seen_exercises := array_append(v_seen_exercises, v_exercise_id);

      v_reps := v_entry->'reps';
      if v_reps is null or jsonb_typeof(v_reps) <> 'array' then
        raise exception 'Cada ejercicio requiere reps como arreglo';
      end if;

      if jsonb_array_length(v_reps) = 0 then
        raise exception 'Cada ejercicio requiere al menos una repeticion';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation then
          raise exception 'reps debe contener enteros validos';
      end;

      if not exists (
        select 1
        from public.exercises e
        where e.id = v_exercise_id
          and e.user_id = v_user_id
          and e.routine_id = p_routine_id
      ) then
        raise exception 'Un ejercicio no pertenece a la rutina del usuario';
      end if;

      select tel.id
      into v_exercise_lineage_id
      from public.training_exercise_lineages tel
      where tel.user_id = v_user_id
        and tel.source_legacy_exercise_id = v_exercise_id;

      if v_exercise_lineage_id is null then
        raise exception 'El ejercicio legacy no tiene identidad historica (exercise_lineage_id) registrada';
      end if;

      insert into public.exercise_entries (
        id,
        user_id,
        session_id,
        exercise_id,
        exercise_lineage_id,
        weight,
        previous_weight,
        reps,
        rir,
        notes,
        observation
      )
      values (
        coalesce((v_entry->>'id')::uuid, gen_random_uuid()),
        v_user_id,
        v_session_id,
        v_exercise_id,
        v_exercise_lineage_id,
        coalesce((v_entry->>'weight')::numeric, 0),
        coalesce((v_entry->>'previous_weight')::numeric, 0),
        array(select rep_value::integer from jsonb_array_elements_text(v_reps) as reps(rep_value)),
        nullif(v_entry->>'rir', ''),
        nullif(v_entry->>'notes', ''),
        nullif(btrim(v_entry->>'observation'), '')
      );
    end loop;
  end if;

  return v_session_id;
end;
$$$perf06_history_17_1$,
      $perf06_history_17_2$commit$perf06_history_17_2$,
      $perf06_history_17_3$/*
Rollback OBS-2A.1 - SQL concreto aplicable solo con autorizacion explicita.

Objetivo del rollback:
- Restaurar public.create_training_session_with_entries a la version vigente
  de OBS-1 (definida en 20260718_exercise_entries_observation.sql): sigue
  guardando observation, pero deja de resolver e insertar
  exercise_lineage_id en la ruta legacy.
- No eliminar la columna exercise_entries.observation.
- No modificar public.create_training_session_with_cycle_entries: no fue
  tocada por esta migracion y el rollback tampoco la toca.
- No tocar tablas, training_exercise_lineages, RLS, indices ni grants.

begin;

create or replace function public.create_training_session_with_entries(
  p_routine_id uuid,
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
security definer
set search_path = public, pg_temp
as $rollback$
declare
  v_user_id uuid := auth.uid();
  v_calendar_week_start date;
  v_session_id uuid;
  v_entry jsonb;
  v_exercise_id uuid;
  v_reps jsonb;
  v_seen_exercises uuid[] := array[]::uuid[];
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_routine_id is null then
    raise exception 'La rutina es obligatoria';
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

  if not exists (
    select 1
    from public.routines r
    where r.id = p_routine_id
      and r.user_id = v_user_id
      and r.deleted_at is null
  ) then
    raise exception 'La rutina no existe o no pertenece al usuario';
  end if;

  if p_status = 'completed' and jsonb_array_length(v_entries) = 0 then
    raise exception 'Un entrenamiento completado requiere ejercicios';
  end if;

  if exists (
    select 1
    from public.training_sessions s
    where s.user_id = v_user_id
      and s.routine_id = p_routine_id
      and s.trained_date = p_trained_date
      and s.deleted_at is null
  ) then
    raise exception 'Ya existe un entrenamiento registrado para esta rutina y fecha';
  end if;

  v_calendar_week_start := p_trained_date - (extract(isodow from p_trained_date)::integer - 1);

  insert into public.training_sessions (
    user_id,
    routine_id,
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
    p_routine_id,
    coalesce(p_week_number, 1),
    p_trained_date,
    v_calendar_week_start,
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
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception 'Cada ejercicio debe ser un objeto JSON';
      end if;

      if nullif(v_entry->>'exercise_id', '') is null then
        raise exception 'Cada ejercicio requiere exercise_id';
      end if;

      begin
        v_exercise_id := (v_entry->>'exercise_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'exercise_id invalido';
      end;

      if v_exercise_id = any(v_seen_exercises) then
        raise exception 'El entrenamiento contiene ejercicios duplicados';
      end if;
      v_seen_exercises := array_append(v_seen_exercises, v_exercise_id);

      v_reps := v_entry->'reps';
      if v_reps is null or jsonb_typeof(v_reps) <> 'array' then
        raise exception 'Cada ejercicio requiere reps como arreglo';
      end if;

      if jsonb_array_length(v_reps) = 0 then
        raise exception 'Cada ejercicio requiere al menos una repeticion';
      end if;

      begin
        perform rep_value::integer
        from jsonb_array_elements_text(v_reps) as reps(rep_value);
      exception
        when invalid_text_representation then
          raise exception 'reps debe contener enteros validos';
      end;

      if not exists (
        select 1
        from public.exercises e
        where e.id = v_exercise_id
          and e.user_id = v_user_id
          and e.routine_id = p_routine_id
      ) then
        raise exception 'Un ejercicio no pertenece a la rutina del usuario';
      end if;

      insert into public.exercise_entries (
        id,
        user_id,
        session_id,
        exercise_id,
        weight,
        previous_weight,
        reps,
        rir,
        notes,
        observation
      )
      values (
        coalesce((v_entry->>'id')::uuid, gen_random_uuid()),
        v_user_id,
        v_session_id,
        v_exercise_id,
        coalesce((v_entry->>'weight')::numeric, 0),
        coalesce((v_entry->>'previous_weight')::numeric, 0),
        array(select rep_value::integer from jsonb_array_elements_text(v_reps) as reps(rep_value)),
        nullif(v_entry->>'rir', ''),
        nullif(v_entry->>'notes', ''),
        nullif(btrim(v_entry->>'observation'), '')
      );
    end loop;
  end if;

  return v_session_id;
end;
$rollback$;

commit;
*/$perf06_history_17_3$
    ]::text[]),
    ('20260810225819', 'perf_06a_security_hardening', array[
      $perf06_history_18_0$-- PERF-06A: least-privilege hardening for the legacy client-facing tables.
--
-- Static frontend write audit (2026-08-10):
-- - profiles: fallback INSERT; UPDATE email, personal fields and avatar metadata.
-- - routines: INSERT user_id/name only.
-- - exercises: INSERT/UPSERT the explicit exercise payload, UPDATE notes and DELETE.
--   Identity columns (id, user_id) are guarded by trigger, not by column ACL.
--
-- RLS policies are intentionally left unchanged. Table privileges are reset before
-- granting only the operations and columns used by those flows.

revoke all privileges on table public.profiles from anon$perf06_history_18_0$,
      $perf06_history_18_1$revoke all privileges on table public.routines from anon$perf06_history_18_1$,
      $perf06_history_18_2$revoke all privileges on table public.exercises from anon$perf06_history_18_2$,
      $perf06_history_18_3$revoke all privileges on table public.profiles from authenticated$perf06_history_18_3$,
      $perf06_history_18_4$revoke all privileges on table public.routines from authenticated$perf06_history_18_4$,
      $perf06_history_18_5$revoke all privileges on table public.exercises from authenticated$perf06_history_18_5$,
      $perf06_history_18_6$grant select on table public.profiles to authenticated$perf06_history_18_6$,
      $perf06_history_18_7$grant insert (id, display_name, email, gender)
  on table public.profiles to authenticated$perf06_history_18_7$,
      $perf06_history_18_8$grant update (
  display_name,
  email,
  first_name,
  last_name,
  birth_date,
  gender,
  phone_number,
  avatar_path,
  avatar_updated_at
) on table public.profiles to authenticated$perf06_history_18_8$,
      $perf06_history_18_9$grant select on table public.routines to authenticated$perf06_history_18_9$,
      $perf06_history_18_10$grant insert (user_id, name)
  on table public.routines to authenticated$perf06_history_18_10$,
      $perf06_history_18_11$grant select on table public.exercises to authenticated$perf06_history_18_11$,
      $perf06_history_18_12$grant insert (
  id,
  user_id,
  routine_id,
  name,
  target_sets,
  target_reps,
  base_weight,
  side_weight,
  day,
  notes
) on table public.exercises to authenticated$perf06_history_18_12$,
      $perf06_history_18_13$grant update (
  id,
  user_id,
  routine_id,
  name,
  target_sets,
  target_reps,
  base_weight,
  side_weight,
  day,
  notes
) on table public.exercises to authenticated$perf06_history_18_13$,
      $perf06_history_18_14$grant delete on table public.exercises to authenticated$perf06_history_18_14$,
      $perf06_history_18_15$-- The legacy exercises upsert sends the full payload, including id and user_id,
-- and PostgREST may replay any of those columns in the ON CONFLICT DO UPDATE SET
-- list. Rather than depending on which columns PostgREST emits, both identity
-- columns stay writable at the ACL level and the invariant is enforced
-- fail-closed by the trigger below: repeating the same value is allowed, any
-- real change to id or user_id aborts the statement. This is the single
-- canonical identity-protection mechanism for public.exercises.
create function public.prevent_exercise_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  if new.id is distinct from old.id then
    raise exception using
      errcode = '42501',
      message = 'exercise identity cannot be changed';
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception using
      errcode = '42501',
      message = 'exercise ownership cannot be changed';
  end if;

  return new;
end;
$function$$perf06_history_18_15$,
      $perf06_history_18_16$revoke execute on function public.prevent_exercise_identity_change() from public$perf06_history_18_16$,
      $perf06_history_18_17$revoke execute on function public.prevent_exercise_identity_change() from anon$perf06_history_18_17$,
      $perf06_history_18_18$revoke execute on function public.prevent_exercise_identity_change() from authenticated$perf06_history_18_18$,
      $perf06_history_18_19$-- Unconditional BEFORE UPDATE: the guard never depends on which columns a
-- client happens to list in the SET clause.
create trigger exercises_prevent_identity_change
  before update on public.exercises
  for each row execute function public.prevent_exercise_identity_change()$perf06_history_18_19$,
      $perf06_history_18_20$-- Trigger functions do not need to remain callable through the Data API. Revoking
-- direct execution does not remove or replace the existing auth.users trigger.
revoke execute on function public.handle_new_user() from public$perf06_history_18_20$,
      $perf06_history_18_21$revoke execute on function public.handle_new_user() from anon$perf06_history_18_21$,
      $perf06_history_18_22$revoke execute on function public.handle_new_user() from authenticated$perf06_history_18_22$,
      $perf06_history_18_23$-- Existing definition only assigns NEW.updated_at = now() and references no
-- application relation. pg_catalog is therefore the minimal fixed search path.
alter function public.set_updated_at() set search_path = pg_catalog$perf06_history_18_23$
    ]::text[]),
    ('20260810230014', 'perf_06c_rls_initplan', array[
      $perf06_history_19_0$-- PERF-06C: evaluate auth.uid() once per statement through a PostgreSQL initplan.
-- ALTER POLICY preserves each policy name, command, role list and permissive mode.

alter policy "profiles own rows" on public.profiles
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id)$perf06_history_19_0$,
      $perf06_history_19_1$alter policy "routines own rows" on public.routines
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id)$perf06_history_19_1$,
      $perf06_history_19_2$alter policy "exercises own rows" on public.exercises
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
  )$perf06_history_19_2$,
      $perf06_history_19_3$alter policy "training cycles select own rows" on public.training_cycles
  using ((select auth.uid()) = user_id)$perf06_history_19_3$,
      $perf06_history_19_4$alter policy "training cycles insert own rows" on public.training_cycles
  with check ((select auth.uid()) = user_id)$perf06_history_19_4$,
      $perf06_history_19_5$alter policy "training cycles update own rows" on public.training_cycles
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id)$perf06_history_19_5$,
      $perf06_history_19_6$alter policy "training cycle routines select own rows" on public.training_cycle_routines
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = (select auth.uid())
        and c.deleted_at is null
    )
  )$perf06_history_19_6$,
      $perf06_history_19_7$alter policy "training cycle routines insert own rows" on public.training_cycle_routines
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.training_cycles c
      where c.id = cycle_id
        and c.user_id = (select auth.uid())
        and c.deleted_at is null
    )
  )$perf06_history_19_7$,
      $perf06_history_19_8$alter policy "training cycle routines update own rows" on public.training_cycle_routines
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
  )$perf06_history_19_8$,
      $perf06_history_19_9$alter policy "training cycle days select own rows" on public.training_cycle_days
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
  )$perf06_history_19_9$,
      $perf06_history_19_10$alter policy "training cycle days insert own rows" on public.training_cycle_days
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
  )$perf06_history_19_10$,
      $perf06_history_19_11$alter policy "training cycle days update own rows" on public.training_cycle_days
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
  )$perf06_history_19_11$,
      $perf06_history_19_12$alter policy "training cycle exercises select own rows" on public.training_cycle_exercises
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
  )$perf06_history_19_12$,
      $perf06_history_19_13$alter policy "training cycle exercises insert own rows" on public.training_cycle_exercises
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
  )$perf06_history_19_13$,
      $perf06_history_19_14$alter policy "training cycle exercises update own rows" on public.training_cycle_exercises
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
  )$perf06_history_19_14$,
      $perf06_history_19_15$alter policy "sessions own rows" on public.training_sessions
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
  )$perf06_history_19_15$,
      $perf06_history_19_16$alter policy "entries own rows" on public.exercise_entries
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
  )$perf06_history_19_16$,
      $perf06_history_19_17$alter policy "daily readiness own select" on public.training_daily_readiness
  using ((select auth.uid()) = user_id)$perf06_history_19_17$,
      $perf06_history_19_18$alter policy "lineages own rows select" on public.training_exercise_lineages
  using (user_id = (select auth.uid()))$perf06_history_19_18$,
      $perf06_history_19_19$alter policy "lineages own rows insert" on public.training_exercise_lineages
  with check (user_id = (select auth.uid()))$perf06_history_19_19$,
      $perf06_history_19_20$alter policy "lineages own rows update" on public.training_exercise_lineages
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()))$perf06_history_19_20$,
      $perf06_history_19_21$alter policy "workout readiness own select" on public.training_workout_readiness
  using ((select auth.uid()) = user_id)$perf06_history_19_21$
    ]::text[]),
    ('20260810230028', 'perf_06b_exercise_entries_user_session_created_id_index', array[
      $perf06_history_20_0$create index exercise_entries_session_user_lineage_created_id_idx
  on public.exercise_entries (session_id, user_id, exercise_lineage_id, created_at, id)$perf06_history_20_0$
    ]::text[]),
    ('20260811035538', 'ensure_legacy_exercise_lineage_invariant', array[
      $perf06_history_21_0$-- PERF-06R: permanent lineage invariant for legacy exercise writes.
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

set local statement_timeout = '15s'$perf06_history_21_0$,
      $perf06_history_21_1$set local lock_timeout = '5s'$perf06_history_21_1$,
      $perf06_history_21_2$-- CREATE TRIGGER also locks the table, but taking the write-conflicting lock first makes
-- the installation boundary explicit: pre-lock commits are handled by the later
-- compensatory migration; post-lock writes can only finish after this trigger exists.
lock table public.exercises in share row exclusive mode$perf06_history_21_2$,
      $perf06_history_21_3$lock table public.training_exercise_lineages in share row exclusive mode$perf06_history_21_3$,
      $perf06_history_21_4$drop policy if exists "lineages own rows select" on public.training_exercise_lineages$perf06_history_21_4$,
      $perf06_history_21_5$drop policy if exists "lineages own rows insert" on public.training_exercise_lineages$perf06_history_21_5$,
      $perf06_history_21_6$drop policy if exists "lineages own rows update" on public.training_exercise_lineages$perf06_history_21_6$,
      $perf06_history_21_7$create policy "lineages own rows select"
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
  )$perf06_history_21_7$,
      $perf06_history_21_8$create policy "lineages own rows insert"
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
  )$perf06_history_21_8$,
      $perf06_history_21_9$create policy "lineages own rows update"
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
  )$perf06_history_21_9$,
      $perf06_history_21_10$revoke all on table public.training_exercise_lineages from anon$perf06_history_21_10$,
      $perf06_history_21_11$revoke all on table public.training_exercise_lineages from authenticated$perf06_history_21_11$,
      $perf06_history_21_12$grant select, insert on table public.training_exercise_lineages to authenticated$perf06_history_21_12$,
      $perf06_history_21_13$grant update (origin_training_cycle_exercise_id, updated_at)
  on table public.training_exercise_lineages
  to authenticated$perf06_history_21_13$,
      $perf06_history_21_14$create function public.validate_training_exercise_lineage_identity_update()
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
$function$$perf06_history_21_14$,
      $perf06_history_21_15$create trigger training_exercise_lineages_validate_identity_update
  before update on public.training_exercise_lineages
  for each row execute function public.validate_training_exercise_lineage_identity_update()$perf06_history_21_15$,
      $perf06_history_21_16$create function public.ensure_legacy_exercise_lineage_invariant()
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
$function$$perf06_history_21_16$,
      $perf06_history_21_17$-- PostgreSQL checks EXECUTE when CREATE TRIGGER runs. Revoking direct execution after
-- trigger creation keeps it out of the Data API without disabling trigger invocation.
create trigger exercises_ensure_legacy_lineage
  after insert or update on public.exercises
  for each row execute function public.ensure_legacy_exercise_lineage_invariant()$perf06_history_21_17$,
      $perf06_history_21_18$revoke execute on function public.ensure_legacy_exercise_lineage_invariant() from public$perf06_history_21_18$,
      $perf06_history_21_19$revoke execute on function public.ensure_legacy_exercise_lineage_invariant() from anon$perf06_history_21_19$,
      $perf06_history_21_20$revoke execute on function public.ensure_legacy_exercise_lineage_invariant() from authenticated$perf06_history_21_20$,
      $perf06_history_21_21$revoke execute on function public.validate_training_exercise_lineage_identity_update() from public$perf06_history_21_21$,
      $perf06_history_21_22$revoke execute on function public.validate_training_exercise_lineage_identity_update() from anon$perf06_history_21_22$,
      $perf06_history_21_23$revoke execute on function public.validate_training_exercise_lineage_identity_update() from authenticated$perf06_history_21_23$,
      $perf06_history_21_24$-- Atomicity: the AFTER trigger runs inside the original exercise write transaction.
-- If the write rolls back, its lineage INSERT rolls back with it. An UPDATE of an older
-- exercise without lineage runs the same repair and must satisfy the same postcondition.
--
-- Proposed rollback (documentation only; separate authorization required): in one
-- transaction, drop public.exercises.exercises_ensure_legacy_lineage and then drop
-- public.ensure_legacy_exercise_lineage_invariant(). Existing lineage rows are data and
-- must not be removed by the invariant rollback.$perf06_history_21_24$
    ]::text[]),
    ('20260811035542', 'reconcile_legacy_exercise_lineages', array[
      $perf06_history_22_0$-- PERF-06R: reconcile legacy exercises created before the permanent lineage invariant.
-- Local/QA candidate only. A separate read-only PROD audit is mandatory before merge.
-- The invariant migration must commit before this migration can begin.

set local statement_timeout = '15s'$perf06_history_22_0$,
      $perf06_history_22_1$set local lock_timeout = '5s'$perf06_history_22_1$,
      $perf06_history_22_2$do $perf_06r$
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
$perf_06r$$perf06_history_22_2$,
      $perf06_history_22_3$-- Proposed rollback (documentation only; never automatic): after a separate audit confirms
-- that no entry or cycle exercise references the inserted lineages, remove only rows whose
-- metadata marker exactly matches reconciliation=PERF-06R, source=migration-history-normalization,
-- version=1. Any rollback requires separate authorization and must preserve pre-existing rows.$perf06_history_22_3$
    ]::text[]),
    ('20260811190144', 'perf_06r_daily_readiness_acl_normalization', array[
      $perf06_history_23_0$-- PERF-06R: normalize the executable ACL of the daily readiness RPC.
-- This migration changes privileges only; it does not replace the function.

revoke all on function public.save_daily_training_readiness(jsonb) from public$perf06_history_23_0$,
      $perf06_history_23_1$revoke all on function public.save_daily_training_readiness(jsonb) from anon$perf06_history_23_1$,
      $perf06_history_23_2$revoke all on function public.save_daily_training_readiness(jsonb) from service_role$perf06_history_23_2$,
      $perf06_history_23_3$grant execute on function public.save_daily_training_readiness(jsonb) to authenticated$perf06_history_23_3$,
      $perf06_history_23_4$grant execute on function public.save_daily_training_readiness(jsonb) to postgres$perf06_history_23_4$
    ]::text[])
),
actual_history as (
  select version, name, statements
  from supabase_migrations.schema_migrations
),
history_check as (
  select
    (select count(*) from actual_history) = 24
    and (select coalesce(sum(cardinality(statements)), 0) from actual_history) = 336
    and not exists (
      select 1
      from expected_history expected
      full join actual_history actual using (version)
      where expected.version is null
         or actual.version is null
         or actual.name is distinct from expected.name
         or actual.statements is distinct from expected.statements
    ) as exact
),
lineage_state as (
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
  )::integer as markers
),
diagnostic as (
select to_regclass('public.training_session_consolidation_audit') is not null as present,
       (select count(*) from public.training_session_consolidation_audit)::integer as row_count
),
catalog as (
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
  as valid
),
complete_state as (
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
  as valid
)
select jsonb_build_object(
  'current_user', (select identity."current_user" from identity),
  'session_user', (select identity."session_user" from identity),
  'isolation_level', (select isolation_level from identity),
  'read_only', (select read_only from identity),
  'server_version_num', (select server_version_num from identity),
  'database_name', (select database_name from identity),
  'partial_application', (select to_jsonb(partial_application) from partial_application),
  'pending', (select pending from lineage_counts),
  'exercise_count', (select exercise_count from lineage_counts),
  'marker_count', (select marker_count from marker_count),
  'incompatible_count', (select incompatible_count from incompatible_lineages),
  'owner_id', (select owner_id from fixture_identity),
  'routine_id', (select routine_id from fixture_identity),
  'fixture_free', (select valid from fixtures),
  'diagnostic_present', (select diagnostic_exists from diagnostic_exists),
  'diagnostic_count', (select diagnostic_count from diagnostic_count),
  'diagnostic_executed_count', (select diagnostic_executed_count from diagnostic_count),
  'diagnostic_hash', (select diagnostic_hash from diagnostic_hash),
  'diagnostic_consumers', (select consumer_count from diagnostic_consumers),
  'data_counts', (select counts from data_counts),
  'prod_guard_valid', (select valid from prod_guard),
  'prod_guard_hash', (select guard_hash from prod_guard),
  'prod_function_item_sha256', (select function_item_sha256 from prod_guard),
  'prod_function_definition_sha256', (select definition_sha256 from prod_guard),
  'fingerprint_count', (select item_count from fingerprint where category = 'OVERALL'),
  'fingerprint_hash', (select sha256 from fingerprint where category = 'OVERALL'),
  'history_exact', (select exact from history_check),
  'history_versions', (select count(*) from actual_history),
  'history_statements', (select coalesce(sum(cardinality(statements)), 0) from actual_history),
  'lineage_pending', (select pending from lineage_state),
  'lineage_markers', (select markers from lineage_state),
  'diagnostic_final_present', (select present from diagnostic),
  'diagnostic_final_count', (select row_count from diagnostic),
  'catalog_valid', (select valid from catalog),
  'complete_state_valid', (select valid from complete_state)
) as snapshot
);

do $perf06_final_gate$
declare
  v_initial jsonb;
  v_final jsonb;
  v_pending integer;
  v_relation text;
  v_expected bigint;
begin
  select initial_snapshot, final_snapshot
  into v_initial, v_final
  from pg_temp.perf06_sql_editor_context;

  v_pending := (v_initial ->> 'pending')::integer;

  if v_final is null
    or (v_final ->> 'fingerprint_count')::integer <> 377
    or pg_catalog.length(coalesce(v_final ->> 'fingerprint_hash', '')) <> 64
    or coalesce((v_final ->> 'history_exact')::boolean, false) is not true
    or (v_final ->> 'history_versions')::integer <> 24
    or (v_final ->> 'history_statements')::integer <> 336
    or v_final -> 'partial_application' <> '{"history_absent":false,"identity_function_absent":false,"invariant_function_absent":false,"lineage_function_absent":false,"perf_index_absent":false,"perf_triggers_absent":false}'::jsonb
    or (v_final ->> 'lineage_pending')::integer <> 0
    or (v_final ->> 'lineage_markers')::integer <> v_pending
    or (v_final ->> 'exercise_count')::integer <> (v_initial ->> 'exercise_count')::integer
    or (v_final ->> 'incompatible_count')::integer <> 0
    or coalesce((v_final ->> 'fixture_free')::boolean, false) is not true
    or coalesce((v_final ->> 'diagnostic_final_present')::boolean, false) is not true
    or (v_final ->> 'diagnostic_final_count')::integer <> 3
    or (v_final ->> 'diagnostic_executed_count')::integer <> 3
    or v_final ->> 'diagnostic_hash' <> v_initial ->> 'diagnostic_hash'
    or coalesce((v_final ->> 'prod_guard_valid')::boolean, false) is not true
    or v_final ->> 'prod_guard_hash' <> v_initial ->> 'prod_guard_hash'
    or v_final ->> 'prod_function_item_sha256' <> 'ebaddb158c298b7eae7866253693d743cac3092c141ccc1a4f312cd32498ca47'
    or v_final ->> 'prod_function_definition_sha256' <> '5d4290d1e54f4cee0080882c635a4fd6f669629322cfd8f963ef02da4eee5541'
    or (v_final ->> 'diagnostic_consumers')::integer <> 0
    or coalesce((v_final ->> 'catalog_valid')::boolean, false) is not true
    or coalesce((v_final ->> 'complete_state_valid')::boolean, false) is not true
  then
    raise exception using
      errcode = '55000',
      message = 'PERF-06 SQL Editor aborted: final state gate failed';
  end if;

  foreach v_relation in array array['exercise_entries', 'exercises', 'profiles', 'routines', 'training_cycle_days', 'training_cycle_exercises', 'training_cycle_routines', 'training_cycles', 'training_daily_readiness', 'training_exercise_lineages', 'training_sessions', 'training_workout_readiness']
  loop
    v_expected := (v_initial -> 'data_counts' ->> v_relation)::bigint;
    if v_relation = 'training_exercise_lineages' then
      v_expected := v_expected + v_pending;
    end if;
    if (v_final -> 'data_counts' ->> v_relation)::bigint <> v_expected then
      raise exception using
        errcode = '55000',
        message = pg_catalog.format('PERF-06 SQL Editor aborted: unexpected row count for %s', v_relation);
    end if;
  end loop;
end;
$perf06_final_gate$;

do $perf06_capture_final$
declare
  v_final_fingerprint text;
begin
  select final_snapshot ->> 'fingerprint_hash'
  into v_final_fingerprint
  from pg_temp.perf06_sql_editor_context;

  if pg_catalog.length(coalesce(v_final_fingerprint, '')) <> 64 then
    raise exception using
      errcode = '55000',
      message = 'PERF06_CAPTURE_FAILED';
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'PERF06_EXPECTED_ROLLBACK final_fingerprint=' || v_final_fingerprint;
end;
$perf06_capture_final$;
