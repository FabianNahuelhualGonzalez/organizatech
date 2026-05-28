-- PLAN / BORRADOR PARA AUDITORIA - NO EJECUTAR.
-- Este archivo es solo plan tecnico read-only. No ejecutar como migracion. No modifica datos.
-- Todas las consultas son SELECT para revisar candidatos de consolidacion legacy.
-- Produccion no debe tocarse sin auditoria, validacion QA y aprobacion explicita.

-- 1) Grupos legacy agrupados por usuario, trained_at y week_number.
-- Objetivo: identificar si cada grupo representa un entrenamiento real consolidable.
with legacy_groups as (
  select
    s.user_id,
    s.trained_at,
    s.week_number,
    count(distinct s.id) as legacy_session_count,
    count(e.id) as entry_count,
    count(distinct e.exercise_id) as distinct_exercise_count,
    count(distinct ex.routine_id) filter (where ex.routine_id is not null) as routine_count,
    count(distinct ex.day) filter (where ex.day is not null and btrim(ex.day) <> '') as planned_day_count,
    count(*) filter (where e.id is null) as sessions_without_entries,
    count(*) filter (where ex.id is null and e.id is not null) as orphan_entry_count,
    count(*) filter (
      where e.id is not null
        and (
          e.user_id <> s.user_id
          or ex.user_id is null
          or ex.user_id <> s.user_id
        )
    ) as ownership_issue_count
  from public.training_sessions s
  left join public.exercise_entries e on e.session_id = s.id
  left join public.exercises ex on ex.id = e.exercise_id
  where s.routine_id is null
     or s.trained_date is null
     or s.calendar_week_start is null
     or s.planned_day is null
     or s.planned_date is null
  group by s.user_id, s.trained_at, s.week_number
)
select
  user_id,
  trained_at,
  week_number,
  legacy_session_count,
  entry_count,
  distinct_exercise_count,
  routine_count,
  planned_day_count,
  sessions_without_entries,
  orphan_entry_count,
  ownership_issue_count,
  case
    when legacy_session_count < 2 then 'not_duplicate_group'
    when entry_count = 0 then 'reject_no_entries'
    when entry_count <> distinct_exercise_count then 'reject_duplicate_exercises'
    when routine_count <> 1 then 'reject_ambiguous_routine'
    when planned_day_count <> 1 then 'reject_ambiguous_day'
    when sessions_without_entries > 0 then 'reject_session_without_entries'
    when orphan_entry_count > 0 then 'reject_orphan_entries'
    when ownership_issue_count > 0 then 'reject_ownership_issue'
    else 'consolidation_candidate'
  end as consolidation_status
from legacy_groups
order by trained_at desc, user_id, week_number;

