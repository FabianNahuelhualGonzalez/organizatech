-- Release B - Fase D1 - QA precheck read-only.
-- Ejecutar solo en Supabase QA: fjjebhaqtrdbpxzxztmh.

begin transaction read only;

select current_setting('transaction_read_only') as transaction_read_only;

with checks as (
  select 'training_daily_readiness_exists' as check_name,
    (to_regclass('public.training_daily_readiness') is not null) as ok
  union all
  select 'training_workout_readiness_absent',
    (to_regclass('public.training_workout_readiness') is null)
  union all
  select 'training_daily_readiness_cycle_day_id_present',
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'training_daily_readiness'
        and column_name = 'cycle_day_id'
    )
  union all
  select 'residual_fk_present',
    exists (
      select 1
      from pg_constraint
      where conname = 'training_daily_readiness_cycle_day_user_fk'
    )
  union all
  select 'user_cycle_day_idx_present',
    exists (
      select 1
      from pg_class
      where relname = 'training_daily_readiness_user_cycle_day_idx'
    )
  union all
  select 'scoped_partial_unique_present',
    exists (
      select 1
      from pg_class
      where relname = 'training_daily_readiness_user_local_date_cycle_day_key'
    )
  union all
  select 'legacy_partial_unique_present',
    exists (
      select 1
      from pg_class
      where relname = 'training_daily_readiness_user_local_date_legacy_key'
    )
  union all
  select 'training_cycle_days_user_id_id_unique_present',
    exists (
      select 1
      from pg_constraint
      where conname = 'training_cycle_days_user_id_id_unique'
    )
  union all
  select 'global_legacy_unique_absent',
    not exists (
      select 1
      from pg_constraint
      where conname = 'training_daily_readiness_user_local_date_key'
    )
  union all
  select 'single_rpc_signature',
    (
      select count(*)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'save_daily_training_readiness'
        and pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb'
    ) = 1
  union all
  select 'rpc_has_variable_conflict_directive',
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'save_daily_training_readiness'
        and pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb'
        and pg_get_functiondef(p.oid) ilike '%#variable_conflict use_column%'
    )
),
readiness_counts as (
  select
    count(*) as total_rows,
    count(*) filter (where cycle_day_id is not null) as rows_with_cycle_day_id,
    count(*) filter (where cycle_day_id is null) as rows_without_cycle_day_id
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
      and (select rows_with_cycle_day_id from readiness_counts) = 1
      and (select rows_without_cycle_day_id from readiness_counts) = 2
      and (select duplicate_user_local_date_groups from duplicate_counts) = 0
    then 'READY_TO_NORMALIZE_QA'
    else 'NOT_READY_TO_NORMALIZE_QA'
  end as verdict,
  jsonb_object_agg(checks.check_name, checks.ok order by checks.check_name) as checks,
  (select to_jsonb(readiness_counts) from readiness_counts) as readiness_counts,
  (select to_jsonb(duplicate_counts) from duplicate_counts) as duplicate_counts
from checks;

rollback;
