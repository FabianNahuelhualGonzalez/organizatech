-- NO EJECUTAR SIN APROBACION - DATASET SINTETICO QA - NO PRODUCCION.
-- Ejecutar solo en Supabase QA.
-- No ejecutar en Produccion.
-- Limpia exclusivamente registros marcados como QA_LEGACY_SYNTHETIC_202605.
-- Este archivo NO es una migracion y no debe moverse a supabase/migrations.

begin;

do $$
declare
  v_marker text := 'QA_LEGACY_SYNTHETIC_202605';
  v_routine_count integer;
  v_exercise_count integer;
  v_session_count integer;
  v_entry_count integer;
  v_audit_deleted_count integer := 0;
  v_remaining_count integer;
  v_audit_remaining_count integer := 0;
begin
  create temp table qa_synthetic_routines_to_delete as
  select id
  from public.routines
  where name like v_marker || '%';

  create temp table qa_synthetic_exercises_to_delete as
  select e.id
  from public.exercises e
  where e.name like v_marker || '%'
     or e.notes like v_marker || '%'
     or e.routine_id in (select id from qa_synthetic_routines_to_delete);

  create temp table qa_synthetic_entries_to_delete as
  select e.id
  from public.exercise_entries e
  where e.notes like v_marker || '%'
     or e.exercise_id in (select id from qa_synthetic_exercises_to_delete);

  create temp table qa_synthetic_sessions_to_delete as
  select s.id
  from public.training_sessions s
  where s.notes like v_marker || '%'
     or s.routine_id in (select id from qa_synthetic_routines_to_delete)
     or s.id in (
       select distinct e.session_id
       from public.exercise_entries e
       where e.id in (select id from qa_synthetic_entries_to_delete)
     );

  select count(*) into v_routine_count from qa_synthetic_routines_to_delete;
  select count(*) into v_exercise_count from qa_synthetic_exercises_to_delete;
  select count(*) into v_session_count from qa_synthetic_sessions_to_delete;
  select count(*) into v_entry_count from qa_synthetic_entries_to_delete;

  if v_routine_count = 0
     and v_exercise_count = 0
     and v_session_count = 0
     and v_entry_count = 0 then
    raise exception 'No se encontraron registros sinteticos QA con marcador %', v_marker;
  end if;

  if to_regclass('public.training_session_consolidation_audit') is not null then
    execute $sql$
      delete from public.training_session_consolidation_audit a
      where a.canonical_session_id in (select id from qa_synthetic_sessions_to_delete)
         or exists (
           select 1
           from unnest(a.legacy_session_ids) legacy_session_id
           where legacy_session_id in (select id from qa_synthetic_sessions_to_delete)
         )
         or exists (
           select 1
           from unnest(a.entry_ids) entry_id
           where entry_id in (select id from qa_synthetic_entries_to_delete)
         )
    $sql$;

    get diagnostics v_audit_deleted_count = row_count;
  end if;

  delete from public.exercise_entries
  where id in (select id from qa_synthetic_entries_to_delete);

  delete from public.training_sessions
  where id in (select id from qa_synthetic_sessions_to_delete);

  delete from public.exercises
  where id in (select id from qa_synthetic_exercises_to_delete);

  delete from public.routines
  where id in (select id from qa_synthetic_routines_to_delete);

  select count(*) into v_remaining_count
  from (
    select id from public.routines where name like v_marker || '%'
    union all
    select id from public.exercises where name like v_marker || '%' or notes like v_marker || '%'
    union all
    select id from public.training_sessions where notes like v_marker || '%'
    union all
    select id from public.exercise_entries where notes like v_marker || '%'
  ) remaining;

  if to_regclass('public.training_session_consolidation_audit') is not null then
    execute $sql$
      select count(*)
      from public.training_session_consolidation_audit a
      where a.legacy_group_key like 'synthetic:%'
         or a.rollback_payload ->> 'dataset_marker' = 'QA_LEGACY_SYNTHETIC_202605'
    $sql$
    into v_audit_remaining_count;
  end if;

  if v_remaining_count <> 0 or v_audit_remaining_count <> 0 then
    raise exception 'Cleanup dataset QA sintetico incompleto. remaining_data=%, remaining_audit=%',
      v_remaining_count,
      v_audit_remaining_count;
  end if;

  raise notice 'Cleanup dataset QA sintetico completado. routines=%, exercises=%, sessions=%, entries=%, audit_rows=%',
    v_routine_count,
    v_exercise_count,
    v_session_count,
    v_entry_count,
    v_audit_deleted_count;
end $$;

commit;