-- 2) Candidatos consolidables con campos inferidos.
-- planned_day se deja como valor actual de exercises.day para auditoria.
-- Si se aprueba ejecucion futura, debe mapearse al codigo tecnico esperado por training_sessions.
with legacy_group_details as (
  select
    s.user_id,
    s.trained_at,
    s.week_number,
    array(
      select s_ids.id
      from public.training_sessions s_ids
      where s_ids.user_id = s.user_id
        and s_ids.trained_at = s.trained_at
        and s_ids.week_number = s.week_number
        and (
          s_ids.routine_id is null
          or s_ids.trained_date is null
          or s_ids.calendar_week_start is null
          or s_ids.planned_day is null
          or s_ids.planned_date is null
        )
      order by s_ids.created_at, s_ids.id
    ) as legacy_session_ids,
    array_agg(e.id order by e.id) filter (where e.id is not null) as entry_ids,
    min(s.created_at) as first_session_created_at,
    count(distinct s.id) as legacy_session_count,
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
    count(*) filter (where ex.id is null and e.id is not null) as orphan_entry_count,
    count(*) filter (
      where e.id is not null
        and (
          e.user_id <> s.user_id
          or ex.user_id is null
          or ex.user_id <> s.user_id
        )
    ) as ownership_issue_count
  from public.training_sessions s
  left join public.exercise_entries e on e.session_id = s.id
  left join public.exercises ex on ex.id = e.exercise_id
  where s.routine_id is null
     or s.trained_date is null
     or s.calendar_week_start is null
     or s.planned_day is null
     or s.planned_date is null
  group by s.user_id, s.trained_at, s.week_number
),
consolidation_candidates as (
  select *
  from legacy_group_details
  where legacy_session_count >= 2
    and entry_count > 0
    and entry_count = distinct_exercise_count
    and routine_count = 1
    and planned_day_count = 1
    and sessions_without_entries = 0
    and orphan_entry_count = 0
    and ownership_issue_count = 0
),
canonical_selection as (
  select
    c.*,
    (
      select s2.id
      from public.training_sessions s2
      where s2.user_id = c.user_id
        and s2.trained_at = c.trained_at
        and s2.week_number = c.week_number
      order by s2.created_at, s2.id
      limit 1
    ) as canonical_session_id
  from consolidation_candidates c
),
planned_day_normalized as (
  select
    cs.*,
    case lower(btrim(cs.inferred_planned_day))
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
    end as inferred_planned_day_code
  from canonical_selection cs
)
select
  user_id,
  concat(user_id::text, ':', trained_at::text, ':', week_number::text) as legacy_group_key,
  canonical_session_id,
  legacy_session_ids,
  entry_ids,
  inferred_routine_id,
  inferred_planned_day,
  inferred_planned_day_code,
  trained_at::date as inferred_trained_date,
  (
    trained_at::date - (extract(isodow from trained_at::date)::integer - 1)
  )::date as inferred_calendar_week_start,
  case inferred_planned_day_code
    when 'monday' then (trained_at::date - (extract(isodow from trained_at::date)::integer - 1))::date
    when 'tuesday' then (trained_at::date - (extract(isodow from trained_at::date)::integer - 1) + 1)::date
    when 'wednesday' then (trained_at::date - (extract(isodow from trained_at::date)::integer - 1) + 2)::date
    when 'thursday' then (trained_at::date - (extract(isodow from trained_at::date)::integer - 1) + 3)::date
    when 'friday' then (trained_at::date - (extract(isodow from trained_at::date)::integer - 1) + 4)::date
    when 'saturday' then (trained_at::date - (extract(isodow from trained_at::date)::integer - 1) + 5)::date
    when 'sunday' then (trained_at::date - (extract(isodow from trained_at::date)::integer - 1) + 6)::date
    else null
  end as inferred_planned_date,
  'completed' as inferred_status,
  first_session_created_at
from planned_day_normalized
order by inferred_trained_date desc, user_id, week_number;

-- 3) Vista conceptual del mapeo de entries hacia sesion canonica.
-- Esta consulta NO mueve entries. Solo muestra que entry_id apuntaria conceptualmente al canonical_session_id.
with candidate_groups as (
  select
    s.user_id,
    s.trained_at,
    s.week_number,
    (
      select s2.id
      from public.training_sessions s2
      where s2.user_id = s.user_id
        and s2.trained_at = s.trained_at
        and s2.week_number = s.week_number
        and (
          s2.routine_id is null
          or s2.trained_date is null
          or s2.calendar_week_start is null
          or s2.planned_day is null
          or s2.planned_date is null
        )
      order by s2.created_at, s2.id
      limit 1
    ) as canonical_session_id,
    count(distinct s.id) as legacy_session_count,
    count(e.id) as entry_count,
    count(distinct e.exercise_id) as distinct_exercise_count,
    count(distinct ex.routine_id) filter (where ex.routine_id is not null) as routine_count,
    count(distinct ex.day) filter (where ex.day is not null and btrim(ex.day) <> '') as planned_day_count,
    count(*) filter (where e.id is null) as sessions_without_entries,
    count(*) filter (where ex.id is null and e.id is not null) as orphan_entry_count,
    count(*) filter (
      where e.id is not null
        and (
          e.user_id <> s.user_id
          or ex.user_id is null
          or ex.user_id <> s.user_id
        )
    ) as ownership_issue_count
  from public.training_sessions s
  left join public.exercise_entries e on e.session_id = s.id
  left join public.exercises ex on ex.id = e.exercise_id
  where s.routine_id is null
     or s.trained_date is null
     or s.calendar_week_start is null
     or s.planned_day is null
     or s.planned_date is null
  group by s.user_id, s.trained_at, s.week_number
),
valid_groups as (
  select *
  from candidate_groups
  where legacy_session_count >= 2
    and entry_count > 0
    and entry_count = distinct_exercise_count
    and routine_count = 1
    and planned_day_count = 1
    and sessions_without_entries = 0
    and orphan_entry_count = 0
    and ownership_issue_count = 0
)
select
  e.id as entry_id,
  e.session_id as current_session_id,
  vg.canonical_session_id as proposed_canonical_session_id,
  e.user_id,
  vg.trained_at,
  vg.week_number,
  e.exercise_id
