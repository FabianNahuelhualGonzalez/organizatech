-- NO EJECUTAR SIN APROBACION - DATASET SINTETICO QA - NO PRODUCCION.
-- Rollback filtrado exclusivamente por auditorias synthetic: QA_LEGACY_SYNTHETIC_202605.
-- Ejecutar solo en Supabase QA.
-- No ejecutar en Produccion.
-- Este archivo NO es una migracion y no debe moverse a supabase/migrations.

begin;

do $$
declare
  v_executed_count integer;
  v_rolled_back_count integer;
  v_missing_payload_count integer;
begin
  if to_regclass('public.training_session_consolidation_audit') is null then
    raise exception 'Rollback sintetico abortado: no existe training_session_consolidation_audit';
  end if;

  select count(*) into v_executed_count
  from public.training_session_consolidation_audit
  where legacy_group_key like 'synthetic:%'
    and rollback_payload ->> 'dataset_marker' = 'QA_LEGACY_SYNTHETIC_202605'
    and status = 'executed'
    and executed_at is not null
    and rolled_back_at is null;

  if v_executed_count <> 5 then
    raise exception 'Rollback sintetico QA esperado: 5 auditorias executed sin rollback; encontrado %', v_executed_count;
  end if;

  select count(*) into v_rolled_back_count
  from public.training_session_consolidation_audit
  where legacy_group_key like 'synthetic:%'
    and rollback_payload ->> 'dataset_marker' = 'QA_LEGACY_SYNTHETIC_202605'
    and (
      rolled_back_at is not null
      or status = 'rolled_back'
    );

  if v_rolled_back_count <> 0 then
    raise exception 'Rollback sintetico abortado: existen auditorias sinteticas ya revertidas %', v_rolled_back_count;
  end if;

  select count(*) into v_missing_payload_count
  from public.training_session_consolidation_audit
  where legacy_group_key like 'synthetic:%'
    and rollback_payload ->> 'dataset_marker' = 'QA_LEGACY_SYNTHETIC_202605'
    and status = 'executed'
    and executed_at is not null
    and rolled_back_at is null
    and (
      rollback_payload is null
      or jsonb_typeof(rollback_payload -> 'entries') <> 'array'
      or jsonb_typeof(rollback_payload -> 'canonical_session') <> 'object'
      or jsonb_typeof(rollback_payload -> 'non_canonical_sessions') <> 'array'
    );

  if v_missing_payload_count <> 0 then
    raise exception 'Rollback sintetico abortado: rollback_payload invalido en % auditorias', v_missing_payload_count;
  end if;
end $$;

create temp table qa_synthetic_rollback_audit on commit drop as
select *
from public.training_session_consolidation_audit
where legacy_group_key like 'synthetic:%'
  and rollback_payload ->> 'dataset_marker' = 'QA_LEGACY_SYNTHETIC_202605'
  and status = 'executed'
  and executed_at is not null
  and rolled_back_at is null;

create temp table qa_synthetic_rollback_entries on commit drop as
select
  a.id as audit_id,
  (entry_item ->> 'id')::uuid as entry_id,
  (entry_item ->> 'original_session_id')::uuid as original_session_id
from qa_synthetic_rollback_audit a
cross join lateral jsonb_array_elements(a.rollback_payload -> 'entries') as entry_item;

create temp table qa_synthetic_rollback_sessions on commit drop as
select
  a.id as audit_id,
  'canonical' as session_role,
  (a.rollback_payload -> 'canonical_session' ->> 'id')::uuid as session_id,
  nullif(a.rollback_payload -> 'canonical_session' ->> 'routine_id', '')::uuid as routine_id,
  nullif(a.rollback_payload -> 'canonical_session' ->> 'calendar_week_start', '')::date as calendar_week_start,
  a.rollback_payload -> 'canonical_session' ->> 'planned_day' as planned_day,
  nullif(a.rollback_payload -> 'canonical_session' ->> 'planned_date', '')::date as planned_date,
  nullif(a.rollback_payload -> 'canonical_session' ->> 'trained_date', '')::date as trained_date,
  a.rollback_payload -> 'canonical_session' ->> 'status' as status,
  nullif(a.rollback_payload -> 'canonical_session' ->> 'completed_at', '')::timestamptz as completed_at,
  nullif(a.rollback_payload -> 'canonical_session' ->> 'deleted_at', '')::timestamptz as deleted_at
