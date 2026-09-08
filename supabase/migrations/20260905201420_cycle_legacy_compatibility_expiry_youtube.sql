-- CYCLE-REDESIGN-LEGACY-COMPATIBILITY-05
-- Promote a safely representable active legacy cycle in place. The bridge
-- keeps the cycle, legacy days/exercises and all training history untouched.
-- It also moves lifecycle notices to T-7/T-3/T-1/T0 while preserving T-2 as
-- a historical event kind for already stored rows.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function private.canonical_training_youtube_url(p_value text)
returns text
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  v_video_id text;
begin
  if pg_catalog.char_length(p_value) not between 19 and 500
    or p_value ~ '[[:cntrl:][:space:]]'
  then
    return null;
  end if;

  v_video_id := pg_catalog.substring(
    p_value, '^https://youtu[.]be/([A-Za-z0-9_-]{11})([?#][^[:space:]]*)?$'
  );

  if v_video_id is null then
    v_video_id := pg_catalog.substring(
      p_value, '^https://(?:www[.]|m[.])?youtube[.]com/(?:embed|shorts|live)/([A-Za-z0-9_-]{11})(?:[?#][^[:space:]]*)?$'
    );
  end if;

  if v_video_id is null
    and p_value ~ '^https://(www[.]|m[.])?youtube[.]com/watch[?][^[:space:]]+$'
    and pg_catalog.regexp_count(p_value, '[?&]v=') = 1
  then
    v_video_id := pg_catalog.substring(
      p_value, '[?&]v=([A-Za-z0-9_-]{11})(&|#|$)'
    );
  end if;

  if v_video_id is null then
    return null;
  end if;

  return 'https://www.youtube.com/watch?v=' || v_video_id;
end;
$function$;

revoke all on function private.canonical_training_youtube_url(text)
  from public, anon, authenticated, service_role;

create or replace function private.is_valid_training_youtube_url(p_value text)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select coalesce(
    p_value = private.canonical_training_youtube_url(p_value),
    false
  )
$function$;

revoke all on function private.is_valid_training_youtube_url(text)
  from public, anon, authenticated, service_role;

create function private.sanitize_training_cycle_plan_youtube_urls(p_plan jsonb)
returns jsonb
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb := p_plan;
  v_day_index integer;
  v_exercise_index integer;
  v_exercise jsonb;
  v_video_url text;
begin
  if pg_catalog.jsonb_typeof(p_plan) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_plan->'days') is distinct from 'array'
  then
    return p_plan;
  end if;

  for v_day_index in 0..pg_catalog.jsonb_array_length(p_plan->'days') - 1 loop
    if pg_catalog.jsonb_typeof(p_plan #> array['days', v_day_index::text, 'exercises'])
      is distinct from 'array'
    then
      continue;
    end if;

    for v_exercise_index in 0..pg_catalog.jsonb_array_length(
      p_plan #> array['days', v_day_index::text, 'exercises']
    ) - 1 loop
      v_exercise := p_plan #> array[
        'days', v_day_index::text, 'exercises', v_exercise_index::text
      ];
      if pg_catalog.jsonb_typeof(v_exercise) = 'object'
        and v_exercise ? 'videoUrl'
        and v_exercise->'videoUrl' <> 'null'::jsonb
      then
        v_video_url := private.canonical_training_youtube_url(
          v_exercise->>'videoUrl'
        );
        v_result := pg_catalog.jsonb_set(
          v_result,
          array['days', v_day_index::text, 'exercises', v_exercise_index::text, 'videoUrl'],
          coalesce(pg_catalog.to_jsonb(v_video_url), 'null'::jsonb),
          false
        );
      end if;
    end loop;
  end loop;

  return v_result;
end;
$function$;

revoke all on function private.sanitize_training_cycle_plan_youtube_urls(jsonb)
  from public, anon, authenticated, service_role;

-- Rows accepted by the original 6..64-character constraints are normalized
-- before the stricter constraints become visible. Valid variants are retained
-- canonically; only URLs that do not identify a real 11-character video are
-- degraded to NULL so one historical row cannot block an entire response.
update public.training_exercise_catalog
set default_video_url = private.canonical_training_youtube_url(default_video_url)
where default_video_url is not null
  and default_video_url is distinct from private.canonical_training_youtube_url(default_video_url);

update public.training_custom_exercises
set video_url = private.canonical_training_youtube_url(video_url)
where video_url is not null
  and video_url is distinct from private.canonical_training_youtube_url(video_url);

