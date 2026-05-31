-- NO EJECUTAR SIN APROBACION EXPLICITA - PRODUCCION - MODIFICA DATOS.
-- Script productivo transaccional para consolidacion legacy Training.
-- Requiere auditoria Claude, aprobacion explicita, backup logico, freeze Training y ventana controlada.
-- No hardcodea usuarios, emails ni UUIDs productivos.
-- No es una migracion y no debe moverse a supabase/migrations.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

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
  constraint training_session_consolidation_audit_legacy_group_key_key
    unique (legacy_group_key),
  constraint training_session_consolidation_audit_status_check
    check (status in ('pending', 'executed', 'rolled_back'))
);

alter table public.training_session_consolidation_audit enable row level security;
revoke all on table public.training_session_consolidation_audit from anon;
revoke all on table public.training_session_consolidation_audit from authenticated;

create temp table prod_legacy_sessions on commit drop as
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
  );

create temp table prod_legacy_group_details on commit drop as
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
from prod_legacy_sessions ls
left join public.exercise_entries e on e.session_id = ls.id
left join public.exercises ex on ex.id = e.exercise_id
group by ls.user_id, ls.trained_at, ls.week_number;

create temp table prod_candidate_analysis on commit drop as
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
  )::date as inferred_calendar_week_start,
  null::date as inferred_planned_date,
  null::text as classification
from prod_legacy_group_details g;

update prod_candidate_analysis
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

update prod_candidate_analysis
set classification = case
  when legacy_session_count < 2 then 'reject_not_legacy_multi_session'
  when entry_count = 0 then 'reject_no_entries'
  when entry_count <> distinct_exercise_count then 'reject_duplicate_exercise_entries'
  when routine_count <> 1 then 'reject_ambiguous_routine'
  when planned_day_count <> 1 then 'reject_ambiguous_day'
  when sessions_without_entries <> 0 then 'reject_sessions_without_entries'
  when orphan_entry_count <> 0 then 'reject_orphan_entries'
  when ownership_issue_count <> 0 then 'reject_ownership_issues'
  when inferred_planned_day_code is null then 'reject_planned_day_not_inferable'
  when inferred_planned_date is null then 'reject_planned_date_not_inferable'
  else 'consolidation_candidate'
end;

create temp table prod_consolidation_candidates on commit drop as
select *
from prod_candidate_analysis
where classification = 'consolidation_candidate';

create temp table prod_rejected_single_session_groups on commit drop as
select *
from prod_candidate_analysis
where classification = 'reject_not_legacy_multi_session';

create temp table prod_baseline_entries on commit drop as
select distinct e.id
from prod_candidate_analysis ca
cross join lateral unnest(ca.entry_ids) as entry_id
join public.exercise_entries e on e.id = entry_id;

create temp table prod_metrics_before on commit drop as
select
  count(e.id) as entry_count,
  coalesce(sum(rep_value), 0) as total_reps,
  coalesce(sum(e.weight * rep_value), 0) as volume_total
from prod_baseline_entries be
join public.exercise_entries e on e.id = be.id
cross join lateral unnest(e.reps) as rep_value;

do $$
declare
  v_affected_users integer;
  v_group_count integer;
  v_legacy_session_count integer;
  v_legacy_entry_count integer;
  v_candidate_count integer;
  v_non_candidate_count integer;
  v_orphan_count integer;
  v_ownership_count integer;
  v_mixed_routine_count integer;
  v_mixed_day_count integer;
  v_sessions_without_entries integer;
  v_planned_day_not_inferable integer;
  v_planned_date_not_inferable integer;
  v_entries_soft_deleted_count integer;
  v_active_audit_count integer;
  v_total_reps integer;
  v_volume_total numeric;
