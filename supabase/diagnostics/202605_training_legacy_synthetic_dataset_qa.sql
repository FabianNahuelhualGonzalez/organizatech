-- NO EJECUTAR SIN APROBACION - DATASET SINTETICO QA - NO PRODUCCION.
-- Ejecutar solo en Supabase QA.
-- No ejecutar en Produccion.
-- No contiene datos reales, emails ni UUIDs productivos.
-- Requiere dos usuarios QA creados previamente con display_name:
-- - QA Legacy Synthetic User A
-- - QA Legacy Synthetic User B
-- Este archivo NO es una migracion y no debe moverse a supabase/migrations.

begin;

do $$
declare
  v_user_a uuid;
  v_user_b uuid;
  v_marker text := 'QA_LEGACY_SYNTHETIC_202605';
  v_user_a_count integer;
  v_user_b_count integer;
  v_existing_count integer;
  v_group_count integer;
  v_session_count integer;
  v_entry_count integer;
  v_user_count integer;
  v_orphan_count integer;
  v_ownership_issue_count integer;
  v_mixed_routine_count integer;
  v_mixed_day_count integer;
begin
  select count(*) into v_user_a_count
  from public.profiles
  where display_name = 'QA Legacy Synthetic User A';

  select count(*) into v_user_b_count
  from public.profiles
  where display_name = 'QA Legacy Synthetic User B';

  if v_user_a_count <> 1 or v_user_b_count <> 1 then
    raise exception 'Dataset QA requiere exactamente 1 perfil QA Legacy Synthetic User A y 1 perfil QA Legacy Synthetic User B. Encontrados A=%, B=%',
      v_user_a_count,
      v_user_b_count;
  end if;

  select id into v_user_a
  from public.profiles
  where display_name = 'QA Legacy Synthetic User A';

  select id into v_user_b
  from public.profiles
  where display_name = 'QA Legacy Synthetic User B';

  if v_user_a = v_user_b then
    raise exception 'Dataset QA requiere dos usuarios sinteticos distintos';
  end if;

  select count(*) into v_existing_count
  from public.routines
  where name like v_marker || '%';

  if v_existing_count <> 0 then
    raise exception 'Dataset QA sintetico ya existe. Ejecutar cleanup antes de recrearlo. Rutinas encontradas %', v_existing_count;
  end if;

  create temp table qa_synthetic_groups (
    user_id uuid not null,
    group_no integer not null,
    routine_name text not null,
    planned_day text not null,
    trained_at date not null,
    week_number integer not null,
    entry_count integer not null,
    primary key (user_id, group_no)
  ) on commit drop;

  insert into qa_synthetic_groups (
    user_id,
    group_no,
    routine_name,
    planned_day,
    trained_at,
    week_number,
    entry_count
  )
  values
    (v_user_a, 1, v_marker || ' Routine A Lunes', 'Lunes', date '2026-05-04', 1, 6),
    (v_user_a, 2, v_marker || ' Routine A Martes', 'Martes', date '2026-05-05', 1, 6),
    (v_user_a, 3, v_marker || ' Routine A Miercoles', 'Miercoles', date '2026-05-06', 1, 6),
    (v_user_b, 4, v_marker || ' Routine B Jueves', 'Jueves', date '2026-05-07', 1, 6),
    (v_user_b, 5, v_marker || ' Routine B Viernes', 'Viernes', date '2026-05-08', 1, 6);

  create temp table qa_synthetic_routines (
    user_id uuid not null,
    group_no integer not null,
    routine_id uuid not null,
    primary key (user_id, group_no)
  ) on commit drop;

  insert into public.routines (
    user_id,
    name
  )
  select
    user_id,
    routine_name
  from qa_synthetic_groups;

  insert into qa_synthetic_routines (
    user_id,
    group_no,
    routine_id
  )
  select
    g.user_id,
    g.group_no,
    r.id
  from qa_synthetic_groups g
  join public.routines r on r.user_id = g.user_id
    and r.name = g.routine_name;

  create temp table qa_synthetic_exercises (
    user_id uuid not null,
    group_no integer not null,
    exercise_no integer not null,
    exercise_id uuid not null,
    primary key (user_id, group_no, exercise_no)
  ) on commit drop;

  insert into public.exercises (
    user_id,
    routine_id,
    name,
    target_sets,
    target_reps,
    base_weight,
    day,
    notes
  )
  select
    g.user_id,
    r.routine_id,
    v_marker || ' Exercise G' || g.group_no::text || '-' || series.exercise_no::text,
    3,
    10 + series.exercise_no,
    20 + series.exercise_no,
    g.planned_day,
    v_marker || ' legacy synthetic exercise'
  from qa_synthetic_groups g
  join qa_synthetic_routines r on r.user_id = g.user_id
    and r.group_no = g.group_no
  cross join lateral generate_series(1, g.entry_count) as series(exercise_no);

  insert into qa_synthetic_exercises (
    user_id,
    group_no,
    exercise_no,
    exercise_id
  )
  select
    g.user_id,
    g.group_no,
    series.exercise_no,
    e.id
  from qa_synthetic_groups g
  cross join lateral generate_series(1, g.entry_count) as series(exercise_no)
  join qa_synthetic_routines r on r.user_id = g.user_id
    and r.group_no = g.group_no
  join public.exercises e on e.user_id = g.user_id
    and e.routine_id = r.routine_id
    and e.name = v_marker || ' Exercise G' || g.group_no::text || '-' || series.exercise_no::text;

  create temp table qa_synthetic_sessions (
    user_id uuid not null,
    group_no integer not null,
    exercise_no integer not null,
    session_id uuid not null,
    primary key (user_id, group_no, exercise_no)
  ) on commit drop;

  insert into public.training_sessions (
    user_id,
    week_number,
    trained_at,
    notes,
    routine_id,
    calendar_week_start,
    planned_day,
    planned_date,
    trained_date,
    completed_at,
    deleted_at
  )
  select
    g.user_id,
    g.week_number,
    g.trained_at,
    v_marker || ' legacy synthetic session G' || g.group_no::text || '-' || series.exercise_no::text,
    null,
    null,
    null,
    null,
    null,
    null,
    null
  from qa_synthetic_groups g
  cross join lateral generate_series(1, g.entry_count) as series(exercise_no);

  insert into qa_synthetic_sessions (
    user_id,
    group_no,
    exercise_no,
    session_id
  )
  select
    g.user_id,
    g.group_no,
    series.exercise_no,
    s.id
  from qa_synthetic_groups g
  cross join lateral generate_series(1, g.entry_count) as series(exercise_no)
  join public.training_sessions s on s.user_id = g.user_id
    and s.trained_at = g.trained_at
    and s.week_number = g.week_number
    and s.notes = v_marker || ' legacy synthetic session G' || g.group_no::text || '-' || series.exercise_no::text;

  insert into public.exercise_entries (
    user_id,
    session_id,
    exercise_id,
    weight,
    previous_weight,
    reps,
    rir,
    notes
  )
  select
    e.user_id,
    s.session_id,
    e.exercise_id,
    20 + e.exercise_no,
    15 + e.exercise_no,
    array[10 + e.exercise_no, 9 + e.exercise_no, 8 + e.exercise_no],
    '2',
    v_marker || ' legacy synthetic entry G' || e.group_no::text || '-' || e.exercise_no::text
  from qa_synthetic_exercises e
  join qa_synthetic_sessions s on s.user_id = e.user_id
    and s.group_no = e.group_no
    and s.exercise_no = e.exercise_no;

  select count(*) into v_group_count
  from (
    select s.user_id, s.trained_at, s.week_number
    from public.training_sessions s
    where s.notes like v_marker || ' legacy synthetic session%'
    group by s.user_id, s.trained_at, s.week_number
  ) groups;

  if v_group_count <> 5 then
    raise exception 'Dataset QA esperado: 5 grupos legacy; encontrado %', v_group_count;
  end if;

  select count(*) into v_session_count
  from public.training_sessions
  where notes like v_marker || ' legacy synthetic session%';

  if v_session_count <> 30 then
    raise exception 'Dataset QA esperado: 30 training_sessions legacy; encontrado %', v_session_count;
  end if;

  select count(*) into v_entry_count
  from public.exercise_entries
  where notes like v_marker || ' legacy synthetic entry%';

  if v_entry_count <> 30 then
    raise exception 'Dataset QA esperado: 30 exercise_entries; encontrado %', v_entry_count;
  end if;

  select count(distinct user_id) into v_user_count
  from public.training_sessions
  where notes like v_marker || ' legacy synthetic session%';

  if v_user_count <> 2 then
    raise exception 'Dataset QA esperado: 2 usuarios afectados; encontrado %', v_user_count;
  end if;

  select count(*) into v_orphan_count
  from public.exercise_entries e
  left join public.exercises ex on ex.id = e.exercise_id
  where e.notes like v_marker || ' legacy synthetic entry%'
    and ex.id is null;

  if v_orphan_count <> 0 then
    raise exception 'Dataset QA esperado: 0 orphan_entries; encontrado %', v_orphan_count;
  end if;

  select count(*) into v_ownership_issue_count
  from public.exercise_entries e
  join public.training_sessions s on s.id = e.session_id
  join public.exercises ex on ex.id = e.exercise_id
  where e.notes like v_marker || ' legacy synthetic entry%'
    and (
      e.user_id <> s.user_id
      or ex.user_id <> s.user_id
    );

  if v_ownership_issue_count <> 0 then
    raise exception 'Dataset QA esperado: 0 ownership_issues; encontrado %', v_ownership_issue_count;
  end if;

  select count(*) into v_mixed_routine_count
  from (
    select s.user_id, s.trained_at, s.week_number
    from public.training_sessions s
    join public.exercise_entries e on e.session_id = s.id
    join public.exercises ex on ex.id = e.exercise_id
    where s.notes like v_marker || ' legacy synthetic session%'
    group by s.user_id, s.trained_at, s.week_number
    having count(distinct ex.routine_id) <> 1
  ) mixed;

  if v_mixed_routine_count <> 0 then
    raise exception 'Dataset QA esperado: 0 mezcla de rutinas; encontrado %', v_mixed_routine_count;
  end if;

  select count(*) into v_mixed_day_count
  from (
    select s.user_id, s.trained_at, s.week_number
    from public.training_sessions s
    join public.exercise_entries e on e.session_id = s.id
    join public.exercises ex on ex.id = e.exercise_id
    where s.notes like v_marker || ' legacy synthetic session%'
    group by s.user_id, s.trained_at, s.week_number
    having count(distinct ex.day) <> 1
  ) mixed;

  if v_mixed_day_count <> 0 then
    raise exception 'Dataset QA esperado: 0 mezcla de dias; encontrado %', v_mixed_day_count;
  end if;
end $$;

commit;
