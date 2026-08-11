-- Diagnostic queries for legacy training data.
-- These queries are intentionally read-only and must not be used as an automatic backfill.
-- Run manually in Supabase QA first. Review results before considering any production action.

-- 1) Sessions created per exercise instead of one session per daily workout.
select
  user_id,
  trained_at,
  count(*) as session_count
from public.training_sessions
group by user_id, trained_at
having count(*) > 1
order by trained_at desc;

-- 2) Sessions without exercise entries.
select
  s.id as session_id,
  s.user_id,
  s.trained_at,
  s.week_number,
  s.created_at
from public.training_sessions s
left join public.exercise_entries e on e.session_id = s.id
where e.id is null
order by s.created_at desc;

-- 3) Active duplicate sessions for the same user/routine/trained_date in the new model.
select
  user_id,
  routine_id,
  trained_date,
  count(*) as session_count
from public.training_sessions
where routine_id is not null
  and trained_date is not null
  and deleted_at is null
group by user_id, routine_id, trained_date
having count(*) > 1
order by trained_date desc;

-- 4) Legacy rows missing new source-of-truth fields.
select
  count(*) filter (where routine_id is null) as missing_routine_id,
  count(*) filter (where calendar_week_start is null) as missing_calendar_week_start,
  count(*) filter (where planned_day is null) as missing_planned_day,
  count(*) filter (where planned_date is null) as missing_planned_date,
  count(*) filter (where trained_date is null) as missing_trained_date
from public.training_sessions;

-- 5) Suspicious week_number sequences per user.
select
  user_id,
  trained_at,
  array_agg(distinct week_number order by week_number) as week_numbers,
  count(*) as session_count
from public.training_sessions
group by user_id, trained_at
having count(distinct week_number) > 1
order by trained_at desc;

-- 6) Exercise entries whose exercise belongs to a different user than the entry.
select
  e.id as entry_id,
  e.user_id as entry_user_id,
  ex.user_id as exercise_user_id,
  e.exercise_id
from public.exercise_entries e
join public.exercises ex on ex.id = e.exercise_id
where e.user_id <> ex.user_id;

-- 7) Exercise entries whose session belongs to a different user than the entry.
select
  e.id as entry_id,
  e.user_id as entry_user_id,
  s.user_id as session_user_id,
  e.session_id
from public.exercise_entries e
join public.training_sessions s on s.id = e.session_id
where e.user_id <> s.user_id;