from valid_groups vg
join public.training_sessions s on s.user_id = vg.user_id
  and s.trained_at = vg.trained_at
  and s.week_number = vg.week_number
  and (
    s.routine_id is null
    or s.trained_date is null
    or s.calendar_week_start is null
    or s.planned_day is null
    or s.planned_date is null
  )
join public.exercise_entries e on e.session_id = s.id
order by vg.trained_at desc, e.user_id, e.id;

-- 4) Sesiones no canonicas que se marcarian logicamente en una fase futura.
-- Esta consulta NO marca deleted_at. Solo muestra candidatas a quedar inactivas.
with valid_groups as (
  select
    s.user_id,
    s.trained_at,
    s.week_number,
    (
      select s2.id
      from public.training_sessions s2
      where s2.user_id = s.user_id
        and s2.trained_at = s.trained_at
        and s2.week_number = s.week_number
        and (
          s2.routine_id is null
          or s2.trained_date is null
          or s2.calendar_week_start is null
          or s2.planned_day is null
          or s2.planned_date is null
        )
      order by s2.created_at, s2.id
      limit 1
    ) as canonical_session_id,
    count(distinct s.id) as legacy_session_count,
    count(e.id) as entry_count,
    count(distinct e.exercise_id) as distinct_exercise_count,
    count(distinct ex.routine_id) filter (where ex.routine_id is not null) as routine_count,
    count(distinct ex.day) filter (where ex.day is not null and btrim(ex.day) <> '') as planned_day_count,
    count(*) filter (where e.id is null) as sessions_without_entries,
    count(*) filter (where ex.id is null and e.id is not null) as orphan_entry_count,
    count(*) filter (
      where e.id is not null
        and (
          e.user_id <> s.user_id
          or ex.user_id is null
          or ex.user_id <> s.user_id
        )
    ) as ownership_issue_count
  from public.training_sessions s
  left join public.exercise_entries e on e.session_id = s.id
  left join public.exercises ex on ex.id = e.exercise_id
  where s.routine_id is null
     or s.trained_date is null
     or s.calendar_week_start is null
     or s.planned_day is null
     or s.planned_date is null
  group by s.user_id, s.trained_at, s.week_number
  having count(distinct s.id) >= 2
     and count(e.id) > 0
     and count(e.id) = count(distinct e.exercise_id)
     and count(distinct ex.routine_id) filter (where ex.routine_id is not null) = 1
     and count(distinct ex.day) filter (where ex.day is not null and btrim(ex.day) <> '') = 1
     and count(*) filter (where e.id is null) = 0
     and count(*) filter (where ex.id is null and e.id is not null) = 0
     and count(*) filter (
       where e.id is not null
         and (
           e.user_id <> s.user_id
           or ex.user_id is null
           or ex.user_id <> s.user_id
         )
     ) = 0
)
select
  s.id as non_canonical_session_id,
  vg.canonical_session_id,
  s.user_id,
  s.trained_at,
  s.week_number,
  s.created_at
from valid_groups vg
join public.training_sessions s on s.user_id = vg.user_id
  and s.trained_at = vg.trained_at
  and s.week_number = vg.week_number
  and (
    s.routine_id is null
    or s.trained_date is null
    or s.calendar_week_start is null
    or s.planned_day is null
    or s.planned_date is null
  )
where s.id <> vg.canonical_session_id
order by s.trained_at desc, s.user_id, s.created_at, s.id;

-- 5) Validacion read-only de totales por usuario para comparar antes/despues en una fase futura.
select
  s.user_id,
  count(distinct s.id) as session_count,
  count(e.id) as entry_count,
  coalesce(sum(array_length(e.reps, 1)), 0) as set_count,
  coalesce(sum(reps_total.total_reps), 0) as total_reps,
  coalesce(sum(e.weight), 0) as simple_weight_total,
  coalesce(sum(e.weight * reps_total.total_reps), 0) as volume_total
