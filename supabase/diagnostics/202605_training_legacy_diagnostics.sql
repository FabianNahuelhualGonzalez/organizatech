-- Este archivo es solo diagnostico. No ejecutar como migracion. No modifica datos.
-- Objetivo: entender registros legacy de training_sessions antes de cualquier backfill.
-- Todas las consultas son read-only y deben ejecutarse primero en Supabase QA.

-- 1) Totales generales de sesiones legacy y campos nuevos faltantes.
select
  count(*) as total_training_sessions,
  count(*) filter (where routine_id is null) as legacy_missing_routine_id,
  count(*) filter (where trained_date is null) as legacy_missing_trained_date,
  count(*) filter (where calendar_week_start is null) as legacy_missing_calendar_week_start,
  count(*) filter (where planned_day is null) as legacy_missing_planned_day,
  count(*) filter (where planned_date is null) as legacy_missing_planned_date,
  count(*) filter (
    where routine_id is null
      and trained_date is null
      and calendar_week_start is null
      and planned_day is null
      and planned_date is null
  ) as legacy_all_source_fields_missing
from public.training_sessions;

-- 2) Impacto multiusuario: cantidad de sesiones legacy por usuario.
select
  user_id,
  count(*) as legacy_session_count,
  min(trained_at) as first_trained_at,
  max(trained_at) as last_trained_at,
  array_agg(distinct week_number order by week_number) as week_numbers
from public.training_sessions
where routine_id is null
   or trained_date is null
   or calendar_week_start is null
   or planned_day is null
   or planned_date is null
group by user_id
order by legacy_session_count desc, last_trained_at desc;

-- 3) Sesiones duplicadas legacy por usuario, fecha real legacy y week_number.
-- Ayuda a detectar el patron antiguo de una training_session por ejercicio.
select
  s.user_id,
  s.trained_at,
  s.week_number,
  count(*) as session_count,
  count(e.id) as entry_count
from public.training_sessions s
left join public.exercise_entries e on e.session_id = s.id
where s.routine_id is null
   or s.trained_date is null
   or s.calendar_week_start is null
   or s.planned_day is null
   or s.planned_date is null
group by s.user_id, s.trained_at, s.week_number
having count(*) > 1
order by s.trained_at desc, session_count desc;

-- 4) Sesiones legacy con y sin exercise_entries.
select
  case when count(e.id) > 0 then 'with_entries' else 'without_entries' end as entry_state,
  count(distinct s.id) as session_count
from public.training_sessions s
left join public.exercise_entries e on e.session_id = s.id
where s.routine_id is null
   or s.trained_date is null
   or s.calendar_week_start is null
   or s.planned_day is null
   or s.planned_date is null
group by entry_state
order by entry_state;

-- 5) Detalle de sesiones legacy sin entries: candidatas a revision manual o no backfill.
select
  s.id as session_id,
  s.user_id,
  s.trained_at,
  s.week_number,
  s.created_at
from public.training_sessions s
left join public.exercise_entries e on e.session_id = s.id
where e.id is null
  and (
    s.routine_id is null
    or s.trained_date is null
    or s.calendar_week_start is null
    or s.planned_day is null
    or s.planned_date is null
  )
order by s.created_at desc;

-- 6) Inferencia de routine_id desde exercise_entries -> exercises.
-- routine_count = 1 sugiere inferencia automatica posible.
-- routine_count > 1 indica ambiguedad.
select
  s.id as session_id,
  s.user_id,
  s.trained_at,
  s.week_number,
  count(e.id) as entry_count,
  count(distinct ex.routine_id) filter (where ex.routine_id is not null) as routine_count,
  array_agg(distinct ex.routine_id) filter (where ex.routine_id is not null) as inferred_routine_ids
from public.training_sessions s
left join public.exercise_entries e on e.session_id = s.id
left join public.exercises ex on ex.id = e.exercise_id
where s.routine_id is null
   or s.trained_date is null
   or s.calendar_week_start is null
   or s.planned_day is null
   or s.planned_date is null
group by s.id, s.user_id, s.trained_at, s.week_number
order by s.trained_at desc;

-- 7) Inferencia de planned_day desde exercises.day.
-- day_count = 1 sugiere inferencia automatica posible.
-- day_count > 1 indica ambiguedad.
select
  s.id as session_id,
  s.user_id,
  s.trained_at,
  s.week_number,
  count(e.id) as entry_count,
  count(distinct ex.day) filter (where ex.day is not null and btrim(ex.day) <> '') as day_count,
  array_agg(distinct ex.day) filter (where ex.day is not null and btrim(ex.day) <> '') as inferred_days
from public.training_sessions s
left join public.exercise_entries e on e.session_id = s.id
left join public.exercises ex on ex.id = e.exercise_id
where s.routine_id is null
   or s.trained_date is null
   or s.calendar_week_start is null
   or s.planned_day is null
   or s.planned_date is null
group by s.id, s.user_id, s.trained_at, s.week_number
order by s.trained_at desc;

