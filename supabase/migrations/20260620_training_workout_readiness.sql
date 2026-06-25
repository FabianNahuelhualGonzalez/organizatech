-- Release B - D2: readiness tied to a concrete workout attempt.
-- Additive only: keeps legacy training_daily_readiness and save_daily_training_readiness(jsonb) intact.
--
-- Manual rollback concept, only with separate authorization:
-- 1. drop function public.link_training_workout_readiness_session_v2(uuid, uuid);
-- 2. drop function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb);
-- 3. drop table public.training_workout_readiness;

create table if not exists public.training_workout_readiness (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_attempt_id uuid not null,
  cycle_id uuid not null,
  cycle_day_id uuid not null,
  workout_started_at timestamptz not null,
  local_date date not null,
  payload jsonb not null,
  training_session_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_workout_readiness_user_attempt_key unique (user_id, workout_attempt_id),
  constraint training_workout_readiness_cycle_user_fk
    foreign key (cycle_id, user_id)
    references public.training_cycles(id, user_id)
    on delete restrict,
  constraint training_workout_readiness_cycle_day_cycle_fk
    foreign key (cycle_day_id, cycle_id)
    references public.training_cycle_days(id, cycle_id)
    on delete restrict,
  constraint training_workout_readiness_session_fk
    foreign key (training_session_id)
    references public.training_sessions(id)
    on delete restrict,
  constraint training_workout_readiness_payload_check check (
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

create unique index if not exists training_workout_readiness_session_key
  on public.training_workout_readiness(training_session_id)
  where training_session_id is not null;

create index if not exists training_workout_readiness_user_created_idx
  on public.training_workout_readiness(user_id, created_at desc);

create index if not exists training_workout_readiness_cycle_day_created_idx
  on public.training_workout_readiness(user_id, cycle_id, cycle_day_id, created_at desc);

drop trigger if exists training_workout_readiness_set_updated_at on public.training_workout_readiness;
create trigger training_workout_readiness_set_updated_at
  before update on public.training_workout_readiness
  for each row execute function public.set_updated_at();

alter table public.training_workout_readiness enable row level security;

drop policy if exists "workout readiness own select" on public.training_workout_readiness;
create policy "workout readiness own select" on public.training_workout_readiness
  for select
  to authenticated
  using (auth.uid() = user_id);

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

create or replace function public.link_training_workout_readiness_session_v2(
  p_workout_attempt_id uuid,
  p_training_session_id uuid
)
returns table (
  id uuid,
  workout_attempt_id uuid,
  training_session_id uuid,
  linked boolean,
  already_linked boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_readiness public.training_workout_readiness%rowtype;
  v_session record;
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_workout_attempt_id is null then
    raise exception 'workout_attempt_id requerido';
  end if;

  if p_training_session_id is null then
    raise exception 'training_session_id requerido';
  end if;

  select *
    into v_readiness
  from public.training_workout_readiness as readiness
  where readiness.user_id = v_user_id
    and readiness.workout_attempt_id = p_workout_attempt_id
  for update;

  if v_readiness.id is null then
    raise exception 'Readiness de entrenamiento no encontrado';
  end if;

  if v_readiness.training_session_id = p_training_session_id then
    id := v_readiness.id;
    workout_attempt_id := v_readiness.workout_attempt_id;
    training_session_id := v_readiness.training_session_id;
    linked := true;
    already_linked := true;
    return next;
    return;
  end if;

  if v_readiness.training_session_id is not null then
    raise exception 'Readiness ya enlazado a otra sesion';
  end if;

  select
    session.id,
    session.user_id,
    session.cycle_id,
    session.cycle_day_id,
    session.created_at
  into v_session
  from public.training_sessions as session
  where session.id = p_training_session_id
    and session.deleted_at is null;

  if v_session.id is null then
    raise exception 'Sesion no encontrada';
  end if;

  if v_session.user_id <> v_user_id then
    raise exception 'Sesion ajena al usuario autenticado';
  end if;

  if v_session.cycle_id is distinct from v_readiness.cycle_id then
    raise exception 'Sesion corresponde a otro ciclo';
  end if;

  if v_session.cycle_day_id is distinct from v_readiness.cycle_day_id then
    raise exception 'Sesion corresponde a otro dia del ciclo';
  end if;

  if v_session.created_at < v_readiness.workout_started_at - interval '5 minutes'
    or v_session.created_at > v_readiness.workout_started_at + interval '36 hours' then
    raise exception 'Sesion fuera de ventana temporal del intento';
  end if;

  if exists (
    select 1
    from public.training_workout_readiness as other_readiness
    where other_readiness.training_session_id = p_training_session_id
      and other_readiness.id <> v_readiness.id
  ) then
    raise exception 'Sesion ya enlazada a otro readiness';
  end if;

  update public.training_workout_readiness as readiness
  set training_session_id = p_training_session_id
  where readiness.id = v_readiness.id
  returning readiness.id, readiness.workout_attempt_id, readiness.training_session_id
  into id, workout_attempt_id, training_session_id;

  linked := true;
  already_linked := false;
  return next;
end;
$function$;

revoke all on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) from public;
revoke all on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) from anon;
revoke all on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) from service_role;
grant execute on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) to authenticated;

revoke all on function public.link_training_workout_readiness_session_v2(uuid, uuid) from public;
revoke all on function public.link_training_workout_readiness_session_v2(uuid, uuid) from anon;
revoke all on function public.link_training_workout_readiness_session_v2(uuid, uuid) from service_role;
grant execute on function public.link_training_workout_readiness_session_v2(uuid, uuid) to authenticated;
