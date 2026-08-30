-- CYCLE-REDESIGN-BACKEND-01
-- Bounded, owner-derived RPC surface for the schema created immediately before
-- this migration. All client writes are allowlisted and portal scoped.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function private.assert_training_cycle_portal_access(
  p_user_id uuid,
  p_portal_scope text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_user_id is null
    or p_user_id is distinct from auth.uid()
    or p_portal_scope is null
    or p_portal_scope not in ('usuario', 'coach')
  then
    raise exception 'training cycle portal access denied' using errcode = '42501';
  end if;

  if p_portal_scope = 'usuario' and not exists (
    select 1
    from public.user_registrations as registration
    where registration.user_id = p_user_id
  ) then
    raise exception 'user portal membership required' using errcode = '42501';
  end if;

  if p_portal_scope = 'coach' and not exists (
    select 1
    from public.coach_registrations as registration
    where registration.user_id = p_user_id
  ) then
    raise exception 'coach portal membership required' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function private.assert_training_cycle_portal_access(uuid, text)
  from public, anon, authenticated, service_role;

create function private.is_valid_training_youtube_url(p_value text)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select
    pg_catalog.char_length(p_value) between 19 and 500
    and p_value !~ '[[:cntrl:][:space:]]'
    and p_value ~ '^https://((www\.|m\.)?youtube\.com/(watch\?[^[:space:]]*v=[A-Za-z0-9_-]{6,64}[^[:space:]]*|shorts/[A-Za-z0-9_-]{6,64}[^[:space:]]*|embed/[A-Za-z0-9_-]{6,64}[^[:space:]]*)|youtu\.be/[A-Za-z0-9_-]{6,64}[^[:space:]]*)$'
$function$;

revoke all on function private.is_valid_training_youtube_url(text)
  from public, anon, authenticated, service_role;

create function private.training_cycle_request_hash(p_payload jsonb)
returns bytea
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select extensions.digest(
    pg_catalog.convert_to(p_payload::pg_catalog.text, 'UTF8'),
    'sha256'
  )
$function$;

revoke all on function private.training_cycle_request_hash(jsonb)
  from public, anon, authenticated, service_role;

create function private.lock_training_cycle_portal(
  p_user_id uuid,
  p_portal_scope text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organizatech:cycle-redesign:'
        || p_user_id::pg_catalog.text || ':' || p_portal_scope,
      0
    )
  );
end;
$function$;

revoke all on function private.lock_training_cycle_portal(uuid, text)
  from public, anon, authenticated, service_role;

create function private.find_training_cycle_receipt(
  p_user_id uuid,
  p_portal_scope text,
  p_request_id uuid,
  p_operation_kind text,
  p_payload jsonb
)
returns table (aggregate_id uuid, result_version integer)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_receipt private.training_cycle_operation_receipts;
begin
  if p_request_id is null or p_payload is null then
    raise exception 'invalid training cycle request' using errcode = '22023';
  end if;

  -- Portal operations serialize independently, while this second key makes a
  -- request id globally single-use for the identity even across two portals.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organizatech:cycle-redesign:request:'
        || p_user_id::pg_catalog.text || ':' || p_request_id::pg_catalog.text,
      0
    )
  );

  select receipt.*
    into v_receipt
  from private.training_cycle_operation_receipts as receipt
  where receipt.user_id = p_user_id
    and receipt.request_id = p_request_id;

  if v_receipt.request_id is null then
    return;
  end if;

  if v_receipt.portal_scope is distinct from p_portal_scope
    or v_receipt.operation_kind is distinct from p_operation_kind
    or v_receipt.payload_hash is distinct from private.training_cycle_request_hash(p_payload)
  then
    raise exception 'request_id payload mismatch' using errcode = '22023';
  end if;

  aggregate_id := v_receipt.aggregate_id;
  result_version := v_receipt.result_version;
  return next;
end;
$function$;

revoke all on function private.find_training_cycle_receipt(uuid, text, uuid, text, jsonb)
  from public, anon, authenticated, service_role;

create function private.record_training_cycle_receipt(
  p_user_id uuid,
  p_portal_scope text,
  p_request_id uuid,
  p_operation_kind text,
  p_payload jsonb,
  p_aggregate_id uuid,
  p_result_version integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  -- Bounded lifetime cardinality. Exact retries are resolved before this helper.
  if exists (
    select 1
    from private.training_cycle_operation_receipts as receipt
    where receipt.user_id = p_user_id
      and receipt.portal_scope = p_portal_scope
    order by receipt.created_at, receipt.request_id
    offset 4095
    limit 1
  ) then
    raise exception using errcode = '54000', message = 'training cycle operation limit reached';
  end if;

  insert into private.training_cycle_operation_receipts (
    user_id,
    request_id,
    portal_scope,
    operation_kind,
    payload_hash,
    aggregate_id,
    result_version
  )
  values (
    p_user_id,
    p_request_id,
    p_portal_scope,
    p_operation_kind,
    private.training_cycle_request_hash(p_payload),
    p_aggregate_id,
    p_result_version
  );
end;
$function$;

revoke all on function private.record_training_cycle_receipt(
  uuid, text, uuid, text, jsonb, uuid, integer
) from public, anon, authenticated, service_role;

-- Mutation RPCs return this immutable acknowledgement on both the first call
-- and an exact request_id replay. Resource reads remain separate RPCs, so a
-- later edit/extension cannot silently change the response of an older call.
create function private.training_cycle_operation_result(
  p_request_id uuid,
  p_operation_kind text,
  p_aggregate_id uuid,
  p_result_version integer
)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'responseKind', 'accepted_operation',
    'requestId', p_request_id,
    'operationKind', p_operation_kind,
    'aggregateId', p_aggregate_id,
    'resultVersion', p_result_version
  )
$function$;

revoke all on function private.training_cycle_operation_result(
  uuid, text, uuid, integer
) from public, anon, authenticated, service_role;

create function private.validate_training_cycle_dates(
  p_start_date date,
  p_end_date date
)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
begin
  if p_start_date is null
    or p_end_date is null
    or p_end_date <= p_start_date
    or p_end_date - p_start_date > 730
  then
    raise exception 'invalid training cycle dates' using errcode = '22023';
  end if;
end;
$function$;

revoke all on function private.validate_training_cycle_dates(date, date)
  from public, anon, authenticated, service_role;

create function private.validate_training_cycle_plan(
  p_user_id uuid,
  p_portal_scope text,
  p_plan jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_day jsonb;
  v_exercise jsonb;
  v_set jsonb;
  v_drop jsonb;
  v_catalog_id uuid;
  v_custom_id uuid;
  v_source_name text;
  v_video_url text;
  v_day_code text;
  v_technique text;
  v_day_order numeric;
  v_exercise_order numeric;
  v_set_order numeric;
  v_drop_order numeric;
  v_reps numeric;
  v_kg numeric;
  v_total_exercises integer := 0;
  v_total_sets integer := 0;
  v_total_drops integer := 0;
  v_exercise_drops integer;
  v_seen_days text[] := array[]::text[];
  v_seen_day_orders integer[];
  v_seen_exercise_orders integer[];
  v_seen_set_orders integer[];
  v_seen_drop_orders integer[];
begin
  perform private.assert_training_cycle_portal_access(p_user_id, p_portal_scope);

  if p_plan is null
    or pg_catalog.jsonb_typeof(p_plan) is distinct from 'object'
    or pg_catalog.octet_length(p_plan::pg_catalog.text) > 262144
    or not (p_plan ? 'days')
    or p_plan - array['days']::text[] <> '{}'::jsonb
    or pg_catalog.jsonb_typeof(p_plan->'days') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_plan->'days') not between 1 and 7
  then
    raise exception 'invalid training cycle plan' using errcode = '22023';
  end if;

  v_seen_day_orders := array[]::integer[];
  for v_day in
    select value from pg_catalog.jsonb_array_elements(p_plan->'days')
  loop
    if pg_catalog.jsonb_typeof(v_day) is distinct from 'object'
      or not (v_day ?& array['day', 'name', 'order', 'exercises'])
      or v_day - array['day', 'name', 'order', 'exercises']::text[] <> '{}'::jsonb
      or pg_catalog.jsonb_typeof(v_day->'day') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_day->'name') is distinct from 'string'
      or pg_catalog.char_length(pg_catalog.btrim(v_day->>'name')) > 120
      or v_day->>'name' ~ '[[:cntrl:]]'
      or pg_catalog.jsonb_typeof(v_day->'order') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_day->'exercises') is distinct from 'array'
      or pg_catalog.jsonb_array_length(v_day->'exercises') > 50
    then
      raise exception 'invalid training cycle day' using errcode = '22023';
    end if;

    v_day_code := v_day->>'day';
    v_day_order := (v_day->>'order')::pg_catalog.numeric;
    if v_day_code not in (
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
    )
      or v_day_code = any(v_seen_days)
      or v_day_order not between 0 and 6
      or pg_catalog.trunc(v_day_order) <> v_day_order
      or v_day_order::integer = any(v_seen_day_orders)
    then
      raise exception 'invalid or duplicate training cycle day' using errcode = '22023';
    end if;
    v_seen_days := pg_catalog.array_append(v_seen_days, v_day_code);
    v_seen_day_orders := pg_catalog.array_append(v_seen_day_orders, v_day_order::integer);

    v_seen_exercise_orders := array[]::integer[];
    for v_exercise in
      select value from pg_catalog.jsonb_array_elements(v_day->'exercises')
    loop
      v_total_exercises := v_total_exercises + 1;
      if v_total_exercises > 200
        or pg_catalog.jsonb_typeof(v_exercise) is distinct from 'object'
        or not (v_exercise ?& array['order', 'technique', 'sets'])
        or v_exercise - array[
          'catalogExerciseId', 'customExerciseId', 'order', 'technique', 'videoUrl', 'sets'
        ]::text[] <> '{}'::jsonb
        or pg_catalog.jsonb_typeof(v_exercise->'order') is distinct from 'number'
        or pg_catalog.jsonb_typeof(v_exercise->'technique') is distinct from 'string'
        or pg_catalog.jsonb_typeof(v_exercise->'sets') is distinct from 'array'
        or pg_catalog.jsonb_array_length(v_exercise->'sets') not between 1 and 20
      then
        raise exception 'invalid training cycle exercise' using errcode = '22023';
      end if;

      if v_exercise ? 'videoUrl'
        and pg_catalog.jsonb_typeof(v_exercise->'videoUrl') not in ('string', 'null')
      then
        raise exception 'invalid training exercise video' using errcode = '22023';
      end if;

      begin
        v_catalog_id := nullif(v_exercise->>'catalogExerciseId', '')::uuid;
        v_custom_id := nullif(v_exercise->>'customExerciseId', '')::uuid;
      exception when invalid_text_representation then
        raise exception 'invalid training exercise source' using errcode = '22023';
      end;

      if pg_catalog.num_nonnulls(v_catalog_id, v_custom_id) <> 1 then
        raise exception 'exactly one training exercise source is required' using errcode = '22023';
      end if;

      if v_catalog_id is not null then
        select catalog.canonical_name, catalog.default_video_url
          into v_source_name, v_video_url
        from public.training_exercise_catalog as catalog
        where catalog.id = v_catalog_id
          and catalog.is_active;
      else
        select custom.name, custom.video_url
          into v_source_name, v_video_url
        from public.training_custom_exercises as custom
        where custom.id = v_custom_id
          and custom.user_id = p_user_id
          and custom.portal_scope = p_portal_scope
          and custom.archived_at is null;
      end if;

      if v_source_name is null then
        raise exception 'invalid training exercise source' using errcode = '22023';
      end if;

      v_exercise_order := (v_exercise->>'order')::pg_catalog.numeric;
      if v_exercise_order not between 0 and 199
        or pg_catalog.trunc(v_exercise_order) <> v_exercise_order
        or v_exercise_order::integer = any(v_seen_exercise_orders)
      then
        raise exception 'invalid or duplicate training exercise order' using errcode = '22023';
      end if;
      v_seen_exercise_orders := pg_catalog.array_append(
        v_seen_exercise_orders,
        v_exercise_order::integer
      );

      v_technique := v_exercise->>'technique';
      if v_technique not in ('linear', 'ascending', 'descending', 'drop_set', 'failure') then
        raise exception 'invalid training technique' using errcode = '22023';
      end if;

      if v_exercise ? 'videoUrl' then
        v_video_url := v_exercise->>'videoUrl';
      end if;
      if v_video_url is not null and not private.is_valid_training_youtube_url(v_video_url) then
        raise exception 'invalid training exercise video' using errcode = '22023';
      end if;

      v_seen_set_orders := array[]::integer[];
      v_exercise_drops := 0;
      for v_set in
        select value from pg_catalog.jsonb_array_elements(v_exercise->'sets')
      loop
        v_total_sets := v_total_sets + 1;
        if v_total_sets > 2000
          or pg_catalog.jsonb_typeof(v_set) is distinct from 'object'
          or not (v_set ?& array['order', 'targetReps', 'targetKg', 'toFailure', 'drops'])
          or v_set - array['order', 'targetReps', 'targetKg', 'toFailure', 'drops']::text[] <> '{}'::jsonb
          or pg_catalog.jsonb_typeof(v_set->'order') is distinct from 'number'
          or pg_catalog.jsonb_typeof(v_set->'targetReps') is distinct from 'number'
          or pg_catalog.jsonb_typeof(v_set->'targetKg') is distinct from 'number'
          or pg_catalog.jsonb_typeof(v_set->'toFailure') is distinct from 'boolean'
          or pg_catalog.jsonb_typeof(v_set->'drops') is distinct from 'array'
          or pg_catalog.jsonb_array_length(v_set->'drops') > 8
        then
          raise exception 'invalid training set' using errcode = '22023';
        end if;

        v_set_order := (v_set->>'order')::pg_catalog.numeric;
        v_reps := (v_set->>'targetReps')::pg_catalog.numeric;
        v_kg := (v_set->>'targetKg')::pg_catalog.numeric;
        if v_set_order not between 0 and 19
          or pg_catalog.trunc(v_set_order) <> v_set_order
          or v_set_order::integer = any(v_seen_set_orders)
          or v_reps not between 1 and 1000
          or pg_catalog.trunc(v_reps) <> v_reps
          or v_kg not between 0 and 99999.99
          or pg_catalog.scale(v_kg) > 2
        then
          raise exception 'invalid training set values' using errcode = '22023';
        end if;
        v_seen_set_orders := pg_catalog.array_append(v_seen_set_orders, v_set_order::integer);

        if v_technique <> 'drop_set' and pg_catalog.jsonb_array_length(v_set->'drops') <> 0 then
          raise exception 'drops require drop_set technique' using errcode = '22023';
        end if;

        v_seen_drop_orders := array[]::integer[];
        for v_drop in
          select value from pg_catalog.jsonb_array_elements(v_set->'drops')
        loop
          v_total_drops := v_total_drops + 1;
          v_exercise_drops := v_exercise_drops + 1;
          if v_total_drops > 4000
            or pg_catalog.jsonb_typeof(v_drop) is distinct from 'object'
            or not (v_drop ?& array['order', 'kg', 'reps'])
            or v_drop - array['order', 'kg', 'reps']::text[] <> '{}'::jsonb
            or pg_catalog.jsonb_typeof(v_drop->'order') is distinct from 'number'
            or pg_catalog.jsonb_typeof(v_drop->'kg') is distinct from 'number'
            or pg_catalog.jsonb_typeof(v_drop->'reps') is distinct from 'number'
          then
            raise exception 'invalid training drop' using errcode = '22023';
          end if;

          v_drop_order := (v_drop->>'order')::pg_catalog.numeric;
          v_kg := (v_drop->>'kg')::pg_catalog.numeric;
          v_reps := (v_drop->>'reps')::pg_catalog.numeric;
          if v_drop_order not between 0 and 7
            or pg_catalog.trunc(v_drop_order) <> v_drop_order
            or v_drop_order::integer = any(v_seen_drop_orders)
            or v_kg not between 0 and 99999.99
            or pg_catalog.scale(v_kg) > 2
            or v_reps not between 1 and 1000
            or pg_catalog.trunc(v_reps) <> v_reps
          then
            raise exception 'invalid training drop values' using errcode = '22023';
          end if;
          v_seen_drop_orders := pg_catalog.array_append(v_seen_drop_orders, v_drop_order::integer);
        end loop;
      end loop;

      if v_technique = 'drop_set' and v_exercise_drops = 0 then
        raise exception 'drop_set requires at least one drop' using errcode = '22023';
      end if;
    end loop;
  end loop;
end;
$function$;

revoke all on function private.validate_training_cycle_plan(uuid, text, jsonb)
  from public, anon, authenticated, service_role;

