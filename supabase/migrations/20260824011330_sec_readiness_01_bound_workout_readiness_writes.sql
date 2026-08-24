-- SEC-READINESS-01: bound client-controlled workout readiness writes.
--
-- Forward-only and QA-first:
-- - preserves the RPC signatures and result shapes;
-- - does not rewrite or validate historical rows;
-- - keeps legacy readiness and the session-link contract intact;
-- - enforces the structural payload boundary only on new rows so a later link
--   can still update a historical row whose payload predates this contract.

create or replace function public.enforce_training_workout_readiness_payload_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.payload is null
    or pg_catalog.jsonb_typeof(new.payload) is distinct from 'object'
    or pg_catalog.octet_length(new.payload::pg_catalog.text) > 1024 then
    raise exception using
      errcode = '22023',
      message = 'Payload de readiness invalido';
  end if;

  if new.payload->'skipped' = 'true'::pg_catalog.jsonb then
    if new.payload <> pg_catalog.jsonb_build_object('skipped', true) then
      raise exception using
        errcode = '22023',
        message = 'Payload de readiness invalido';
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
      or pg_catalog.jsonb_typeof(new.payload->'energy') is distinct from 'number' then
      raise exception using
        errcode = '22023',
        message = 'Payload de readiness invalido';
    end if;

    if (new.payload->>'motivation')::pg_catalog.numeric not between 1 and 7
      or (new.payload->>'hydration')::pg_catalog.numeric not between 1 and 7
      or (new.payload->>'sleep')::pg_catalog.numeric not between 1 and 7
      or (new.payload->>'energy')::pg_catalog.numeric not between 1 and 7
      or pg_catalog.trunc((new.payload->>'motivation')::pg_catalog.numeric) <> (new.payload->>'motivation')::pg_catalog.numeric
      or pg_catalog.trunc((new.payload->>'hydration')::pg_catalog.numeric) <> (new.payload->>'hydration')::pg_catalog.numeric
      or pg_catalog.trunc((new.payload->>'sleep')::pg_catalog.numeric) <> (new.payload->>'sleep')::pg_catalog.numeric
      or pg_catalog.trunc((new.payload->>'energy')::pg_catalog.numeric) <> (new.payload->>'energy')::pg_catalog.numeric then
      raise exception using
        errcode = '22023',
        message = 'Payload de readiness invalido';
    end if;
  else
    raise exception using
      errcode = '22023',
      message = 'Payload de readiness invalido';
  end if;

  return new;
end;
$function$;

alter function public.enforce_training_workout_readiness_payload_insert() owner to postgres;
revoke all on function public.enforce_training_workout_readiness_payload_insert() from public;
revoke all on function public.enforce_training_workout_readiness_payload_insert() from anon;
revoke all on function public.enforce_training_workout_readiness_payload_insert() from authenticated;
revoke all on function public.enforce_training_workout_readiness_payload_insert() from service_role;

drop trigger if exists training_workout_readiness_payload_insert_guard on public.training_workout_readiness;
create trigger training_workout_readiness_payload_insert_guard
  before insert on public.training_workout_readiness
  for each row execute function public.enforce_training_workout_readiness_payload_insert();

