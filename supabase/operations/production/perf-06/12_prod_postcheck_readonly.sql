begin isolation level repeatable read read only;

set local statement_timeout = '20s';

set local lock_timeout = '3s';

set local idle_in_transaction_session_timeout = '30s';

set local application_name = 'organizatech-perf-06-prod-postcommit-readonly';

with
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
overall as (
  select item_count, sha256 from fingerprint where category = 'OVERALL'
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
diagnostic as (
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
history as (
  select
    pg_catalog.count(*)::integer as versions,
    coalesce(pg_catalog.sum(pg_catalog.cardinality(statements)), 0)::integer as statements,
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          coalesce(pg_catalog.string_agg(
            version || pg_catalog.chr(31) || name || pg_catalog.chr(31)
            || pg_catalog.array_to_string(statements, pg_catalog.chr(30)),
            E'\n' order by version
          ), ''),
          'UTF8'
        )
      ),
      'hex'
    ) as sha256
  from supabase_migrations.schema_migrations
),
lineage as (
  select
    pg_catalog.count(*) filter (where not exists (
      select 1 from public.training_exercise_lineages as lineage
      where lineage.user_id = exercise.user_id
        and lineage.source_legacy_exercise_id = exercise.id
        and lineage.origin_kind = 'legacy'
        and lineage.origin_training_cycle_exercise_id is null
    ))::integer as pending,
    (select pg_catalog.count(*)::integer from public.training_exercise_lineages
     where metadata @> '{"reconciliation":"PERF-06R","source":"migration-history-normalization","version":1}'::jsonb) as markers
  from public.exercises as exercise
),
catalog as (
  select
    pg_catalog.to_regprocedure('public.prevent_exercise_identity_change()') is not null
    and pg_catalog.to_regprocedure('public.ensure_legacy_exercise_lineage_invariant()') is not null
    and pg_catalog.to_regprocedure('public.validate_training_exercise_lineage_identity_update()') is not null
    and pg_catalog.to_regclass('public.exercise_entries_session_user_lineage_created_id_idx') is not null
    and (select pg_catalog.count(*) from pg_catalog.pg_trigger
         where tgname in ('exercises_prevent_identity_change', 'exercises_ensure_legacy_lineage', 'training_exercise_lineages_validate_identity_update')
           and tgenabled = 'O' and not tgisinternal) = 3
    and (select pg_catalog.count(*) from pg_catalog.pg_policy
         where polrelid = 'public.training_exercise_lineages'::pg_catalog.regclass) = 3
    and pg_catalog.has_table_privilege('authenticated', 'public.training_exercise_lineages', 'SELECT')
    and pg_catalog.has_table_privilege('authenticated', 'public.training_exercise_lineages', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.training_exercise_lineages', 'DELETE')
    and pg_catalog.has_column_privilege('authenticated', 'public.training_exercise_lineages', 'origin_training_cycle_exercise_id', 'UPDATE')
    and not pg_catalog.has_column_privilege('authenticated', 'public.training_exercise_lineages', 'user_id', 'UPDATE')
    and pg_catalog.has_function_privilege('authenticated', 'public.save_daily_training_readiness(jsonb)', 'EXECUTE')
    and pg_catalog.has_function_privilege('postgres', 'public.save_daily_training_readiness(jsonb)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', 'public.save_daily_training_readiness(jsonb)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', 'public.save_daily_training_readiness(jsonb)', 'EXECUTE')
    as valid
),
evaluation as (
  select
    overall.item_count = 377
    and overall.sha256 = '65267f8cc811923352e947ecce94196520d958ea45c760ea652d4e8235e84c3d'
    and prod_guard.valid
    and prod_guard.function_item_sha256 = 'ebaddb158c298b7eae7866253693d743cac3092c141ccc1a4f312cd32498ca47'
    and prod_guard.definition_sha256 = '5d4290d1e54f4cee0080882c635a4fd6f669629322cfd8f963ef02da4eee5541'
    and diagnostic.diagnostic_count = 3
    and diagnostic.diagnostic_executed_count = 3
    and diagnostic_hash.diagnostic_hash = '6508604cac7b91490218d2f590d26a8616c9e0b525ca3c0548783139cdf39590'
    and history.versions = 24
    and history.statements = 336
    and history.sha256 = '3325f11a1cac1738b9aaa4adb389594d7dfb366b2a5978959ffb7210ffbe9756'
    and lineage.pending = 0
    and lineage.markers = 0
    and catalog.valid
    as valid,
    overall.item_count,
    overall.sha256,
    history.versions,
    history.statements,
    history.sha256 as history_sha256,
    lineage.pending,
    lineage.markers,
    prod_guard.valid as prod_guard_valid,
    diagnostic.diagnostic_count,
    diagnostic.diagnostic_executed_count,
    catalog.valid as catalog_valid
  from overall, prod_guard, diagnostic, diagnostic_hash, history, lineage, catalog
)
select
  case when valid then 'PASS_PROD_APPLIED' else 'BLOCKED' end as verdict,
  'lzycxltqbrtsnwfdotqw'::text as expected_project_ref,
  item_count as canonical_items,
  sha256 as canonical_fingerprint,
  versions as history_versions,
  statements as history_statements,
  history_sha256,
  pending as pending_lineages,
  markers as reconciliation_markers,
  prod_guard_valid,
  diagnostic_count as diagnostic_rows,
  diagnostic_executed_count as diagnostic_executed_rows,
  catalog_valid
from evaluation;

rollback;