from qa_synthetic_rollback_audit a
union all
select
  a.id as audit_id,
  'non_canonical' as session_role,
  (session_item ->> 'id')::uuid as session_id,
  nullif(session_item ->> 'routine_id', '')::uuid as routine_id,
  nullif(session_item ->> 'calendar_week_start', '')::date as calendar_week_start,
  session_item ->> 'planned_day' as planned_day,
  nullif(session_item ->> 'planned_date', '')::date as planned_date,
  nullif(session_item ->> 'trained_date', '')::date as trained_date,
  session_item ->> 'status' as status,
  nullif(session_item ->> 'completed_at', '')::timestamptz as completed_at,
  nullif(session_item ->> 'deleted_at', '')::timestamptz as deleted_at
from qa_synthetic_rollback_audit a
cross join lateral jsonb_array_elements(a.rollback_payload -> 'non_canonical_sessions') as session_item;

update public.exercise_entries e
set session_id = r.original_session_id
from qa_synthetic_rollback_entries r
where e.id = r.entry_id;

update public.training_sessions s
set
  routine_id = r.routine_id,
  calendar_week_start = r.calendar_week_start,
  planned_day = r.planned_day,
  planned_date = r.planned_date,
  trained_date = r.trained_date,
  status = r.status,
  completed_at = r.completed_at,
  deleted_at = r.deleted_at
from qa_synthetic_rollback_sessions r
where s.id = r.session_id;

update public.training_session_consolidation_audit a
set
  status = 'rolled_back',
  rolled_back_at = now()
from qa_synthetic_rollback_audit r
where a.id = r.id
  and a.status = 'executed'
  and a.rolled_back_at is null;

do $$
declare
  v_not_rolled_back_count integer;
  v_entry_mismatch_count integer;
  v_session_mismatch_count integer;
  v_active_audit_count integer;
begin
  select count(*) into v_not_rolled_back_count
  from qa_synthetic_rollback_audit r
  join public.training_session_consolidation_audit a on a.id = r.id
  where a.status <> 'rolled_back'
     or a.rolled_back_at is null;

  if v_not_rolled_back_count <> 0 then
    raise exception 'Rollback sintetico fallo: auditorias no marcadas como rolled_back %', v_not_rolled_back_count;
  end if;

  select count(*) into v_entry_mismatch_count
  from qa_synthetic_rollback_entries r
  join public.exercise_entries e on e.id = r.entry_id
  where e.session_id is distinct from r.original_session_id;

  if v_entry_mismatch_count <> 0 then
    raise exception 'Rollback sintetico fallo: entries con session_id no restaurado %', v_entry_mismatch_count;
  end if;

  select count(*) into v_session_mismatch_count
  from qa_synthetic_rollback_sessions r
  join public.training_sessions s on s.id = r.session_id
  where s.deleted_at is distinct from r.deleted_at
     or s.routine_id is distinct from r.routine_id
     or s.calendar_week_start is distinct from r.calendar_week_start
     or s.planned_day is distinct from r.planned_day
     or s.planned_date is distinct from r.planned_date
     or s.trained_date is distinct from r.trained_date
     or s.status is distinct from r.status
     or s.completed_at is distinct from r.completed_at;

  if v_session_mismatch_count <> 0 then
    raise exception 'Rollback sintetico fallo: campos de sesion no restaurados %', v_session_mismatch_count;
  end if;

  select count(*) into v_active_audit_count
  from public.training_session_consolidation_audit
  where legacy_group_key like 'synthetic:%'
    and rollback_payload ->> 'dataset_marker' = 'QA_LEGACY_SYNTHETIC_202605'
    and status = 'executed'
    and rolled_back_at is null;

  if v_active_audit_count <> 0 then
    raise exception 'Rollback sintetico fallo: quedan auditorias executed sin rollback %', v_active_audit_count;
  end if;
end $$;

commit;