create function private.resolve_training_cycle_exercise_source(
  p_user_id uuid,
  p_portal_scope text,
  p_catalog_exercise_id uuid,
  p_custom_exercise_id uuid
)
returns table (
  source_name text,
  muscle_group text,
  default_video_url text,
  exercise_lineage_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if pg_catalog.num_nonnulls(p_catalog_exercise_id, p_custom_exercise_id) <> 1 then
    raise exception 'exactly one training exercise source is required' using errcode = '22023';
  end if;

  if p_catalog_exercise_id is not null then
    select catalog.canonical_name, catalog.muscle_group, catalog.default_video_url
      into source_name, muscle_group, default_video_url
    from public.training_exercise_catalog as catalog
    where catalog.id = p_catalog_exercise_id
      and catalog.is_active;

    if source_name is null then
      raise exception 'training exercise catalog source unavailable' using errcode = '22023';
    end if;

    insert into public.training_exercise_lineages (
      user_id,
      portal_scope,
      origin_kind,
      metadata,
      catalog_exercise_id
    )
    values (
      p_user_id,
      p_portal_scope,
      'scoped',
      pg_catalog.jsonb_build_object(
        'source', 'cycle_redesign_catalog',
        'portalScope', p_portal_scope
      ),
      p_catalog_exercise_id
    )
    on conflict (user_id, portal_scope, catalog_exercise_id)
      where catalog_exercise_id is not null
    do nothing;

    select lineage.id
      into exercise_lineage_id
    from public.training_exercise_lineages as lineage
    where lineage.user_id = p_user_id
      and lineage.portal_scope = p_portal_scope
      and lineage.catalog_exercise_id = p_catalog_exercise_id;
  else
    select
      custom.name,
      custom.muscle_group,
      custom.video_url,
      custom.lineage_id
    into
      source_name,
      muscle_group,
      default_video_url,
      exercise_lineage_id
    from public.training_custom_exercises as custom
    join public.training_exercise_lineages as lineage
      on lineage.id = custom.lineage_id
     and lineage.user_id = custom.user_id
     and lineage.portal_scope = custom.portal_scope
     and lineage.custom_exercise_id = custom.id
    where custom.id = p_custom_exercise_id
      and custom.user_id = p_user_id
      and custom.portal_scope = p_portal_scope
      and custom.archived_at is null;
  end if;

  if source_name is null or exercise_lineage_id is null then
    raise exception 'training exercise source unavailable' using errcode = '22023';
  end if;

  return next;
end;
$function$;

revoke all on function private.resolve_training_cycle_exercise_source(
  uuid, text, uuid, uuid
) from public, anon, authenticated, service_role;

create function private.ensure_training_cycle_legacy_day(
  p_user_id uuid,
  p_cycle_id uuid,
  p_day_code text,
  p_routine_name text,
  p_sort_order integer
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_database_routine_name text := pg_catalog.coalesce(
    pg_catalog.nullif(pg_catalog.btrim(p_routine_name), ''),
    'Rutina ' || p_day_code
  );
  v_routine_id uuid;
  v_day_id uuid;
begin
  select routine.id
    into v_routine_id
  from public.training_cycle_routines as routine
  where routine.user_id = p_user_id
    and routine.cycle_id = p_cycle_id
    and pg_catalog.lower(routine.name) = pg_catalog.lower(v_database_routine_name)
    and routine.deleted_at is null
  order by routine.created_at, routine.id
  limit 1;

  if v_routine_id is null then
    insert into public.training_cycle_routines (
      user_id,
      cycle_id,
      name,
      sort_order,
      notes
    )
    values (
      p_user_id,
      p_cycle_id,
      v_database_routine_name,
      p_sort_order,
      null
    )
    returning id into v_routine_id;
  end if;

  select day.id
    into v_day_id
  from public.training_cycle_days as day
  where day.user_id = p_user_id
    and day.cycle_id = p_cycle_id
    and day.week_index = 1
    and day.day_code = p_day_code
    and day.deleted_at is null
  order by day.created_at, day.id
  limit 1;

  if v_day_id is null then
    insert into public.training_cycle_days (
      user_id,
      cycle_id,
      routine_id,
      week_index,
      day_code,
      sort_order,
      notes
    )
    values (
      p_user_id,
      p_cycle_id,
      v_routine_id,
      1,
      p_day_code,
      p_sort_order,
      pg_catalog.jsonb_build_object(
        'cycleRedesignRoutineName',
        pg_catalog.btrim(p_routine_name)
      )::pg_catalog.text
    )
    returning id into v_day_id;
  else
    update public.training_cycle_days as day
    set
      routine_id = v_routine_id,
      sort_order = p_sort_order,
      notes = pg_catalog.jsonb_build_object(
        'cycleRedesignRoutineName',
        pg_catalog.btrim(p_routine_name)
      )::pg_catalog.text
    where day.id = v_day_id
      and day.user_id = p_user_id
      and day.cycle_id = p_cycle_id;
  end if;

  return v_day_id;
end;
$function$;

revoke all on function private.ensure_training_cycle_legacy_day(
  uuid, uuid, text, text, integer
) from public, anon, authenticated, service_role;

create function private.persist_training_cycle_plan_version(
  p_user_id uuid,
  p_portal_scope text,
  p_cycle_id uuid,
  p_version integer,
  p_request_id uuid,
  p_change_kind text,
  p_goal text,
  p_start_date date,
  p_end_date date,
  p_source_version_id uuid,
  p_plan jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_version_id uuid;
  v_day jsonb;
  v_exercise jsonb;
  v_set jsonb;
  v_drop jsonb;
  v_source record;
  v_catalog_id uuid;
  v_custom_id uuid;
  v_day_id uuid;
  v_plan_day_id uuid;
  v_cycle_exercise_id uuid;
  v_plan_exercise_id uuid;
  v_plan_set_id uuid;
  v_video_url text;
  v_first_reps integer;
  v_first_kg numeric(8,2);
  v_set_count integer;
  v_retired_marker constant text := '[organizatech:future-plan-retired]';
begin
  perform private.assert_training_cycle_portal_access(p_user_id, p_portal_scope);
  perform private.validate_training_cycle_dates(p_start_date, p_end_date);
  perform private.validate_training_cycle_plan(p_user_id, p_portal_scope, p_plan);

  if p_version not between 1 and 256
    or p_goal not in ('strength', 'volume', 'definition', 'deload')
    or p_change_kind not in ('activation', 'edit')
    or not exists (
      select 1
      from public.training_cycles as cycle
      where cycle.id = p_cycle_id
        and cycle.user_id = p_user_id
        and cycle.portal_scope = p_portal_scope
        and cycle.status = 'active'
        and cycle.deleted_at is null
    )
  then
    raise exception 'invalid training cycle version request' using errcode = '22023';
  end if;

  insert into public.training_cycle_plan_versions (
    cycle_id,
    user_id,
    portal_scope,
    version,
    request_id,
    change_kind,
    goal,
    start_date,
    end_date,
    source_version_id,
    plan_payload
  )
  values (
    p_cycle_id,
    p_user_id,
    p_portal_scope,
    p_version,
    p_request_id,
    p_change_kind,
    p_goal,
    p_start_date,
    p_end_date,
    p_source_version_id,
    p_plan
  )
  returning id into v_version_id;

  if p_source_version_id is not null then
    update public.training_cycle_exercises as exercise
    set notes = case
      when pg_catalog.position(v_retired_marker in pg_catalog.coalesce(exercise.notes, '')) > 0
        then exercise.notes
      when pg_catalog.nullif(pg_catalog.btrim(exercise.notes), '') is null
        then v_retired_marker
      else exercise.notes || E'\n' || v_retired_marker
    end
    where exercise.user_id = p_user_id
      and exercise.cycle_id = p_cycle_id
      and exercise.id in (
        select snapshot.legacy_cycle_exercise_id
        from public.training_cycle_plan_exercises as snapshot
        where snapshot.version_id = p_source_version_id
          and snapshot.user_id = p_user_id
          and snapshot.cycle_id = p_cycle_id
      );
  end if;

  for v_day in
    select value
    from pg_catalog.jsonb_array_elements(p_plan->'days')
    order by (value->>'order')::integer
  loop
    v_day_id := private.ensure_training_cycle_legacy_day(
      p_user_id,
      p_cycle_id,
      v_day->>'day',
      v_day->>'name',
      (v_day->>'order')::integer
    );

    insert into public.training_cycle_plan_days (
      version_id,
      cycle_id,
      user_id,
      day_code,
      routine_name,
      sort_order,
      legacy_cycle_day_id
    )
    values (
      v_version_id,
      p_cycle_id,
      p_user_id,
      v_day->>'day',
      pg_catalog.btrim(v_day->>'name'),
      (v_day->>'order')::smallint,
      v_day_id
    )
    returning id into v_plan_day_id;

    for v_exercise in
      select value
      from pg_catalog.jsonb_array_elements(v_day->'exercises')
      order by (value->>'order')::integer
    loop
      v_catalog_id := nullif(v_exercise->>'catalogExerciseId', '')::uuid;
      v_custom_id := nullif(v_exercise->>'customExerciseId', '')::uuid;

      select source.*
        into v_source
      from private.resolve_training_cycle_exercise_source(
        p_user_id,
        p_portal_scope,
        v_catalog_id,
        v_custom_id
      ) as source;

      v_video_url := case
        when v_exercise ? 'videoUrl' then v_exercise->>'videoUrl'
        else v_source.default_video_url
      end;

      select
        (set_row.value->>'targetReps')::integer,
        (set_row.value->>'targetKg')::numeric(8,2)
      into v_first_reps, v_first_kg
      from pg_catalog.jsonb_array_elements(v_exercise->'sets') as set_row(value)
      order by (set_row.value->>'order')::integer
      limit 1;

      v_set_count := pg_catalog.jsonb_array_length(v_exercise->'sets');

      insert into public.training_cycle_exercises (
        user_id,
        cycle_id,
        day_id,
        name,
        target_sets,
        target_reps,
        base_weight,
        side_weight,
        sort_order,
        notes,
        source_legacy_exercise_id,
        exercise_lineage_id
      )
      values (
        p_user_id,
        p_cycle_id,
        v_day_id,
        v_source.source_name,
        v_set_count,
        v_first_reps,
        v_first_kg,
        null,
        (v_exercise->>'order')::integer,
        null,
        null,
        v_source.exercise_lineage_id
      )
      returning id into v_cycle_exercise_id;

      update public.training_exercise_lineages as lineage
      set origin_training_cycle_exercise_id = pg_catalog.coalesce(
        lineage.origin_training_cycle_exercise_id,
        v_cycle_exercise_id
      )
      where lineage.id = v_source.exercise_lineage_id
        and lineage.user_id = p_user_id
        and lineage.portal_scope = p_portal_scope
        and lineage.origin_kind = 'scoped';

      insert into public.training_cycle_plan_exercises (
        version_id,
        day_id,
        cycle_id,
        user_id,
        portal_scope,
        catalog_exercise_id,
        custom_exercise_id,
        exercise_lineage_id,
        name_snapshot,
        muscle_group_snapshot,
        sort_order,
        technique,
        video_url_snapshot,
        legacy_cycle_exercise_id
      )
      values (
        v_version_id,
        v_plan_day_id,
        p_cycle_id,
        p_user_id,
        p_portal_scope,
        v_catalog_id,
        v_custom_id,
        v_source.exercise_lineage_id,
        v_source.source_name,
        v_source.muscle_group,
        (v_exercise->>'order')::smallint,
        v_exercise->>'technique',
        v_video_url,
        v_cycle_exercise_id
      )
      returning id into v_plan_exercise_id;

      for v_set in
        select value
        from pg_catalog.jsonb_array_elements(v_exercise->'sets')
        order by (value->>'order')::integer
      loop
        insert into public.training_cycle_plan_sets (
          version_id,
          exercise_id,
          user_id,
          sort_order,
          target_reps,
          target_kg,
          to_failure
        )
        values (
          v_version_id,
          v_plan_exercise_id,
          p_user_id,
          (v_set->>'order')::smallint,
          (v_set->>'targetReps')::smallint,
          (v_set->>'targetKg')::numeric(8,2),
          (v_set->>'toFailure')::boolean
        )
        returning id into v_plan_set_id;

        for v_drop in
          select value
          from pg_catalog.jsonb_array_elements(v_set->'drops')
          order by (value->>'order')::integer
        loop
          insert into public.training_cycle_plan_drops (
            version_id,
            exercise_id,
            set_id,
            user_id,
            sort_order,
            kg,
            reps
          )
          values (
            v_version_id,
            v_plan_exercise_id,
            v_plan_set_id,
            p_user_id,
            (v_drop->>'order')::smallint,
            (v_drop->>'kg')::numeric(8,2),
            (v_drop->>'reps')::smallint
          );
        end loop;
      end loop;
    end loop;
  end loop;

  return v_version_id;
end;
$function$;

revoke all on function private.persist_training_cycle_plan_version(
  uuid, text, uuid, integer, uuid, text, text, date, date, uuid, jsonb
) from public, anon, authenticated, service_role;

create function private.copy_training_cycle_plan_version(
  p_user_id uuid,
  p_portal_scope text,
  p_cycle_id uuid,
  p_version integer,
  p_request_id uuid,
  p_goal text,
  p_start_date date,
  p_end_date date,
  p_source_version_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_source_version public.training_cycle_plan_versions;
  v_version_id uuid;
  v_source_day public.training_cycle_plan_days;
  v_source_exercise public.training_cycle_plan_exercises;
  v_source_set public.training_cycle_plan_sets;
  v_new_day_id uuid;
  v_new_exercise_id uuid;
  v_new_set_id uuid;
begin
  perform private.assert_training_cycle_portal_access(p_user_id, p_portal_scope);
  perform private.validate_training_cycle_dates(p_start_date, p_end_date);

  select version.*
    into v_source_version
  from public.training_cycle_plan_versions as version
  where version.id = p_source_version_id
    and version.cycle_id = p_cycle_id
    and version.user_id = p_user_id
    and version.portal_scope = p_portal_scope;

  if v_source_version.id is null
    or p_version not between 2 and 256
    or p_goal not in ('strength', 'volume', 'definition', 'deload')
  then
    raise exception 'invalid source training cycle version' using errcode = '22023';
  end if;

  insert into public.training_cycle_plan_versions (
    cycle_id,
    user_id,
    portal_scope,
    version,
    request_id,
    change_kind,
    goal,
    start_date,
    end_date,
    source_version_id,
    plan_payload
  )
  values (
    p_cycle_id,
    p_user_id,
    p_portal_scope,
    p_version,
    p_request_id,
    'extension',
    p_goal,
    p_start_date,
    p_end_date,
    p_source_version_id,
    v_source_version.plan_payload
  )
  returning id into v_version_id;

  for v_source_day in
    select day.*
    from public.training_cycle_plan_days as day
    where day.version_id = p_source_version_id
      and day.user_id = p_user_id
    order by day.sort_order, day.id
  loop
    insert into public.training_cycle_plan_days (
      version_id,
      cycle_id,
      user_id,
      day_code,
      routine_name,
      sort_order,
      legacy_cycle_day_id
    )
    values (
      v_version_id,
      p_cycle_id,
      p_user_id,
      v_source_day.day_code,
      v_source_day.routine_name,
      v_source_day.sort_order,
      v_source_day.legacy_cycle_day_id
    )
    returning id into v_new_day_id;

    for v_source_exercise in
      select exercise.*
      from public.training_cycle_plan_exercises as exercise
      where exercise.version_id = p_source_version_id
        and exercise.day_id = v_source_day.id
        and exercise.user_id = p_user_id
      order by exercise.sort_order, exercise.id
    loop
      insert into public.training_cycle_plan_exercises (
        version_id,
        day_id,
        cycle_id,
        user_id,
        portal_scope,
        catalog_exercise_id,
        custom_exercise_id,
        exercise_lineage_id,
        name_snapshot,
        muscle_group_snapshot,
        sort_order,
        technique,
        video_url_snapshot,
        legacy_cycle_exercise_id
      )
      values (
        v_version_id,
        v_new_day_id,
        p_cycle_id,
        p_user_id,
        p_portal_scope,
        v_source_exercise.catalog_exercise_id,
        v_source_exercise.custom_exercise_id,
        v_source_exercise.exercise_lineage_id,
        v_source_exercise.name_snapshot,
        v_source_exercise.muscle_group_snapshot,
        v_source_exercise.sort_order,
        v_source_exercise.technique,
        v_source_exercise.video_url_snapshot,
        v_source_exercise.legacy_cycle_exercise_id
      )
      returning id into v_new_exercise_id;

      for v_source_set in
        select set_row.*
        from public.training_cycle_plan_sets as set_row
        where set_row.version_id = p_source_version_id
          and set_row.exercise_id = v_source_exercise.id
          and set_row.user_id = p_user_id
        order by set_row.sort_order, set_row.id
      loop
        insert into public.training_cycle_plan_sets (
          version_id,
          exercise_id,
          user_id,
          sort_order,
          target_reps,
          target_kg,
          to_failure
        )
        values (
          v_version_id,
          v_new_exercise_id,
          p_user_id,
          v_source_set.sort_order,
          v_source_set.target_reps,
          v_source_set.target_kg,
          v_source_set.to_failure
        )
        returning id into v_new_set_id;

        insert into public.training_cycle_plan_drops (
          version_id,
          exercise_id,
          set_id,
          user_id,
          sort_order,
          kg,
          reps
        )
        select
          v_version_id,
          v_new_exercise_id,
          v_new_set_id,
          p_user_id,
          drop_row.sort_order,
          drop_row.kg,
          drop_row.reps
        from public.training_cycle_plan_drops as drop_row
        where drop_row.version_id = p_source_version_id
          and drop_row.set_id = v_source_set.id
          and drop_row.user_id = p_user_id
        order by drop_row.sort_order, drop_row.id;
      end loop;
    end loop;
  end loop;

  return v_version_id;
end;
$function$;

revoke all on function private.copy_training_cycle_plan_version(
  uuid, text, uuid, integer, uuid, text, date, date, uuid
) from public, anon, authenticated, service_role;

create function private.training_cycle_plan_snapshot_json(p_version_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'days',
    pg_catalog.coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'snapshotId', day.id,
          'day', day.day_code,
          'name', day.routine_name,
          'order', day.sort_order,
          'legacyCycleDayId', day.legacy_cycle_day_id,
          'exercises', day.exercises
        )
        order by day.sort_order, day.id
      ),
      '[]'::jsonb
    )
  )
  from (
    select
      plan_day.*,
      pg_catalog.coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'snapshotId', exercise.id,
              'catalogExerciseId', exercise.catalog_exercise_id,
              'customExerciseId', exercise.custom_exercise_id,
              'exerciseLineageId', exercise.exercise_lineage_id,
              'name', exercise.name_snapshot,
              'muscleGroup', exercise.muscle_group_snapshot,
              'order', exercise.sort_order,
              'technique', exercise.technique,
              'videoUrl', exercise.video_url_snapshot,
              'legacyCycleExerciseId', exercise.legacy_cycle_exercise_id,
              'sets', pg_catalog.coalesce(
                (
                  select pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                      'snapshotId', set_row.id,
                      'order', set_row.sort_order,
                      'targetReps', set_row.target_reps,
                      'targetKg', set_row.target_kg,
                      'toFailure', set_row.to_failure,
                      'drops', pg_catalog.coalesce(
                        (
                          select pg_catalog.jsonb_agg(
                            pg_catalog.jsonb_build_object(
                              'snapshotId', drop_row.id,
                              'order', drop_row.sort_order,
                              'kg', drop_row.kg,
                              'reps', drop_row.reps
                            )
                            order by drop_row.sort_order, drop_row.id
                          )
                          from public.training_cycle_plan_drops as drop_row
                          where drop_row.version_id = p_version_id
                            and drop_row.exercise_id = exercise.id
                            and drop_row.set_id = set_row.id
                        ),
                        '[]'::jsonb
                      )
                    )
                    order by set_row.sort_order, set_row.id
                  )
                  from public.training_cycle_plan_sets as set_row
                  where set_row.version_id = p_version_id
                    and set_row.exercise_id = exercise.id
                ),
                '[]'::jsonb
              )
            )
            order by exercise.sort_order, exercise.id
          )
          from public.training_cycle_plan_exercises as exercise
          where exercise.version_id = p_version_id
            and exercise.day_id = plan_day.id
        ),
        '[]'::jsonb
      ) as exercises
    from public.training_cycle_plan_days as plan_day
    where plan_day.version_id = p_version_id
  ) as day
