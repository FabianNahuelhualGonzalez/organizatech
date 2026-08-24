-- SEC-READINESS-01 - QA precheck, strictly read-only.
-- Run only after a human confirms the QA project. Never run in Production.
-- The result exposes booleans and aggregate counts, never UUIDs or payloads.

begin transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '3s';

with table_target as (
  select
    relation.oid,
    relation.relowner,
    relation.relacl,
    relation.relrowsecurity
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = relation.relnamespace
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
  select policy.polcmd, policy.polroles
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
    pg_catalog.pg_get_function_identity_arguments(procedure.oid) as identity_args
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname in (
      'save_training_workout_readiness_v2',
      'link_training_workout_readiness_session_v2'
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
guard_state as (
  select
    pg_catalog.to_regprocedure('public.enforce_training_workout_readiness_payload_insert()') is not null as guard_function_present,
    exists (
      select 1
      from pg_catalog.pg_trigger as trigger
      where trigger.tgrelid = pg_catalog.to_regclass('public.training_workout_readiness')
        and trigger.tgname = 'training_workout_readiness_payload_insert_guard'
        and not trigger.tgisinternal
    ) as guard_trigger_present
),
candidate_contexts as (
  select distinct on (cycle.user_id)
    cycle.user_id,
    cycle.id as cycle_id,
    cycle_day.id as cycle_day_id,
    session.id as training_session_id,
    session.created_at as session_created_at,
    (
      select pg_catalog.count(*)
      from public.training_workout_readiness as readiness
      where readiness.user_id = cycle.user_id
        and readiness.created_at >= pg_catalog.clock_timestamp() - interval '36 hours'
    ) as recent_attempts
  from public.training_cycles as cycle
  join public.training_cycle_days as cycle_day
    on cycle_day.cycle_id = cycle.id
   and cycle_day.user_id = cycle.user_id
   and cycle_day.deleted_at is null
  join public.training_sessions as session
    on session.user_id = cycle.user_id
   and session.cycle_id = cycle.id
   and session.cycle_day_id = cycle_day.id
   and session.deleted_at is null
   and session.created_at >= pg_catalog.clock_timestamp() - interval '35 hours'
   and session.created_at <= pg_catalog.clock_timestamp() + interval '5 minutes'
  left join public.training_workout_readiness as linked_readiness
    on linked_readiness.training_session_id = session.id
  where cycle.status = 'active'
    and cycle.deleted_at is null
    and linked_readiness.id is null
    and (
      select pg_catalog.count(*)
      from public.training_workout_readiness as readiness
      where readiness.user_id = cycle.user_id
        and readiness.created_at >= pg_catalog.clock_timestamp() - interval '36 hours'
    ) < 32
  order by cycle.user_id, session.created_at desc, session.id
),
candidate_counts as (
  select
    pg_catalog.count(*) as candidate_users,
    pg_catalog.count(distinct user_id) as distinct_candidate_users,
    coalesce(pg_catalog.max(recent_attempts), 0) as max_candidate_recent_attempts
  from candidate_contexts
),
historical_payload_counts as (
  select
    pg_catalog.count(*) as readiness_rows,
    pg_catalog.count(*) filter (
      where (
        case
          when pg_catalog.jsonb_typeof(readiness.payload) is distinct from 'object' then false
          when pg_catalog.octet_length(readiness.payload::pg_catalog.text) > 1024 then false
          when readiness.payload->'skipped' = 'true'::pg_catalog.jsonb then
            readiness.payload = pg_catalog.jsonb_build_object('skipped', true)
          when readiness.payload->'skipped' = 'false'::pg_catalog.jsonb then
            case
              when readiness.payload <> pg_catalog.jsonb_build_object(
                'skipped', false,
                'motivation', readiness.payload->'motivation',
                'hydration', readiness.payload->'hydration',
                'sleep', readiness.payload->'sleep',
                'energy', readiness.payload->'energy'
              ) then false
              when pg_catalog.jsonb_typeof(readiness.payload->'motivation') is distinct from 'number' then false
              when pg_catalog.jsonb_typeof(readiness.payload->'hydration') is distinct from 'number' then false
              when pg_catalog.jsonb_typeof(readiness.payload->'sleep') is distinct from 'number' then false
              when pg_catalog.jsonb_typeof(readiness.payload->'energy') is distinct from 'number' then false
              else
                (readiness.payload->>'motivation')::pg_catalog.numeric between 1 and 7
                and (readiness.payload->>'hydration')::pg_catalog.numeric between 1 and 7
                and (readiness.payload->>'sleep')::pg_catalog.numeric between 1 and 7
                and (readiness.payload->>'energy')::pg_catalog.numeric between 1 and 7
                and pg_catalog.trunc((readiness.payload->>'motivation')::pg_catalog.numeric) = (readiness.payload->>'motivation')::pg_catalog.numeric
                and pg_catalog.trunc((readiness.payload->>'hydration')::pg_catalog.numeric) = (readiness.payload->>'hydration')::pg_catalog.numeric
                and pg_catalog.trunc((readiness.payload->>'sleep')::pg_catalog.numeric) = (readiness.payload->>'sleep')::pg_catalog.numeric
                and pg_catalog.trunc((readiness.payload->>'energy')::pg_catalog.numeric) = (readiness.payload->>'energy')::pg_catalog.numeric
            end
          else false
        end
      ) is not true
    ) as historical_payloads_outside_new_contract
  from public.training_workout_readiness as readiness
),
protected_table_counts as (
  select
    (select pg_catalog.count(*) from public.training_daily_readiness) as legacy_readiness_rows,
    (select pg_catalog.count(*) from public.training_sessions) as training_session_rows,
    (select pg_catalog.count(*) from public.exercise_entries) as exercise_entry_rows
),
checks as (
  select 'table_present' as check_name,
    pg_catalog.to_regclass('public.training_workout_readiness') is not null as ok
  union all
  select 'pre_migration_guard_absent',
    not guard_function_present and not guard_trigger_present
  from guard_state
  union all
  select 'rls_enabled',
    coalesce((select relrowsecurity from table_target), false)
  union all
  select 'single_select_policy_no_write_policies',
    (select pg_catalog.count(*) from policy_info) = 1
    and (select pg_catalog.count(*) from policy_info where polcmd = 'r') = 1
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
  select 'rpc_signatures_exact',
    (select pg_catalog.count(*) from functions_target) = 2
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
  union all
  select 'rpc_security_definer',
    (select pg_catalog.count(*) from functions_target where prosecdef) = 2
  union all
  select 'rpc_authenticated_execute_only',
    not exists (
      select 1
      from functions_target as target
      where not exists (
        select 1 from function_acl cross join role_oids
        where function_acl.proname = target.proname
          and function_acl.identity_args = target.identity_args
          and function_acl.grantee = authenticated_oid
          and function_acl.privilege_type = 'EXECUTE'
      )
    )
    and not exists (
      select 1 from function_acl cross join role_oids
      where privilege_type = 'EXECUTE'
        and grantee in (0, anon_oid, service_role_oid)
    )
  union all
  select 'two_distinct_material_candidates',
    candidate_users >= 2 and distinct_candidate_users >= 2
  from candidate_counts
  union all
  select 'candidate_quota_headroom',
    max_candidate_recent_attempts < 32
  from candidate_counts
  union all
  select 'legacy_and_protected_tables_present',
    pg_catalog.to_regclass('public.training_daily_readiness') is not null
    and pg_catalog.to_regclass('public.training_sessions') is not null
    and pg_catalog.to_regclass('public.exercise_entries') is not null
)
select
  case
    when pg_catalog.bool_and(checks.ok) then 'SEC_READINESS_01_QA_READY'
    else 'SEC_READINESS_01_QA_NOT_READY'
  end as verdict,
  pg_catalog.jsonb_object_agg(checks.check_name, checks.ok order by checks.check_name) as checks,
  (
    select pg_catalog.jsonb_build_object(
      'candidate_users', candidate_counts.candidate_users,
      'max_candidate_recent_attempts', candidate_counts.max_candidate_recent_attempts,
      'readiness_rows', historical_payload_counts.readiness_rows,
      'historical_payloads_outside_new_contract', historical_payload_counts.historical_payloads_outside_new_contract,
      'legacy_readiness_rows', protected_table_counts.legacy_readiness_rows,
      'training_session_rows', protected_table_counts.training_session_rows,
      'exercise_entry_rows', protected_table_counts.exercise_entry_rows
    )
    from candidate_counts
    cross join historical_payload_counts
    cross join protected_table_counts
  ) as counts
from checks;

rollback;