begin
  select count(distinct user_id) into v_affected_users from prod_candidate_analysis;
  if v_affected_users <> 2 then
    raise exception 'Baseline esperado affected_users=2; encontrado %', v_affected_users;
  end if;

  select count(*) into v_group_count from prod_candidate_analysis;
  if v_group_count <> 5 then
    raise exception 'Baseline esperado legacy_group_count=5; encontrado %', v_group_count;
  end if;

  select coalesce(sum(legacy_session_count), 0) into v_legacy_session_count from prod_candidate_analysis;
  if v_legacy_session_count <> 30 then
    raise exception 'Baseline esperado legacy_training_sessions=30; encontrado %', v_legacy_session_count;
  end if;

  select coalesce(sum(entry_count), 0) into v_legacy_entry_count from prod_candidate_analysis;
  if v_legacy_entry_count <> 30 then
    raise exception 'Baseline esperado legacy_exercise_entries=30; encontrado %', v_legacy_entry_count;
  end if;

  select count(*) into v_candidate_count from prod_candidate_analysis where classification = 'consolidation_candidate';
  if v_candidate_count <> 3 then
    raise exception 'Baseline esperado consolidation_candidates=3; encontrado %', v_candidate_count;
  end if;

  select count(*) into v_non_candidate_count from prod_candidate_analysis where classification <> 'consolidation_candidate';
  if v_non_candidate_count <> 2 then
    raise exception 'Baseline esperado non_candidates=2; encontrado %', v_non_candidate_count;
  end if;

  select coalesce(sum(orphan_entry_count), 0) into v_orphan_count from prod_candidate_analysis;
  if v_orphan_count <> 0 then
    raise exception 'Baseline esperado orphan_entries=0; encontrado %', v_orphan_count;
  end if;

  select coalesce(sum(ownership_issue_count), 0) into v_ownership_count from prod_candidate_analysis;
  if v_ownership_count <> 0 then
    raise exception 'Baseline esperado ownership_issues=0; encontrado %', v_ownership_count;
  end if;

  select count(*) into v_mixed_routine_count from prod_candidate_analysis where routine_count <> 1;
  if v_mixed_routine_count <> 0 then
    raise exception 'Baseline esperado mixed_routine_groups=0; encontrado %', v_mixed_routine_count;
  end if;

  select count(*) into v_mixed_day_count from prod_candidate_analysis where planned_day_count <> 1;
  if v_mixed_day_count <> 0 then
    raise exception 'Baseline esperado mixed_day_groups=0; encontrado %', v_mixed_day_count;
  end if;

  select coalesce(sum(sessions_without_entries), 0) into v_sessions_without_entries from prod_candidate_analysis;
  if v_sessions_without_entries <> 0 then
    raise exception 'Baseline esperado sessions_without_entries=0; encontrado %', v_sessions_without_entries;
  end if;

  select count(*) into v_planned_day_not_inferable from prod_candidate_analysis where inferred_planned_day_code is null;
  if v_planned_day_not_inferable <> 0 then
    raise exception 'Baseline esperado planned_day_not_inferable=0; encontrado %', v_planned_day_not_inferable;
  end if;

  select count(*) into v_planned_date_not_inferable from prod_candidate_analysis where inferred_planned_date is null;
  if v_planned_date_not_inferable <> 0 then
    raise exception 'Baseline esperado planned_date_not_inferable=0; encontrado %', v_planned_date_not_inferable;
  end if;

  select count(*) into v_entries_soft_deleted_count
  from public.exercise_entries e
  join public.training_sessions s on s.id = e.session_id
  where s.deleted_at is not null;
  if v_entries_soft_deleted_count <> 0 then
    raise exception 'Baseline esperado entries_to_soft_deleted_sessions=0; encontrado %', v_entries_soft_deleted_count;
  end if;

  select count(*) into v_active_audit_count
  from public.training_session_consolidation_audit
  where status in ('pending', 'executed')
    and rolled_back_at is null;
  if v_active_audit_count <> 0 then
    raise exception 'Existen auditorias pending/executed sin rollback: %', v_active_audit_count;
  end if;

  select total_reps, volume_total into v_total_reps, v_volume_total from prod_metrics_before;
  if v_total_reps <> 1157 then
    raise exception 'Baseline esperado total_reps=1157; encontrado %', v_total_reps;
  end if;
  if v_volume_total <> 42941 then
    raise exception 'Baseline esperado volume_total=42941; encontrado %', v_volume_total;
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
  'production:' || c.user_id::text || ':' || c.trained_at::text || ':' || c.week_number::text,
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
    'phase', '2.1F',
    'migration_name', '202605_training_legacy_production_consolidation_script',
    'baseline_candidates', 3,
    'baseline_total_reps', 1157,
    'baseline_volume_total', 42941,
    'prepared_at', now(),
    'classification', c.classification,
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
from prod_consolidation_candidates c;

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
from prod_consolidation_candidates c
where s.id = c.canonical_session_id;

update public.exercise_entries e
set session_id = c.canonical_session_id
from prod_consolidation_candidates c
where e.id = any(c.entry_ids);

update public.training_sessions s
set deleted_at = now()
from prod_consolidation_candidates c
where s.id = any(c.legacy_session_ids)
  and s.id <> c.canonical_session_id;

update public.training_session_consolidation_audit a
set
  status = 'executed',
  executed_at = now()
from prod_consolidation_candidates c
where a.legacy_group_key = 'production:' || c.user_id::text || ':' || c.trained_at::text || ':' || c.week_number::text
  and a.status = 'pending';