$function$;

revoke all on function private.training_cycle_plan_snapshot_json(uuid)
  from public, anon, authenticated, service_role;

create function private.schedule_training_cycle_notifications(
  p_user_id uuid,
  p_portal_scope text,
  p_cycle_id uuid,
  p_end_date date
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  update public.training_cycle_notifications as notification
  set superseded_at = v_now
  where notification.user_id = p_user_id
    and notification.portal_scope = p_portal_scope
    and notification.cycle_id = p_cycle_id
    and notification.end_date_snapshot is distinct from p_end_date
    and notification.superseded_at is null;

  insert into public.training_cycle_notifications (
    user_id,
    portal_scope,
    cycle_id,
    end_date_snapshot,
    event_kind,
    scheduled_on,
    title,
    body
  )
  values
    (
      p_user_id, p_portal_scope, p_cycle_id, p_end_date, 'expires_t3', p_end_date - 3,
      'Quedan 3 días de ciclo',
      'Tu ciclo termina el ' || p_end_date::pg_catalog.text || '. Puedes extenderlo desde Mi ciclo.'
    ),
    (
      p_user_id, p_portal_scope, p_cycle_id, p_end_date, 'expires_t2', p_end_date - 2,
      'Quedan 2 días de ciclo',
      'Después del ' || p_end_date::pg_catalog.text || ' el ciclo se cerrará y podrás crear el siguiente.'
    ),
    (
      p_user_id, p_portal_scope, p_cycle_id, p_end_date, 'expires_t1', p_end_date - 1,
      'Mañana termina tu ciclo',
      'Puedes extenderlo antes del cierre automático.'
    ),
    (
      p_user_id, p_portal_scope, p_cycle_id, p_end_date, 'expires_t0', p_end_date,
      'Hoy es el último día',
      'Hoy entrenas normal. El cierre se intentará mañana y esperará si tienes un entrenamiento en curso.'
    ),
    (
      p_user_id, p_portal_scope, p_cycle_id, p_end_date, 'closed_t1', p_end_date + 1,
      'Ciclo cerrado',
      'Tu ciclo quedó guardado en el historial. Ya puedes preparar el siguiente.'
    )
  on conflict (cycle_id, end_date_snapshot, event_kind) do nothing;
end;
$function$;

revoke all on function private.schedule_training_cycle_notifications(uuid, text, uuid, date)
  from public, anon, authenticated, service_role;

create function private.materialize_training_cycle_lifecycle_for_identity(
  p_user_id uuid,
  p_portal_scope text,
  p_now timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_today date := pg_catalog.timezone('America/Santiago', p_now)::date;
  v_cycle public.training_cycles;
  v_closed_cycle_id uuid;
begin
  if p_user_id is null or p_portal_scope not in ('usuario', 'coach') then
    raise exception 'invalid lifecycle identity' using errcode = '22023';
  end if;
  perform private.lock_training_cycle_portal(p_user_id, p_portal_scope);

  update public.training_cycle_notifications as notification
  set materialized_at = pg_catalog.coalesce(notification.materialized_at, p_now)
  from public.training_cycles as cycle
  where cycle.id = notification.cycle_id
    and cycle.user_id = p_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.current_plan_version_id is not null
    and notification.user_id = p_user_id
    and notification.portal_scope = p_portal_scope
    and notification.event_kind <> 'closed_t1'
    and notification.scheduled_on <= v_today
    and notification.superseded_at is null
    and notification.materialized_at is null;

  select cycle.*
    into v_cycle
  from public.training_cycles as cycle
  where cycle.user_id = p_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status = 'active'
    and cycle.deleted_at is null
    and cycle.current_plan_version_id is not null
  for update;

  if v_cycle.id is null
    or v_cycle.planned_end_date is null
    or v_cycle.planned_end_date >= v_today
  then
    return null;
  end if;

  -- A recent, non-skipped readiness without a linked session is the existing
  -- durable signal that a workout is still in progress. Stale rows older than
  -- the bounded readiness window no longer postpone closure indefinitely.
  if exists (
    select 1
    from public.training_workout_readiness as readiness
    where readiness.user_id = p_user_id
      and readiness.cycle_id = v_cycle.id
      and readiness.training_session_id is null
      and readiness.payload->>'skipped' = 'false'
      and readiness.workout_started_at >= p_now - interval '36 hours'
      and readiness.workout_started_at <= p_now + interval '5 minutes'
  ) then
    return null;
  end if;

  update public.training_cycles as cycle
  set
    status = 'completed',
    ended_at = p_now,
    closed_at = p_now,
    closed_reason = 'expired',
    summary_snapshot = pg_catalog.coalesce(
      cycle.summary_snapshot,
      pg_catalog.jsonb_build_object(
        'source', 'cycle-redesign-auto-close',
        'planVersion', cycle.current_plan_version
      )
    )
  where cycle.id = v_cycle.id
    and cycle.user_id = p_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status = 'active'
  returning cycle.id into v_closed_cycle_id;

  if v_closed_cycle_id is not null then
    update public.training_cycle_notifications as notification
    set materialized_at = pg_catalog.coalesce(notification.materialized_at, p_now)
    where notification.user_id = p_user_id
      and notification.portal_scope = p_portal_scope
      and notification.cycle_id = v_closed_cycle_id
      and notification.end_date_snapshot = v_cycle.planned_end_date
      and notification.event_kind = 'closed_t1'
      and notification.scheduled_on <= v_today
      and notification.superseded_at is null;
  end if;

  return v_closed_cycle_id;
end;
$function$;

revoke all on function private.materialize_training_cycle_lifecycle_for_identity(
  uuid, text, timestamptz
) from public, anon, authenticated, service_role;

create function private.materialize_own_training_cycle_lifecycle(
  p_user_id uuid,
  p_portal_scope text,
  p_now timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  perform private.assert_training_cycle_portal_access(p_user_id, p_portal_scope);
  return private.materialize_training_cycle_lifecycle_for_identity(
    p_user_id,
    p_portal_scope,
    p_now
  );
end;
$function$;

revoke all on function private.materialize_own_training_cycle_lifecycle(
  uuid, text, timestamptz
) from public, anon, authenticated, service_role;

create function private.verify_training_cycle_lifecycle_capability(
  p_capability text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_expected_capability text;
begin
  select secret.decrypted_secret
    into v_expected_capability
  from vault.decrypted_secrets as secret
  where secret.name = 'organizatech_training_cycle_lifecycle_rpc_secret'
  order by secret.created_at desc
  limit 1;

  if p_capability is null
    or v_expected_capability is null
    or pg_catalog.char_length(p_capability) not between 32 and 512
    or pg_catalog.char_length(v_expected_capability) not between 32 and 512
    or p_capability ~ '[[:cntrl:][:space:]]'
    or v_expected_capability ~ '[[:cntrl:][:space:]]'
  then
    return false;
  end if;

  return private.transactional_email_constant_time_equal(
    extensions.digest(pg_catalog.convert_to(p_capability, 'UTF8'), 'sha256'),
    extensions.digest(
      pg_catalog.convert_to(v_expected_capability, 'UTF8'),
      'sha256'
    )
  );
exception
  when others then
    return false;
end;
$function$;

revoke all on function private.verify_training_cycle_lifecycle_capability(text)
  from public, anon, authenticated, service_role;

-- System-only scheduler boundary. It is intentionally executable by anon
-- because the Edge worker authenticates with a separate Vault-backed
-- capability and no service_role credential. auth.uid() must remain NULL.
create function public.claim_due_training_cycle_lifecycle_deliveries(
  p_capability text,
  p_limit integer default 25
)
returns table (
  delivery_id uuid,
  user_id uuid,
  portal_scope text,
  cycle_id uuid,
  notification_id uuid,
  event_kind text,
  scheduled_on date,
  idempotency_key uuid,
  recipient_email text,
  title text,
  body text,
  attempt_token uuid
)
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '2s'
set statement_timeout = '8s'
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_today date := pg_catalog.timezone('America/Santiago', v_now)::date;
  v_check record;
  v_closed_cycle_id uuid;
begin
  if auth.uid() is not null
    or not private.verify_training_cycle_lifecycle_capability(p_capability)
  then
    raise exception 'training cycle scheduler unauthorized' using errcode = '42501';
  end if;

  if p_limit is null or p_limit not between 1 and 25 then
    raise exception 'invalid training cycle scheduler limit' using errcode = '22023';
  end if;

  -- A provider request with an unknown outcome is terminally ambiguous. It is
  -- never automatically retried, which prevents a duplicate email after an
  -- accepted-but-unconfirmed Brevo request.
  update private.training_cycle_notification_deliveries as delivery
  set
    status = 'ambiguous',
    attempt_token = null,
    provider_error_code = 'stale_sending',
    updated_at = v_now
  where delivery.status = 'sending'
    and delivery.claimed_at < v_now - interval '15 minutes';

  -- Materialize the bell independently and in a bounded batch. T+1 is only
  -- materialized by the closure routine after the active-workout guard passes.
  with due as (
    select notification.id
    from public.training_cycle_notifications as notification
    join public.training_cycles as cycle
      on cycle.id = notification.cycle_id
     and cycle.user_id = notification.user_id
     and cycle.portal_scope = notification.portal_scope
    where notification.event_kind <> 'closed_t1'
      and notification.scheduled_on <= v_today
      and notification.materialized_at is null
      and notification.superseded_at is null
      and cycle.current_plan_version_id is not null
    order by notification.scheduled_on, notification.id
    for update of notification skip locked
    limit 100
  )
  update public.training_cycle_notifications as notification
  set materialized_at = v_now
  from due
  where notification.id = due.id;

  -- New/extended expirations enter a private closure ledger once. Protected
  -- workouts are rescheduled, so a small set cannot starve later identities.
  insert into private.training_cycle_lifecycle_checks as lifecycle_check (
    cycle_id,
    user_id,
    portal_scope,
    end_date_snapshot,
    status,
    attempt_count,
    next_check_at
  )
  select
    cycle.id,
    cycle.user_id,
    cycle.portal_scope,
    cycle.planned_end_date,
    'pending',
    0,
    v_now
  from public.training_cycles as cycle
  left join private.training_cycle_lifecycle_checks as existing
    on existing.cycle_id = cycle.id
  where cycle.status = 'active'
    and cycle.deleted_at is null
    and cycle.current_plan_version_id is not null
    and cycle.planned_end_date < v_today
    and (
      existing.cycle_id is null
      or existing.end_date_snapshot is distinct from cycle.planned_end_date
    )
  order by cycle.planned_end_date, cycle.id
  limit 100
  on conflict on constraint training_cycle_lifecycle_checks_pkey do update set
    user_id = excluded.user_id,
    portal_scope = excluded.portal_scope,
    end_date_snapshot = excluded.end_date_snapshot,
    status = 'pending',
    attempt_count = 0,
    next_check_at = v_now,
    checked_at = null,
    updated_at = v_now
  where lifecycle_check.end_date_snapshot is distinct from excluded.end_date_snapshot;

  for v_check in
    select lifecycle_check.*
    from private.training_cycle_lifecycle_checks as lifecycle_check
    join public.training_cycles as cycle
      on cycle.id = lifecycle_check.cycle_id
     and cycle.user_id = lifecycle_check.user_id
     and cycle.portal_scope = lifecycle_check.portal_scope
     and cycle.planned_end_date = lifecycle_check.end_date_snapshot
    where lifecycle_check.status in ('pending', 'protected')
      and lifecycle_check.next_check_at <= v_now
      and lifecycle_check.attempt_count < 32767
      and cycle.status = 'active'
      and cycle.deleted_at is null
      and cycle.current_plan_version_id is not null
      and cycle.planned_end_date < v_today
    order by lifecycle_check.next_check_at, lifecycle_check.cycle_id
    for update of lifecycle_check skip locked
    limit 50
  loop
    v_closed_cycle_id := private.materialize_training_cycle_lifecycle_for_identity(
      v_check.user_id,
      v_check.portal_scope,
      v_now
    );

    update private.training_cycle_lifecycle_checks as lifecycle_check
    set
      status = case
        when v_closed_cycle_id is not null then 'closed'
        else 'protected'
      end,
      attempt_count = lifecycle_check.attempt_count + 1,
      next_check_at = case
        when v_closed_cycle_id is not null then v_now
        else v_now + interval '15 minutes'
      end,
      checked_at = v_now,
      updated_at = v_now
    where lifecycle_check.cycle_id = v_check.cycle_id
      and lifecycle_check.end_date_snapshot = v_check.end_date_snapshot;
  end loop;

  insert into private.training_cycle_notification_deliveries (
    notification_id,
    user_id,
    portal_scope,
    cycle_id,
    idempotency_key
  )
  select
    notification.id,
    notification.user_id,
    notification.portal_scope,
    notification.cycle_id,
    private.transactional_email_idempotency_uuid(
      'organizatech:training-cycle-lifecycle:v1:'
        || notification.id::pg_catalog.text
    )
  from public.training_cycle_notifications as notification
  where notification.materialized_at is not null
    and notification.superseded_at is null
    and not exists (
      select 1
      from private.training_cycle_notification_deliveries as existing_delivery
      where existing_delivery.notification_id = notification.id
    )
  order by notification.materialized_at, notification.id
  limit 100
  on conflict on constraint training_cycle_notification_deliveries_notification_unique
    do nothing;

  update private.training_cycle_notification_deliveries as delivery
  set
    status = 'rejected',
    attempt_token = null,
    provider_error_code = case
      when notification.superseded_at is not null then 'notification_superseded'
      else 'recipient_unavailable'
    end,
    updated_at = v_now
  from public.training_cycle_notifications as notification
  where notification.id = delivery.notification_id
    and delivery.status in ('pending', 'failed')
    and (
      notification.superseded_at is not null
      or not exists (
        select 1
        from auth.users as auth_user
        where auth_user.id = delivery.user_id
          and auth_user.email_confirmed_at is not null
          and auth_user.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    );

  return query
  with candidates as (
    select delivery.id
    from private.training_cycle_notification_deliveries as delivery
    join public.training_cycle_notifications as notification
      on notification.id = delivery.notification_id
     and notification.user_id = delivery.user_id
     and notification.portal_scope = delivery.portal_scope
     and notification.cycle_id = delivery.cycle_id
     and notification.superseded_at is null
    join auth.users as auth_user
      on auth_user.id = delivery.user_id
     and auth_user.email_confirmed_at is not null
     and auth_user.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    where delivery.status in ('pending', 'failed')
      and delivery.attempt_count < 3
      and (
        delivery.status = 'pending'
        or delivery.updated_at <= v_now
          - pg_catalog.make_interval(mins => delivery.attempt_count * 5)
      )
    order by delivery.created_at, delivery.id
    for update of delivery skip locked
    limit p_limit
  ), claimed as (
    update private.training_cycle_notification_deliveries as delivery
    set
      status = 'sending',
      attempt_count = delivery.attempt_count + 1,
      attempt_token = pg_catalog.gen_random_uuid(),
      claimed_at = v_now,
      provider_error_code = null,
      updated_at = v_now
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select
    claimed.id,
    claimed.user_id,
    claimed.portal_scope,
    claimed.cycle_id,
    notification.id,
    notification.event_kind,
    notification.scheduled_on,
    claimed.idempotency_key,
    pg_catalog.lower(pg_catalog.btrim(auth_user.email)),
    notification.title,
    notification.body,
    claimed.attempt_token
  from claimed
  join public.training_cycle_notifications as notification
    on notification.id = claimed.notification_id
   and notification.superseded_at is null
  join auth.users as auth_user
    on auth_user.id = claimed.user_id
   and auth_user.email_confirmed_at is not null
  where auth_user.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
end;
$function$;

revoke all on function public.claim_due_training_cycle_lifecycle_deliveries(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_due_training_cycle_lifecycle_deliveries(text, integer)
  to anon;

create function public.complete_training_cycle_lifecycle_delivery(
  p_capability text,
  p_delivery_id uuid,
  p_attempt_token uuid,
  p_outcome text,
  p_provider_message_id text default null,
  p_provider_error_code text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '2s'
set statement_timeout = '5s'
as $function$
begin
  if auth.uid() is not null
    or not private.verify_training_cycle_lifecycle_capability(p_capability)
    or p_outcome not in ('sent', 'failed', 'rejected', 'ambiguous')
  then
    raise exception 'training cycle completion unauthorized' using errcode = '42501';
  end if;

  if p_delivery_id is null
    or p_attempt_token is null
    or (
      p_outcome = 'sent'
      and (
        p_provider_message_id is null
        or pg_catalog.char_length(p_provider_message_id) not between 1 and 512
        or p_provider_message_id ~ '[\r\n]'
        or p_provider_error_code is not null
      )
    )
    or (
      p_outcome <> 'sent'
      and (
        p_provider_message_id is not null
        or p_provider_error_code is null
        or p_provider_error_code !~ '^[a-z0-9_]{1,64}$'
      )
    )
  then
    raise exception 'invalid training cycle completion payload' using errcode = '22023';
  end if;

  update private.training_cycle_notification_deliveries as delivery
  set
    status = p_outcome,
    attempt_token = null,
    provider_message_id = case
      when p_outcome = 'sent' then p_provider_message_id
      else null
    end,
    provider_error_code = case
      when p_outcome = 'sent' then null
      else p_provider_error_code
    end,
    sent_at = case
      when p_outcome = 'sent' then pg_catalog.clock_timestamp()
      else null
    end,
    updated_at = pg_catalog.clock_timestamp()
  where delivery.id = p_delivery_id
    and delivery.status = 'sending'
    and delivery.attempt_token = p_attempt_token;

  return found;
end;
$function$;

revoke all on function public.complete_training_cycle_lifecycle_delivery(
  text, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.complete_training_cycle_lifecycle_delivery(
  text, uuid, uuid, text, text, text
) to anon;

-- Existing legacy tables keep their current client grants for backwards
-- compatibility. Once a cycle belongs to this redesign, however, its lifecycle
-- and compatibility projection may only be changed through the bounded RPCs
-- below. This prevents a direct legacy update from bypassing versioning or the
-- in-progress-workout closure guard.
create function private.guard_cycle_redesign_direct_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_old_cycle_id uuid;
  v_new_cycle_id uuid;
begin
  -- Preserve referential account deletion while keeping every direct
  -- application DELETE (trigger depth 1) behind the redesign boundary.
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;

  if current_user::pg_catalog.text not in ('anon', 'authenticated', 'service_role') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_table_name = 'training_cycles' then
    v_old_cycle_id := old.id;
    if tg_op <> 'DELETE' then
      v_new_cycle_id := new.id;
    end if;
  else
    if tg_op <> 'INSERT' then
      v_old_cycle_id := old.cycle_id;
    end if;
    if tg_op <> 'DELETE' then
      v_new_cycle_id := new.cycle_id;
    end if;
  end if;

  if exists (
    select 1
    from public.training_cycles as cycle
    where cycle.id in (v_old_cycle_id, v_new_cycle_id)
      and cycle.current_plan_version_id is not null
  ) then
    raise exception 'cycle-redesign rows require the versioned API' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_cycle_redesign_direct_write()
  from public, anon, authenticated, service_role;

create trigger training_cycles_guard_redesign_direct_write
  before update or delete on public.training_cycles
  for each row execute function private.guard_cycle_redesign_direct_write();
create trigger training_cycle_routines_guard_redesign_direct_write
  before insert or update or delete on public.training_cycle_routines
  for each row execute function private.guard_cycle_redesign_direct_write();
create trigger training_cycle_days_guard_redesign_direct_write
  before insert or update or delete on public.training_cycle_days
  for each row execute function private.guard_cycle_redesign_direct_write();
create trigger training_cycle_exercises_guard_redesign_direct_write
  before insert or update or delete on public.training_cycle_exercises
  for each row execute function private.guard_cycle_redesign_direct_write();

create function private.guard_cycle_redesign_readiness_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_cycle public.training_cycles;
  v_portal_scope text;
  v_today date := pg_catalog.timezone(
    'America/Santiago', pg_catalog.clock_timestamp()
  )::date;
begin
  select cycle.*
    into v_cycle
  from public.training_cycles as cycle
  where cycle.id = new.cycle_id
    and cycle.user_id = new.user_id
    and cycle.deleted_at is null;

  if v_cycle.id is null or v_cycle.current_plan_version_id is null then
    return new;
  end if;

  if new.user_id is distinct from auth.uid() then
    raise exception 'training readiness ownership denied' using errcode = '42501';
  end if;

  v_portal_scope := v_cycle.portal_scope;

  -- This is the same lock used by lifecycle closure. A readiness insert that
  -- wins first becomes visible before closure checks; if closure wins, a new
  -- workout cannot be opened against the already expired redesign cycle.
  perform private.lock_training_cycle_portal(new.user_id, v_portal_scope);

  select cycle.*
    into v_cycle
  from public.training_cycles as cycle
  where cycle.id = new.cycle_id
    and cycle.user_id = new.user_id
    and cycle.portal_scope = v_portal_scope
    and cycle.deleted_at is null;

  if v_cycle.status <> 'active'
    or v_cycle.planned_end_date is null
    or v_cycle.planned_end_date < v_today
  then
    raise exception 'training cycle is closed for new workouts' using errcode = '55000';
  end if;

  return new;
end;
$function$;

revoke all on function private.guard_cycle_redesign_readiness_insert()
  from public, anon, authenticated, service_role;

create trigger training_workout_readiness_guard_cycle_redesign_insert
  before insert on public.training_workout_readiness
  for each row execute function private.guard_cycle_redesign_readiness_insert();

create function private.training_cycle_draft_snapshot_json(
  p_user_id uuid,
  p_portal_scope text,
  p_draft_id uuid,
  p_version integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  perform private.assert_training_cycle_portal_access(p_user_id, p_portal_scope);

  select pg_catalog.jsonb_build_object(
    'draftId', draft.id,
    'origin', draft.origin,
    'sourceCycleId', draft.source_cycle_id,
    'state', draft.state,
    'version', version.version,
    'goal', version.goal,
    'startDate', version.start_date,
    'endDate', version.end_date,
    'plan', version.plan_payload,
    'activatedCycleId', draft.activated_cycle_id,
    'createdAt', draft.created_at,
    'updatedAt', draft.updated_at
  )
    into v_result
  from public.training_cycle_drafts as draft
  join public.training_cycle_draft_versions as version
    on version.draft_id = draft.id
   and version.user_id = draft.user_id
   and version.portal_scope = draft.portal_scope
   and version.version = pg_catalog.coalesce(p_version, draft.current_version)
  where draft.id = p_draft_id
    and draft.user_id = p_user_id
    and draft.portal_scope = p_portal_scope;

  if v_result is null then
    raise exception 'training cycle draft not found' using errcode = 'P0002';
  end if;

  return v_result;
end;
$function$;

revoke all on function private.training_cycle_draft_snapshot_json(
  uuid, text, uuid, integer
) from public, anon, authenticated, service_role;

create function private.create_training_cycle_draft_record(
  p_user_id uuid,
  p_portal_scope text,
  p_request_id uuid,
  p_receipt_operation text,
  p_origin text,
  p_source_cycle_id uuid,
  p_goal text,
  p_start_date date,
  p_end_date date,
  p_plan jsonb,
  p_receipt_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_draft_id uuid;
  v_receipt_version integer;
  v_version_operation text;
begin
  perform private.assert_training_cycle_portal_access(p_user_id, p_portal_scope);
  perform private.lock_training_cycle_portal(p_user_id, p_portal_scope);

  v_version_operation := case p_receipt_operation
    when 'draft_create' then 'create'
    when 'draft_duplicate' then 'duplicate'
    when 'draft_renewal' then 'renewal'
    else null
  end;

  if p_request_id is null
    or p_receipt_payload is null
    or p_goal is null
    or p_goal not in ('strength', 'volume', 'definition', 'deload')
    or p_origin is null
    or p_origin not in ('manual', 'suggested', 'duplicate', 'renewal')
    or v_version_operation is null
    or (p_origin in ('manual', 'suggested') and p_source_cycle_id is not null)
    or (p_origin in ('duplicate', 'renewal') and p_source_cycle_id is null)
  then
    raise exception 'invalid training cycle draft request' using errcode = '22023';
  end if;

  select receipt.aggregate_id, receipt.result_version
    into v_draft_id, v_receipt_version
  from private.find_training_cycle_receipt(
    p_user_id,
    p_portal_scope,
    p_request_id,
    p_receipt_operation,
    p_receipt_payload
  ) as receipt;

  if v_draft_id is not null then
    return private.training_cycle_operation_result(
      p_request_id, p_receipt_operation, v_draft_id, v_receipt_version
    );
  end if;

  perform private.validate_training_cycle_dates(p_start_date, p_end_date);
  perform private.validate_training_cycle_plan(p_user_id, p_portal_scope, p_plan);

  if exists (
    select 1
    from public.training_cycle_drafts as draft
    where draft.user_id = p_user_id
      and draft.portal_scope = p_portal_scope
      and draft.state = 'draft'
  ) then
    raise exception 'discard or resume the existing draft first' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.training_cycle_drafts as draft
    where draft.user_id = p_user_id
      and draft.portal_scope = p_portal_scope
    order by draft.created_at, draft.id
    offset 511
    limit 1
  ) then
    raise exception using errcode = '54000', message = 'training cycle draft limit reached';
  end if;

  insert into public.training_cycle_drafts (
    user_id,
    portal_scope,
    origin,
    source_cycle_id,
    state,
    current_version
  )
  values (
    p_user_id,
    p_portal_scope,
    p_origin,
    p_source_cycle_id,
    'draft',
    1
  )
  returning id into v_draft_id;

  insert into public.training_cycle_draft_versions (
    draft_id,
    user_id,
    portal_scope,
    version,
    request_id,
    operation_kind,
    goal,
    start_date,
    end_date,
    plan_payload
  )
  values (
    v_draft_id,
    p_user_id,
    p_portal_scope,
    1,
    p_request_id,
    v_version_operation,
    p_goal,
    p_start_date,
    p_end_date,
    p_plan
  );

  perform private.record_training_cycle_receipt(
    p_user_id,
    p_portal_scope,
    p_request_id,
    p_receipt_operation,
    p_receipt_payload,
    v_draft_id,
    1
  );

  return private.training_cycle_operation_result(
    p_request_id, p_receipt_operation, v_draft_id, 1
  );
end;
$function$;

revoke all on function private.create_training_cycle_draft_record(
  uuid, text, uuid, text, text, uuid, text, date, date, jsonb, jsonb
) from public, anon, authenticated, service_role;

create function public.list_own_training_exercise_catalog(
  p_portal_scope text,
  p_query text default '',
  p_limit integer default 100,
  p_after_source_kind text default null,
  p_after_sort_order integer default null,
  p_after_name text default null,
  p_after_source_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_query text := pg_catalog.lower(pg_catalog.btrim(pg_catalog.coalesce(p_query, '')));
  v_cursor_rank integer := case p_after_source_kind
    when 'catalog' then 0
    when 'custom' then 1
    else null
  end;
  v_result jsonb;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);

  if p_limit is null
    or p_limit not between 1 and 100
    or pg_catalog.char_length(v_query) > 120
    or v_query ~ '[[:cntrl:]]'
    or not (
      (
        p_after_source_kind is null
        and p_after_sort_order is null
        and p_after_name is null
        and p_after_source_id is null
      )
      or (
        p_after_source_kind is not null
        and p_after_sort_order is not null
        and p_after_name is not null
        and p_after_source_id is not null
      )
    )
    or (
      p_after_source_kind is not null
      and (
        v_cursor_rank is null
        or p_after_sort_order not between 0 and 32767
        or (p_after_source_kind = 'custom' and p_after_sort_order <> 0)
        or pg_catalog.char_length(p_after_name) not between 1 and 120
        or p_after_name is distinct from pg_catalog.lower(pg_catalog.btrim(p_after_name))
        or p_after_name ~ '[[:cntrl:]]'
      )
    )
  then
    raise exception 'invalid training exercise catalog query' using errcode = '22023';
  end if;

  with all_sources as (
    select
      'catalog'::text as source_kind,
      catalog.id as source_id,
      catalog.canonical_name as name,
      pg_catalog.lower(catalog.canonical_name) as sort_name,
      catalog.muscle_group,
      catalog.default_video_url as video_url,
      0 as source_rank,
      catalog.sort_order::integer as sort_order
    from public.training_exercise_catalog as catalog
    where catalog.is_active

    union all

    select
      'custom'::text,
      custom.id,
      custom.name,
      pg_catalog.lower(custom.name),
      custom.muscle_group,
      custom.video_url,
      1,
      0
    from public.training_custom_exercises as custom
    where custom.user_id = v_user_id
      and custom.portal_scope = p_portal_scope
      and custom.archived_at is null
  ), candidates as (
    select source.*
    from all_sources as source
    where (
      v_query = ''
      or pg_catalog.position(v_query in pg_catalog.lower(source.name)) > 0
      or pg_catalog.position(v_query in pg_catalog.lower(source.muscle_group)) > 0
    )
      and (
        p_after_source_kind is null
        or (
          source.source_rank,
          source.sort_order,
          source.sort_name,
          source.source_id
        ) > (
          v_cursor_rank,
          p_after_sort_order,
          p_after_name,
          p_after_source_id
        )
      )
    order by source.source_rank, source.sort_order, source.sort_name, source.source_id
    limit p_limit + 1
  ), page as (
    select candidate.*
    from candidates as candidate
    order by candidate.source_rank, candidate.sort_order, candidate.sort_name, candidate.source_id
    limit p_limit
  )
  select pg_catalog.jsonb_build_object(
    'items',
    pg_catalog.coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'sourceKind', item.source_kind,
            'sourceId', item.source_id,
            'name', item.name,
            'muscleGroup', item.muscle_group,
            'videoUrl', item.video_url
          )
          order by item.source_rank, item.sort_order, item.sort_name, item.source_id
        )
        from page as item
      ),
      '[]'::jsonb
    ),
    'nextCursor',
    case
      when (select pg_catalog.count(*) from candidates) > p_limit then (
        select pg_catalog.jsonb_build_object(
          'afterSourceKind', item.source_kind,
          'afterSortOrder', item.sort_order,
          'afterName', item.sort_name,
          'afterSourceId', item.source_id
        )
        from page as item
        order by
          item.source_rank desc,
          item.sort_order desc,
          item.sort_name desc,
          item.source_id desc
        limit 1
      )
      else null
    end
  )
    into v_result
  ;

  return v_result;
end;
$function$;

revoke all on function public.list_own_training_exercise_catalog(
  text, text, integer, text, integer, text, uuid
)
  from public, anon, authenticated, service_role;
grant execute on function public.list_own_training_exercise_catalog(
  text, text, integer, text, integer, text, uuid
)
  to authenticated;

create function public.create_own_training_custom_exercise(
  p_request_id uuid,
  p_portal_scope text,
  p_name text,
  p_muscle_group text,
  p_video_url text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_name text := pg_catalog.btrim(p_name);
  v_video_url text := pg_catalog.nullif(pg_catalog.btrim(p_video_url), '');
  v_payload jsonb;
  v_custom_id uuid;
  v_receipt_version integer;
  v_lineage_id uuid;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  perform private.lock_training_cycle_portal(v_user_id, p_portal_scope);

  if p_request_id is null
    or v_name is null
    or pg_catalog.char_length(v_name) not between 1 and 120
    or v_name ~ '[[:cntrl:]]'
    or p_muscle_group is null
    or p_muscle_group not in (
      'pectoral', 'hombros', 'triceps', 'dorsal', 'biceps', 'trapecio',
      'cuadriceps', 'femoral', 'gluteos', 'pantorrillas',
      'pierna_completa', 'abdomen'
    )
    or (
      v_video_url is not null
      and not private.is_valid_training_youtube_url(v_video_url)
    )
  then
    raise exception 'invalid custom training exercise' using errcode = '22023';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'portalScope', p_portal_scope,
    'name', v_name,
    'muscleGroup', p_muscle_group,
    'videoUrl', v_video_url
  );

  select receipt.aggregate_id, receipt.result_version
    into v_custom_id, v_receipt_version
  from private.find_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'custom_exercise_create',
    v_payload
  ) as receipt;

  if v_custom_id is not null then
    return private.training_cycle_operation_result(
      p_request_id, 'custom_exercise_create', v_custom_id, v_receipt_version
    );
  end if;

  if exists (
    select 1
    from public.training_custom_exercises as custom
    where custom.user_id = v_user_id
      and custom.portal_scope = p_portal_scope
    order by custom.created_at, custom.id
    offset 199
    limit 1
  ) then
    raise exception using errcode = '54000', message = 'custom training exercise limit reached';
  end if;

  insert into public.training_exercise_lineages (
    user_id,
    portal_scope,
    origin_kind,
    metadata
  )
  values (
    v_user_id,
    p_portal_scope,
    'scoped',
    pg_catalog.jsonb_build_object(
      'source', 'cycle_redesign_custom',
      'portalScope', p_portal_scope
    )
  )
  returning id into v_lineage_id;

  insert into public.training_custom_exercises (
    user_id,
    portal_scope,
    lineage_id,
    name,
    muscle_group,
    video_url
  )
  values (
    v_user_id,
    p_portal_scope,
    v_lineage_id,
    v_name,
    p_muscle_group,
    v_video_url
  )
  returning id into v_custom_id;

  update public.training_exercise_lineages as lineage
  set custom_exercise_id = v_custom_id
  where lineage.id = v_lineage_id
    and lineage.user_id = v_user_id
    and lineage.portal_scope = p_portal_scope
    and lineage.custom_exercise_id is null;

  perform private.record_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'custom_exercise_create',
    v_payload,
    v_custom_id,
    null
  );

  return private.training_cycle_operation_result(
    p_request_id, 'custom_exercise_create', v_custom_id, null
  );
end;
$function$;

revoke all on function public.create_own_training_custom_exercise(
  uuid, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_own_training_custom_exercise(
  uuid, text, text, text, text
) to authenticated;

create function public.create_own_training_cycle_draft(
  p_request_id uuid,
  p_portal_scope text,
  p_origin text,
  p_goal text,
  p_start_date date,
  p_end_date date,
  p_plan jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_payload jsonb;
begin
  v_payload := pg_catalog.jsonb_build_object(
    'portalScope', p_portal_scope,
    'origin', p_origin,
    'goal', p_goal,
    'startDate', p_start_date,
    'endDate', p_end_date,
    'plan', p_plan
  );

  return private.create_training_cycle_draft_record(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'draft_create',
    p_origin,
    null,
    p_goal,
    p_start_date,
    p_end_date,
    p_plan,
    v_payload
  );
end;
$function$;

revoke all on function public.create_own_training_cycle_draft(
  uuid, text, text, text, date, date, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_own_training_cycle_draft(
  uuid, text, text, text, date, date, jsonb
) to authenticated;

create function public.get_own_training_cycle_draft(
  p_portal_scope text,
  p_draft_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_draft_id uuid;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);

  select draft.id
    into v_draft_id
  from public.training_cycle_drafts as draft
  where draft.user_id = v_user_id
    and draft.portal_scope = p_portal_scope
    and (
      (p_draft_id is null and draft.state = 'draft')
      or draft.id = p_draft_id
    )
  order by
    case when draft.state = 'draft' then 0 else 1 end,
    draft.updated_at desc,
    draft.id
  limit 1;

  if v_draft_id is null then
    return null;
  end if;

  return private.training_cycle_draft_snapshot_json(
    v_user_id, p_portal_scope, v_draft_id, null
  );
end;
$function$;

revoke all on function public.get_own_training_cycle_draft(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_own_training_cycle_draft(text, uuid)
  to authenticated;

create function public.save_own_training_cycle_draft(
  p_request_id uuid,
  p_portal_scope text,
  p_draft_id uuid,
  p_expected_version integer,
  p_goal text,
  p_start_date date,
  p_end_date date,
  p_plan jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_payload jsonb;
  v_receipt_draft_id uuid;
  v_receipt_version integer;
  v_draft public.training_cycle_drafts;
  v_new_version integer;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  perform private.lock_training_cycle_portal(v_user_id, p_portal_scope);

  if p_request_id is null
    or p_draft_id is null
    or p_expected_version is null
    or p_goal is null
    or p_goal not in ('strength', 'volume', 'definition', 'deload')
  then
    raise exception 'invalid training cycle draft save' using errcode = '22023';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'portalScope', p_portal_scope,
    'draftId', p_draft_id,
    'expectedVersion', p_expected_version,
    'goal', p_goal,
    'startDate', p_start_date,
    'endDate', p_end_date,
    'plan', p_plan
  );

  select receipt.aggregate_id, receipt.result_version
    into v_receipt_draft_id, v_receipt_version
  from private.find_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'draft_save',
    v_payload
  ) as receipt;

  if v_receipt_draft_id is not null then
    return private.training_cycle_operation_result(
      p_request_id, 'draft_save', v_receipt_draft_id, v_receipt_version
    );
  end if;

  perform private.validate_training_cycle_dates(p_start_date, p_end_date);
  perform private.validate_training_cycle_plan(v_user_id, p_portal_scope, p_plan);

  select draft.*
    into v_draft
  from public.training_cycle_drafts as draft
  where draft.id = p_draft_id
    and draft.user_id = v_user_id
    and draft.portal_scope = p_portal_scope
  for update;

  if v_draft.id is null then
    raise exception 'training cycle draft not found' using errcode = 'P0002';
  end if;
  if v_draft.state <> 'draft' then
    raise exception 'training cycle draft is not editable' using errcode = '55000';
  end if;
  if v_draft.current_version is distinct from p_expected_version then
    raise exception 'training cycle draft version conflict' using errcode = '40001';
  end if;
  if v_draft.current_version >= 256 then
    raise exception using errcode = '54000', message = 'training cycle draft version limit reached';
  end if;

  v_new_version := v_draft.current_version + 1;

  insert into public.training_cycle_draft_versions (
    draft_id,
    user_id,
    portal_scope,
    version,
    request_id,
    operation_kind,
    goal,
    start_date,
    end_date,
    plan_payload
  )
  values (
    v_draft.id,
    v_user_id,
    p_portal_scope,
    v_new_version,
    p_request_id,
    'save',
    p_goal,
    p_start_date,
    p_end_date,
    p_plan
  );

  update public.training_cycle_drafts as draft
  set current_version = v_new_version
  where draft.id = v_draft.id
    and draft.user_id = v_user_id
    and draft.portal_scope = p_portal_scope
    and draft.state = 'draft'
    and draft.current_version = p_expected_version;

  if not found then
    raise exception 'training cycle draft version conflict' using errcode = '40001';
  end if;

  perform private.record_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'draft_save',
    v_payload,
    v_draft.id,
    v_new_version
  );

  return private.training_cycle_operation_result(
    p_request_id, 'draft_save', v_draft.id, v_new_version
  );
end;
$function$;

revoke all on function public.save_own_training_cycle_draft(
  uuid, text, uuid, integer, text, date, date, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.save_own_training_cycle_draft(
  uuid, text, uuid, integer, text, date, date, jsonb
) to authenticated;

create function public.discard_own_training_cycle_draft(
  p_request_id uuid,
  p_portal_scope text,
  p_draft_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_payload jsonb;
  v_receipt_draft_id uuid;
  v_receipt_version integer;
  v_draft public.training_cycle_drafts;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  perform private.lock_training_cycle_portal(v_user_id, p_portal_scope);

  if p_request_id is null
    or p_draft_id is null
    or p_expected_version is null
    or p_expected_version not between 1 and 256
  then
    raise exception 'invalid training cycle draft discard' using errcode = '22023';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'portalScope', p_portal_scope,
    'draftId', p_draft_id,
    'expectedVersion', p_expected_version
  );

  select receipt.aggregate_id, receipt.result_version
    into v_receipt_draft_id, v_receipt_version
  from private.find_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'draft_discard',
    v_payload
  ) as receipt;

  if v_receipt_draft_id is not null then
    return private.training_cycle_operation_result(
      p_request_id, 'draft_discard', v_receipt_draft_id, v_receipt_version
    );
  end if;

  select draft.*
    into v_draft
  from public.training_cycle_drafts as draft
  where draft.id = p_draft_id
    and draft.user_id = v_user_id
    and draft.portal_scope = p_portal_scope
  for update;

  if v_draft.id is null then
    raise exception 'training cycle draft not found' using errcode = 'P0002';
  end if;
  if v_draft.state <> 'draft' then
    raise exception 'training cycle draft is not discardable' using errcode = '55000';
  end if;
  if v_draft.current_version is distinct from p_expected_version then
    raise exception 'training cycle draft version conflict' using errcode = '40001';
  end if;

  update public.training_cycle_drafts as draft
  set
    state = 'discarded',
    discarded_at = pg_catalog.clock_timestamp()
  where draft.id = v_draft.id
    and draft.user_id = v_user_id
    and draft.portal_scope = p_portal_scope
    and draft.state = 'draft'
    and draft.current_version = p_expected_version;

  if not found then
    raise exception 'training cycle draft version conflict' using errcode = '40001';
  end if;

  perform private.record_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'draft_discard',
    v_payload,
    v_draft.id,
    v_draft.current_version
  );

  return private.training_cycle_operation_result(
    p_request_id, 'draft_discard', v_draft.id, v_draft.current_version
  );
end;
$function$;

revoke all on function public.discard_own_training_cycle_draft(
  uuid, text, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.discard_own_training_cycle_draft(
  uuid, text, uuid, integer
) to authenticated;

create function public.duplicate_own_training_cycle_to_draft(
  p_request_id uuid,
  p_portal_scope text,
  p_source_cycle_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_source public.training_cycle_plan_versions;
  v_payload jsonb;
  v_receipt_draft_id uuid;
  v_receipt_version integer;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  perform private.lock_training_cycle_portal(v_user_id, p_portal_scope);

  if p_request_id is null or p_source_cycle_id is null then
    raise exception 'invalid training cycle duplicate request' using errcode = '22023';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'portalScope', p_portal_scope,
    'sourceCycleId', p_source_cycle_id,
    'startDate', p_start_date,
    'endDate', p_end_date
  );

  select receipt.aggregate_id, receipt.result_version
    into v_receipt_draft_id, v_receipt_version
  from private.find_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'draft_duplicate',
    v_payload
  ) as receipt;

  if v_receipt_draft_id is not null then
    return private.training_cycle_operation_result(
      p_request_id, 'draft_duplicate', v_receipt_draft_id, v_receipt_version
    );
  end if;

  perform private.materialize_own_training_cycle_lifecycle(
    v_user_id, p_portal_scope, pg_catalog.clock_timestamp()
  );

  select version.*
    into v_source
  from public.training_cycles as cycle
  join public.training_cycle_plan_versions as version
    on version.id = cycle.current_plan_version_id
   and version.cycle_id = cycle.id
   and version.user_id = cycle.user_id
  where cycle.id = p_source_cycle_id
    and cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status in ('active', 'completed')
    and cycle.deleted_at is null;

  if v_source.id is null then
    raise exception 'source training cycle not found' using errcode = 'P0002';
  end if;

  return private.create_training_cycle_draft_record(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'draft_duplicate',
    'duplicate',
    p_source_cycle_id,
    v_source.goal,
    p_start_date,
    p_end_date,
    v_source.plan_payload,
    v_payload
  );
end;
$function$;

revoke all on function public.duplicate_own_training_cycle_to_draft(
  uuid, text, uuid, date, date
) from public, anon, authenticated, service_role;
grant execute on function public.duplicate_own_training_cycle_to_draft(
  uuid, text, uuid, date, date
) to authenticated;

create function public.renew_own_closed_training_cycle_to_draft(
  p_request_id uuid,
  p_portal_scope text,
  p_source_cycle_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_source public.training_cycle_plan_versions;
  v_payload jsonb;
  v_receipt_draft_id uuid;
  v_receipt_version integer;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  perform private.lock_training_cycle_portal(v_user_id, p_portal_scope);

  if p_request_id is null or p_source_cycle_id is null then
    raise exception 'invalid training cycle renewal request' using errcode = '22023';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'portalScope', p_portal_scope,
    'sourceCycleId', p_source_cycle_id,
    'startDate', p_start_date,
    'endDate', p_end_date
  );

  select receipt.aggregate_id, receipt.result_version
    into v_receipt_draft_id, v_receipt_version
  from private.find_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'draft_renewal',
    v_payload
  ) as receipt;

  if v_receipt_draft_id is not null then
    return private.training_cycle_operation_result(
      p_request_id, 'draft_renewal', v_receipt_draft_id, v_receipt_version
    );
  end if;

  perform private.materialize_own_training_cycle_lifecycle(
    v_user_id, p_portal_scope, pg_catalog.clock_timestamp()
  );

  select version.*
    into v_source
  from public.training_cycles as cycle
  join public.training_cycle_plan_versions as version
    on version.id = cycle.current_plan_version_id
   and version.cycle_id = cycle.id
   and version.user_id = cycle.user_id
  where cycle.id = p_source_cycle_id
    and cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status = 'completed'
    and cycle.deleted_at is null;

  if v_source.id is null then
    raise exception 'closed source training cycle not found' using errcode = 'P0002';
  end if;

  return private.create_training_cycle_draft_record(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'draft_renewal',
    'renewal',
    p_source_cycle_id,
    v_source.goal,
    p_start_date,
    p_end_date,
    v_source.plan_payload,
    v_payload
  );
end;
$function$;

revoke all on function public.renew_own_closed_training_cycle_to_draft(
  uuid, text, uuid, date, date
) from public, anon, authenticated, service_role;
grant execute on function public.renew_own_closed_training_cycle_to_draft(
  uuid, text, uuid, date, date
) to authenticated;

create function private.training_cycle_snapshot_json(
  p_user_id uuid,
  p_portal_scope text,
  p_cycle_id uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_today date := pg_catalog.timezone('America/Santiago', p_now)::date;
  v_result jsonb;
begin
  perform private.assert_training_cycle_portal_access(p_user_id, p_portal_scope);

  select pg_catalog.jsonb_build_object(
    'cycleId', cycle.id,
    'portalScope', cycle.portal_scope,
    'cycleNumber', cycle.cycle_number,
    'goal', version.goal,
    'startDate', version.start_date,
    'endDate', version.end_date,
    'status', case
      when cycle.status in ('completed', 'cancelled') then 'closed'
      when cycle.status = 'active'
        and v_today >= version.end_date - 3 then 'expiring'
      else 'active'
    end,
    'daysUntilEnd', version.end_date - v_today,
    'version', cycle.current_plan_version,
    'snapshotId', cycle.current_plan_version_id,
    'extensionCount', cycle.extension_count,
    'sourceDraftId', cycle.source_draft_id,
    'sourceCycleId', cycle.source_cycle_id,
    'closedAt', cycle.closed_at,
    'closedReason', cycle.closed_reason,
    'createdAt', cycle.created_at,
    'updatedAt', cycle.updated_at,
    'plan', private.training_cycle_plan_snapshot_json(cycle.current_plan_version_id)
  )
    into v_result
  from public.training_cycles as cycle
  join public.training_cycle_plan_versions as version
    on version.id = cycle.current_plan_version_id
   and version.cycle_id = cycle.id
   and version.user_id = cycle.user_id
  where cycle.id = p_cycle_id
    and cycle.user_id = p_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.deleted_at is null;

  if v_result is null then
    raise exception 'training cycle not found' using errcode = 'P0002';
  end if;

  return v_result;
end;
$function$;

revoke all on function private.training_cycle_snapshot_json(
  uuid, text, uuid, timestamptz
) from public, anon, authenticated, service_role;

create function public.activate_own_training_cycle_draft(
  p_request_id uuid,
  p_portal_scope text,
  p_draft_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '8s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_today date := pg_catalog.timezone('America/Santiago', v_now)::date;
  v_payload jsonb;
  v_receipt_cycle_id uuid;
  v_receipt_version integer;
  v_draft public.training_cycle_drafts;
  v_draft_version public.training_cycle_draft_versions;
  v_cycle_id uuid;
  v_plan_version_id uuid;
  v_cycle_number integer;
  v_duration_weeks integer;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  perform private.lock_training_cycle_portal(v_user_id, p_portal_scope);

  if p_request_id is null
    or p_draft_id is null
    or p_expected_version is null
    or p_expected_version not between 1 and 256
  then
    raise exception 'invalid training cycle activation request' using errcode = '22023';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'portalScope', p_portal_scope,
    'draftId', p_draft_id,
    'expectedVersion', p_expected_version
  );

  select receipt.aggregate_id, receipt.result_version
    into v_receipt_cycle_id, v_receipt_version
  from private.find_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'cycle_activate',
    v_payload
  ) as receipt;

  if v_receipt_cycle_id is not null then
    return private.training_cycle_operation_result(
      p_request_id, 'cycle_activate', v_receipt_cycle_id, v_receipt_version
    );
  end if;

  perform private.materialize_own_training_cycle_lifecycle(
    v_user_id, p_portal_scope, v_now
  );

  select draft.*
    into v_draft
  from public.training_cycle_drafts as draft
  where draft.id = p_draft_id
    and draft.user_id = v_user_id
    and draft.portal_scope = p_portal_scope
  for update;

  if v_draft.id is null then
    raise exception 'training cycle draft not found' using errcode = 'P0002';
  end if;
  if v_draft.state <> 'draft' then
    raise exception 'training cycle draft is not activatable' using errcode = '55000';
  end if;
  if v_draft.current_version is distinct from p_expected_version then
    raise exception 'training cycle draft version conflict' using errcode = '40001';
  end if;

  select version.*
    into v_draft_version
  from public.training_cycle_draft_versions as version
  where version.draft_id = v_draft.id
    and version.user_id = v_user_id
    and version.portal_scope = p_portal_scope
    and version.version = v_draft.current_version;

  if v_draft_version.id is null then
    raise exception 'training cycle draft snapshot not found' using errcode = 'P0002';
  end if;

  perform private.validate_training_cycle_dates(
    v_draft_version.start_date, v_draft_version.end_date
  );
  perform private.validate_training_cycle_plan(
    v_user_id, p_portal_scope, v_draft_version.plan_payload
  );

  if v_draft_version.end_date < v_today then
    raise exception 'training cycle end date is already past' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.training_cycles as cycle
    where cycle.user_id = v_user_id
      and cycle.portal_scope = p_portal_scope
      and cycle.status = 'active'
      and cycle.deleted_at is null
  ) then
    raise exception 'an active training cycle already exists in this portal' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.training_cycles as cycle
    where cycle.user_id = v_user_id
      and cycle.portal_scope = p_portal_scope
    order by cycle.created_at, cycle.id
    offset 999
    limit 1
  ) then
    raise exception using errcode = '54000', message = 'training cycle limit reached';
  end if;

  select pg_catalog.coalesce(pg_catalog.max(cycle.cycle_number), 0) + 1
    into v_cycle_number
  from public.training_cycles as cycle
  where cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope;

  if v_cycle_number not between 1 and 1000000 then
    raise exception using errcode = '54000', message = 'training cycle number limit reached';
  end if;

  v_duration_weeks := pg_catalog.greatest(
    1,
    pg_catalog.ceil(
      ((v_draft_version.end_date - v_draft_version.start_date) + 1)::numeric / 7
    )::integer
  );

  insert into public.training_cycles (
    user_id,
    name,
    cycle_number,
    cycle_type,
    goal,
    started_at,
    ended_at,
    status,
    plan_snapshot,
    summary_snapshot,
    duration_weeks,
    planned_start_date,
    planned_end_date,
    portal_scope,
    current_plan_version,
    current_plan_version_id,
    source_draft_id,
    source_cycle_id,
    extension_count
  )
  values (
    v_user_id,
    'Ciclo ' || v_cycle_number::pg_catalog.text,
    v_cycle_number,
    null,
    v_draft_version.goal,
    v_draft_version.start_date::timestamp at time zone 'America/Santiago',
    null,
    'active',
    v_draft_version.plan_payload,
    null,
    v_duration_weeks,
    v_draft_version.start_date,
    v_draft_version.end_date,
    p_portal_scope,
    0,
    null,
    v_draft.id,
    v_draft.source_cycle_id,
    0
  )
  returning id into v_cycle_id;

  v_plan_version_id := private.persist_training_cycle_plan_version(
    v_user_id,
    p_portal_scope,
    v_cycle_id,
    1,
    p_request_id,
    'activation',
    v_draft_version.goal,
    v_draft_version.start_date,
    v_draft_version.end_date,
    null,
    v_draft_version.plan_payload
  );

  update public.training_cycles as cycle
  set
    current_plan_version = 1,
    current_plan_version_id = v_plan_version_id
  where cycle.id = v_cycle_id
    and cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status = 'active';

  if not found then
    raise exception 'training cycle activation conflict' using errcode = '40001';
  end if;

  update public.training_cycle_drafts as draft
  set
    state = 'activated',
    activated_cycle_id = v_cycle_id
  where draft.id = v_draft.id
    and draft.user_id = v_user_id
    and draft.portal_scope = p_portal_scope
    and draft.state = 'draft'
    and draft.current_version = p_expected_version;

  if not found then
    raise exception 'training cycle draft version conflict' using errcode = '40001';
  end if;

  perform private.schedule_training_cycle_notifications(
    v_user_id, p_portal_scope, v_cycle_id, v_draft_version.end_date
  );
  perform private.record_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'cycle_activate',
    v_payload,
    v_cycle_id,
    1
  );

  return private.training_cycle_operation_result(
    p_request_id, 'cycle_activate', v_cycle_id, 1
  );
end;
$function$;

revoke all on function public.activate_own_training_cycle_draft(
  uuid, text, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.activate_own_training_cycle_draft(
  uuid, text, uuid, integer
) to authenticated;

create function public.edit_own_active_training_cycle(
  p_request_id uuid,
  p_portal_scope text,
  p_cycle_id uuid,
  p_expected_version integer,
  p_goal text,
  p_plan jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '8s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_payload jsonb;
  v_receipt_cycle_id uuid;
  v_receipt_version integer;
  v_cycle public.training_cycles;
  v_new_version integer;
  v_plan_version_id uuid;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  perform private.lock_training_cycle_portal(v_user_id, p_portal_scope);

  if p_request_id is null
    or p_cycle_id is null
    or p_expected_version is null
    or p_goal is null
    or p_goal not in ('strength', 'volume', 'definition', 'deload')
  then
    raise exception 'invalid training cycle edit request' using errcode = '22023';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'portalScope', p_portal_scope,
    'cycleId', p_cycle_id,
    'expectedVersion', p_expected_version,
    'goal', p_goal,
    'plan', p_plan
  );

  select receipt.aggregate_id, receipt.result_version
    into v_receipt_cycle_id, v_receipt_version
  from private.find_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'cycle_edit',
    v_payload
  ) as receipt;

  if v_receipt_cycle_id is not null then
    return private.training_cycle_operation_result(
      p_request_id, 'cycle_edit', v_receipt_cycle_id, v_receipt_version
    );
  end if;

  perform private.validate_training_cycle_plan(v_user_id, p_portal_scope, p_plan);

  perform private.materialize_own_training_cycle_lifecycle(
    v_user_id, p_portal_scope, v_now
  );

  select cycle.*
    into v_cycle
  from public.training_cycles as cycle
  where cycle.id = p_cycle_id
    and cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.deleted_at is null
  for update;

  if v_cycle.id is null then
    raise exception 'training cycle not found' using errcode = 'P0002';
  end if;
  if v_cycle.status <> 'active' or v_cycle.current_plan_version_id is null then
    raise exception 'training cycle is not editable' using errcode = '55000';
  end if;
  if v_cycle.current_plan_version is distinct from p_expected_version then
    raise exception 'training cycle version conflict' using errcode = '40001';
  end if;
  if v_cycle.current_plan_version >= 256 then
    raise exception using errcode = '54000', message = 'training cycle version limit reached';
  end if;

  v_new_version := v_cycle.current_plan_version + 1;
  v_plan_version_id := private.persist_training_cycle_plan_version(
    v_user_id,
    p_portal_scope,
    v_cycle.id,
    v_new_version,
    p_request_id,
    'edit',
    p_goal,
    v_cycle.planned_start_date,
    v_cycle.planned_end_date,
    v_cycle.current_plan_version_id,
    p_plan
  );

  update public.training_cycles as cycle
  set
    goal = p_goal,
    plan_snapshot = p_plan,
    current_plan_version = v_new_version,
    current_plan_version_id = v_plan_version_id
  where cycle.id = v_cycle.id
    and cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status = 'active'
    and cycle.current_plan_version = p_expected_version;

  if not found then
    raise exception 'training cycle version conflict' using errcode = '40001';
  end if;

  perform private.record_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'cycle_edit',
    v_payload,
    v_cycle.id,
    v_new_version
  );

  return private.training_cycle_operation_result(
    p_request_id, 'cycle_edit', v_cycle.id, v_new_version
  );
