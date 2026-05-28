-- NO EJECUTAR SIN APROBACION - DATASET SINTETICO QA - NO PRODUCCION.
-- Variante de consolidacion filtrada exclusivamente por QA_LEGACY_SYNTHETIC_202605.
-- Ejecutar solo en Supabase QA.
-- No ejecutar en Produccion.
-- Requiere auditoria Claude y aprobacion humana antes de cualquier ejecucion.
-- Este archivo NO es una migracion y no debe moverse a supabase/migrations.

begin;

create table if not exists public.training_session_consolidation_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  legacy_group_key text not null,
  canonical_session_id uuid not null,
  legacy_session_ids uuid[] not null,
  entry_ids uuid[] not null,
  inferred_routine_id uuid not null,
  inferred_planned_day text not null,
  inferred_planned_day_code text not null,
  inferred_trained_date date not null,
  inferred_calendar_week_start date not null,
  inferred_planned_date date not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  executed_at timestamptz null,
  rolled_back_at timestamptz null,
  rollback_payload jsonb not null,
  constraint training_session_consolidation_audit_status_check
    check (status in ('pending', 'executed', 'rolled_back'))
);

alter table public.training_session_consolidation_audit enable row level security;
revoke all on table public.training_session_consolidation_audit from anon;
revoke all on table public.training_session_consolidation_audit from authenticated;

create temp table qa_synthetic_legacy_group_details on commit drop as
select
  s.user_id,
  s.trained_at,
  s.week_number,
  array_agg(s.id order by s.created_at, s.id) as legacy_session_ids,
  array_agg(e.id order by e.id) filter (where e.id is not null) as entry_ids,
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
where s.notes like 'QA_LEGACY_SYNTHETIC_202605 legacy synthetic session%'
  and s.routine_id is null
  and s.trained_date is null
  and s.calendar_week_start is null
  and s.planned_day is null
  and s.planned_date is null
group by s.user_id, s.trained_at, s.week_number;

create temp table qa_synthetic_consolidation_candidates on commit drop as
select
  d.*,
  d.legacy_session_ids[1] as canonical_session_id,
  case lower(btrim(d.inferred_planned_day))
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
  s.trained_at::date as inferred_trained_date,
  (
    s.trained_at::date - (extract(isodow from s.trained_at::date)::integer - 1)
  )::date as inferred_calendar_week_start
from qa_synthetic_legacy_group_details d
join public.training_sessions s on s.id = d.legacy_session_ids[1]
where d.legacy_session_count >= 2
  and d.entry_count > 0
  and d.entry_count = d.distinct_exercise_count
  and d.routine_count = 1
  and d.planned_day_count = 1
  and d.sessions_without_entries = 0
  and d.orphan_entry_count = 0
  and d.ownership_issue_count = 0;

alter table qa_synthetic_consolidation_candidates
  add column inferred_planned_date date;

update qa_synthetic_consolidation_candidates
set inferred_planned_date = case inferred_planned_day_code
  when 'monday' then inferred_calendar_week_start
  when 'tuesday' then inferred_calendar_week_start + 1
  when 'wednesday' then inferred_calendar_week_start + 2
  when 'thursday' then inferred_calendar_week_start + 3
  when 'friday' then inferred_calendar_week_start + 4
  when 'saturday' then inferred_calendar_week_start + 5
  when 'sunday' then inferred_calendar_week_start + 6
  else null
end;

do $$
declare
  v_group_count integer;
  v_session_count integer;
  v_entry_count integer;
  v_user_count integer;
  v_orphan_count integer;
  v_mixed_routine_count integer;
  v_mixed_day_count integer;
  v_ownership_issue_count integer;
  v_non_candidate_count integer;
  v_bad_canonical_count integer;
  v_bad_planned_day_count integer;
  v_existing_audit_count integer;
  v_entries_soft_deleted_count integer;
