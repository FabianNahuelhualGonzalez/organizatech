-- ORGANIZATECH PERF-06 — PRODUCCIÓN — DRIFT DIAGNOSTIC READ-ONLY

-- DESTINO EXCLUSIVO: organizatech PROD (lzycxltqbrtsnwfdotqw).

-- Identifica diferencias de catálogo; no lee filas de aplicación, Auth ni Storage.

-- No aplica migraciones, no crea objetos, no modifica datos y termina con ROLLBACK.



begin isolation level repeatable read read only;

set local statement_timeout = '20s';

set local lock_timeout = '3s';

set local idle_in_transaction_session_timeout = '30s';

set local application_name = 'organizatech-perf-06-prod-drift-readonly';

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
),
expected_category_counts(category, expected_item_count) as (
  values
    ('relation'::text, 12::bigint),
    ('column'::text, 140::bigint),
    ('constraint'::text, 87::bigint),
    ('index'::text, 48::bigint),
    ('policy'::text, 26::bigint),
    ('function'::text, 8::bigint),
    ('trigger'::text, 13::bigint),
    ('table_acl'::text, 12::bigint),
    ('column_acl'::text, 0::bigint)
),
category_deltas as (
  select
    expected.category,
    coalesce(actual.item_count, 0)::bigint as item_count,
    expected.expected_item_count,
    actual.sha256,
    coalesce(actual.item_count, 0)::bigint <> expected.expected_item_count as count_differs
  from expected_category_counts as expected
  left join category_hashes as actual using (category)
),
drift_categories as (
  select category from category_deltas where count_differs
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
diagnostic_relation as (
  select pg_catalog.to_regclass('public.training_session_consolidation_audit') as oid
),
diagnostic_catalog as (
  select pg_catalog.jsonb_build_object(
    'present', diagnostic.oid is not null,
    'constraints', (select pg_catalog.count(*) from pg_catalog.pg_constraint where conrelid = diagnostic.oid),
    'indexes', (select pg_catalog.count(*) from pg_catalog.pg_index where indrelid = diagnostic.oid),
    'policies', (select pg_catalog.count(*) from pg_catalog.pg_policy where polrelid = diagnostic.oid),
    'triggers', (select pg_catalog.count(*) from pg_catalog.pg_trigger where tgrelid = diagnostic.oid and not tgisinternal),
    'view_consumers', (
      select pg_catalog.count(*)
      from pg_catalog.pg_depend as dependency
      join pg_catalog.pg_rewrite as rewrite_row
        on dependency.classid = 'pg_catalog.pg_rewrite'::pg_catalog.regclass
       and rewrite_row.oid = dependency.objid
      where dependency.refobjid = diagnostic.oid
        and rewrite_row.ev_class <> diagnostic.oid
    )
  ) as detail
  from diagnostic_relation as diagnostic
),
evaluation as (
  select case
    when runtime.current_user <> 'postgres'
      or runtime.session_user <> 'postgres'
      or runtime.read_only <> 'on'
      or runtime.isolation_level <> 'repeatable read'
    then 'BLOCKED_IDENTITY_OR_TRANSACTION'
    when overall.item_count <> 347
      or overall.sha256 <> '1fefc787fe75385f63de9b5292b70d8dfe8c25f6a6e60b1cbf092493a29903a5'
    then 'DRIFT_SNAPSHOT_CHANGED'
    when not exists (select 1 from drift_categories)
    then 'BLOCKED_NO_COUNT_DRIFT_FOUND'
    else 'PASS_DRIFT_DIAGNOSTIC_COMPLETE'
  end as verdict
  from runtime cross join overall
),
report as (
  select
    1::integer as sort_group,
    'RUNTIME'::text as record_type,
    'runtime'::text as category,
    null::bigint as item_count,
    null::bigint as expected_item_count,
    null::text as category_sha256,
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
      'overall_items', overall.item_count,
      'overall_sha256', overall.sha256
    ) as detail
  from runtime cross join overall

  union all

  select
    2,
    'CATEGORY',
    category,
    item_count,
    expected_item_count,
    sha256,
    null,
    null,
    pg_catalog.jsonb_build_object('count_differs', count_differs)
  from category_deltas

  union all

  select
    3,
    'OBJECT',
    manifest.category,
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

  union all

  select
    4,
    'EXCLUDED_DIAGNOSTIC',
    'excluded_diagnostic',
    null,
    null,
    null,
    'public|training_session_consolidation_audit',
    null,
    diagnostic_catalog.detail
  from diagnostic_catalog
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
  report.object_key,
  report.item_sha256,
  report.detail
from report cross join evaluation
order by report.sort_group, report.category, report.object_key nulls first;

rollback;