end;
$function$;

revoke all on function public.edit_own_active_training_cycle(
  uuid, text, uuid, integer, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.edit_own_active_training_cycle(
  uuid, text, uuid, integer, text, jsonb
) to authenticated;

create function public.extend_own_active_training_cycle(
  p_request_id uuid,
  p_portal_scope text,
  p_cycle_id uuid,
  p_expected_version integer,
  p_new_end_date date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '8s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_today date := pg_catalog.timezone('America/Santiago', v_now)::date;
  v_payload jsonb;
  v_receipt_cycle_id uuid;
  v_receipt_version integer;
  v_cycle public.training_cycles;
  v_current_snapshot public.training_cycle_plan_versions;
  v_new_version integer;
  v_plan_version_id uuid;
  v_duration_weeks integer;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  perform private.lock_training_cycle_portal(v_user_id, p_portal_scope);

  if p_request_id is null
    or p_cycle_id is null
    or p_expected_version is null
    or p_new_end_date is null
  then
    raise exception 'invalid training cycle extension request' using errcode = '22023';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'portalScope', p_portal_scope,
    'cycleId', p_cycle_id,
    'expectedVersion', p_expected_version,
    'newEndDate', p_new_end_date
  );

  select receipt.aggregate_id, receipt.result_version
    into v_receipt_cycle_id, v_receipt_version
  from private.find_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'cycle_extend',
    v_payload
  ) as receipt;

  if v_receipt_cycle_id is not null then
    return private.training_cycle_operation_result(
      p_request_id, 'cycle_extend', v_receipt_cycle_id, v_receipt_version
    );
  end if;

  perform private.materialize_own_training_cycle_lifecycle(
    v_user_id, p_portal_scope, v_now
  );

  select cycle.*
    into v_cycle
  from public.training_cycles as cycle
  where cycle.id = p_cycle_id
    and cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.deleted_at is null
  for update;

  if v_cycle.id is null then
    raise exception 'training cycle not found' using errcode = 'P0002';
  end if;
  if v_cycle.status <> 'active' or v_cycle.current_plan_version_id is null then
    raise exception 'training cycle is not extendable' using errcode = '55000';
  end if;
  if v_cycle.current_plan_version is distinct from p_expected_version then
    raise exception 'training cycle version conflict' using errcode = '40001';
  end if;
  if p_new_end_date <= v_today
    or p_new_end_date <= v_cycle.planned_end_date
  then
    raise exception 'new end date must be after today and the current end date' using errcode = '22023';
  end if;

  perform private.validate_training_cycle_dates(
    v_cycle.planned_start_date, p_new_end_date
  );

  if v_cycle.current_plan_version >= 256 or v_cycle.extension_count >= 256 then
    raise exception using errcode = '54000', message = 'training cycle extension limit reached';
  end if;

  select version.*
    into v_current_snapshot
  from public.training_cycle_plan_versions as version
  where version.id = v_cycle.current_plan_version_id
    and version.cycle_id = v_cycle.id
    and version.user_id = v_user_id
    and version.portal_scope = p_portal_scope;

  if v_current_snapshot.id is null then
    raise exception 'training cycle snapshot not found' using errcode = 'P0002';
  end if;

  v_new_version := v_cycle.current_plan_version + 1;
  v_plan_version_id := private.copy_training_cycle_plan_version(
    v_user_id,
    p_portal_scope,
    v_cycle.id,
    v_new_version,
    p_request_id,
    v_current_snapshot.goal,
    v_current_snapshot.start_date,
    p_new_end_date,
    v_current_snapshot.id
  );

  v_duration_weeks := pg_catalog.greatest(
    1,
    pg_catalog.ceil(
      ((p_new_end_date - v_cycle.planned_start_date) + 1)::numeric / 7
    )::integer
  );

  update public.training_cycles as cycle
  set
    planned_end_date = p_new_end_date,
    duration_weeks = v_duration_weeks,
    extension_count = cycle.extension_count + 1,
    current_plan_version = v_new_version,
    current_plan_version_id = v_plan_version_id
  where cycle.id = v_cycle.id
    and cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status = 'active'
    and cycle.current_plan_version = p_expected_version;

  if not found then
    raise exception 'training cycle version conflict' using errcode = '40001';
  end if;

  perform private.schedule_training_cycle_notifications(
    v_user_id, p_portal_scope, v_cycle.id, p_new_end_date
  );
  perform private.record_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'cycle_extend',
    v_payload,
    v_cycle.id,
    v_new_version
  );

  return private.training_cycle_operation_result(
    p_request_id, 'cycle_extend', v_cycle.id, v_new_version
  );
