-- Release B - Fase D1 - QA postcheck read-only.
-- Ejecutar solo en Supabase QA: fjjebhaqtrdbpxzxztmh.

begin transaction read only;

select current_setting('transaction_read_only') as transaction_read_only;

with target_function as (
  select p.oid, p.proacl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'save_daily_training_readiness'
    and pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb'
),
explicit_function_acl as (
  select
    acl.grantee,
    acl.privilege_type
  from target_function f
  cross join lateral aclexplode(coalesce(f.proacl, '{}'::aclitem[])) as acl
),
role_oids as (
  select
    (select oid from pg_roles where rolname = 'authenticated') as authenticated_oid,
    (select oid from pg_roles where rolname = 'anon') as anon_oid,
    (select oid from pg_roles where rolname = 'service_role') as service_role_oid
),
checks as (
  select 'cycle_day_id_absent' as check_name,
    not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'training_daily_readiness'
        and column_name = 'cycle_day_id'
    ) as ok
  union all
  select 'residual_fk_absent',
    not exists (
      select 1
      from pg_constraint
      where conname = 'training_daily_readiness_cycle_day_user_fk'
    )
  union all
  select 'partial_scoped_unique_absent',
    not exists (
      select 1
      from pg_class
      where relname = 'training_daily_readiness_user_local_date_cycle_day_key'
    )
  union all
  select 'partial_legacy_unique_absent',
    not exists (
      select 1
      from pg_class
      where relname = 'training_daily_readiness_user_local_date_legacy_key'
    )
  union all
  select 'user_cycle_day_idx_absent',
    not exists (
      select 1
      from pg_class
      where relname = 'training_daily_readiness_user_cycle_day_idx'
    )
  union all
  select 'training_cycle_days_user_id_id_unique_absent',
    not exists (
      select 1
      from pg_constraint
      where conname = 'training_cycle_days_user_id_id_unique'
    )
  union all
  select 'training_workout_readiness_absent',
    to_regclass('public.training_workout_readiness') is null
  union all
  select 'global_legacy_unique_present',
    exists (
      select 1
      from pg_constraint
      where conname = 'training_daily_readiness_user_local_date_key'
    )
  union all
  select 'rpc_legacy_signature_present',
    (
      select count(*)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'save_daily_training_readiness'
        and pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb'
    ) = 1
  union all
  select 'rpc_variable_conflict_absent',
    not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'save_daily_training_readiness'
        and pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb'
        and pg_get_functiondef(p.oid) ilike '%#variable_conflict use_column%'
    )
  union all
  select 'authenticated_execute_true',
    exists (
      select 1
      from explicit_function_acl acl
      cross join role_oids roles
      where acl.grantee = roles.authenticated_oid
        and acl.privilege_type = 'EXECUTE'
    )
  union all
  select 'anon_execute_false',
    not exists (
      select 1
      from explicit_function_acl acl
      cross join role_oids roles
      where acl.grantee = roles.anon_oid
        and acl.privilege_type = 'EXECUTE'
    )
  union all
  select 'public_execute_false',
    not exists (
      select 1
      from explicit_function_acl acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    )
  union all
  select 'service_role_execute_false',
    not exists (
      select 1
      from explicit_function_acl acl
      cross join role_oids roles
      where acl.grantee = roles.service_role_oid
        and acl.privilege_type = 'EXECUTE'
    )
),
readiness_counts as (
  select count(*) as total_rows
  from public.training_daily_readiness
),
duplicate_counts as (
  select count(*) as duplicate_user_local_date_groups
  from (
    select user_id, local_date
    from public.training_daily_readiness
    group by user_id, local_date
    having count(*) > 1
  ) duplicates
)
select
  case
    when bool_and(checks.ok)
      and (select total_rows from readiness_counts) = 3
      and (select duplicate_user_local_date_groups from duplicate_counts) = 0
    then 'QA_NORMALIZATION_VERIFIED'
    else 'QA_NORMALIZATION_FAILED'
  end as verdict,
  jsonb_object_agg(checks.check_name, checks.ok order by checks.check_name) as checks,
  (select to_jsonb(readiness_counts) from readiness_counts) as readiness_counts,
  (select to_jsonb(duplicate_counts) from duplicate_counts) as duplicate_counts
from checks;

rollback;
