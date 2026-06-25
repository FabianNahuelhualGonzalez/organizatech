-- Release B - D3 - QA postcheck read-only.
-- Ejecutar despues de 02_rpc_functional_transaction.sql solo en Supabase QA.
-- No imprime UUIDs ni payloads.

begin transaction read only;

with row_counts as (
  select
    (select count(*) from public.training_workout_readiness) as training_workout_readiness_rows,
    (select count(*) from public.training_daily_readiness) as legacy_training_daily_readiness_rows
),
function_checks as (
  select
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'save_training_workout_readiness_v2'
        and pg_get_function_identity_arguments(p.oid) = 'p_workout_attempt_id uuid, p_cycle_id uuid, p_cycle_day_id uuid, p_workout_started_at timestamp with time zone, p_payload jsonb'
    ) as save_v2_present,
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'link_training_workout_readiness_session_v2'
        and pg_get_function_identity_arguments(p.oid) = 'p_workout_attempt_id uuid, p_training_session_id uuid'
    ) as link_v2_present,
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'save_daily_training_readiness'
        and pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb'
    ) as legacy_save_rpc_present
),
checks as (
  select 'training_workout_readiness_present' as check_name,
    to_regclass('public.training_workout_readiness') is not null as ok
  union all
  select 'training_daily_readiness_present',
    to_regclass('public.training_daily_readiness') is not null
  union all
  select 'save_v2_present', save_v2_present from function_checks
  union all
  select 'link_v2_present', link_v2_present from function_checks
  union all
  select 'legacy_save_rpc_present', legacy_save_rpc_present from function_checks
  union all
  select 'training_workout_readiness_empty_after_rollback', training_workout_readiness_rows = 0 from row_counts
)
select
  case when bool_and(checks.ok) then 'D3_QA_ROLLBACK_VERIFIED' else 'D3_QA_ROLLBACK_FAILED' end as verdict,
  jsonb_object_agg(checks.check_name, checks.ok order by checks.check_name) as checks,
  (select to_jsonb(row_counts) from row_counts) as row_counts
from checks;

rollback;