update public.training_cycle_plan_exercises
set video_url_snapshot = private.canonical_training_youtube_url(video_url_snapshot)
where video_url_snapshot is not null
  and video_url_snapshot is distinct from private.canonical_training_youtube_url(video_url_snapshot);

update public.training_cycle_draft_versions
set plan_payload = private.sanitize_training_cycle_plan_youtube_urls(plan_payload)
where plan_payload is distinct from private.sanitize_training_cycle_plan_youtube_urls(plan_payload);

update public.training_cycle_plan_versions
set plan_payload = private.sanitize_training_cycle_plan_youtube_urls(plan_payload)
where plan_payload is distinct from private.sanitize_training_cycle_plan_youtube_urls(plan_payload);

alter table public.training_exercise_catalog
  drop constraint training_exercise_catalog_video_length,
  add constraint training_exercise_catalog_video_length check (
    default_video_url is null
    or default_video_url = private.canonical_training_youtube_url(default_video_url)
  );

alter table public.training_custom_exercises
  drop constraint training_custom_exercises_video_length,
  add constraint training_custom_exercises_video_length check (
    video_url is null
    or video_url = private.canonical_training_youtube_url(video_url)
  );

alter table public.training_cycle_plan_exercises
  drop constraint training_cycle_plan_exercises_video_length,
  add constraint training_cycle_plan_exercises_video_length check (
    video_url_snapshot is null
    or video_url_snapshot = private.canonical_training_youtube_url(video_url_snapshot)
  );

alter table public.training_cycle_draft_versions
  add constraint training_cycle_draft_versions_youtube_urls_canonical check (
    plan_payload = private.sanitize_training_cycle_plan_youtube_urls(plan_payload)
  );

alter table public.training_cycle_plan_versions
  add constraint training_cycle_plan_versions_youtube_urls_canonical check (
    plan_payload = private.sanitize_training_cycle_plan_youtube_urls(plan_payload)
  );

alter table public.training_cycle_notifications
  drop constraint training_cycle_notifications_event_kind_allowed,
  add constraint training_cycle_notifications_event_kind_allowed check (
    event_kind in (
      'expires_t7', 'expires_t3', 'expires_t2', 'expires_t1',
      'expires_t0', 'closed_t1'
    )
  ),
  drop constraint training_cycle_notifications_schedule_shape,
  add constraint training_cycle_notifications_schedule_shape check (
    (event_kind = 'expires_t7' and scheduled_on = end_date_snapshot - 7)
    or (event_kind = 'expires_t3' and scheduled_on = end_date_snapshot - 3)
    or (event_kind = 'expires_t2' and scheduled_on = end_date_snapshot - 2)
    or (event_kind = 'expires_t1' and scheduled_on = end_date_snapshot - 1)
    or (event_kind = 'expires_t0' and scheduled_on = end_date_snapshot)
    or (event_kind = 'closed_t1' and scheduled_on = end_date_snapshot + 1)
  );