end;
$function$;

revoke all on function public.extend_own_active_training_cycle(
  uuid, text, uuid, integer, date
) from public, anon, authenticated, service_role;
grant execute on function public.extend_own_active_training_cycle(
  uuid, text, uuid, integer, date
) to authenticated;

create function public.record_own_training_cycle_execution(
  p_request_id uuid,
  p_portal_scope text,
  p_cycle_id uuid,
  p_expected_version integer,
  p_performed_at timestamptz,
  p_execution jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '2s'
set statement_timeout = '8s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_performed_on date;
  v_week_started_on date;
  v_payload jsonb;
  v_receipt_execution_id uuid;
  v_receipt_version integer;
  v_cycle public.training_cycles;
  v_plan_version public.training_cycle_plan_versions;
  v_plan_day public.training_cycle_plan_days;
  v_execution_id uuid;
  v_execution_exercise_id uuid;
  v_execution_set_id uuid;
  v_exercise jsonb;
  v_set jsonb;
  v_drop jsonb;
  v_plan_exercise public.training_cycle_plan_exercises;
  v_plan_set public.training_cycle_plan_sets;
  v_plan_drop public.training_cycle_plan_drops;
  v_completed boolean;
  v_drop_completed boolean;
  v_reached_failure boolean;
  v_actual_reps numeric;
  v_actual_kg numeric;
  v_plan_day_id uuid;
  v_plan_exercise_id uuid;
  v_plan_set_id uuid;
  v_plan_drop_id uuid;
  v_order numeric;
  v_seen_exercise_ids uuid[] := array[]::uuid[];
  v_seen_set_ids uuid[];
  v_seen_drop_ids uuid[];
  v_total_sets integer := 0;
  v_total_drops integer := 0;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  perform private.lock_training_cycle_portal(v_user_id, p_portal_scope);

  if p_request_id is null
    or p_cycle_id is null
    or p_expected_version is null
    or p_expected_version not between 1 and 256
    or p_performed_at is null
    or p_execution is null
    or pg_catalog.jsonb_typeof(p_execution) is distinct from 'object'
    or pg_catalog.octet_length(p_execution::pg_catalog.text) > 262144
    or not (p_execution ?& array['dayId', 'exercises'])
    or p_execution - array['dayId', 'exercises']::text[] <> '{}'::jsonb
    or pg_catalog.jsonb_typeof(p_execution->'dayId') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_execution->'exercises') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_execution->'exercises') not between 1 and 200
  then
    raise exception 'invalid training cycle execution request' using errcode = '22023';
  end if;

  begin
    v_plan_day_id := (p_execution->>'dayId')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'invalid training cycle execution day' using errcode = '22023';
  end;

  v_payload := pg_catalog.jsonb_build_object(
    'portalScope', p_portal_scope,
    'cycleId', p_cycle_id,
    'expectedVersion', p_expected_version,
    'performedAt', p_performed_at,
    'execution', p_execution
  );

  select receipt.aggregate_id, receipt.result_version
    into v_receipt_execution_id, v_receipt_version
  from private.find_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'cycle_execution_record',
    v_payload
  ) as receipt;

  if v_receipt_execution_id is not null then
    return private.training_cycle_operation_result(
      p_request_id,
      'cycle_execution_record',
      v_receipt_execution_id,
      v_receipt_version
    );
  end if;

  if p_performed_at > v_now + interval '5 minutes'
    or p_performed_at < v_now - interval '730 days'
  then
    raise exception 'invalid training cycle execution timestamp' using errcode = '22023';
  end if;

  perform private.materialize_own_training_cycle_lifecycle(
    v_user_id,
    p_portal_scope,
    v_now
  );

  select cycle.*
    into v_cycle
  from public.training_cycles as cycle
  where cycle.id = p_cycle_id
    and cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status = 'active'
    and cycle.deleted_at is null
    and cycle.current_plan_version_id is not null
  for update;

  if v_cycle.id is null
    or v_cycle.current_plan_version is distinct from p_expected_version
  then
    raise exception 'training cycle execution version conflict' using errcode = '40001';
  end if;

  select version.*
    into v_plan_version
  from public.training_cycle_plan_versions as version
  where version.id = v_cycle.current_plan_version_id
    and version.cycle_id = v_cycle.id
    and version.user_id = v_user_id
    and version.portal_scope = p_portal_scope
    and version.version = p_expected_version;

  v_performed_on := pg_catalog.timezone(
    'America/Santiago',
    p_performed_at
  )::date;
  v_week_started_on := v_performed_on
    - (extract(isodow from v_performed_on)::integer - 1);

  if v_plan_version.id is null
    or v_performed_on < v_plan_version.start_date
    or v_performed_on > v_plan_version.end_date
  then
    raise exception 'training cycle execution is outside the active snapshot'
      using errcode = '22023';
  end if;

  select plan_day.*
    into v_plan_day
  from public.training_cycle_plan_days as plan_day
  where plan_day.id = v_plan_day_id
    and plan_day.version_id = v_plan_version.id
    and plan_day.cycle_id = v_cycle.id
    and plan_day.user_id = v_user_id;

  if v_plan_day.id is null
    or pg_catalog.jsonb_array_length(p_execution->'exercises') <> (
      select pg_catalog.count(*)::integer
      from public.training_cycle_plan_exercises as plan_exercise
      where plan_exercise.version_id = v_plan_version.id
        and plan_exercise.day_id = v_plan_day.id
        and plan_exercise.user_id = v_user_id
        and plan_exercise.portal_scope = p_portal_scope
    )
  then
    raise exception 'training cycle execution day snapshot mismatch'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.training_cycle_executions as execution
    where execution.user_id = v_user_id
      and execution.portal_scope = p_portal_scope
    order by execution.created_at, execution.id
    offset 4095
    limit 1
  ) then
    raise exception using errcode = '54000',
      message = 'training cycle execution limit reached';
  end if;

  insert into public.training_cycle_executions (
    user_id,
    portal_scope,
    cycle_id,
    plan_version_id,
    plan_version,
    plan_day_id,
    request_id,
    performed_at,
    performed_on,
    week_started_on
  )
  values (
    v_user_id,
    p_portal_scope,
    v_cycle.id,
    v_plan_version.id,
    v_plan_version.version,
    v_plan_day.id,
    p_request_id,
    p_performed_at,
    v_performed_on,
    v_week_started_on
  )
  returning id into v_execution_id;

  for v_exercise in
    select value
    from pg_catalog.jsonb_array_elements(p_execution->'exercises')
  loop
    if pg_catalog.jsonb_typeof(v_exercise) is distinct from 'object'
      or not (v_exercise ?& array['planExerciseId', 'order', 'sets'])
      or v_exercise - array['planExerciseId', 'order', 'sets']::text[] <> '{}'::jsonb
      or pg_catalog.jsonb_typeof(v_exercise->'planExerciseId') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_exercise->'order') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_exercise->'sets') is distinct from 'array'
      or pg_catalog.jsonb_array_length(v_exercise->'sets') not between 1 and 20
    then
      raise exception 'invalid training cycle execution exercise' using errcode = '22023';
    end if;

    begin
      v_plan_exercise_id := (v_exercise->>'planExerciseId')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'invalid training cycle execution exercise id' using errcode = '22023';
    end;
    v_order := (v_exercise->>'order')::pg_catalog.numeric;

    if v_plan_exercise_id = any(v_seen_exercise_ids)
      or v_order not between 0 and 199
      or pg_catalog.trunc(v_order) <> v_order
    then
      raise exception 'duplicate or invalid training cycle execution exercise'
        using errcode = '22023';
    end if;
    v_seen_exercise_ids := pg_catalog.array_append(
      v_seen_exercise_ids,
      v_plan_exercise_id
    );

    select plan_exercise.*
      into v_plan_exercise
    from public.training_cycle_plan_exercises as plan_exercise
    where plan_exercise.id = v_plan_exercise_id
      and plan_exercise.version_id = v_plan_version.id
      and plan_exercise.day_id = v_plan_day.id
      and plan_exercise.cycle_id = v_cycle.id
      and plan_exercise.user_id = v_user_id
      and plan_exercise.portal_scope = p_portal_scope;

    if v_plan_exercise.id is null
      or v_plan_exercise.sort_order is distinct from v_order::smallint
      or pg_catalog.jsonb_array_length(v_exercise->'sets') <> (
        select pg_catalog.count(*)::integer
        from public.training_cycle_plan_sets as plan_set
        where plan_set.version_id = v_plan_version.id
          and plan_set.exercise_id = v_plan_exercise.id
          and plan_set.user_id = v_user_id
      )
    then
      raise exception 'training cycle execution exercise snapshot mismatch'
        using errcode = '22023';
    end if;

    insert into public.training_cycle_execution_exercises (
      execution_id,
      plan_exercise_id,
      plan_version_id,
      cycle_id,
      user_id,
      portal_scope,
      exercise_lineage_id,
      name_snapshot,
      muscle_group_snapshot,
      technique_snapshot,
      sort_order
    )
    values (
      v_execution_id,
      v_plan_exercise.id,
      v_plan_version.id,
      v_cycle.id,
      v_user_id,
      p_portal_scope,
      v_plan_exercise.exercise_lineage_id,
      v_plan_exercise.name_snapshot,
      v_plan_exercise.muscle_group_snapshot,
      v_plan_exercise.technique,
      v_plan_exercise.sort_order
    )
    returning id into v_execution_exercise_id;

    v_seen_set_ids := array[]::uuid[];
    for v_set in
      select value
      from pg_catalog.jsonb_array_elements(v_exercise->'sets')
    loop
      v_total_sets := v_total_sets + 1;
      if v_total_sets > 2000
        or pg_catalog.jsonb_typeof(v_set) is distinct from 'object'
        or not (v_set ?& array[
          'planSetId', 'order', 'completed', 'reps', 'kg',
          'reachedFailure', 'drops'
        ])
        or v_set - array[
          'planSetId', 'order', 'completed', 'reps', 'kg',
          'reachedFailure', 'drops'
        ]::text[] <> '{}'::jsonb
        or pg_catalog.jsonb_typeof(v_set->'planSetId') is distinct from 'string'
        or pg_catalog.jsonb_typeof(v_set->'order') is distinct from 'number'
        or pg_catalog.jsonb_typeof(v_set->'completed') is distinct from 'boolean'
        or pg_catalog.jsonb_typeof(v_set->'reachedFailure') is distinct from 'boolean'
        or pg_catalog.jsonb_typeof(v_set->'drops') is distinct from 'array'
        or pg_catalog.jsonb_array_length(v_set->'drops') > 8
      then
        raise exception 'invalid training cycle execution set' using errcode = '22023';
      end if;

      begin
        v_plan_set_id := (v_set->>'planSetId')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'invalid training cycle execution set id' using errcode = '22023';
      end;
      v_order := (v_set->>'order')::pg_catalog.numeric;
      v_completed := (v_set->>'completed')::boolean;
      v_reached_failure := (v_set->>'reachedFailure')::boolean;

      if v_plan_set_id = any(v_seen_set_ids)
        or v_order not between 0 and 19
        or pg_catalog.trunc(v_order) <> v_order
      then
        raise exception 'duplicate or invalid training cycle execution set'
          using errcode = '22023';
      end if;
      v_seen_set_ids := pg_catalog.array_append(v_seen_set_ids, v_plan_set_id);

      if v_completed then
        if pg_catalog.jsonb_typeof(v_set->'reps') is distinct from 'number'
          or pg_catalog.jsonb_typeof(v_set->'kg') is distinct from 'number'
        then
          raise exception 'completed execution set requires results' using errcode = '22023';
        end if;
        v_actual_reps := (v_set->>'reps')::pg_catalog.numeric;
        v_actual_kg := (v_set->>'kg')::pg_catalog.numeric;
        if v_actual_reps not between 1 and 1000
          or pg_catalog.trunc(v_actual_reps) <> v_actual_reps
          or v_actual_kg not between 0 and 99999.99
          or pg_catalog.scale(v_actual_kg) > 2
        then
          raise exception 'invalid training cycle execution set results'
            using errcode = '22023';
        end if;
      else
        if pg_catalog.jsonb_typeof(v_set->'reps') is distinct from 'null'
          or pg_catalog.jsonb_typeof(v_set->'kg') is distinct from 'null'
          or v_reached_failure
        then
          raise exception 'skipped execution set cannot contain results'
            using errcode = '22023';
        end if;
        v_actual_reps := null;
        v_actual_kg := null;
      end if;

      select plan_set.*
        into v_plan_set
      from public.training_cycle_plan_sets as plan_set
      where plan_set.id = v_plan_set_id
        and plan_set.version_id = v_plan_version.id
        and plan_set.exercise_id = v_plan_exercise.id
        and plan_set.user_id = v_user_id;

      if v_plan_set.id is null
        or v_plan_set.sort_order is distinct from v_order::smallint
        or pg_catalog.jsonb_array_length(v_set->'drops') <> (
          select pg_catalog.count(*)::integer
          from public.training_cycle_plan_drops as plan_drop
          where plan_drop.version_id = v_plan_version.id
            and plan_drop.exercise_id = v_plan_exercise.id
            and plan_drop.set_id = v_plan_set.id
            and plan_drop.user_id = v_user_id
        )
      then
        raise exception 'training cycle execution set snapshot mismatch'
          using errcode = '22023';
      end if;

      insert into public.training_cycle_execution_sets (
        execution_exercise_id,
        execution_id,
        plan_exercise_id,
        plan_set_id,
        plan_version_id,
        user_id,
        sort_order,
        completed,
        actual_reps,
        actual_kg,
        reached_failure,
        target_reps_snapshot,
        target_kg_snapshot,
        planned_to_failure_snapshot
      )
      values (
        v_execution_exercise_id,
        v_execution_id,
        v_plan_exercise.id,
        v_plan_set.id,
        v_plan_version.id,
        v_user_id,
        v_plan_set.sort_order,
        v_completed,
        v_actual_reps::smallint,
        v_actual_kg::numeric(8,2),
        v_reached_failure,
        v_plan_set.target_reps,
        v_plan_set.target_kg,
        v_plan_set.to_failure
      )
      returning id into v_execution_set_id;

      v_seen_drop_ids := array[]::uuid[];
      for v_drop in
        select value
        from pg_catalog.jsonb_array_elements(v_set->'drops')
      loop
        v_total_drops := v_total_drops + 1;
        if v_total_drops > 4000
          or pg_catalog.jsonb_typeof(v_drop) is distinct from 'object'
          or not (v_drop ?& array[
            'planDropId', 'order', 'completed', 'reps', 'kg'
          ])
          or v_drop - array[
            'planDropId', 'order', 'completed', 'reps', 'kg'
          ]::text[] <> '{}'::jsonb
          or pg_catalog.jsonb_typeof(v_drop->'planDropId') is distinct from 'string'
          or pg_catalog.jsonb_typeof(v_drop->'order') is distinct from 'number'
          or pg_catalog.jsonb_typeof(v_drop->'completed') is distinct from 'boolean'
        then
          raise exception 'invalid training cycle execution drop' using errcode = '22023';
        end if;

        begin
          v_plan_drop_id := (v_drop->>'planDropId')::uuid;
        exception
          when invalid_text_representation then
            raise exception 'invalid training cycle execution drop id' using errcode = '22023';
        end;
        v_order := (v_drop->>'order')::pg_catalog.numeric;
        v_drop_completed := (v_drop->>'completed')::boolean;

        if v_plan_drop_id = any(v_seen_drop_ids)
          or v_order not between 0 and 7
          or pg_catalog.trunc(v_order) <> v_order
          or (not v_completed and v_drop_completed)
        then
          raise exception 'duplicate or invalid training cycle execution drop'
            using errcode = '22023';
        end if;
        v_seen_drop_ids := pg_catalog.array_append(v_seen_drop_ids, v_plan_drop_id);

        if v_drop_completed then
          if pg_catalog.jsonb_typeof(v_drop->'reps') is distinct from 'number'
            or pg_catalog.jsonb_typeof(v_drop->'kg') is distinct from 'number'
          then
            raise exception 'completed execution drop requires results'
              using errcode = '22023';
          end if;
          v_actual_reps := (v_drop->>'reps')::pg_catalog.numeric;
          v_actual_kg := (v_drop->>'kg')::pg_catalog.numeric;
          if v_actual_reps not between 1 and 1000
            or pg_catalog.trunc(v_actual_reps) <> v_actual_reps
            or v_actual_kg not between 0 and 99999.99
            or pg_catalog.scale(v_actual_kg) > 2
          then
            raise exception 'invalid training cycle execution drop results'
              using errcode = '22023';
          end if;
        else
          if pg_catalog.jsonb_typeof(v_drop->'reps') is distinct from 'null'
            or pg_catalog.jsonb_typeof(v_drop->'kg') is distinct from 'null'
          then
            raise exception 'skipped execution drop cannot contain results'
              using errcode = '22023';
          end if;
          v_actual_reps := null;
          v_actual_kg := null;
        end if;

        select plan_drop.*
          into v_plan_drop
        from public.training_cycle_plan_drops as plan_drop
        where plan_drop.id = v_plan_drop_id
          and plan_drop.version_id = v_plan_version.id
          and plan_drop.exercise_id = v_plan_exercise.id
          and plan_drop.set_id = v_plan_set.id
          and plan_drop.user_id = v_user_id;

        if v_plan_drop.id is null
          or v_plan_drop.sort_order is distinct from v_order::smallint
        then
          raise exception 'training cycle execution drop snapshot mismatch'
            using errcode = '22023';
        end if;

        insert into public.training_cycle_execution_drops (
          execution_set_id,
          execution_exercise_id,
          execution_id,
          plan_exercise_id,
          plan_set_id,
          plan_drop_id,
          plan_version_id,
          user_id,
          sort_order,
          completed,
          actual_reps,
          actual_kg,
          target_reps_snapshot,
          target_kg_snapshot
        )
        values (
          v_execution_set_id,
          v_execution_exercise_id,
          v_execution_id,
          v_plan_exercise.id,
          v_plan_set.id,
          v_plan_drop.id,
          v_plan_version.id,
          v_user_id,
          v_plan_drop.sort_order,
          v_drop_completed,
          v_actual_reps::smallint,
          v_actual_kg::numeric(8,2),
          v_plan_drop.reps,
          v_plan_drop.kg
        );
      end loop;
    end loop;
  end loop;

  perform private.record_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'cycle_execution_record',
    v_payload,
    v_execution_id,
    v_plan_version.version
  );

  return private.training_cycle_operation_result(
    p_request_id,
    'cycle_execution_record',
    v_execution_id,
    v_plan_version.version
  );
