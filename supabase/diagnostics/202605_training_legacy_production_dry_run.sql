-- DRY-RUN READ-ONLY - PRODUCCION - NO MODIFICA DATOS.
-- Ejecutar solo para diagnostico read-only en Supabase Produccion.
-- No contiene sentencias de modificacion de datos ni estructura.
-- No hardcodea usuarios, emails ni UUIDs.
-- No es una migracion y no debe moverse a supabase/migrations.

begin;
set transaction read only;

with legacy_sessions as (
  select
    s.id,
    s.user_id,
    s.week_number,
    s.trained_at,
    s.created_at,
    s.routine_id,
    s.calendar_week_start,
    s.planned_day,
    s.planned_date,
    s.trained_date,
    s.deleted_at
  from public.training_sessions s
  where s.deleted_at is null
    and (
      s.routine_id is null
      or s.trained_date is null
      or s.calendar_week_start is null
      or s.planned_day is null
      or s.planned_date is null
    )
),
legacy_group_details as (
  select
    ls.user_id,
    ls.trained_at,
    ls.week_number,
    array_agg(ls.id order by ls.created_at, ls.id) as legacy_session_ids,
    array_agg(e.id order by e.id) filter (where e.id is not null) as entry_ids,
    count(distinct ls.id) as legacy_session_count,
    count(e.id) as entry_count,
    count(distinct e.exercise_id) as distinct_exercise_count,
    (
      array_agg(distinct ex.routine_id::text order by ex.routine_id::text)
        filter (where ex.routine_id is not null)
    )[1]::uuid as inferred_routine_id,
    count(distinct ex.routine_id) filter (where ex.routine_id is not null) as routine_count,
    min(ex.day) filter (where ex.day is not null and btrim(ex.day) <> '') as inferred_planned_day,
    count(distinct ex.day) filter (where ex.day is not null and btrim(ex.day) <> '') as planned_day_count,
    count(*) filter (where e.id is null) as sessions_without_entries,
    count(*) filter (where e.id is not null and ex.id is null) as orphan_entry_count,
    count(*) filter (
      where e.id is not null
        and (
          e.user_id <> ls.user_id
          or ex.user_id is null
          or ex.user_id <> ls.user_id
        )
    ) as ownership_issue_count
  from legacy_sessions ls
  left join public.exercise_entries e on e.session_id = ls.id
  left join public.exercises ex on ex.id = e.exercise_id
  group by ls.user_id, ls.trained_at, ls.week_number
),
planned_day_normalized as (
  select
    g.*,
    g.legacy_session_ids[1] as canonical_session_id,
    case lower(btrim(g.inferred_planned_day))
      when 'lunes' then 'monday'
      when 'martes' then 'tuesday'
      when 'miercoles' then 'wednesday'
      when U&'mi\00E9rcoles' then 'wednesday'
      when 'jueves' then 'thursday'
      when 'viernes' then 'friday'
      when 'sabado' then 'saturday'
      when U&'s\00E1bado' then 'saturday'
      when 'domingo' then 'sunday'
      else null
    end as inferred_planned_day_code,
    g.trained_at::date as inferred_trained_date,
    (
      g.trained_at::date - (extract(isodow from g.trained_at::date)::integer - 1)
    )::date as inferred_calendar_week_start
  from legacy_group_details g
),
candidate_analysis as (
  select
    p.*,
    case p.inferred_planned_day_code
      when 'monday' then p.inferred_calendar_week_start
      when 'tuesday' then p.inferred_calendar_week_start + 1
      when 'wednesday' then p.inferred_calendar_week_start + 2
      when 'thursday' then p.inferred_calendar_week_start + 3
      when 'friday' then p.inferred_calendar_week_start + 4
      when 'saturday' then p.inferred_calendar_week_start + 5
      when 'sunday' then p.inferred_calendar_week_start + 6
      else null
    end as inferred_planned_date,
    case
      when p.legacy_session_count < 2 then 'reject_not_legacy_multi_session'
      when p.entry_count = 0 then 'reject_no_entries'
      when p.entry_count <> p.distinct_exercise_count then 'reject_duplicate_exercise_entries'
      when p.routine_count <> 1 then 'reject_ambiguous_routine'
      when p.planned_day_count <> 1 then 'reject_ambiguous_day'
      when p.sessions_without_entries <> 0 then 'reject_sessions_without_entries'
      when p.orphan_entry_count <> 0 then 'reject_orphan_entries'
      when p.ownership_issue_count <> 0 then 'reject_ownership_issues'
      when p.inferred_planned_day_code is null then 'reject_planned_day_not_inferable'
      else 'consolidation_candidate'
    end as classification
  from planned_day_normalized p
),
entries_to_soft_deleted_sessions as (
  select count(*) as issue_count
  from public.exercise_entries e
  join public.training_sessions s on s.id = e.session_id
  where s.deleted_at is not null
),
audit_table_state as (
  select to_regclass('public.training_session_consolidation_audit') is not null as audit_table_exists
),
metrics_by_user as (
  select
    ca.user_id,
    count(*) as group_count,
    coalesce(sum(ca.legacy_session_count), 0) as legacy_session_count,
    coalesce(sum(ca.entry_count), 0) as entry_count,
    coalesce(sum(reps_totals.total_reps), 0) as total_reps,
    coalesce(sum(reps_totals.volume_total), 0) as volume_total
  from candidate_analysis ca
  left join lateral (
    select
      coalesce(sum(rep_value), 0) as total_reps,
      coalesce(sum(e.weight * rep_value), 0) as volume_total
    from public.exercise_entries e
    cross join lateral unnest(e.reps) as rep_value
    where e.id = any(ca.entry_ids)
  ) reps_totals on true
  group by ca.user_id
)
select
  'summary' as section,
  jsonb_build_object(
    'legacy_group_count', (select count(*) from candidate_analysis),
    'legacy_training_sessions', (select coalesce(sum(legacy_session_count), 0) from candidate_analysis),
    'legacy_exercise_entries', (select coalesce(sum(entry_count), 0) from candidate_analysis),
    'affected_users', (select count(distinct user_id) from candidate_analysis),
    'consolidation_candidates', (
      select count(*)
      from candidate_analysis
      where classification = 'consolidation_candidate'
    ),
    'non_candidates', (
      select count(*)
      from candidate_analysis
      where classification <> 'consolidation_candidate'
    ),
    'orphan_entries', (select coalesce(sum(orphan_entry_count), 0) from candidate_analysis),
    'ownership_issues', (select coalesce(sum(ownership_issue_count), 0) from candidate_analysis),
    'mixed_routine_groups', (
      select count(*)
      from candidate_analysis
      where routine_count <> 1
    ),
    'mixed_day_groups', (
      select count(*)
      from candidate_analysis
      where planned_day_count <> 1
    ),
    'planned_day_not_inferable', (
      select count(*)
      from candidate_analysis
      where inferred_planned_day_code is null
    ),
    'planned_date_not_inferable', (
      select count(*)
      from candidate_analysis
      where inferred_planned_date is null
    ),
    'sessions_without_entries', (select coalesce(sum(sessions_without_entries), 0) from candidate_analysis),
    'entries_to_soft_deleted_sessions', (select issue_count from entries_to_soft_deleted_sessions),
    'audit_table_exists', (select audit_table_exists from audit_table_state),
    'active_audit_pending_or_executed', 'run optional audit query if audit_table_exists is true'
  ) as result