create or replace function private.schedule_training_cycle_notifications(
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
  v_today date := pg_catalog.timezone('America/Santiago', v_now)::date;
begin
  update public.training_cycle_notifications as notification
  set superseded_at = coalesce(notification.superseded_at, v_now)
  where notification.user_id = p_user_id
    and notification.portal_scope = p_portal_scope
    and notification.cycle_id = p_cycle_id
    and notification.superseded_at is null
    and (
      notification.end_date_snapshot is distinct from p_end_date
      or (
        notification.end_date_snapshot = p_end_date
        and notification.event_kind = 'expires_t2'
        and notification.materialized_at is null
      )
    );

  insert into public.training_cycle_notifications (
    user_id,
    portal_scope,
    cycle_id,
    end_date_snapshot,
    event_kind,
    scheduled_on,
    title,
    body,
    superseded_at
  )
  select
    p_user_id,
    p_portal_scope,
    p_cycle_id,
    p_end_date,
    event.event_kind,
    event.scheduled_on,
    event.title,
    event.body,
    case
      when event.event_kind <> 'closed_t1' and event.scheduled_on < v_today
        then v_now
      else null
    end
  from (values
    (
      'expires_t7'::text,
      p_end_date - 7,
      'Queda 1 semana de ciclo'::text,
      'Tu ciclo termina el ' || p_end_date::pg_catalog.text
        || '. Puedes mantener la fecha o extenderla desde Mi ciclo.'
    ),
    (
      'expires_t3'::text,
      p_end_date - 3,
      'Quedan 3 días de ciclo'::text,
      'Tu ciclo termina el ' || p_end_date::pg_catalog.text
        || '. Puedes extenderlo desde Mi ciclo.'
    ),
    (
      'expires_t1'::text,
      p_end_date - 1,
      'Mañana termina tu ciclo'::text,
      'Puedes extenderlo antes de que comience el cierre automático.'
    ),
    (
      'expires_t0'::text,
      p_end_date,
      'Hoy es el último día'::text,
      'Hoy entrenas normal. El cierre se procesa desde mañana y espera si tienes un entrenamiento en curso.'
    ),
    (
      'closed_t1'::text,
      p_end_date + 1,
      'Ciclo cerrado'::text,
      'Tu ciclo quedó guardado en el historial. Ya puedes preparar el siguiente.'
    )
  ) as event(event_kind, scheduled_on, title, body)
  on conflict (cycle_id, end_date_snapshot, event_kind) do nothing;
end;
$function$;

revoke all on function private.schedule_training_cycle_notifications(
  uuid, text, uuid, date
) from public, anon, authenticated, service_role;

create or replace function private.training_cycle_snapshot_json(
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
      when cycle.status = 'active' and v_today >= version.end_date - 7 then 'expiring'
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
  ) into v_result
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

create function public.adapt_own_active_legacy_training_cycle(
  p_request_id uuid,
  p_portal_scope text,
  p_expected_cycle_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '3s'
set statement_timeout = '12s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_cycle public.training_cycles;
  v_start_date date;
  v_end_date date;
  v_duration_weeks integer;
  v_source record;
  v_version_id uuid;
  v_day jsonb;
  v_exercise jsonb;
  v_set jsonb;
  v_legacy_day_id uuid;
  v_legacy_exercise_id uuid;
  v_plan_day_id uuid;
  v_plan_exercise_id uuid;
  v_catalog_id uuid;
  v_custom_id uuid;
  v_resolved record;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  perform private.lock_training_cycle_portal(v_user_id, p_portal_scope);

  if p_request_id is null or p_expected_cycle_id is null then
    raise exception 'invalid legacy training cycle adaptation request'
      using errcode = '22023';
  end if;

  select cycle.* into v_cycle
  from public.training_cycles as cycle
  where cycle.id = p_expected_cycle_id
    and cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status = 'active'
    and cycle.deleted_at is null
  for update;

  if v_cycle.id is null then
    raise exception 'confirmed active training cycle changed' using errcode = '40001';
  end if;

  if v_cycle.current_plan_version_id is not null then
    return pg_catalog.jsonb_build_object(
      'responseKind', 'legacy_compatibility',
      'requestId', p_request_id,
      'cycleId', v_cycle.id,
      'status', 'already_canonical',
      'version', v_cycle.current_plan_version,
      'reason', null
    );
  end if;

  v_start_date := coalesce(
    v_cycle.planned_start_date,
    pg_catalog.timezone('America/Santiago', v_cycle.started_at)::date
  );
  v_duration_weeks := v_cycle.duration_weeks;
  v_end_date := v_cycle.planned_end_date;
  if v_end_date is null
    and v_start_date is not null
    and v_duration_weeks between 1 and 104
  then
    v_end_date := v_start_date + (v_duration_weeks * 7) - 1;
  end if;

  if v_start_date is null
    or v_end_date is null
    or v_end_date <= v_start_date
    or v_end_date - v_start_date > 730
  then
    return pg_catalog.jsonb_build_object(
      'responseKind', 'legacy_compatibility',
      'requestId', p_request_id,
      'cycleId', v_cycle.id,
      'status', 'legacy_fallback',
      'version', null,
      'reason', 'unsupported_dates'
    );
  end if;

  begin
    select source.* into strict v_source
    from private.training_cycle_replacement_source(
      v_user_id, p_portal_scope, v_cycle.id
    ) as source;
  exception
    when sqlstate '55000' then
      return pg_catalog.jsonb_build_object(
        'responseKind', 'legacy_compatibility',
        'requestId', p_request_id,
        'cycleId', v_cycle.id,
        'status', 'legacy_fallback',
        'version', null,
        'reason', 'unsupported_plan'
      );
  end;

  perform private.validate_training_cycle_dates(v_start_date, v_end_date);
  perform private.validate_training_cycle_plan(v_user_id, p_portal_scope, v_source.plan);

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
  ) values (
    v_cycle.id,
    v_user_id,
    p_portal_scope,
    1,
    p_request_id,
    'activation',
    v_source.goal,
    v_start_date,
    v_end_date,
    null,
    v_source.plan
  ) returning id into v_version_id;

  for v_day in
    select value
    from pg_catalog.jsonb_array_elements(v_source.plan->'days')
    order by (value->>'order')::integer
  loop
    select day.id into strict v_legacy_day_id
    from public.training_cycle_days as day
    where day.user_id = v_user_id
      and day.cycle_id = v_cycle.id
      and day.week_index = 1
      and day.day_code = v_day->>'day'
      and day.deleted_at is null;

    insert into public.training_cycle_plan_days (
      version_id,
      cycle_id,
      user_id,
      day_code,
      routine_name,
      sort_order,
      legacy_cycle_day_id
    ) values (
      v_version_id,
      v_cycle.id,
      v_user_id,
      v_day->>'day',
      pg_catalog.btrim(v_day->>'name'),
      (v_day->>'order')::smallint,
      v_legacy_day_id
    ) returning id into v_plan_day_id;

    for v_exercise in
      select value
      from pg_catalog.jsonb_array_elements(v_day->'exercises')
      order by (value->>'order')::integer
    loop
      select exercise.id into strict v_legacy_exercise_id
      from public.training_cycle_exercises as exercise
      where exercise.user_id = v_user_id
        and exercise.cycle_id = v_cycle.id
        and exercise.day_id = v_legacy_day_id
        and exercise.sort_order = (v_exercise->>'order')::integer
        and exercise.deleted_at is null;

      v_catalog_id := nullif(v_exercise->>'catalogExerciseId', '')::uuid;
      v_custom_id := nullif(v_exercise->>'customExerciseId', '')::uuid;
      select resolved.* into strict v_resolved
      from private.resolve_training_cycle_exercise_source(
        v_user_id, p_portal_scope, v_catalog_id, v_custom_id
      ) as resolved;

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
      ) values (
        v_version_id,
        v_plan_day_id,
        v_cycle.id,
        v_user_id,
        p_portal_scope,
        v_catalog_id,
        v_custom_id,
        v_resolved.exercise_lineage_id,
        v_resolved.source_name,
        v_resolved.muscle_group,
        (v_exercise->>'order')::smallint,
        v_exercise->>'technique',
        v_exercise->>'videoUrl',
        v_legacy_exercise_id
      ) returning id into v_plan_exercise_id;

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
        ) values (
          v_version_id,
          v_plan_exercise_id,
          v_user_id,
          (v_set->>'order')::smallint,
          (v_set->>'targetReps')::smallint,
          (v_set->>'targetKg')::numeric(8,2),
          (v_set->>'toFailure')::boolean
        );
      end loop;
    end loop;
  end loop;

  v_duration_weeks := greatest(
    1,
    pg_catalog.ceil(((v_end_date - v_start_date) + 1)::numeric / 7)::integer
  );

  update public.training_cycles as cycle
  set
    planned_start_date = v_start_date,
    planned_end_date = v_end_date,
    duration_weeks = v_duration_weeks,
    current_plan_version = 1,
    current_plan_version_id = v_version_id
  where cycle.id = v_cycle.id
    and cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status = 'active'
    and cycle.current_plan_version = 0
    and cycle.current_plan_version_id is null;
  if not found then
    raise exception 'confirmed active training cycle changed' using errcode = '40001';
  end if;

  perform private.schedule_training_cycle_notifications(
    v_user_id, p_portal_scope, v_cycle.id, v_end_date
  );

  return pg_catalog.jsonb_build_object(
    'responseKind', 'legacy_compatibility',
    'requestId', p_request_id,
    'cycleId', v_cycle.id,
    'status', 'adapted',
    'version', 1,
    'reason', null
  );
end;
$function$;

revoke all on function public.adapt_own_active_legacy_training_cycle(
  uuid, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.adapt_own_active_legacy_training_cycle(
  uuid, text, uuid
) to authenticated;

do $postcheck$
begin
  if pg_catalog.to_regprocedure(
    'public.adapt_own_active_legacy_training_cycle(uuid,text,uuid)'
  ) is null
    or not pg_catalog.has_function_privilege(
      'authenticated',
      'public.adapt_own_active_legacy_training_cycle(uuid,text,uuid)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'public.adapt_own_active_legacy_training_cycle(uuid,text,uuid)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role',
      'public.adapt_own_active_legacy_training_cycle(uuid,text,uuid)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'private.training_cycle_replacement_source(uuid,text,uuid)',
      'EXECUTE'
    )
  then
    raise exception 'legacy cycle compatibility postcheck failed';
  end if;
end;
$postcheck$;

commit;
