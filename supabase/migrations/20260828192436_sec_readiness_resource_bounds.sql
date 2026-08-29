-- SECURITY-SCAN-2179 / finding 3: bound authenticated workout readiness writes.
-- Forward-only: historical rows are preserved and only new inserts use the
-- stricter structural boundary.

create index if not exists training_workout_readiness_user_pending_created_idx
  on public.training_workout_readiness(user_id, created_at desc)
  where training_session_id is null;

create or replace function public.enforce_training_workout_readiness_payload_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.payload is null
    or pg_catalog.jsonb_typeof(new.payload) is distinct from 'object'
    or pg_catalog.octet_length(new.payload::pg_catalog.text) > 1024
  then
    raise exception using errcode = '22023', message = 'Payload de readiness invalido';
  end if;

  if new.payload->'skipped' = 'true'::pg_catalog.jsonb then
    if new.payload <> pg_catalog.jsonb_build_object('skipped', true) then
      raise exception using errcode = '22023', message = 'Payload de readiness invalido';
    end if;
  elsif new.payload->'skipped' = 'false'::pg_catalog.jsonb then
    if new.payload <> pg_catalog.jsonb_build_object(
        'skipped', false,
        'motivation', new.payload->'motivation',
        'hydration', new.payload->'hydration',
        'sleep', new.payload->'sleep',
        'energy', new.payload->'energy'
      )
      or pg_catalog.jsonb_typeof(new.payload->'motivation') is distinct from 'number'
      or pg_catalog.jsonb_typeof(new.payload->'hydration') is distinct from 'number'
      or pg_catalog.jsonb_typeof(new.payload->'sleep') is distinct from 'number'
      or pg_catalog.jsonb_typeof(new.payload->'energy') is distinct from 'number'
      or (new.payload->>'motivation')::pg_catalog.numeric not between 1 and 7
      or (new.payload->>'hydration')::pg_catalog.numeric not between 1 and 7
      or (new.payload->>'sleep')::pg_catalog.numeric not between 1 and 7
      or (new.payload->>'energy')::pg_catalog.numeric not between 1 and 7
      or pg_catalog.trunc((new.payload->>'motivation')::pg_catalog.numeric) <> (new.payload->>'motivation')::pg_catalog.numeric
      or pg_catalog.trunc((new.payload->>'hydration')::pg_catalog.numeric) <> (new.payload->>'hydration')::pg_catalog.numeric
      or pg_catalog.trunc((new.payload->>'sleep')::pg_catalog.numeric) <> (new.payload->>'sleep')::pg_catalog.numeric
      or pg_catalog.trunc((new.payload->>'energy')::pg_catalog.numeric) <> (new.payload->>'energy')::pg_catalog.numeric
    then
      raise exception using errcode = '22023', message = 'Payload de readiness invalido';
    end if;
  else
    raise exception using errcode = '22023', message = 'Payload de readiness invalido';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_training_workout_readiness_payload_insert()
  from public, anon, authenticated, service_role;

drop trigger if exists training_workout_readiness_payload_insert_guard
  on public.training_workout_readiness;