do $$
declare
  v_executed_count integer;
  v_audited_entry_count integer;
  v_entries_soft_deleted_count integer;
  v_active_canonical_count integer;
  v_rejected_active_count integer;
  v_active_baseline_sessions integer;
  v_soft_deleted_baseline_sessions integer;
  v_total_entries integer;
  v_total_reps integer;
  v_volume_total numeric;
  v_ownership_count integer;
begin
  select count(*) into v_executed_count
  from public.training_session_consolidation_audit
  where legacy_group_key like 'production:%'
    and status = 'executed'
    and rolled_back_at is null;
  if v_executed_count <> 3 then
    raise exception 'Postcheck esperado auditorias executed=3; encontrado %', v_executed_count;
  end if;

  select count(*) into v_audited_entry_count
  from public.exercise_entries e
  join public.training_session_consolidation_audit a on e.id = any(a.entry_ids)
  where a.legacy_group_key like 'production:%'
    and a.status = 'executed'
    and a.rolled_back_at is null;
  if v_audited_entry_count <> 28 then
    raise exception 'Postcheck esperado entries auditadas=28; encontrado %', v_audited_entry_count;
  end if;

  select count(*) into v_entries_soft_deleted_count
  from public.exercise_entries e
  join public.training_sessions s on s.id = e.session_id
  where s.deleted_at is not null;
  if v_entries_soft_deleted_count <> 0 then
    raise exception 'Postcheck esperado entries apuntando a soft-deleted=0; encontrado %', v_entries_soft_deleted_count;
  end if;

  select count(*) into v_active_canonical_count
  from public.training_sessions s
  join public.training_session_consolidation_audit a on a.canonical_session_id = s.id
  where a.legacy_group_key like 'production:%'
    and a.status = 'executed'
    and a.rolled_back_at is null
    and s.deleted_at is null;
  if v_active_canonical_count <> 3 then
    raise exception 'Postcheck esperado sesiones canonicas activas=3; encontrado %', v_active_canonical_count;
  end if;

  select count(*) into v_rejected_active_count
  from prod_rejected_single_session_groups r
  join public.training_sessions s on s.id = r.legacy_session_ids[1]
  where s.deleted_at is null
    and s.routine_id is null
    and s.trained_date is null
    and s.calendar_week_start is null
    and s.planned_day is null
    and s.planned_date is null;
  if v_rejected_active_count <> 2 then
    raise exception 'Postcheck esperado grupos rechazados intactos=2; encontrado %', v_rejected_active_count;
  end if;

  select count(*) into v_active_baseline_sessions
  from prod_candidate_analysis ca
  cross join lateral unnest(ca.legacy_session_ids) as session_id
  join public.training_sessions s on s.id = session_id
  where s.deleted_at is null;
  if v_active_baseline_sessions <> 5 then
    raise exception 'Postcheck esperado sesiones activas baseline=5; encontrado %', v_active_baseline_sessions;
  end if;

  select count(*) into v_soft_deleted_baseline_sessions
  from prod_candidate_analysis ca
  cross join lateral unnest(ca.legacy_session_ids) as session_id
  join public.training_sessions s on s.id = session_id
  where s.deleted_at is not null;
  if v_soft_deleted_baseline_sessions <> 25 then
    raise exception 'Postcheck esperado sesiones soft-deleted baseline=25; encontrado %', v_soft_deleted_baseline_sessions;
  end if;

  select count(*) into v_total_entries
  from prod_baseline_entries be
  join public.exercise_entries e on e.id = be.id;
  if v_total_entries <> 30 then
    raise exception 'Postcheck esperado exercise_entries=30; encontrado %', v_total_entries;
  end if;

  select
    coalesce(sum(rep_value), 0),
    coalesce(sum(e.weight * rep_value), 0)
    into v_total_reps, v_volume_total
  from prod_baseline_entries be
  join public.exercise_entries e on e.id = be.id
  cross join lateral unnest(e.reps) as rep_value;
  if v_total_reps <> 1157 then
    raise exception 'Postcheck esperado total_reps=1157; encontrado %', v_total_reps;
  end if;
  if v_volume_total <> 42941 then
    raise exception 'Postcheck esperado volume_total=42941; encontrado %', v_volume_total;
  end if;

  select count(*) into v_ownership_count
  from prod_baseline_entries be
  join public.exercise_entries e on e.id = be.id
  join public.training_sessions s on s.id = e.session_id
  join public.exercises ex on ex.id = e.exercise_id
  where e.user_id <> s.user_id
     or ex.user_id <> s.user_id;
  if v_ownership_count <> 0 then
    raise exception 'Postcheck esperado ownership_issues=0; encontrado %', v_ownership_count;
  end if;
end $$;

commit;
