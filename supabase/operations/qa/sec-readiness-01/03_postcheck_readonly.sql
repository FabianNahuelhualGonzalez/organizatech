-- SEC-READINESS-01 - QA postcheck, strictly read-only.
-- Run after the migration and the rollback-only functional probe, never in Production.
-- The result exposes booleans and aggregate counts, never UUIDs or payloads.

begin transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '3s';

with table_target as (
  select
    relation.oid,
    relation.relowner,
    relation.relacl,
    relation.relrowsecurity,
    owner.rolname as owner_name,
    owner.rolbypassrls as owner_bypassrls
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_roles as owner
    on owner.oid = relation.relowner
  where namespace.nspname = 'public'
    and relation.relname = 'training_workout_readiness'
    and relation.relkind = 'r'
),
role_oids as (
  select
    (select role.oid from pg_catalog.pg_roles as role where role.rolname = 'authenticated') as authenticated_oid,
    (select role.oid from pg_catalog.pg_roles as role where role.rolname = 'anon') as anon_oid,
    (select role.oid from pg_catalog.pg_roles as role where role.rolname = 'service_role') as service_role_oid
),
table_acl as (
  select acl.grantee, acl.privilege_type
  from table_target as target
  cross join lateral pg_catalog.aclexplode(
    coalesce(target.relacl, pg_catalog.acldefault('r', target.relowner))
  ) as acl
),
policy_info as (
  select
    policy.polcmd,
    policy.polroles,
    pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) as using_expression
  from table_target as target
  join pg_catalog.pg_policy as policy
    on policy.polrelid = target.oid
),
functions_target as (
  select
    procedure.oid,
    procedure.proname,
    procedure.proowner,
    procedure.proacl,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.prosrc,
    owner.rolname as owner_name,
    owner.rolbypassrls as owner_bypassrls,
    pg_catalog.pg_get_function_identity_arguments(procedure.oid) as identity_args
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  join pg_catalog.pg_roles as owner
    on owner.oid = procedure.proowner
  where namespace.nspname = 'public'
    and procedure.proname in (
      'save_training_workout_readiness_v2',
      'link_training_workout_readiness_session_v2',
      'enforce_training_workout_readiness_payload_insert'
    )
),
function_acl as (
  select
    target.proname,
    target.identity_args,
    acl.grantee,
    acl.privilege_type
  from functions_target as target
  cross join lateral pg_catalog.aclexplode(
    coalesce(target.proacl, pg_catalog.acldefault('f', target.proowner))
  ) as acl
),
trigger_state as (
  select
    trigger.tgname,
    trigger.tgtype,
    trigger.tgisinternal,
    trigger.tgfoid
  from pg_catalog.pg_trigger as trigger
  where trigger.tgrelid = pg_catalog.to_regclass('public.training_workout_readiness')
    and trigger.tgname = 'training_workout_readiness_payload_insert_guard'
),
historical_payload_counts as (
  select
    pg_catalog.count(*) as readiness_rows,
    pg_catalog.count(*) filter (
      where pg_catalog.octet_length(readiness.payload::pg_catalog.text) > 1024
    ) as historical_payloads_over_1024_bytes
  from public.training_workout_readiness as readiness
),
protected_table_counts as (
  select
    (select pg_catalog.count(*) from public.training_daily_readiness) as legacy_readiness_rows,
    (select pg_catalog.count(*) from public.training_sessions) as training_session_rows,
    (select pg_catalog.count(*) from public.exercise_entries) as exercise_entry_rows
),
checks as (
  select 'table_owner_postgres_bypassrls' as check_name,
    owner_name = 'postgres' and owner_bypassrls
  from table_target
  union all
  select 'rls_enabled', relrowsecurity
  from table_target
  union all
  select 'single_own_select_policy_no_writes',
    (select pg_catalog.count(*) from policy_info) = 1
    and (select pg_catalog.count(*) from policy_info where polcmd = 'r') = 1
    and exists (
      select 1 from policy_info cross join role_oids
      where polcmd = 'r'
        and polroles = array[authenticated_oid]
        and using_expression ilike '%auth.uid()%user_id%'
    )
  union all
  select 'table_authenticated_select_only',
    exists (
      select 1 from table_acl cross join role_oids
      where grantee = authenticated_oid and privilege_type = 'SELECT'
    )
    and not exists (
      select 1 from table_acl cross join role_oids
      where grantee = authenticated_oid and privilege_type <> 'SELECT'
    )
  union all
  select 'table_public_anon_service_without_privileges',
    not exists (
      select 1 from table_acl cross join role_oids
      where grantee in (0, anon_oid, service_role_oid)
    )
  union all
  select 'function_inventory_exact',
    (select pg_catalog.count(*) from functions_target) = 3
    and exists (
      select 1 from functions_target
      where proname = 'save_training_workout_readiness_v2'
        and identity_args = 'p_workout_attempt_id uuid, p_cycle_id uuid, p_cycle_day_id uuid, p_workout_started_at timestamp with time zone, p_payload jsonb'
    )
    and exists (
      select 1 from functions_target
      where proname = 'link_training_workout_readiness_session_v2'
        and identity_args = 'p_workout_attempt_id uuid, p_training_session_id uuid'
    )
    and exists (
      select 1 from functions_target
      where proname = 'enforce_training_workout_readiness_payload_insert'
        and identity_args = ''
    )
  union all
  select 'rpc_owner_definer_bypassrls_search_path_empty',
    (select pg_catalog.count(*) from functions_target
      where proname in ('save_training_workout_readiness_v2', 'link_training_workout_readiness_session_v2')
        and owner_name = 'postgres'
        and owner_bypassrls
        and prosecdef
        and exists (
          select 1
          from pg_catalog.unnest(proconfig) as setting(value)
          where setting.value in ('search_path=', 'search_path=""')
        )
    ) = 2
  union all
  select 'rpc_authenticated_execute_only',
    not exists (
      select 1
      from functions_target as target
      where target.proname in ('save_training_workout_readiness_v2', 'link_training_workout_readiness_session_v2')
        and not exists (
          select 1 from function_acl cross join role_oids
          where function_acl.proname = target.proname
            and function_acl.identity_args = target.identity_args
            and function_acl.grantee = authenticated_oid
            and function_acl.privilege_type = 'EXECUTE'
        )
    )
    and not exists (
      select 1 from function_acl cross join role_oids
      where proname in ('save_training_workout_readiness_v2', 'link_training_workout_readiness_session_v2')
        and privilege_type = 'EXECUTE'
        and grantee in (0, anon_oid, service_role_oid)
    )
  union all
  select 'insert_guard_owner_invoker_closed_acl_search_path_empty',
    exists (
      select 1 from functions_target as target
      where target.proname = 'enforce_training_workout_readiness_payload_insert'
        and target.owner_name = 'postgres'
        and not target.prosecdef
        and exists (
          select 1
          from pg_catalog.unnest(target.proconfig) as setting(value)
          where setting.value in ('search_path=', 'search_path=""')
        )
    )
    and not exists (
      select 1 from function_acl cross join role_oids
      where proname = 'enforce_training_workout_readiness_payload_insert'
        and privilege_type = 'EXECUTE'
        and grantee in (0, authenticated_oid, anon_oid, service_role_oid)
    )
  union all
  select 'structural_insert_guard_present',
    (select pg_catalog.count(*) from trigger_state) = 1
    and exists (
      select 1 from trigger_state
      where not tgisinternal
        and tgfoid = pg_catalog.to_regprocedure('public.enforce_training_workout_readiness_payload_insert()')
        and (tgtype & 1) = 1
        and (tgtype & 2) = 2
        and (tgtype & 4) = 4
        and (tgtype & 16) = 0
    )
  union all
  select 'rpc_payload_contract_real',
    exists (
      select 1 from functions_target
      where proname = 'save_training_workout_readiness_v2'
        and prosrc ilike '%octet_length(p_payload::pg_catalog.text) > 1024%'
        and prosrc ilike '%p_payload <> pg_catalog.jsonb_build_object%'
        and prosrc ilike '%jsonb_build_object(''skipped'', true)%'
        and prosrc ilike '%not between 1 and 7%'
    )
  union all
  select 'rpc_quota_and_serialization_real',
    exists (
      select 1 from functions_target
      where proname = 'save_training_workout_readiness_v2'
        and prosrc ilike '%pg_advisory_xact_lock%'
        and prosrc ilike '%hashtextextended%'
        and prosrc ilike '%created_at >= v_now - interval ''36 hours''%'
        and prosrc ilike '%v_recent_attempt_count >= 32%'
        and prosrc ilike '%limit 32%'
        and pg_catalog.strpos(prosrc, 'pg_advisory_xact_lock') < pg_catalog.strpos(prosrc, 'select pg_catalog.count(*)')
        and pg_catalog.strpos(prosrc, 'select pg_catalog.count(*)') < pg_catalog.strpos(prosrc, 'insert into public.training_workout_readiness')
    )
  union all
  select 'rpc_active_context_and_row_locks_real',
    exists (
      select 1 from functions_target
      where proname = 'save_training_workout_readiness_v2'
        and prosrc ilike '%cycle.status = ''active''%'
        and prosrc ilike '%cycle.deleted_at is null%'
        and prosrc ilike '%day.cycle_id = p_cycle_id%'
        and prosrc ilike '%day.deleted_at is null%'
        and (pg_catalog.length(pg_catalog.lower(prosrc)) - pg_catalog.length(pg_catalog.replace(pg_catalog.lower(prosrc), 'for share', ''))) / pg_catalog.length('for share') >= 2
    )
  union all
  select 'protected_and_legacy_relations_present',
    pg_catalog.to_regclass('public.training_daily_readiness') is not null
    and pg_catalog.to_regclass('public.training_sessions') is not null
    and pg_catalog.to_regclass('public.exercise_entries') is not null
)
select
  case
    when pg_catalog.bool_and(checks.ok) then 'SEC_READINESS_01_QA_VERIFIED'
    else 'SEC_READINESS_01_QA_FAILED'
  end as verdict,
  pg_catalog.jsonb_object_agg(checks.check_name, checks.ok order by checks.check_name) as checks,
  (
    select pg_catalog.jsonb_build_object(
      'readiness_rows', historical_payload_counts.readiness_rows,
      'historical_payloads_over_1024_bytes', historical_payload_counts.historical_payloads_over_1024_bytes,
      'legacy_readiness_rows', protected_table_counts.legacy_readiness_rows,
      'training_session_rows', protected_table_counts.training_session_rows,
      'exercise_entry_rows', protected_table_counts.exercise_entry_rows
    )
    from historical_payload_counts
    cross join protected_table_counts
  ) as counts
from checks;

rollback;
