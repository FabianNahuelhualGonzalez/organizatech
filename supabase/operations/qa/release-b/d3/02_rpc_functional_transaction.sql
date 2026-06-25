-- Release B - D3 - RPC v2 functional transaction.
-- Ejecutar solo en Supabase QA: fjjebhaqtrdbpxzxztmh.
-- Todas las escrituras quedan dentro de esta transaccion y se descartan con rollback.
-- No imprime UUIDs ni payloads.

begin;

do $d3_setup$
declare
  v_candidate record;
  v_workout_readiness_rows bigint;
  v_legacy_rows_before bigint;
begin
  if to_regclass('public.training_workout_readiness') is null then
    raise exception 'D3 abortado: falta public.training_workout_readiness';
  end if;

  if to_regclass('public.training_daily_readiness') is null then
    raise exception 'D3 abortado: falta public.training_daily_readiness';
  end if;

  select count(*) into v_workout_readiness_rows
  from public.training_workout_readiness;

  if v_workout_readiness_rows <> 0 then
    raise exception 'D3 abortado: training_workout_readiness debe tener 0 filas, tiene %', v_workout_readiness_rows;
  end if;

  select count(*)
  into v_legacy_rows_before
  from public.training_daily_readiness;

  perform set_config('app.d3.legacy_rows_before', v_legacy_rows_before::text, true);

  select
    session.user_id,
    session.cycle_id,
    session.cycle_day_id,
    session.id as training_session_id,
    session.created_at as workout_started_at
  into v_candidate
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
  order by session.created_at desc, session.id
  limit 1;

  if v_candidate.training_session_id is null then
    raise exception 'D3 abortado: no existe sesion candidata reciente no enlazada';
  end if;

  perform set_config('request.jwt.claim.sub', v_candidate.user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('app.d3.user_id', v_candidate.user_id::text, true);
  perform set_config('app.d3.cycle_id', v_candidate.cycle_id::text, true);
  perform set_config('app.d3.cycle_day_id', v_candidate.cycle_day_id::text, true);
  perform set_config('app.d3.training_session_id', v_candidate.training_session_id::text, true);
  perform set_config('app.d3.workout_started_at', v_candidate.workout_started_at::text, true);
  perform set_config('app.d3.workout_attempt_id_1', gen_random_uuid()::text, true);
  perform set_config('app.d3.workout_attempt_id_2', gen_random_uuid()::text, true);
end;
$d3_setup$;

set local role authenticated;

do $d3_authenticated$
declare
  v_user_id uuid := current_setting('app.d3.user_id')::uuid;
  v_cycle_id uuid := current_setting('app.d3.cycle_id')::uuid;
  v_cycle_day_id uuid := current_setting('app.d3.cycle_day_id')::uuid;
  v_training_session_id uuid := current_setting('app.d3.training_session_id')::uuid;
  v_workout_started_at timestamptz := current_setting('app.d3.workout_started_at')::timestamptz;
  v_attempt_1 uuid := current_setting('app.d3.workout_attempt_id_1')::uuid;
  v_attempt_2 uuid := current_setting('app.d3.workout_attempt_id_2')::uuid;
  v_payload_1 jsonb := '{"skipped": false, "motivation": 4, "hydration": 5, "sleep": 6, "energy": 7}'::jsonb;
  v_payload_changed jsonb := '{"skipped": false, "motivation": 7, "hydration": 6, "sleep": 5, "energy": 4}'::jsonb;
  v_payload_2 jsonb := '{"skipped": true}'::jsonb;
  v_save_1 record;
  v_save_1_retry record;
  v_save_1_changed record;
  v_save_2 record;
  v_link_1 record;
  v_link_1_retry record;
  v_row_count bigint;
  v_linked_attempt_1_count bigint;
  v_attempt_2_unlinked_count bigint;
begin
  select * into v_save_1
  from public.save_training_workout_readiness_v2(v_attempt_1, v_cycle_id, v_cycle_day_id, v_workout_started_at, v_payload_1);

  if v_save_1.id is null
    or v_save_1.context_mismatch is not false
    or v_save_1.user_id <> v_user_id
    or v_save_1.cycle_id <> v_cycle_id
    or v_save_1.cycle_day_id <> v_cycle_day_id
    or v_save_1.workout_started_at <> v_workout_started_at
    or v_save_1.local_date <> (v_workout_started_at at time zone 'America/Santiago')::date
    or v_save_1.payload <> v_payload_1
    or v_save_1.training_session_id is not null then
    raise exception 'D3 escenario 1 fallo: primer guardado invalido';
  end if;

  select count(*) into v_row_count
  from public.training_workout_readiness
  where user_id = v_user_id
    and workout_attempt_id = v_attempt_1;

  if v_row_count <> 1 then
    raise exception 'D3 escenario 1 fallo: cantidad de filas inesperada %', v_row_count;
  end if;

  select * into v_save_1_retry
  from public.save_training_workout_readiness_v2(v_attempt_1, v_cycle_id, v_cycle_day_id, v_workout_started_at, v_payload_1);

  if v_save_1_retry.id <> v_save_1.id
    or v_save_1_retry.context_mismatch is not false then
    raise exception 'D3 escenario 2 fallo: retry identico no idempotente';
  end if;

  select count(*) into v_row_count
  from public.training_workout_readiness
  where user_id = v_user_id
    and workout_attempt_id = v_attempt_1;

  if v_row_count <> 1 then
    raise exception 'D3 escenario 2 fallo: retry creo filas adicionales';
  end if;

  select * into v_save_1_changed
  from public.save_training_workout_readiness_v2(v_attempt_1, v_cycle_id, v_cycle_day_id, v_workout_started_at, v_payload_changed);

  if v_save_1_changed.id <> v_save_1.id
    or v_save_1_changed.context_mismatch is not true
    or v_save_1_changed.payload <> v_payload_1 then
    raise exception 'D3 escenario 3 fallo: retry con payload distinto no devolvio persistido';
  end if;

  if exists (
    select 1
    from public.training_workout_readiness
    where user_id = v_user_id
      and workout_attempt_id = v_attempt_1
      and payload <> v_payload_1
  ) then
    raise exception 'D3 escenario 3 fallo: payload original fue sobrescrito';
  end if;

  select * into v_save_2
  from public.save_training_workout_readiness_v2(v_attempt_2, v_cycle_id, v_cycle_day_id, v_workout_started_at, v_payload_2);

  if v_save_2.id is null
    or v_save_2.id = v_save_1.id
    or v_save_2.context_mismatch is not false
    or v_save_2.training_session_id is not null
    or v_save_2.payload <> v_payload_2 then
    raise exception 'D3 escenario 4 fallo: segundo intento invalido';
  end if;

  select count(*) into v_row_count
  from public.training_workout_readiness
  where user_id = v_user_id
    and workout_attempt_id in (v_attempt_1, v_attempt_2);

  if v_row_count <> 2 then
    raise exception 'D3 escenario 4 fallo: no coexisten dos intentos';
  end if;

  select * into v_link_1
  from public.link_training_workout_readiness_session_v2(v_attempt_1, v_training_session_id);

  if v_link_1.training_session_id <> v_training_session_id
    or v_link_1.linked is not true
    or v_link_1.already_linked is not false then
    raise exception 'D3 escenario 5 fallo: primer enlace invalido';
  end if;

  select count(*) into v_linked_attempt_1_count
  from public.training_workout_readiness
  where user_id = v_user_id
    and workout_attempt_id = v_attempt_1
    and training_session_id = v_training_session_id;

  select count(*) into v_attempt_2_unlinked_count
  from public.training_workout_readiness
  where user_id = v_user_id
    and workout_attempt_id = v_attempt_2
    and training_session_id is null;

  if v_linked_attempt_1_count <> 1 or v_attempt_2_unlinked_count <> 1 then
    raise exception 'D3 escenario 5 fallo: enlace afecto filas incorrectas';
  end if;

  select * into v_link_1_retry
  from public.link_training_workout_readiness_session_v2(v_attempt_1, v_training_session_id);

  if v_link_1_retry.id <> v_link_1.id
    or v_link_1_retry.training_session_id <> v_training_session_id
    or v_link_1_retry.linked is not true
    or v_link_1_retry.already_linked is not true then
    raise exception 'D3 escenario 6 fallo: retry de enlace no idempotente';
  end if;
end;
$d3_authenticated$;

reset role;

do $d3_admin_final$
declare
  v_attempt_1 uuid := current_setting('app.d3.workout_attempt_id_1')::uuid;
  v_attempt_2 uuid := current_setting('app.d3.workout_attempt_id_2')::uuid;
  v_training_session_id uuid := current_setting('app.d3.training_session_id')::uuid;
  v_payload_1 jsonb := '{"skipped": false, "motivation": 4, "hydration": 5, "sleep": 6, "energy": 7}'::jsonb;
  v_payload_2 jsonb := '{"skipped": true}'::jsonb;
  v_temporary_rows bigint;
  v_legacy_rows_before bigint := current_setting('app.d3.legacy_rows_before')::bigint;
  v_legacy_rows_after bigint;
begin
  select count(*) into v_temporary_rows
  from public.training_workout_readiness
  where workout_attempt_id in (v_attempt_1, v_attempt_2);

  if v_temporary_rows <> 2 then
    raise exception 'D3 verificacion final fallo: filas temporales %', v_temporary_rows;
  end if;

  if not exists (
    select 1
    from public.training_workout_readiness
    where workout_attempt_id = v_attempt_1
      and training_session_id = v_training_session_id
      and payload = v_payload_1
  ) then
    raise exception 'D3 verificacion final fallo: attempt 1 no esta enlazado o payload cambio';
  end if;

  if not exists (
    select 1
    from public.training_workout_readiness
    where workout_attempt_id = v_attempt_2
      and training_session_id is null
      and payload = v_payload_2
  ) then
    raise exception 'D3 verificacion final fallo: attempt 2 no esta pendiente con skipped true';
  end if;

  select count(*)
  into v_legacy_rows_after
  from public.training_daily_readiness;

  if v_legacy_rows_after <> v_legacy_rows_before then
    raise exception 'D3 verificacion final fallo: legacy cambio de % a % filas', v_legacy_rows_before, v_legacy_rows_after;
  end if;

  perform set_config('app.d3.legacy_rows_after', v_legacy_rows_after::text, true);
end;
$d3_admin_final$;

with context as (
  select
    current_setting('app.d3.workout_attempt_id_1')::uuid as attempt_1,
    current_setting('app.d3.workout_attempt_id_2')::uuid as attempt_2,
    current_setting('app.d3.training_session_id')::uuid as training_session_id,
    current_setting('app.d3.legacy_rows_before')::bigint as legacy_rows_before,
    current_setting('app.d3.legacy_rows_after')::bigint as legacy_rows_after
),
temporary_counts as (
  select
    count(*) filter (where readiness.workout_attempt_id in (context.attempt_1, context.attempt_2)) as temporary_training_workout_readiness_rows,
    count(*) filter (where readiness.workout_attempt_id = context.attempt_1 and readiness.training_session_id = context.training_session_id) as attempt_1_linked_rows,
    count(*) filter (where readiness.workout_attempt_id = context.attempt_2 and readiness.training_session_id is null) as attempt_2_unlinked_rows,
    context.legacy_rows_before,
    context.legacy_rows_after
  from context
  left join public.training_workout_readiness as readiness on true
  group by context.legacy_rows_before, context.legacy_rows_after
),
checks as (
  select 'two_temporary_rows' as check_name, temporary_training_workout_readiness_rows = 2 as ok from temporary_counts
  union all
  select 'attempt_1_linked', attempt_1_linked_rows = 1 from temporary_counts
  union all
  select 'attempt_2_unlinked', attempt_2_unlinked_rows = 1 from temporary_counts
  union all
  select 'legacy_count_unchanged', legacy_rows_after = legacy_rows_before from temporary_counts
)
select
  case when bool_and(checks.ok) then 'D3_RPC_FUNCTIONAL_VERIFIED' else 'D3_RPC_FUNCTIONAL_FAILED' end as verdict,
  jsonb_object_agg(checks.check_name, checks.ok order by checks.check_name) as checks,
  (select to_jsonb(temporary_counts) from temporary_counts) as temporary_counts
from checks;

rollback;