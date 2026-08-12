-- ORGANIZATECH PERF-06 — PRODUCCIÓN — POST-FAILURE CANONICAL DRIFT READ-ONLY
-- DESTINO EXCLUSIVO: organizatech PROD (lzycxltqbrtsnwfdotqw).
-- Identifica la categoría y las claves de objeto del drift 346/4216 vs 346/ebd6.
-- No devuelve definiciones, ACL completas ni filas de aplicación y termina con ROLLBACK.

begin isolation level repeatable read read only;

set local statement_timeout = '20s';

set local lock_timeout = '3s';

set local idle_in_transaction_session_timeout = '30s';

set local application_name = 'organizatech-perf-06-prod-post-failure-drift-readonly';

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
),
expected_categories(category, expected_item_count, expected_sha256) as (
  values
    ('relation'::text, 12::bigint, '27f39c8229b08c387618b3c239f67e7f21665855eefda34d5ef2a9ca4428deaa'::text),
    ('column'::text, 140::bigint, '69898daeb45e1089b14321e2213118cdf467497537f57e85aa11237563e463b5'::text),
    ('constraint'::text, 87::bigint, 'f2a6754c268c5daf0d2928191776274ff5bdbaef261f1e6f117483071f099248'::text),
    ('index'::text, 48::bigint, '22e08687bf2c4d90d1b6b14581f8eb4da195347501c4c5cd119fab4d2170c4b8'::text),
    ('policy'::text, 26::bigint, 'bd7c900256bb787b4b38875a7b002737cedc7261c7dc03cfef3426a1cc588cdf'::text),
    ('function'::text, 8::bigint, '892bea17c5e3850563128297ced60de517d353fffe624e1b48204435f550d62e'::text),
    ('trigger'::text, 13::bigint, 'a82172aeb6f41d125020c4af5d58f7843942231301f41fe8b834532f0195a2ca'::text),
    ('table_acl'::text, 12::bigint, '25a6ff8df97e92bb63d29cc6f26083cb20522a3886069d76f3234ab5c6d57beb'::text),
    ('column_acl'::text, 0::bigint, null::text)
),
category_deltas as (
  select
    expected.category,
    coalesce(actual.item_count, 0)::bigint as item_count,
    expected.expected_item_count,
    actual.sha256 as category_sha256,
    expected.expected_sha256,
    coalesce(actual.item_count, 0)::bigint <> expected.expected_item_count
      or actual.sha256 is distinct from expected.expected_sha256 as differs
  from expected_categories as expected
  left join category_hashes as actual using (category)
),
drift_categories as (
  select category from category_deltas where differs
),
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
diagnostic_count as (
select
  pg_catalog.count(*)::integer as diagnostic_count,
  pg_catalog.count(*) filter (where status::text = 'executed')::integer as diagnostic_executed_count
from public.training_session_consolidation_audit
),
partial_application as (
  select
    pg_catalog.to_regclass('supabase_migrations.schema_migrations') is null as history_absent,
    pg_catalog.to_regprocedure('public.prevent_exercise_identity_change()') is null as identity_function_absent,
    pg_catalog.to_regprocedure('public.ensure_legacy_exercise_lineage_invariant()') is null as invariant_function_absent,
    pg_catalog.to_regprocedure('public.validate_training_exercise_lineage_identity_update()') is null as lineage_function_absent,
    pg_catalog.to_regclass('public.exercise_entries_session_user_lineage_created_id_idx') is null as perf_index_absent,
    not exists (
      select 1 from pg_catalog.pg_trigger
      where tgname in ('exercises_prevent_identity_change', 'exercises_ensure_legacy_lineage', 'training_exercise_lineages_validate_identity_update')
        and not tgisinternal
    ) as perf_triggers_absent
),
evaluation as (
  select case
    when runtime.current_user <> 'postgres'
      or runtime.session_user <> 'postgres'
      or runtime.isolation_level <> 'repeatable read'
      or runtime.read_only <> 'on'
      or runtime.server_version_num <> 170006
      or runtime.database_name <> 'postgres'
      or not runtime.tls_active
    then 'BLOCKED_IDENTITY_OR_TRANSACTION'
    when overall.item_count <> 346
      or overall.sha256 <> '4216b822625f6fbeea326d09312fc2f77bb268995b552280b6e4d2951870b210'
    then 'DRIFT_SNAPSHOT_CHANGED'
    when not prod_guard.valid
      or prod_guard.function_item_sha256 <> 'ebaddb158c298b7eae7866253693d743cac3092c141ccc1a4f312cd32498ca47'
      or prod_guard.definition_sha256 <> '5d4290d1e54f4cee0080882c635a4fd6f669629322cfd8f963ef02da4eee5541'
    then 'BLOCKED_PROD_GUARD_CHANGED'
    when diagnostic_count.diagnostic_count <> 3
      or diagnostic_count.diagnostic_executed_count <> 3
    then 'BLOCKED_DIAGNOSTIC_CHANGED'
    when not partial_application.history_absent
      or not partial_application.identity_function_absent
      or not partial_application.invariant_function_absent
      or not partial_application.lineage_function_absent
      or not partial_application.perf_index_absent
      or not partial_application.perf_triggers_absent
    then 'BLOCKED_PARTIAL_APPLICATION'
    when not exists (select 1 from drift_categories)
    then 'BLOCKED_NO_CANONICAL_DRIFT_FOUND'
    else 'PASS_POST_FAILURE_DRIFT_CAPTURED'
  end as verdict
  from runtime, overall, prod_guard, diagnostic_count, partial_application
),
report as (
  select
    1::integer as sort_group,
    'RUNTIME'::text as record_type,
    'runtime'::text as category,
    null::bigint as item_count,
    null::bigint as expected_item_count,
    null::text as category_sha256,
    null::text as expected_category_sha256,
    null::text as object_key,
    null::text as item_sha256,
    pg_catalog.jsonb_build_object(
      'current_user', runtime.current_user,
      'session_user', runtime.session_user,
      'isolation_level', runtime.isolation_level,
      'transaction_read_only', runtime.read_only,
      'server_version_num', runtime.server_version_num,
      'database_name', runtime.database_name,
      'tls_active', runtime.tls_active,
      'canonical_items', overall.item_count,
      'canonical_sha256', overall.sha256
    ) as detail
  from runtime cross join overall

  union all

  select
    2,
    'CATEGORY',
    category,
    item_count,
    expected_item_count,
    category_sha256,
    expected_sha256,
    null,
    null,
    pg_catalog.jsonb_build_object('differs', differs)
  from category_deltas

  union all

  select
    3,
    'OBJECT',
    manifest.category,
    null,
    null,
    null,
    null,
    case manifest.category
      when 'relation' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2))
      when 'column' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3), pg_catalog.split_part(manifest.line, '|', 4))
      when 'constraint' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3))
      when 'index' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3))
      when 'policy' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3))
      when 'function' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3))
      when 'trigger' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3))
      when 'table_acl' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2))
      when 'column_acl' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3))
    end,
    pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(manifest.category || '|' || manifest.line, 'UTF8')),
      'hex'
    ),
    null
  from manifest
  join drift_categories using (category)
)
select
  evaluation.verdict,
  'lzycxltqbrtsnwfdotqw'::text as expected_project_ref,
  true as visual_project_confirmation_required,
  report.record_type,
  report.category,
  report.item_count,
  report.expected_item_count,
  report.category_sha256,
  report.expected_category_sha256,
  report.object_key,
  report.item_sha256,
  report.detail
from report cross join evaluation
order by report.sort_group, report.category, report.object_key nulls first;

rollback;