begin
  select count(*) into v_group_count from qa_synthetic_consolidation_candidates;
  if v_group_count <> 5 then
    raise exception 'Dataset sintetico QA esperado: 5 grupos consolidables; encontrado %', v_group_count;
  end if;

  select coalesce(sum(legacy_session_count), 0) into v_session_count from qa_synthetic_consolidation_candidates;
  if v_session_count <> 30 then
    raise exception 'Dataset sintetico QA esperado: 30 training_sessions legacy; encontrado %', v_session_count;
  end if;

  select coalesce(sum(entry_count), 0) into v_entry_count from qa_synthetic_consolidation_candidates;
  if v_entry_count <> 30 then
    raise exception 'Dataset sintetico QA esperado: 30 exercise_entries legacy; encontrado %', v_entry_count;
  end if;

  select count(distinct user_id) into v_user_count from qa_synthetic_consolidation_candidates;
  if v_user_count <> 2 then
    raise exception 'Dataset sintetico QA esperado: 2 usuarios afectados; encontrado %', v_user_count;
  end if;

  select coalesce(sum(orphan_entry_count), 0) into v_orphan_count from qa_synthetic_legacy_group_details;
  if v_orphan_count <> 0 then
    raise exception 'Dataset sintetico QA esperado: 0 entries huerfanas; encontrado %', v_orphan_count;
  end if;

  select count(*) into v_mixed_routine_count
  from qa_synthetic_legacy_group_details
  where routine_count <> 1;
  if v_mixed_routine_count <> 0 then
    raise exception 'Dataset sintetico QA esperado: 0 grupos con mezcla de rutinas; encontrado %', v_mixed_routine_count;
  end if;

  select count(*) into v_mixed_day_count
  from qa_synthetic_legacy_group_details
  where planned_day_count <> 1;
  if v_mixed_day_count <> 0 then
    raise exception 'Dataset sintetico QA esperado: 0 grupos con mezcla de dias; encontrado %', v_mixed_day_count;
  end if;

  select coalesce(sum(ownership_issue_count), 0) into v_ownership_issue_count from qa_synthetic_legacy_group_details;
  if v_ownership_issue_count <> 0 then
    raise exception 'Dataset sintetico QA esperado: 0 ownership issues; encontrado %', v_ownership_issue_count;
  end if;

  select count(*) into v_non_candidate_count
  from qa_synthetic_legacy_group_details d
  where not exists (
    select 1
    from qa_synthetic_consolidation_candidates c
    where c.user_id = d.user_id
      and c.trained_at = d.trained_at
      and c.week_number = d.week_number
  );
  if v_non_candidate_count <> 0 then
    raise exception 'Dataset sintetico QA esperado: todos los grupos consolidation_candidate; grupos no candidatos %', v_non_candidate_count;
  end if;

  select count(*) into v_bad_canonical_count
  from qa_synthetic_consolidation_candidates
  where canonical_session_id is distinct from legacy_session_ids[1];
  if v_bad_canonical_count <> 0 then
    raise exception 'Dataset sintetico QA esperado: canonical_session_id = legacy_session_ids[1]; inconsistencias %', v_bad_canonical_count;
  end if;

  select count(*) into v_bad_planned_day_count
  from qa_synthetic_consolidation_candidates
  where inferred_planned_day_code is null
     or inferred_planned_date is null;
  if v_bad_planned_day_count <> 0 then
    raise exception 'Dataset sintetico QA esperado: planned_day tecnico y planned_date inferibles; inconsistencias %', v_bad_planned_day_count;
  end if;

  select count(*) into v_existing_audit_count
  from public.training_session_consolidation_audit
  where legacy_group_key like 'synthetic:%'
    and status in ('pending', 'executed')
    and rolled_back_at is null;
  if v_existing_audit_count <> 0 then
    raise exception 'Existen auditorias sinteticas pendientes/ejecutadas sin rollback: %', v_existing_audit_count;
  end if;

  select count(*) into v_entries_soft_deleted_count
  from public.exercise_entries e
  join public.training_sessions s on s.id = e.session_id
  where s.deleted_at is not null
    and (
      e.notes like 'QA_LEGACY_SYNTHETIC_202605%'
      or s.notes like 'QA_LEGACY_SYNTHETIC_202605%'
    );
  if v_entries_soft_deleted_count <> 0 then
    raise exception 'Precheck sintetico fallo: entries sinteticas apuntando a sesiones soft-deleted %', v_entries_soft_deleted_count;
  end if;
end $$;

insert into public.training_session_consolidation_audit (
  user_id,
  legacy_group_key,
  canonical_session_id,
  legacy_session_ids,
  entry_ids,
  inferred_routine_id,
  inferred_planned_day,
  inferred_planned_day_code,
  inferred_trained_date,
  inferred_calendar_week_start,
  inferred_planned_date,
  status,
  rollback_payload
)
select
  c.user_id,
  'synthetic:' || c.user_id::text || ':' || c.trained_at::text || ':' || c.week_number::text,
  c.canonical_session_id,
  c.legacy_session_ids,
  c.entry_ids,
  c.inferred_routine_id,
  c.inferred_planned_day,
  c.inferred_planned_day_code,
  c.inferred_trained_date,
  c.inferred_calendar_week_start,
  c.inferred_planned_date,
  'pending',
  jsonb_build_object(
    'prepared_at', now(),
    'dataset_marker', 'QA_LEGACY_SYNTHETIC_202605',
    'entries', (
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'original_session_id', e.session_id
        )
        order by e.id
      )
      from public.exercise_entries e
      where e.id = any(c.entry_ids)
    ),
    'canonical_session', (
      select jsonb_build_object(
        'id', s.id,
        'routine_id', s.routine_id,
        'calendar_week_start', s.calendar_week_start,
        'planned_day', s.planned_day,
        'planned_date', s.planned_date,
        'trained_date', s.trained_date,
        'status', s.status,
        'completed_at', s.completed_at,
        'deleted_at', s.deleted_at
      )
      from public.training_sessions s
      where s.id = c.canonical_session_id
    ),
    'non_canonical_sessions', (
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'routine_id', s.routine_id,
          'calendar_week_start', s.calendar_week_start,
          'planned_day', s.planned_day,
          'planned_date', s.planned_date,
          'trained_date', s.trained_date,
          'status', s.status,
          'completed_at', s.completed_at,
          'deleted_at', s.deleted_at
        )
        order by s.created_at, s.id
      )
      from public.training_sessions s
      where s.id = any(c.legacy_session_ids)
        and s.id <> c.canonical_session_id
    )
  )