alter table public.training_workout_readiness owner to postgres;
alter table public.training_workout_readiness enable row level security;
revoke all on table public.training_workout_readiness from public;
revoke all on table public.training_workout_readiness from anon;
revoke all on table public.training_workout_readiness from authenticated;
revoke all on table public.training_workout_readiness from service_role;
grant select on table public.training_workout_readiness to authenticated;

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
  v_now timestamptz := pg_catalog.now();
  v_recent_attempt_count bigint;
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

  if p_payload is null
    or pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
    or pg_catalog.octet_length(p_payload::pg_catalog.text) > 1024 then
    raise exception using
      errcode = '22023',
      message = 'Payload de readiness invalido';
  end if;

  if p_payload->'skipped' = 'true'::pg_catalog.jsonb then
    if p_payload <> pg_catalog.jsonb_build_object('skipped', true) then
      raise exception using
        errcode = '22023',
        message = 'Payload de readiness invalido';
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
      or pg_catalog.jsonb_typeof(p_payload->'energy') is distinct from 'number' then
      raise exception using
        errcode = '22023',
        message = 'Payload de readiness invalido';
    end if;

    if (p_payload->>'motivation')::pg_catalog.numeric not between 1 and 7
      or (p_payload->>'hydration')::pg_catalog.numeric not between 1 and 7
      or (p_payload->>'sleep')::pg_catalog.numeric not between 1 and 7
      or (p_payload->>'energy')::pg_catalog.numeric not between 1 and 7
      or pg_catalog.trunc((p_payload->>'motivation')::pg_catalog.numeric) <> (p_payload->>'motivation')::pg_catalog.numeric
      or pg_catalog.trunc((p_payload->>'hydration')::pg_catalog.numeric) <> (p_payload->>'hydration')::pg_catalog.numeric
      or pg_catalog.trunc((p_payload->>'sleep')::pg_catalog.numeric) <> (p_payload->>'sleep')::pg_catalog.numeric
      or pg_catalog.trunc((p_payload->>'energy')::pg_catalog.numeric) <> (p_payload->>'energy')::pg_catalog.numeric then
      raise exception using
        errcode = '22023',
        message = 'Payload de readiness invalido';
    end if;
  else
    raise exception using
      errcode = '22023',
      message = 'Payload de readiness invalido';
  end if;

  v_local_date := (p_workout_started_at at time zone 'America/Santiago')::pg_catalog.date;

  -- Preserve the established fast idempotent path for a persisted attempt.
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

  -- The authoritative auth identity is the lock key. Hash collisions can only
  -- over-serialize different users; they cannot let same-user writes race.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organizatech:sec-readiness-01:user:' || v_user_id::pg_catalog.text,
      0
    )
  );

  -- A same-attempt request may have committed while this transaction waited.
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
    or p_workout_started_at < v_now - interval '36 hours' then
    raise exception 'workout_started_at fuera de ventana permitida';
  end if;

  -- Row locks keep active/deleted context stable through the insert. The order is
  -- always cycle then day to avoid feature-internal lock-order inversions.
  perform cycle.id
  from public.training_cycles as cycle
  where cycle.id = p_cycle_id
    and cycle.user_id = v_user_id
    and cycle.status = 'active'
    and cycle.deleted_at is null
  for share;

  if not found then
    raise exception 'El ciclo no pertenece al usuario autenticado o no esta activo';
  end if;

  perform day.id
  from public.training_cycle_days as day
  where day.id = p_cycle_day_id
    and day.cycle_id = p_cycle_id
    and day.user_id = v_user_id
    and day.deleted_at is null
  for share;

  if not found then
    raise exception 'El dia no pertenece al ciclo indicado';
  end if;

  select pg_catalog.count(*)
  into v_recent_attempt_count
  from (
    select 1
    from public.training_workout_readiness as readiness
    where readiness.user_id = v_user_id
      and readiness.created_at >= v_now - interval '36 hours'
    limit 32
  ) as recent_attempts;

  if v_recent_attempt_count >= 32 then
    raise exception using
      errcode = '54000',
      message = 'Limite de intentos de readiness alcanzado';
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
  )
  values (
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
    readiness.payload,
    readiness.training_session_id,
    readiness.created_at,
    readiness.updated_at,
    false;

  if found then
    return;
  end if;

  -- Retain the historical conflict fallback for a deployment-overlap caller that
  -- started under the previous function body and therefore did not take this lock.
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

alter function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb)
  security definer;
alter function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb)
  set search_path = '';
alter function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb)
  owner to postgres;

-- Keep the link RPC body and response unchanged while bringing its execution
-- context under the same empty-search-path and explicit ownership contract.
alter function public.link_training_workout_readiness_session_v2(uuid, uuid)
  security definer;
alter function public.link_training_workout_readiness_session_v2(uuid, uuid)
  set search_path = '';
alter function public.link_training_workout_readiness_session_v2(uuid, uuid)
  owner to postgres;

revoke all on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) from public;
revoke all on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) from anon;
revoke all on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) from authenticated;
revoke all on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) from service_role;
grant execute on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) to authenticated;

revoke all on function public.link_training_workout_readiness_session_v2(uuid, uuid) from public;
revoke all on function public.link_training_workout_readiness_session_v2(uuid, uuid) from anon;
revoke all on function public.link_training_workout_readiness_session_v2(uuid, uuid) from authenticated;
revoke all on function public.link_training_workout_readiness_session_v2(uuid, uuid) from service_role;
grant execute on function public.link_training_workout_readiness_session_v2(uuid, uuid) to authenticated;