-- 8) Clasificacion preliminar de riesgo de backfill por sesion legacy.
select
  s.id as session_id,
  s.user_id,
  s.trained_at,
  s.week_number,
  count(e.id) as entry_count,
  count(distinct ex.routine_id) filter (where ex.routine_id is not null) as routine_count,
  count(distinct ex.day) filter (where ex.day is not null and btrim(ex.day) <> '') as day_count,
  case
    when count(e.id) = 0 then 'manual_review_no_entries'
    when count(distinct ex.routine_id) filter (where ex.routine_id is not null) = 1
      and count(distinct ex.day) filter (where ex.day is not null and btrim(ex.day) <> '') = 1
      then 'inferable_candidate'
    when count(distinct ex.routine_id) filter (where ex.routine_id is not null) > 1
      then 'manual_review_multiple_routines'
    when count(distinct ex.day) filter (where ex.day is not null and btrim(ex.day) <> '') > 1
      then 'manual_review_multiple_days'
    else 'manual_review_missing_inference'
  end as backfill_risk
from public.training_sessions s
left join public.exercise_entries e on e.session_id = s.id
left join public.exercises ex on ex.id = e.exercise_id
where s.routine_id is null
   or s.trained_date is null
   or s.calendar_week_start is null
   or s.planned_day is null
   or s.planned_date is null
group by s.id, s.user_id, s.trained_at, s.week_number
order by s.trained_at desc;

-- 9) Sesiones legacy con entries de varias rutinas.
select
  s.id as session_id,
  s.user_id,
  s.trained_at,
  s.week_number,
  count(e.id) as entry_count,
  array_agg(distinct ex.routine_id) filter (where ex.routine_id is not null) as routine_ids
from public.training_sessions s
join public.exercise_entries e on e.session_id = s.id
left join public.exercises ex on ex.id = e.exercise_id
where (
    s.routine_id is null
    or s.trained_date is null
    or s.calendar_week_start is null
    or s.planned_day is null
    or s.planned_date is null
  )
group by s.id, s.user_id, s.trained_at, s.week_number
having count(distinct ex.routine_id) filter (where ex.routine_id is not null) > 1
order by s.trained_at desc;

-- 10) Sesiones legacy con entries de varios dias planificados.
select
  s.id as session_id,
  s.user_id,
  s.trained_at,
  s.week_number,
  count(e.id) as entry_count,
  array_agg(distinct ex.day) filter (where ex.day is not null and btrim(ex.day) <> '') as planned_days
from public.training_sessions s
join public.exercise_entries e on e.session_id = s.id
left join public.exercises ex on ex.id = e.exercise_id
where (
    s.routine_id is null
    or s.trained_date is null
    or s.calendar_week_start is null
    or s.planned_day is null
    or s.planned_date is null
  )
group by s.id, s.user_id, s.trained_at, s.week_number
having count(distinct ex.day) filter (where ex.day is not null and btrim(ex.day) <> '') > 1
order by s.trained_at desc;

-- 11) Entries sin ejercicio asociado.
select
  e.id as entry_id,
  e.user_id as entry_user_id,
  e.session_id,
  e.exercise_id
from public.exercise_entries e
left join public.exercises ex on ex.id = e.exercise_id
where ex.id is null
order by e.session_id;

-- 12) Inconsistencias entre user_id de entry, exercise y session.
select
  e.id as entry_id,
  e.user_id as entry_user_id,
  s.user_id as session_user_id,
  ex.user_id as exercise_user_id,
  e.session_id,
  e.exercise_id
from public.exercise_entries e
left join public.training_sessions s on s.id = e.session_id
left join public.exercises ex on ex.id = e.exercise_id
where s.id is null
   or ex.id is null
   or e.user_id <> s.user_id
   or e.user_id <> ex.user_id
   or s.user_id <> ex.user_id
order by e.session_id;

-- 13) Resumen de candidatos inferibles vs revision manual.
with legacy_session_risk as (
  select
    s.id,
    count(e.id) as entry_count,
    count(distinct ex.routine_id) filter (where ex.routine_id is not null) as routine_count,
    count(distinct ex.day) filter (where ex.day is not null and btrim(ex.day) <> '') as day_count
  from public.training_sessions s
  left join public.exercise_entries e on e.session_id = s.id
  left join public.exercises ex on ex.id = e.exercise_id
  where s.routine_id is null
     or s.trained_date is null
     or s.calendar_week_start is null
     or s.planned_day is null
     or s.planned_date is null
  group by s.id
)
select
  case
    when entry_count = 0 then 'manual_review_no_entries'
    when routine_count = 1 and day_count = 1 then 'inferable_candidate'
    when routine_count > 1 then 'manual_review_multiple_routines'
    when day_count > 1 then 'manual_review_multiple_days'
    else 'manual_review_missing_inference'
  end as backfill_risk,
  count(*) as session_count
from legacy_session_risk
group by backfill_risk
order by session_count desc;
