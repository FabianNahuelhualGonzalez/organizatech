-- Fase 2.2DE: corrige ambiguedad PL/pgSQL entre RETURNS TABLE local_date y columna local_date.
-- Redefine solo la RPC publica, sin cambiar firma, retorno, permisos ni contrato de datos.

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
as $function$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_local_date date := (now() at time zone 'America/Santiago')::date;
  v_cycle_day_id uuid;
  v_response_payload jsonb;
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

  if p_payload ? 'cycle_day_id' and p_payload->'cycle_day_id' <> 'null'::jsonb then
    v_cycle_day_id := nullif(trim(p_payload->>'cycle_day_id'), '')::uuid;
  end if;

  v_response_payload := p_payload - 'cycle_day_id';

  if not (v_response_payload ? 'skipped') or jsonb_typeof(v_response_payload->'skipped') <> 'boolean' then
    raise exception 'Payload de readiness invalido';
  end if;

  if coalesce((v_response_payload->>'skipped')::boolean, false) = false then
    if jsonb_typeof(v_response_payload->'motivation') <> 'number'
      or jsonb_typeof(v_response_payload->'hydration') <> 'number'
      or jsonb_typeof(v_response_payload->'sleep') <> 'number'
      or jsonb_typeof(v_response_payload->'energy') <> 'number'
      or (v_response_payload->>'motivation')::integer not between 1 and 7
      or (v_response_payload->>'hydration')::integer not between 1 and 7
      or (v_response_payload->>'sleep')::integer not between 1 and 7
      or (v_response_payload->>'energy')::integer not between 1 and 7
      or (v_response_payload->>'motivation')::numeric <> (v_response_payload->>'motivation')::integer
      or (v_response_payload->>'hydration')::numeric <> (v_response_payload->>'hydration')::integer
      or (v_response_payload->>'sleep')::numeric <> (v_response_payload->>'sleep')::integer
      or (v_response_payload->>'energy')::numeric <> (v_response_payload->>'energy')::integer then
      raise exception 'Payload de readiness invalido';
    end if;
  end if;

  if v_cycle_day_id is not null and not exists (
    select 1
    from public.training_cycle_days as day
    where day.id = v_cycle_day_id
      and day.user_id = v_user_id
      and day.deleted_at is null
  ) then
    raise exception 'El dia del ciclo no pertenece al usuario autenticado';
  end if;

  if v_cycle_day_id is not null then
    insert into public.training_daily_readiness as readiness (
      user_id,
      local_date,
      cycle_day_id,
      payload
    )
    values (
      v_user_id,
      v_local_date,
      v_cycle_day_id,
      v_response_payload
    )
    on conflict (user_id, local_date, cycle_day_id)
    where cycle_day_id is not null
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

    if v_id is null then
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
        and readiness.local_date = v_local_date
        and readiness.cycle_day_id = v_cycle_day_id;
    end if;
  else
    insert into public.training_daily_readiness as readiness (
      user_id,
      local_date,
      cycle_day_id,
      payload
    )
    values (
      v_user_id,
      v_local_date,
      null,
      v_response_payload
    )
    on conflict (user_id, local_date)
    where cycle_day_id is null
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

    if v_id is null then
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
        and readiness.local_date = v_local_date
        and readiness.cycle_day_id is null;
    end if;
  end if;

  if v_id is null then
    raise exception 'No se pudo confirmar el readiness del entrenamiento';
  end if;

  id := v_id;
  local_date := v_local_date;
  payload := v_payload;
  created_at := v_created_at;
  updated_at := v_updated_at;
  return next;
end;
$function$;

revoke all on function public.save_daily_training_readiness(jsonb) from public;
revoke all on function public.save_daily_training_readiness(jsonb) from anon;
grant execute on function public.save_daily_training_readiness(jsonb) to authenticated;
