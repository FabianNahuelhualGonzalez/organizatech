-- Release B - D3 hotfix: save v2 ON CONFLICT ambiguity.
-- Solo QA: fjjebhaqtrdbpxzxztmh.
-- Ejecutado manualmente el 24-06-2026.
-- Causa: PostgreSQL 42702 por ambiguedad en ON CONFLICT (user_id, workout_attempt_id).
-- Resultado en QA: Success. No rows returned.
-- No ejecutar en Production sin fase separada y autorizacion explicita.

begin;

create or replace function public.save_training_workout_readiness_v2(
  p_workout_attempt_id uuid,
  p_cycle_id uuid,
  p_cycle_day_id uuid,
  p_workout_started_at timestamptz,
  p_payload jsonb
)
returns table (
  id uuid,
  user_id uuid,
  workout_attempt_id uuid,
  cycle_id uuid,
  cycle_day_id uuid,
  workout_started_at timestamptz,
  local_date date,
  payload jsonb,
  training_session_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  context_mismatch boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_local_date date;
  v_id uuid;
  v_persisted_user_id uuid;
  v_persisted_workout_attempt_id uuid;
  v_persisted_cycle_id uuid;
  v_persisted_cycle_day_id uuid;
  v_persisted_workout_started_at timestamptz;
  v_persisted_local_date date;
  v_training_session_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
  v_updated_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_workout_attempt_id is null then
    raise exception 'workout_attempt_id requerido';
  end if;

  if p_cycle_id is null then
    raise exception 'cycle_id requerido';
  end if;

  if p_cycle_day_id is null then
    raise exception 'cycle_day_id requerido';
  end if;

  if p_workout_started_at is null then
    raise exception 'workout_started_at requerido';
  end if;

  v_local_date := (p_workout_started_at at time zone 'America/Santiago')::date;

  select
    readiness.id,
    readiness.user_id,
    readiness.workout_attempt_id,
    readiness.cycle_id,
    readiness.cycle_day_id,
    readiness.workout_started_at,
    readiness.local_date,
    readiness.payload,
    readiness.training_session_id,
    readiness.created_at,
    readiness.updated_at,
    (
      readiness.cycle_id is distinct from p_cycle_id
      or readiness.cycle_day_id is distinct from p_cycle_day_id
      or readiness.workout_started_at is distinct from p_workout_started_at
      or readiness.local_date is distinct from v_local_date
      or readiness.payload is distinct from p_payload
    )
  into
    v_id,
    v_persisted_user_id,
    v_persisted_workout_attempt_id,
    v_persisted_cycle_id,
    v_persisted_cycle_day_id,
    v_persisted_workout_started_at,
    v_persisted_local_date,
    v_payload,
    v_training_session_id,
    v_created_at,
    v_updated_at,
    context_mismatch
  from public.training_workout_readiness as readiness
  where readiness.user_id = v_user_id
    and readiness.workout_attempt_id = p_workout_attempt_id;

  if v_id is not null then
    id := v_id;
    user_id := v_persisted_user_id;
    workout_attempt_id := v_persisted_workout_attempt_id;
    cycle_id := v_persisted_cycle_id;
    cycle_day_id := v_persisted_cycle_day_id;
    workout_started_at := v_persisted_workout_started_at;
    local_date := v_persisted_local_date;
    payload := v_payload;
    training_session_id := v_training_session_id;
    created_at := v_created_at;
    updated_at := v_updated_at;
    return next;
    return;
  end if;

  if p_workout_started_at > now() + interval '5 minutes'
    or p_workout_started_at < now() - interval '36 hours' then
    raise exception 'workout_started_at fuera de ventana permitida';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload de readiness invalido';
  end if;

  if not (p_payload ? 'skipped') or jsonb_typeof(p_payload->'skipped') <> 'boolean' then
    raise exception 'Payload de readiness invalido';
  end if;

  if coalesce((p_payload->>'skipped')::boolean, false) = false then
    if jsonb_typeof(p_payload->'motivation') <> 'number'
      or jsonb_typeof(p_payload->'hydration') <> 'number'
      or jsonb_typeof(p_payload->'sleep') <> 'number'
      or jsonb_typeof(p_payload->'energy') <> 'number'
      or (p_payload->>'motivation')::integer not between 1 and 7
      or (p_payload->>'hydration')::integer not between 1 and 7
      or (p_payload->>'sleep')::integer not between 1 and 7
      or (p_payload->>'energy')::integer not between 1 and 7
      or (p_payload->>'motivation')::numeric <> (p_payload->>'motivation')::integer
      or (p_payload->>'hydration')::numeric <> (p_payload->>'hydration')::integer
      or (p_payload->>'sleep')::numeric <> (p_payload->>'sleep')::integer
      or (p_payload->>'energy')::numeric <> (p_payload->>'energy')::integer then
      raise exception 'Payload de readiness invalido';
    end if;
  end if;

  if not exists (
    select 1
    from public.training_cycles as cycle
    where cycle.id = p_cycle_id
      and cycle.user_id = v_user_id
      and cycle.deleted_at is null
  ) then
    raise exception 'El ciclo no pertenece al usuario autenticado';
  end if;

  if not exists (
    select 1
    from public.training_cycle_days as day
    where day.id = p_cycle_day_id
      and day.cycle_id = p_cycle_id
      and day.deleted_at is null
  ) then
    raise exception 'El dia no pertenece al ciclo indicado';
  end if;

  insert into public.training_workout_readiness as readiness (
    user_id,
    workout_attempt_id,
    cycle_id,
    cycle_day_id,
    workout_started_at,
    local_date,
    payload
  )
  values (
    v_user_id,
    p_workout_attempt_id,
    p_cycle_id,
    p_cycle_day_id,
    p_workout_started_at,
    v_local_date,
    p_payload
  )
  on conflict on constraint training_workout_readiness_user_attempt_key
  do nothing
  returning
    readiness.id,
    readiness.user_id,
    readiness.workout_attempt_id,
    readiness.cycle_id,
    readiness.cycle_day_id,
    readiness.workout_started_at,
    readiness.local_date,
    readiness.training_session_id,
    readiness.payload,
    readiness.created_at,
    readiness.updated_at
  into
    v_id,
    v_persisted_user_id,
    v_persisted_workout_attempt_id,
    v_persisted_cycle_id,
    v_persisted_cycle_day_id,
    v_persisted_workout_started_at,
    v_persisted_local_date,
    v_training_session_id,
    v_payload,
    v_created_at,
    v_updated_at;

  if v_id is null then
    select
      readiness.id,
      readiness.user_id,
      readiness.workout_attempt_id,
      readiness.cycle_id,
      readiness.cycle_day_id,
      readiness.workout_started_at,
      readiness.local_date,
      readiness.training_session_id,
      readiness.payload,
      readiness.created_at,
      readiness.updated_at,
      (
        readiness.cycle_id is distinct from p_cycle_id
        or readiness.cycle_day_id is distinct from p_cycle_day_id
        or readiness.workout_started_at is distinct from p_workout_started_at
        or readiness.local_date is distinct from v_local_date
        or readiness.payload is distinct from p_payload
      )
    into
      v_id,
      v_persisted_user_id,
      v_persisted_workout_attempt_id,
      v_persisted_cycle_id,
      v_persisted_cycle_day_id,
      v_persisted_workout_started_at,
      v_persisted_local_date,
      v_training_session_id,
      v_payload,
      v_created_at,
      v_updated_at,
      context_mismatch
    from public.training_workout_readiness as readiness
    where readiness.user_id = v_user_id
      and readiness.workout_attempt_id = p_workout_attempt_id;
  else
    context_mismatch := false;
  end if;

  if v_id is null then
    raise exception 'No se pudo confirmar readiness de entrenamiento';
  end if;

  id := v_id;
  user_id := v_persisted_user_id;
  workout_attempt_id := v_persisted_workout_attempt_id;
  cycle_id := v_persisted_cycle_id;
  cycle_day_id := v_persisted_cycle_day_id;
  workout_started_at := v_persisted_workout_started_at;
  local_date := v_persisted_local_date;
  payload := v_payload;
  training_session_id := v_training_session_id;
  created_at := v_created_at;
  updated_at := v_updated_at;
  return next;
end;
$function$;

revoke all on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) from public;
revoke all on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) from anon;
revoke all on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) from service_role;
grant execute on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) to authenticated;

commit;