create trigger training_workout_readiness_payload_insert_guard
  before insert on public.training_workout_readiness
  for each row execute function public.enforce_training_workout_readiness_payload_insert();

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
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_local_date date;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_recent_attempt_count integer;
  v_pending_attempt_count integer;
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

  v_local_date := (p_workout_started_at at time zone 'America/Santiago')::pg_catalog.date;

  -- Exact retries remain available even when the account has reached a quota.
  return query
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
  from public.training_workout_readiness as readiness
  where readiness.user_id = v_user_id
    and readiness.workout_attempt_id = p_workout_attempt_id;

  if found then
    return;
  end if;

  if p_payload is null
    or pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
    or pg_catalog.octet_length(p_payload::pg_catalog.text) > 1024
  then
    raise exception using errcode = '22023', message = 'Payload de readiness invalido';
  end if;

  if p_payload->'skipped' = 'true'::pg_catalog.jsonb then
    if p_payload <> pg_catalog.jsonb_build_object('skipped', true) then
      raise exception using errcode = '22023', message = 'Payload de readiness invalido';
    end if;
  elsif p_payload->'skipped' = 'false'::pg_catalog.jsonb then
    if p_payload <> pg_catalog.jsonb_build_object(
        'skipped', false,
        'motivation', p_payload->'motivation',
        'hydration', p_payload->'hydration',
        'sleep', p_payload->'sleep',
        'energy', p_payload->'energy'
      )
      or pg_catalog.jsonb_typeof(p_payload->'motivation') is distinct from 'number'
      or pg_catalog.jsonb_typeof(p_payload->'hydration') is distinct from 'number'
      or pg_catalog.jsonb_typeof(p_payload->'sleep') is distinct from 'number'
      or pg_catalog.jsonb_typeof(p_payload->'energy') is distinct from 'number'
      or (p_payload->>'motivation')::pg_catalog.numeric not between 1 and 7
      or (p_payload->>'hydration')::pg_catalog.numeric not between 1 and 7
      or (p_payload->>'sleep')::pg_catalog.numeric not between 1 and 7
      or (p_payload->>'energy')::pg_catalog.numeric not between 1 and 7
      or pg_catalog.trunc((p_payload->>'motivation')::pg_catalog.numeric) <> (p_payload->>'motivation')::pg_catalog.numeric
      or pg_catalog.trunc((p_payload->>'hydration')::pg_catalog.numeric) <> (p_payload->>'hydration')::pg_catalog.numeric
      or pg_catalog.trunc((p_payload->>'sleep')::pg_catalog.numeric) <> (p_payload->>'sleep')::pg_catalog.numeric
      or pg_catalog.trunc((p_payload->>'energy')::pg_catalog.numeric) <> (p_payload->>'energy')::pg_catalog.numeric
    then
      raise exception using errcode = '22023', message = 'Payload de readiness invalido';
    end if;
  else
    raise exception using errcode = '22023', message = 'Payload de readiness invalido';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organizatech:security-readiness:user:' || v_user_id::pg_catalog.text,
      0
    )
  );

  -- Recheck after the per-user lock so concurrent retries stay idempotent.
  return query
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
  from public.training_workout_readiness as readiness
  where readiness.user_id = v_user_id
    and readiness.workout_attempt_id = p_workout_attempt_id;

  if found then
    return;
  end if;

  if p_workout_started_at > v_now + interval '5 minutes'
    or p_workout_started_at < v_now - interval '36 hours'
  then
    raise exception 'workout_started_at fuera de ventana permitida';
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

  select pg_catalog.count(*)::integer
    into v_recent_attempt_count
  from (
    select 1
    from public.training_workout_readiness as readiness
    where readiness.user_id = v_user_id
      and readiness.created_at >= v_now - interval '36 hours'
    limit 32
  ) as recent_attempts;

  if v_recent_attempt_count >= 32 then
    raise exception using errcode = '54000', message = 'Limite de intentos de readiness alcanzado';
  end if;

  select pg_catalog.count(*)::integer
    into v_pending_attempt_count
  from (
    select 1
    from public.training_workout_readiness as readiness
    where readiness.user_id = v_user_id
      and readiness.training_session_id is null
    limit 32
  ) as pending_attempts;

  if v_pending_attempt_count >= 32 then
    raise exception using errcode = '54000', message = 'Limite de readiness pendientes alcanzado';
  end if;

  return query
  insert into public.training_workout_readiness as readiness (
    user_id,
    workout_attempt_id,
    cycle_id,
    cycle_day_id,
    workout_started_at,
    local_date,
    payload,
    created_at,
    updated_at
  ) values (
    v_user_id,
    p_workout_attempt_id,
    p_cycle_id,
    p_cycle_day_id,
    p_workout_started_at,
    v_local_date,
    p_payload,
    v_now,
    v_now
  )
  on conflict on constraint training_workout_readiness_user_attempt_key do nothing
  returning
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
    false;

  if found then
    return;
  end if;

  -- Compatibility fallback for a transaction that began under the old body.
  return query
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
  from public.training_workout_readiness as readiness
  where readiness.user_id = v_user_id
    and readiness.workout_attempt_id = p_workout_attempt_id;

  if found then
    return;
  end if;

  raise exception 'No se pudo confirmar readiness de entrenamiento';
end;
$function$;

revoke all on function public.save_training_workout_readiness_v2(
  uuid, uuid, uuid, timestamptz, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.save_training_workout_readiness_v2(
  uuid, uuid, uuid, timestamptz, jsonb
) to authenticated;