from qa_synthetic_consolidation_candidates c;

update public.training_sessions s
set
  routine_id = c.inferred_routine_id,
  trained_date = c.inferred_trained_date,
  calendar_week_start = c.inferred_calendar_week_start,
  planned_day = c.inferred_planned_day_code,
  planned_date = c.inferred_planned_date,
  status = 'completed',
  completed_at = coalesce(s.completed_at, s.trained_at, s.created_at),
  deleted_at = null
from qa_synthetic_consolidation_candidates c
where s.id = c.canonical_session_id;

update public.exercise_entries e
set session_id = c.canonical_session_id
from qa_synthetic_consolidation_candidates c
where e.id = any(c.entry_ids);

update public.training_sessions s
set deleted_at = now()
from qa_synthetic_consolidation_candidates c
where s.id = any(c.legacy_session_ids)
  and s.id <> c.canonical_session_id;

update public.training_session_consolidation_audit a
set
  status = 'executed',
  executed_at = now()
from qa_synthetic_consolidation_candidates c
where a.legacy_group_key = 'synthetic:' || c.user_id::text || ':' || c.trained_at::text || ':' || c.week_number::text
  and a.status = 'pending';

do $$
declare
  v_audit_count integer;
  v_entry_count integer;
  v_entries_soft_deleted_count integer;
  v_active_duplicate_count integer;
  v_active_session_count integer;
begin
  select count(*) into v_audit_count
  from public.training_session_consolidation_audit
  where legacy_group_key like 'synthetic:%'
    and status = 'executed'
    and rolled_back_at is null;
  if v_audit_count <> 5 then
    raise exception 'Postcheck sintetico esperado: 5 auditorias executed; encontrado %', v_audit_count;
  end if;

  select count(*) into v_entry_count
  from public.exercise_entries e
  join public.training_session_consolidation_audit a on e.id = any(a.entry_ids)
  where a.legacy_group_key like 'synthetic:%'
    and a.status = 'executed'
    and a.rolled_back_at is null;
  if v_entry_count <> 30 then
    raise exception 'Postcheck sintetico esperado: 30 entries auditadas; encontrado %', v_entry_count;
  end if;

  select count(*) into v_entries_soft_deleted_count
  from public.exercise_entries e
  join public.training_sessions s on s.id = e.session_id
  join public.training_session_consolidation_audit a on e.id = any(a.entry_ids)
  where a.legacy_group_key like 'synthetic:%'
    and a.status = 'executed'
    and a.rolled_back_at is null
    and s.deleted_at is not null;
  if v_entries_soft_deleted_count <> 0 then
    raise exception 'Postcheck sintetico fallo: entries apuntando a sesiones soft-deleted %', v_entries_soft_deleted_count;
  end if;

  select count(*) into v_active_duplicate_count
  from (
    select s.user_id, s.routine_id, s.trained_date
    from public.training_sessions s
    join public.training_session_consolidation_audit a on a.canonical_session_id = s.id
    where a.legacy_group_key like 'synthetic:%'
      and a.status = 'executed'
      and a.rolled_back_at is null
      and s.deleted_at is null
    group by s.user_id, s.routine_id, s.trained_date
    having count(*) > 1
  ) duplicates;
  if v_active_duplicate_count <> 0 then
    raise exception 'Postcheck sintetico fallo: sesiones activas duplicadas %', v_active_duplicate_count;
  end if;

  select count(*) into v_active_session_count
  from public.training_sessions s
  join public.training_session_consolidation_audit a on a.canonical_session_id = s.id
  where a.legacy_group_key like 'synthetic:%'
    and a.status = 'executed'
    and a.rolled_back_at is null
    and s.deleted_at is null;
  if v_active_session_count <> 5 then
    raise exception 'Postcheck sintetico esperado: 5 sesiones canonicas activas; encontrado %', v_active_session_count;
  end if;
end $$;

commit;
