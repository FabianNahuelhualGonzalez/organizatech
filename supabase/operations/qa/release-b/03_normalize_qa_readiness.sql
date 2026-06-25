-- Release B - Fase D1 - QA normalization.
-- Ejecutar solo en Supabase QA: fjjebhaqtrdbpxzxztmh.
-- No ejecutar en Production.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

lock table public.training_daily_readiness in access exclusive mode;
lock table public.training_cycle_days in access exclusive mode;

do $precheck$
declare
  v_duplicate_groups integer;
  v_total_rows integer;
  v_rows_with_cycle_day_id integer;
  v_rows_without_cycle_day_id integer;
begin
  if current_setting('transaction_read_only')::boolean then
    raise exception 'La normalizacion requiere una transaccion de escritura controlada en QA';
  end if;

  if to_regclass('public.training_daily_readiness') is null then
    raise exception 'Falta public.training_daily_readiness';
  end if;

  if to_regclass('public.training_workout_readiness') is not null then
    raise exception 'training_workout_readiness no debe existir antes de normalizar QA';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'training_daily_readiness'
      and column_name = 'cycle_day_id'
  ) then
    raise exception 'No existe cycle_day_id residual en training_daily_readiness';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'training_daily_readiness_cycle_day_user_fk'
  ) then
    raise exception 'Falta FK residual training_daily_readiness_cycle_day_user_fk';
  end if;

  if not exists (
    select 1
    from pg_class
    where relname = 'training_daily_readiness_user_cycle_day_idx'
  ) then
    raise exception 'Falta indice residual training_daily_readiness_user_cycle_day_idx';
  end if;

  if not exists (
    select 1
    from pg_class
    where relname = 'training_daily_readiness_user_local_date_cycle_day_key'
  ) then
    raise exception 'Falta unique parcial scoped residual';
  end if;

  if not exists (
    select 1
    from pg_class
    where relname = 'training_daily_readiness_user_local_date_legacy_key'
  ) then
    raise exception 'Falta unique parcial legacy residual';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'training_cycle_days_user_id_id_unique'
  ) then
    raise exception 'Falta unique residual training_cycle_days_user_id_id_unique';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conname = 'training_daily_readiness_user_local_date_key'
  ) then
    raise exception 'El unique global legacy ya existe; QA no esta en estado residual esperado';
  end if;

  select count(*)
    into v_duplicate_groups
  from (
    select user_id, local_date
    from public.training_daily_readiness
    group by user_id, local_date
    having count(*) > 1
  ) duplicates;

  if v_duplicate_groups <> 0 then
    raise exception 'Existen duplicados por user_id/local_date: %', v_duplicate_groups;
  end if;

  select
    count(*),
    count(*) filter (where cycle_day_id is not null),
    count(*) filter (where cycle_day_id is null)
  into
    v_total_rows,
    v_rows_with_cycle_day_id,
    v_rows_without_cycle_day_id
  from public.training_daily_readiness;

  if v_total_rows <> 3 then
    raise exception 'Conteo readiness inesperado. Esperado 3, actual %', v_total_rows;
  end if;

  if v_rows_with_cycle_day_id <> 1 then
    raise exception 'Conteo scoped inesperado. Esperado 1, actual %', v_rows_with_cycle_day_id;
  end if;

  if v_rows_without_cycle_day_id <> 2 then
    raise exception 'Conteo legacy inesperado. Esperado 2, actual %', v_rows_without_cycle_day_id;
  end if;

  if (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'save_daily_training_readiness'
      and pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb'
  ) <> 1 then
    raise exception 'La firma esperada de save_daily_training_readiness(jsonb) no es unica';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'save_daily_training_readiness'
      and pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb'
      and pg_get_functiondef(p.oid) ilike '%#variable_conflict use_column%'
  ) then
    raise exception 'La RPC residual no contiene #variable_conflict use_column';
  end if;
end;
$precheck$;

alter table public.training_daily_readiness
  drop constraint training_daily_readiness_cycle_day_user_fk;

drop index public.training_daily_readiness_user_cycle_day_idx;
drop index public.training_daily_readiness_user_local_date_cycle_day_key;
drop index public.training_daily_readiness_user_local_date_legacy_key;

alter table public.training_daily_readiness
  drop column cycle_day_id;

alter table public.training_cycle_days
  drop constraint training_cycle_days_user_id_id_unique;

alter table public.training_daily_readiness
  add constraint training_daily_readiness_user_local_date_key unique (user_id, local_date);

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
$function$;

revoke all on function public.save_daily_training_readiness(jsonb) from public;
revoke all on function public.save_daily_training_readiness(jsonb) from anon;
revoke all on function public.save_daily_training_readiness(jsonb) from service_role;
grant execute on function public.save_daily_training_readiness(jsonb) to authenticated;

commit;
