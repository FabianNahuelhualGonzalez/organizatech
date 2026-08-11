create or replace function public.save_daily_training_readiness(
  p_payload jsonb
)
returns table (
  id uuid,
  local_date date,
  payload jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_local_date date := (now() at time zone 'America/Santiago')::date;
  v_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
  v_updated_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
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

  insert into public.training_daily_readiness as readiness (
    user_id,
    local_date,
    payload
  )
  values (
    v_user_id,
    v_local_date,
    p_payload
  )
  on conflict on constraint training_daily_readiness_user_local_date_key
  do nothing
  returning
    readiness.id,
    readiness.payload,
    readiness.created_at,
    readiness.updated_at
  into
    v_id,
    v_payload,
    v_created_at,
    v_updated_at;

  if v_id is not null then
    id := v_id;
    local_date := v_local_date;
    payload := v_payload;
    created_at := v_created_at;
    updated_at := v_updated_at;
    return next;
    return;
  end if;

  select
    readiness.id,
    readiness.payload,
    readiness.created_at,
    readiness.updated_at
  into
    v_id,
    v_payload,
    v_created_at,
    v_updated_at
  from public.training_daily_readiness as readiness
  where readiness.user_id = v_user_id
    and readiness.local_date = v_local_date;

  if v_id is null then
    raise exception 'No se pudo confirmar el readiness diario existente';
  end if;

  id := v_id;
  local_date := v_local_date;
  payload := v_payload;
  created_at := v_created_at;
  updated_at := v_updated_at;
  return next;
end;
$$;