end;
$function$;

revoke all on function public.record_own_training_cycle_execution(
  uuid, text, uuid, integer, timestamptz, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.record_own_training_cycle_execution(
  uuid, text, uuid, integer, timestamptz, jsonb
) to authenticated;

create function public.refresh_own_training_cycle_lifecycle(
  p_portal_scope text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_closed_cycle_id uuid;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  v_closed_cycle_id := private.materialize_own_training_cycle_lifecycle(
    v_user_id, p_portal_scope, v_now
  );

  return pg_catalog.jsonb_build_object(
    'closedCycleId', v_closed_cycle_id,
    'refreshedAt', v_now
  );
end;
$function$;

revoke all on function public.refresh_own_training_cycle_lifecycle(text)
  from public, anon, authenticated, service_role;
grant execute on function public.refresh_own_training_cycle_lifecycle(text)
  to authenticated;

create function public.get_own_training_cycle(
  p_portal_scope text,
  p_cycle_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  perform private.materialize_own_training_cycle_lifecycle(
    v_user_id, p_portal_scope, v_now
  );

  return private.training_cycle_snapshot_json(
    v_user_id, p_portal_scope, p_cycle_id, v_now
  );
end;
$function$;

revoke all on function public.get_own_training_cycle(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_own_training_cycle(text, uuid)
  to authenticated;

create function public.get_own_active_training_cycle(
  p_portal_scope text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_cycle_id uuid;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  perform private.materialize_own_training_cycle_lifecycle(
    v_user_id, p_portal_scope, v_now
  );

  select cycle.id
    into v_cycle_id
  from public.training_cycles as cycle
  where cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status = 'active'
    and cycle.deleted_at is null
    and cycle.current_plan_version_id is not null;

  if v_cycle_id is null then
    return null;
  end if;

  return private.training_cycle_snapshot_json(
    v_user_id, p_portal_scope, v_cycle_id, v_now
  );
end;
$function$;

revoke all on function public.get_own_active_training_cycle(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_own_active_training_cycle(text)
  to authenticated;

create function public.list_own_training_cycles(
  p_portal_scope text,
  p_limit integer default 50,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_today date := pg_catalog.timezone('America/Santiago', v_now)::date;
  v_result jsonb;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  if p_limit is null
    or p_limit not between 1 and 100
    or ((p_before_created_at is null) <> (p_before_id is null))
  then
    raise exception 'invalid training cycle list limit' using errcode = '22023';
  end if;

  perform private.materialize_own_training_cycle_lifecycle(
    v_user_id, p_portal_scope, v_now
  );

  with candidates as (
    select
      cycle.id,
      cycle.cycle_number,
      version.goal,
      version.start_date,
      version.end_date,
      case
        when cycle.status in ('completed', 'cancelled') then 'closed'
        when cycle.status = 'active' and v_today >= version.end_date - 3 then 'expiring'
        else 'active'
      end as public_status,
      cycle.current_plan_version,
      cycle.current_plan_version_id,
      cycle.extension_count,
      cycle.closed_at,
      cycle.updated_at,
      cycle.created_at
    from public.training_cycles as cycle
    join public.training_cycle_plan_versions as version
      on version.id = cycle.current_plan_version_id
     and version.cycle_id = cycle.id
     and version.user_id = cycle.user_id
     and version.portal_scope = cycle.portal_scope
    where cycle.user_id = v_user_id
      and cycle.portal_scope = p_portal_scope
      and cycle.deleted_at is null
      and (
        p_before_created_at is null
        or (cycle.created_at, cycle.id) < (p_before_created_at, p_before_id)
      )
    order by cycle.created_at desc, cycle.id desc
    limit p_limit + 1
  ), page as (
    select candidate.*
    from candidates as candidate
    order by candidate.created_at desc, candidate.id desc
    limit p_limit
  )
  select pg_catalog.jsonb_build_object(
    'items',
    pg_catalog.coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'cycleId', item.id,
            'cycleNumber', item.cycle_number,
            'goal', item.goal,
            'startDate', item.start_date,
            'endDate', item.end_date,
            'status', item.public_status,
            'version', item.current_plan_version,
            'snapshotId', item.current_plan_version_id,
            'extensionCount', item.extension_count,
            'closedAt', item.closed_at,
            'updatedAt', item.updated_at
          )
          order by item.created_at desc, item.id desc
        )
        from page as item
      ),
      '[]'::jsonb
    ),
    'nextCursor',
    case
      when (select pg_catalog.count(*) from candidates) > p_limit then (
        select pg_catalog.jsonb_build_object(
          'beforeCreatedAt', item.created_at,
          'beforeId', item.id
        )
        from page as item
        order by item.created_at, item.id
        limit 1
      )
      else null
    end
  )
  into v_result;

  return v_result;
end;
$function$;

revoke all on function public.list_own_training_cycles(
  text, integer, timestamptz, uuid
)
  from public, anon, authenticated, service_role;
grant execute on function public.list_own_training_cycles(
  text, integer, timestamptz, uuid
)
  to authenticated;

create function public.list_own_training_cycle_versions(
  p_portal_scope text,
  p_cycle_id uuid,
  p_limit integer default 100,
  p_before_version integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  if p_cycle_id is null
    or p_limit is null
    or p_limit not between 1 and 100
    or (p_before_version is not null and p_before_version not between 1 and 256)
  then
    raise exception 'invalid training cycle version list request' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.training_cycles as cycle
    where cycle.id = p_cycle_id
      and cycle.user_id = v_user_id
      and cycle.portal_scope = p_portal_scope
      and cycle.deleted_at is null
      and cycle.current_plan_version_id is not null
  ) then
    raise exception 'training cycle not found' using errcode = 'P0002';
  end if;

  with candidates as (
    select version.*
    from public.training_cycle_plan_versions as version
    where version.cycle_id = p_cycle_id
      and version.user_id = v_user_id
      and version.portal_scope = p_portal_scope
      and (p_before_version is null or version.version < p_before_version)
    order by version.version desc, version.id desc
    limit p_limit + 1
  ), page as (
    select candidate.*
    from candidates as candidate
    order by candidate.version desc, candidate.id desc
    limit p_limit
  )
  select pg_catalog.jsonb_build_object(
    'items',
    pg_catalog.coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'snapshotId', item.id,
            'version', item.version,
            'changeKind', item.change_kind,
            'goal', item.goal,
            'startDate', item.start_date,
            'endDate', item.end_date,
            'sourceSnapshotId', item.source_version_id,
            'createdAt', item.created_at
          )
          order by item.version desc, item.id desc
        )
        from page as item
      ),
      '[]'::jsonb
    ),
    'nextCursor',
    case
      when (select pg_catalog.count(*) from candidates) > p_limit then (
        select pg_catalog.jsonb_build_object('beforeVersion', item.version)
        from page as item
        order by item.version, item.id
        limit 1
      )
      else null
    end
  )
  into v_result;

  return v_result;