from public.training_sessions s
left join public.exercise_entries e on e.session_id = s.id
left join lateral (
  select coalesce(sum(rep_value), 0) as total_reps
  from unnest(e.reps) as rep_value
) reps_total on true
group by s.user_id
order by s.user_id;

-- 6) Validacion read-only de posibles duplicados activos en el modelo nuevo.
select
  user_id,
  routine_id,
  trained_date,
  count(*) as active_session_count
from public.training_sessions
where routine_id is not null
  and trained_date is not null
  and deleted_at is null
group by user_id, routine_id, trained_date
having count(*) > 1
order by trained_date desc;

-- 7) Validacion read-only: no deben quedar entries apuntando a sesiones soft-deleted.
-- Despues de una consolidacion correcta debe retornar 0 filas.
select
  e.id as entry_id,
  e.session_id,
  s.user_id,
  s.deleted_at
from public.exercise_entries e
join public.training_sessions s on s.id = e.session_id
where s.deleted_at is not null
order by s.user_id, e.id;

-- 8) Validacion read-only de sesion canonica deterministica.
-- canonical_session_id debe coincidir con legacy_session_ids[1].
-- Si no coincide, el grupo debe rechazarse o revisarse manualmente.
with legacy_group_details as (
  select
    s.user_id,
    s.trained_at,
    s.week_number,
    array(
      select s_ids.id
      from public.training_sessions s_ids
      where s_ids.user_id = s.user_id
        and s_ids.trained_at = s.trained_at
        and s_ids.week_number = s.week_number
        and (
          s_ids.routine_id is null
          or s_ids.trained_date is null
          or s_ids.calendar_week_start is null
          or s_ids.planned_day is null
          or s_ids.planned_date is null
        )
      order by s_ids.created_at, s_ids.id
    ) as legacy_session_ids,
    count(distinct s.id) as legacy_session_count,
    count(e.id) as entry_count,
    count(distinct e.exercise_id) as distinct_exercise_count,
    count(distinct ex.routine_id) filter (where ex.routine_id is not null) as routine_count,
    count(distinct ex.day) filter (where ex.day is not null and btrim(ex.day) <> '') as planned_day_count,
    count(*) filter (where e.id is null) as sessions_without_entries,
    count(*) filter (where ex.id is null and e.id is not null) as orphan_entry_count,
    count(*) filter (
      where e.id is not null
        and (
          e.user_id <> s.user_id
          or ex.user_id is null
          or ex.user_id <> s.user_id
        )
    ) as ownership_issue_count
  from public.training_sessions s
  left join public.exercise_entries e on e.session_id = s.id
  left join public.exercises ex on ex.id = e.exercise_id
  where s.routine_id is null
     or s.trained_date is null
     or s.calendar_week_start is null
     or s.planned_day is null
     or s.planned_date is null
  group by s.user_id, s.trained_at, s.week_number
),
valid_groups as (
  select *
  from legacy_group_details
  where legacy_session_count >= 2
    and entry_count > 0
    and entry_count = distinct_exercise_count
    and routine_count = 1
    and planned_day_count = 1
    and sessions_without_entries = 0
    and orphan_entry_count = 0
    and ownership_issue_count = 0
),
canonical_selection as (
  select
    vg.*,
    (
      select s2.id
      from public.training_sessions s2
      where s2.user_id = vg.user_id
        and s2.trained_at = vg.trained_at
        and s2.week_number = vg.week_number
        and (
          s2.routine_id is null
          or s2.trained_date is null
          or s2.calendar_week_start is null
          or s2.planned_day is null
          or s2.planned_date is null
        )
      order by s2.created_at, s2.id
      limit 1
    ) as canonical_session_id
  from valid_groups vg
)
select
  user_id,
  trained_at,
  week_number,
  legacy_session_ids,
  canonical_session_id,
  legacy_session_ids[1] as expected_canonical_session_id
from canonical_selection
where canonical_session_id is distinct from legacy_session_ids[1]
order by trained_at desc, user_id, week_number;
