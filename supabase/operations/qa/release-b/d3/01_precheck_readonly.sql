-- Release B - D3 - QA precheck read-only.
-- Ejecutar solo en Supabase QA: fjjebhaqtrdbpxzxztmh.
-- No imprime UUIDs ni payloads.

begin transaction read only;

with table_counts as (
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
candidate_recent_sessions as (
  select session.id
  from public.training_sessions as session
  join public.training_cycles as cycle
    on cycle.id = session.cycle_id
   and cycle.user_id = session.user_id
  join public.training_cycle_days as cycle_day
    on cycle_day.id = session.cycle_day_id
   and cycle_day.cycle_id = session.cycle_id
  left join public.training_workout_readiness as readiness
    on readiness.training_session_id = session.id
  where session.deleted_at is null
    and session.cycle_id is not null
    and session.cycle_day_id is not null
    and session.created_at >= now() - interval '35 hours'
    and session.created_at <= now() + interval '5 minutes'
    and cycle.deleted_at is null
    and cycle_day.deleted_at is null
    and readiness.id is null
),
candidate_counts as (
  select count(*) as candidate_recent_sessions
  from candidate_recent_sessions
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
  select 'training_workout_readiness_empty', training_workout_readiness_rows = 0 from table_counts
  union all
  select 'candidate_recent_sessions_available', candidate_recent_sessions > 0 from candidate_counts
),
counts as (
  select
    candidate_counts.candidate_recent_sessions,
    table_counts.training_workout_readiness_rows,
    table_counts.legacy_training_daily_readiness_rows
  from candidate_counts
  cross join table_counts
)
select
  case when bool_and(checks.ok) then 'D3_QA_READY' else 'D3_QA_NOT_READY' end as verdict,
  jsonb_object_agg(checks.check_name, checks.ok order by checks.check_name) as checks,
  (select to_jsonb(counts) from counts) as counts
from checks;

rollback;