end;
$function$;

revoke all on function public.list_own_training_cycle_versions(
  text, uuid, integer, integer
)
  from public, anon, authenticated, service_role;
grant execute on function public.list_own_training_cycle_versions(
  text, uuid, integer, integer
)
  to authenticated;

create function public.get_own_training_cycle_version(
  p_portal_scope text,
  p_cycle_id uuid,
  p_version integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_snapshot public.training_cycle_plan_versions;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);

  if p_cycle_id is null or p_version is null or p_version not between 1 and 256 then
    raise exception 'invalid training cycle version request' using errcode = '22023';
  end if;

  select version.*
    into v_snapshot
  from public.training_cycle_plan_versions as version
  join public.training_cycles as cycle
    on cycle.id = version.cycle_id
   and cycle.user_id = version.user_id
   and cycle.portal_scope = version.portal_scope
  where version.cycle_id = p_cycle_id
    and version.user_id = v_user_id
    and version.portal_scope = p_portal_scope
    and version.version = p_version
    and cycle.deleted_at is null;

  if v_snapshot.id is null then
    raise exception 'training cycle version not found' using errcode = 'P0002';
  end if;

  return pg_catalog.jsonb_build_object(
    'cycleId', v_snapshot.cycle_id,
    'snapshotId', v_snapshot.id,
    'version', v_snapshot.version,
    'changeKind', v_snapshot.change_kind,
    'goal', v_snapshot.goal,
    'startDate', v_snapshot.start_date,
    'endDate', v_snapshot.end_date,
    'sourceSnapshotId', v_snapshot.source_version_id,
    'createdAt', v_snapshot.created_at,
    'plan', private.training_cycle_plan_snapshot_json(v_snapshot.id)
  );
