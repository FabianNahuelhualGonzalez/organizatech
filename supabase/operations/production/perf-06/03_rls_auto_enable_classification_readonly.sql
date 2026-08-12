-- ORGANIZATECH PERF-06 — PRODUCCIÓN — RLS AUTO-ENABLE CLASSIFICATION READ-ONLY
-- DESTINO EXCLUSIVO: organizatech PROD (lzycxltqbrtsnwfdotqw).
-- Clasifica public.rls_auto_enable() y ensure_rls sólo mediante pg_catalog.
-- No devuelve el cuerpo de la función, no modifica objetos y termina con ROLLBACK.

begin isolation level repeatable read read only;

set local statement_timeout = '20s';
set local lock_timeout = '3s';
set local idle_in_transaction_session_timeout = '30s';
set local application_name = 'organizatech-perf-06-prod-rls-auto-enable-readonly';

with runtime as (
  select
    current_user::text as current_user,
    session_user::text as session_user,
    pg_catalog.current_setting('transaction_isolation') as isolation_level,
    pg_catalog.current_setting('transaction_read_only') as read_only,
    pg_catalog.current_setting('server_version_num')::integer as server_version_num,
    pg_catalog.current_database() as database_name,
    coalesce(
      (select ssl from pg_catalog.pg_stat_ssl where pid = pg_catalog.pg_backend_pid()),
      false
    ) as tls_active
),
target_function as (
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
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(procedure.oid),
      '[[:space:]]+',
      ' ',
      'g'
    ) as normalized_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  join pg_catalog.pg_roles as owner_role
    on owner_role.oid = procedure.proowner
  join pg_catalog.pg_language as language
    on language.oid = procedure.prolang
  where namespace.nspname = 'public'
    and procedure.proname = 'rls_auto_enable'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''
),
function_summary as (
  select
    pg_catalog.count(*)::integer as function_count,
    coalesce(pg_catalog.bool_and(owner_name = 'postgres'), false) as owner_is_postgres,
    coalesce(pg_catalog.bool_and(language_name = 'plpgsql'), false) as language_is_plpgsql,
    coalesce(pg_catalog.bool_and(prosecdef), false) as security_definer,
    coalesce(
      pg_catalog.bool_and(
        coalesce(proconfig, '{}'::text[]) @> array['search_path=pg_catalog']::text[]
      ),
      false
    ) as search_path_pg_catalog,
    coalesce(pg_catalog.bool_and(return_type = 'event_trigger'), false) as returns_event_trigger,
    coalesce(pg_catalog.bool_and(identity_arguments = ''), false) as zero_arguments,
    pg_catalog.min(
      pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(normalized_definition, 'UTF8')),
        'hex'
      )
    ) as definition_sha256,
    coalesce(
      pg_catalog.bool_and(
        pg_catalog.strpos(pg_catalog.lower(normalized_definition), 'pg_event_trigger_ddl_commands()') > 0
      ),
      false
    ) as reads_event_trigger_commands,
    coalesce(
      pg_catalog.bool_and(
        pg_catalog.strpos(pg_catalog.lower(normalized_definition), 'cmd.schema_name in (''public'')') > 0
      ),
      false
    ) as limits_schema_to_public,
    coalesce(
      pg_catalog.bool_and(
        pg_catalog.strpos(pg_catalog.lower(normalized_definition), 'alter table if exists %s enable row level security') > 0
      ),
      false
    ) as enables_row_level_security
  from target_function
),
function_acl_rows as (
  select
    acl.grantee,
    role.rolname as grantee_name,
    acl.privilege_type,
    acl.is_grantable
  from target_function as target
  cross join lateral pg_catalog.aclexplode(
    coalesce(target.proacl, pg_catalog.acldefault('f', target.proowner))
  ) as acl
  left join pg_catalog.pg_roles as role
    on role.oid = acl.grantee
),
function_acl_summary as (
  select
    coalesce(pg_catalog.bool_or(grantee = 0 and privilege_type = 'EXECUTE'), false) as public_execute_direct,
    coalesce(pg_catalog.bool_or(grantee_name = 'anon' and privilege_type = 'EXECUTE'), false) as anon_execute_direct,
    coalesce(pg_catalog.bool_or(grantee_name = 'authenticated' and privilege_type = 'EXECUTE'), false) as authenticated_execute_direct,
    coalesce(pg_catalog.bool_or(grantee_name = 'service_role' and privilege_type = 'EXECUTE'), false) as service_role_execute_direct,
    coalesce(pg_catalog.bool_or(grantee_name = 'postgres' and privilege_type = 'EXECUTE'), false) as postgres_execute_direct,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'grantee', coalesce(grantee_name, 'PUBLIC'),
          'privilege', privilege_type,
          'grantable', is_grantable
        )
        order by coalesce(grantee_name, 'PUBLIC'), privilege_type, is_grantable
      ),
      '[]'::jsonb
    ) as direct_acl
  from function_acl_rows
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
  join pg_catalog.pg_roles as event_owner
    on event_owner.oid = event_trigger.evtowner
  left join target_function as target
    on target.oid = event_trigger.evtfoid
  where event_trigger.evtname = 'ensure_rls'
     or target.oid is not null
),
event_trigger_summary as (
  select
    pg_catalog.count(*) filter (where evtname = 'ensure_rls')::integer as ensure_rls_count,
    pg_catalog.count(*) filter (where target_function_oid is not null)::integer as triggers_using_function,
    coalesce(
      pg_catalog.bool_and(owner_name = 'postgres') filter (where evtname = 'ensure_rls'),
      false
    ) as owner_is_postgres,
    coalesce(
      pg_catalog.bool_and(evtevent = 'ddl_command_end') filter (where evtname = 'ensure_rls'),
      false
    ) as event_is_ddl_command_end,
    coalesce(
      pg_catalog.bool_and(evtenabled = 'O') filter (where evtname = 'ensure_rls'),
      false
    ) as enabled_for_origin,
    coalesce(
      pg_catalog.bool_and(evtfoid = target_function_oid) filter (where evtname = 'ensure_rls'),
      false
    ) as calls_target_function,
    coalesce(
      pg_catalog.bool_and(
        evttags @> array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']::text[]
        and evttags <@ array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']::text[]
      ) filter (where evtname = 'ensure_rls'),
      false
    ) as tags_exact,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'name', evtname,
          'event', evtevent,
          'enabled', evtenabled,
          'tags', evttags,
          'owner', owner_name,
          'calls_target', evtfoid = target_function_oid
        )
        order by evtname
      ),
      '[]'::jsonb
    ) as event_triggers
  from target_event_triggers
),
dependency_rows as (
  select
    'inbound'::text as direction,
    dependency.classid::pg_catalog.regclass::text as catalog_name,
    dependency.deptype::text as dependency_type
  from pg_catalog.pg_depend as dependency
  join target_function as target
    on dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
   and dependency.refobjid = target.oid

  union all

  select
    'outbound',
    dependency.refclassid::pg_catalog.regclass::text,
    dependency.deptype::text
  from pg_catalog.pg_depend as dependency
  join target_function as target
    on dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
   and dependency.objid = target.oid
),
dependency_summary as (
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'direction', direction,
        'catalog', catalog_name,
        'dependency_type', dependency_type,
        'count', dependency_count
      )
      order by direction, catalog_name, dependency_type
    ),
    '[]'::jsonb
  ) as dependencies
  from (
    select direction, catalog_name, dependency_type, pg_catalog.count(*) as dependency_count
    from dependency_rows
    group by direction, catalog_name, dependency_type
  ) as grouped_dependencies
),
evaluation as (
  select case
    when runtime.current_user <> 'postgres'
      or runtime.session_user <> 'postgres'
      or runtime.read_only <> 'on'
      or runtime.isolation_level <> 'repeatable read'
    then 'BLOCKED_IDENTITY_OR_TRANSACTION'
    when function_summary.function_count <> 1
    then 'BLOCKED_FUNCTION_CARDINALITY'
    else 'PASS_RLS_AUTO_ENABLE_CLASSIFICATION_CAPTURED'
  end as verdict
  from runtime cross join function_summary
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
  pg_catalog.to_jsonb(function_summary) as function_summary,
  pg_catalog.to_jsonb(function_acl_summary) as function_acl,
  pg_catalog.to_jsonb(event_trigger_summary) as event_trigger_summary,
  dependency_summary.dependencies
from runtime
cross join function_summary
cross join function_acl_summary
cross join event_trigger_summary
cross join dependency_summary
cross join evaluation;

rollback;