union all
select
  'classification_counts' as section,
  jsonb_object_agg(classification, classification_count order by classification) as result
from (
  select classification, count(*) as classification_count
  from candidate_analysis
  group by classification
) counts
union all
select
  'impact_by_group' as section,
  jsonb_agg(
    jsonb_build_object(
      'user_ref', 'USER_' || dense_rank_value::text,
      'trained_at', trained_at,
      'week_number', week_number,
      'classification', classification,
      'legacy_session_count', legacy_session_count,
      'entry_count', entry_count,
      'distinct_exercise_count', distinct_exercise_count,
      'routine_count', routine_count,
      'planned_day_count', planned_day_count,
      'inferred_planned_day', inferred_planned_day,
      'inferred_planned_day_code', inferred_planned_day_code,
      'inferred_trained_date', inferred_trained_date,
      'inferred_calendar_week_start', inferred_calendar_week_start,
      'inferred_planned_date', inferred_planned_date,
      'sessions_without_entries', sessions_without_entries,
      'orphan_entry_count', orphan_entry_count,
      'ownership_issue_count', ownership_issue_count
    )
    order by trained_at, week_number, dense_rank_value
  ) as result
from (
  select
    ca.*,
    dense_rank() over (order by ca.user_id) as dense_rank_value
  from candidate_analysis ca
) anonymized_groups
union all
select
  'impact_by_user_anonymized' as section,
  jsonb_agg(
    jsonb_build_object(
      'user_ref', 'USER_' || dense_rank_value::text,
      'group_count', group_count,
      'legacy_session_count', legacy_session_count,
      'entry_count', entry_count,
      'total_reps', total_reps,
      'volume_total', volume_total
    )
    order by dense_rank_value
  ) as result
from (
  select
    m.*,
    dense_rank() over (order by m.user_id) as dense_rank_value
  from metrics_by_user m
) anonymized_users;

rollback;