end;
$function$;

revoke all on function public.get_own_training_cycle_version(text, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_own_training_cycle_version(text, uuid, integer)
  to authenticated;

create function public.list_own_training_cycle_notifications(
  p_portal_scope text,
  p_limit integer default 50,
  p_before_materialized_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_result jsonb;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  if p_limit is null
    or p_limit not between 1 and 100
    or ((p_before_materialized_at is null) <> (p_before_id is null))
  then
    raise exception 'invalid training cycle notification limit' using errcode = '22023';
  end if;

  perform private.materialize_own_training_cycle_lifecycle(
    v_user_id, p_portal_scope, v_now
  );

  with candidates as (
    select notification.*
    from public.training_cycle_notifications as notification
    where notification.user_id = v_user_id
      and notification.portal_scope = p_portal_scope
      and notification.materialized_at is not null
      and notification.superseded_at is null
      and (
        p_before_materialized_at is null
        or (notification.materialized_at, notification.id)
          < (p_before_materialized_at, p_before_id)
      )
    order by notification.materialized_at desc, notification.id desc
    limit p_limit + 1
  ), page as (
    select candidate.*
    from candidates as candidate
    order by candidate.materialized_at desc, candidate.id desc
    limit p_limit
  )
  select pg_catalog.jsonb_build_object(
    'items',
    pg_catalog.coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'notificationId', item.id,
            'cycleId', item.cycle_id,
            'eventKind', item.event_kind,
            'scheduledOn', item.scheduled_on,
            'title', item.title,
            'body', item.body,
            'materializedAt', item.materialized_at,
            'readAt', item.read_at
          )
          order by item.materialized_at desc, item.id desc
        )
        from page as item
      ),
      '[]'::jsonb
    ),
    'nextCursor',
    case
      when (select pg_catalog.count(*) from candidates) > p_limit then (
        select pg_catalog.jsonb_build_object(
          'beforeMaterializedAt', item.materialized_at,
          'beforeId', item.id
        )
        from page as item
        order by item.materialized_at, item.id
        limit 1
      )
      else null
    end
  )
    into v_result;

  return v_result;
end;
$function$;

revoke all on function public.list_own_training_cycle_notifications(
  text, integer, timestamptz, uuid
)
  from public, anon, authenticated, service_role;
grant execute on function public.list_own_training_cycle_notifications(
  text, integer, timestamptz, uuid
)
  to authenticated;

create function public.mark_own_training_cycle_notifications_read(
  p_request_id uuid,
  p_portal_scope text,
  p_notification_ids uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_payload jsonb;
  v_receipt_id uuid;
  v_receipt_version integer;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  perform private.lock_training_cycle_portal(v_user_id, p_portal_scope);

  if p_request_id is null
    or p_notification_ids is null
    or pg_catalog.cardinality(p_notification_ids) not between 1 and 50
    or pg_catalog.array_position(p_notification_ids, null::uuid) is not null
    or pg_catalog.cardinality(p_notification_ids) <> (
      select pg_catalog.count(distinct selected.notification_id)::integer
      from pg_catalog.unnest(p_notification_ids) as selected(notification_id)
    )
  then
    raise exception 'invalid training cycle notification selection' using errcode = '22023';
  end if;

  select pg_catalog.jsonb_build_object(
    'portalScope', p_portal_scope,
    'notificationIds', pg_catalog.jsonb_agg(
      selected.notification_id order by selected.notification_id
    )
  )
    into v_payload
  from pg_catalog.unnest(p_notification_ids) as selected(notification_id);

  select receipt.aggregate_id, receipt.result_version
    into v_receipt_id, v_receipt_version
  from private.find_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'notifications_mark_read',
    v_payload
  ) as receipt;

  if v_receipt_id is not null then
    return private.training_cycle_operation_result(
      p_request_id,
      'notifications_mark_read',
      v_receipt_id,
      v_receipt_version
    );
  end if;

  update public.training_cycle_notifications as notification
  set read_at = pg_catalog.coalesce(notification.read_at, v_now)
  where notification.user_id = v_user_id
    and notification.portal_scope = p_portal_scope
    and notification.id = any(p_notification_ids)
    and notification.materialized_at is not null
    and notification.superseded_at is null;

  perform private.record_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'notifications_mark_read',
    v_payload,
    p_request_id,
    null
  );

  return private.training_cycle_operation_result(
    p_request_id,
    'notifications_mark_read',
    p_request_id,
    null
  );
end;
$function$;

revoke all on function public.mark_own_training_cycle_notifications_read(uuid, text, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.mark_own_training_cycle_notifications_read(uuid, text, uuid[])
  to authenticated;

do $postcheck$
declare
  v_claim oid := pg_catalog.to_regprocedure(
    'public.claim_due_training_cycle_lifecycle_deliveries(text,integer)'
  );
  v_complete oid := pg_catalog.to_regprocedure(
    'public.complete_training_cycle_lifecycle_delivery(text,uuid,uuid,text,text,text)'
  );
  v_execution oid := pg_catalog.to_regprocedure(
    'public.record_own_training_cycle_execution(uuid,text,uuid,integer,timestamptz,jsonb)'
  );
  v_catalog oid := pg_catalog.to_regprocedure(
    'public.list_own_training_exercise_catalog(text,text,integer,text,integer,text,uuid)'
  );
  v_notifications oid := pg_catalog.to_regprocedure(
    'public.list_own_training_cycle_notifications(text,integer,timestamptz,uuid)'
  );
  v_mark_notifications oid := pg_catalog.to_regprocedure(
    'public.mark_own_training_cycle_notifications_read(uuid,text,uuid[])'
  );
begin
  if v_claim is null
    or v_complete is null
    or v_execution is null
    or v_catalog is null
    or v_notifications is null
    or v_mark_notifications is null
    or pg_catalog.to_regprocedure(
      'private.transactional_email_constant_time_equal(bytea,bytea)'
    ) is null
    or pg_catalog.to_regprocedure(
      'private.transactional_email_idempotency_uuid(text)'
    ) is null
  then
    raise exception 'cycle redesign API postcheck failed: missing RPC';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc as procedure_row
    where procedure_row.oid in (
      v_claim,
      v_complete,
      v_execution,
      v_catalog,
      v_notifications,
      v_mark_notifications
    )
      and procedure_row.prosecdef
      and exists (
        select 1
        from pg_catalog.unnest(procedure_row.proconfig) as setting(value)
        where setting.value like 'search_path=%'
      )
  ) <> 6 then
    raise exception 'cycle redesign API postcheck failed: definer/search_path';
  end if;

  if not pg_catalog.has_function_privilege('anon', v_claim, 'EXECUTE')
    or not pg_catalog.has_function_privilege('anon', v_complete, 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', v_execution, 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', v_catalog, 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', v_notifications, 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', v_mark_notifications, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_claim, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_complete, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_execution, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_catalog, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_notifications, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_mark_notifications, 'EXECUTE')
  then
    raise exception 'cycle redesign API postcheck failed: RPC grants';
  end if;
end;
$postcheck$;

commit;
