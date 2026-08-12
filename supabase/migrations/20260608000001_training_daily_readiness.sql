-- Fase 2.2CO: idempotencia diaria del formulario de motivacion/readiness.
-- No toca training_sessions, exercise_entries ni training_cycles.

create table if not exists public.training_daily_readiness (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_daily_readiness_user_local_date_key unique (user_id, local_date),
  constraint training_daily_readiness_payload_check check (
    jsonb_typeof(payload) = 'object'
    and payload ? 'skipped'
    and jsonb_typeof(payload->'skipped') = 'boolean'
    and (
      (payload->>'skipped')::boolean = true
      or (
        jsonb_typeof(payload->'motivation') = 'number'
        and jsonb_typeof(payload->'hydration') = 'number'
        and jsonb_typeof(payload->'sleep') = 'number'
        and jsonb_typeof(payload->'energy') = 'number'
        and (payload->>'motivation')::integer between 1 and 7
        and (payload->>'hydration')::integer between 1 and 7
        and (payload->>'sleep')::integer between 1 and 7
        and (payload->>'energy')::integer between 1 and 7
        and (payload->>'motivation')::numeric = (payload->>'motivation')::integer
        and (payload->>'hydration')::numeric = (payload->>'hydration')::integer
        and (payload->>'sleep')::numeric = (payload->>'sleep')::integer
        and (payload->>'energy')::numeric = (payload->>'energy')::integer
      )
    )
  )
);

drop trigger if exists training_daily_readiness_set_updated_at on public.training_daily_readiness;
create trigger training_daily_readiness_set_updated_at
  before update on public.training_daily_readiness
  for each row execute function public.set_updated_at();

alter table public.training_daily_readiness enable row level security;

drop policy if exists "daily readiness own select" on public.training_daily_readiness;
create policy "daily readiness own select" on public.training_daily_readiness
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No DELETE policy: users cannot remove daily readiness records through the API.
-- No direct INSERT/UPDATE grants: writes go through save_daily_training_readiness.

revoke all on table public.training_daily_readiness from public;
revoke all on table public.training_daily_readiness from anon;
revoke all on table public.training_daily_readiness from authenticated;
grant select on table public.training_daily_readiness to authenticated;

drop function if exists public.save_daily_training_readiness(jsonb, date);

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

  return query
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
  on conflict (user_id, local_date) do nothing
  returning
    readiness.id,
    readiness.local_date,
    readiness.payload,
    readiness.created_at,
    readiness.updated_at;

  if found then
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

revoke all on function public.save_daily_training_readiness(jsonb) from public;
revoke all on function public.save_daily_training_readiness(jsonb) from anon;
grant execute on function public.save_daily_training_readiness(jsonb) to authenticated;
