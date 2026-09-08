-- CYCLE-REDESIGN-ACTIVE-ATOMIC-REPLACEMENT-02
-- A confirmed replacement must either prepare the new editable draft and
-- close the active cycle together, or leave both the cycle and prior draft
-- untouched. This overlays the preparatory 20260831213114 migration without
-- rewriting it.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- The earlier manual-close primitive is intentionally no longer client
-- callable: closing without preparing its replacement creates a destructive
-- partial workflow.
revoke execute on function public.complete_own_active_training_cycle_manually(
  uuid, text, uuid
) from authenticated;

create function private.infer_legacy_training_muscle_group(
  p_exercise_name text,
  p_routine_name text
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case
    when pg_catalog.lower(p_exercise_name || ' ' || p_routine_name) ~
      '(press.*(banca|pecho)|pectoral|apertura|fondos.*pecho)' then 'pectoral'
    when pg_catalog.lower(p_exercise_name || ' ' || p_routine_name) ~
      '(press militar|hombro|elevaci[oó]n lateral|deltoid)' then 'hombros'
    when pg_catalog.lower(p_exercise_name || ' ' || p_routine_name) ~
      '(tr[ií]ceps|pushdown|press franc[eé]s)' then 'triceps'
    when pg_catalog.lower(p_exercise_name || ' ' || p_routine_name) ~
      '(remo|jal[oó]n|dorsal|espalda|dominada)' then 'dorsal'
    when pg_catalog.lower(p_exercise_name || ' ' || p_routine_name) ~
      '(b[ií]ceps|curl)' then 'biceps'
    when pg_catalog.lower(p_exercise_name || ' ' || p_routine_name) ~
      '(trapecio|encogimiento)' then 'trapecio'
    when pg_catalog.lower(p_exercise_name || ' ' || p_routine_name) ~
      '(femoral|peso muerto rumano|isqui)' then 'femoral'
    when pg_catalog.lower(p_exercise_name || ' ' || p_routine_name) ~
      '(hip.?thrust|gl[uú]teo|patada.*polea)' then 'gluteos'
    when pg_catalog.lower(p_exercise_name || ' ' || p_routine_name) ~
      '(pantorrilla|gemelo)' then 'pantorrillas'
    when pg_catalog.lower(p_exercise_name || ' ' || p_routine_name) ~
      '(abdomen|abdominal|crunch|core)' then 'abdomen'
    when pg_catalog.lower(p_exercise_name || ' ' || p_routine_name) ~
      '(sentadilla|prensa|extensi[oó]n.*cu[aá]driceps|cu[aá]driceps)' then 'cuadriceps'
    when pg_catalog.lower(p_exercise_name || ' ' || p_routine_name) ~
      '(pierna|zancada|estocada|b[uú]lgara)' then 'pierna_completa'
    else null
  end
$function$;

revoke all on function private.infer_legacy_training_muscle_group(text, text)
  from public, anon, authenticated, service_role;

create function private.training_cycle_replacement_source(
  p_user_id uuid,
  p_portal_scope text,
  p_cycle_id uuid
)
returns table(goal text, plan jsonb)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_cycle public.training_cycles;
  v_plan jsonb;
  v_goal text;
  v_legacy record;
  v_lineage_id uuid;
  v_custom_id uuid;
begin
  perform private.assert_training_cycle_portal_access(p_user_id, p_portal_scope);

  select cycle.* into v_cycle
  from public.training_cycles as cycle
  where cycle.id = p_cycle_id
    and cycle.user_id = p_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status = 'active'
    and cycle.deleted_at is null;

  if v_cycle.id is null then
    raise exception 'confirmed active training cycle changed' using errcode = '40001';
  end if;

  if v_cycle.current_plan_version_id is not null then
    select version.goal, version.plan_payload
      into v_goal, v_plan
    from public.training_cycle_plan_versions as version
    where version.id = v_cycle.current_plan_version_id
      and version.cycle_id = v_cycle.id
      and version.user_id = p_user_id
      and version.portal_scope = p_portal_scope;
  else
    -- Validate the complete legacy shape before creating any scoped identity.
    -- Unsupported multi-week or anomalous plans keep using the legacy path;
    -- they are never truncated or partially converted.
    if (
      select pg_catalog.count(*)
      from public.training_cycle_days as day
      where day.cycle_id = v_cycle.id
        and day.user_id = p_user_id
        and day.week_index = 1
        and day.deleted_at is null
    ) not between 1 and 7
      or exists (
        select 1
        from public.training_cycle_days as day
        where day.cycle_id = v_cycle.id
          and day.user_id = p_user_id
          and day.week_index <> 1
          and day.deleted_at is null
      )
      or exists (
        select 1
        from public.training_cycle_days as day
        join public.training_cycle_routines as routine
          on routine.id = day.routine_id
         and routine.cycle_id = day.cycle_id
         and routine.user_id = day.user_id
         and routine.deleted_at is null
        where day.cycle_id = v_cycle.id
          and day.user_id = p_user_id
          and day.week_index = 1
          and day.deleted_at is null
          and (
            day.day_code not in (
              'monday', 'tuesday', 'wednesday', 'thursday',
              'friday', 'saturday', 'sunday'
            )
            or day.sort_order not between 0 and 6
            or pg_catalog.char_length(pg_catalog.btrim(routine.name)) not between 1 and 120
            -- The canonical payload has no legacy notes fields.
            or pg_catalog.btrim(coalesce(routine.notes, '')) <> ''
            or pg_catalog.btrim(coalesce(day.notes, '')) <> ''
          )
      )
      or exists (
        select 1
        from public.training_cycle_days as day
        where day.cycle_id = v_cycle.id
          and day.user_id = p_user_id
          and day.week_index = 1
          and day.deleted_at is null
        group by day.day_code
        having pg_catalog.count(*) <> 1
      )
      or exists (
        select 1
        from public.training_cycle_days as day
        join public.training_cycle_exercises as exercise
          on exercise.day_id = day.id
         and exercise.cycle_id = day.cycle_id
         and exercise.user_id = day.user_id
         and exercise.deleted_at is null
        where day.cycle_id = v_cycle.id
          and day.user_id = p_user_id
          and day.week_index = 1
          and day.deleted_at is null
        group by day.id
        having pg_catalog.count(*) not between 1 and 50
          or pg_catalog.count(distinct exercise.sort_order) <> pg_catalog.count(*)
      )
      or (
        select pg_catalog.count(*)
        from public.training_cycle_days as day
        join public.training_cycle_exercises as exercise
          on exercise.day_id = day.id
         and exercise.cycle_id = day.cycle_id
         and exercise.user_id = day.user_id
         and exercise.deleted_at is null
        where day.cycle_id = v_cycle.id
          and day.user_id = p_user_id
          and day.week_index = 1
          and day.deleted_at is null
      ) > 200
    then
      raise exception 'legacy training cycle cannot be converted safely'
        using errcode = '55000';
    end if;

    -- A legacy plan can be converted only when each historical exercise has
    -- an exact catalog identity. Guessing a muscle group or silently dropping
    -- an exercise would corrupt the user's program, so unsupported legacy
    -- content fails before any close/discard write.
    if not exists (
      select 1
      from public.training_cycle_days as day
      join public.training_cycle_exercises as exercise
        on exercise.day_id = day.id
       and exercise.cycle_id = day.cycle_id
       and exercise.user_id = day.user_id
       and exercise.deleted_at is null
      where day.cycle_id = v_cycle.id
        and day.user_id = p_user_id
        and day.week_index = 1
        and day.deleted_at is null
    ) or exists (
      select 1
      from public.training_cycle_days as day
      join public.training_cycle_exercises as exercise
        on exercise.day_id = day.id
       and exercise.cycle_id = day.cycle_id
       and exercise.user_id = day.user_id
       and exercise.deleted_at is null
      where day.cycle_id = v_cycle.id
        and day.user_id = p_user_id
        and day.week_index = 1
        and day.deleted_at is null
        and (
          pg_catalog.char_length(pg_catalog.btrim(exercise.name)) not between 1 and 120
          or exercise.sort_order not between 0 and 199
          or
          exercise.target_sets not between 1 and 20
          or exercise.target_reps not between 1 and 1000
          or exercise.base_weight not between 0 and 100000
          -- Do not turn a two-component legacy load into base weight alone.
          or coalesce(exercise.side_weight, 0) <> 0
          or pg_catalog.btrim(coalesce(exercise.notes, '')) <> ''
          or (
            not exists (
            select 1
            from public.training_exercise_catalog as catalog
            where pg_catalog.lower(pg_catalog.btrim(catalog.canonical_name)) =
              pg_catalog.lower(pg_catalog.btrim(exercise.name))
            )
            and private.infer_legacy_training_muscle_group(
              exercise.name,
              (select routine.name from public.training_cycle_routines as routine
               where routine.id = day.routine_id)
            ) is null
          )
        )
    ) then
      raise exception 'legacy training cycle cannot be converted safely'
        using errcode = '55000';
    end if;

    v_goal := case pg_catalog.lower(coalesce(v_cycle.goal, ''))
      when 'strength' then 'strength' when 'fuerza' then 'strength'
      when 'volume' then 'volume' when 'volumen' then 'volume'
      when 'definition' then 'definition' when 'definicion' then 'definition'
      when 'definición' then 'definition'
      when 'deload' then 'deload' when 'descarga' then 'deload'
      else null
    end;
    if v_goal is null then
      raise exception 'legacy training cycle cannot be converted safely'
        using errcode = '55000';
    end if;

    -- Preserve ordinary legacy exercises that predate the global catalog by
    -- creating/reusing a portal-scoped custom identity. The inference is an
    -- explicit bounded allowlist; unknown content fails above before writes.
    for v_legacy in
      select distinct on (pg_catalog.lower(pg_catalog.btrim(exercise.name)))
        exercise.name,
        routine.name as routine_name
      from public.training_cycle_days as day
      join public.training_cycle_routines as routine
        on routine.id = day.routine_id
       and routine.user_id = day.user_id
       and routine.cycle_id = day.cycle_id
      join public.training_cycle_exercises as exercise
        on exercise.day_id = day.id
       and exercise.user_id = day.user_id
       and exercise.cycle_id = day.cycle_id
       and exercise.deleted_at is null
      where day.user_id = p_user_id
        and day.cycle_id = v_cycle.id
        and day.week_index = 1
        and day.deleted_at is null
        and not exists (
          select 1 from public.training_exercise_catalog as catalog
          where pg_catalog.lower(pg_catalog.btrim(catalog.canonical_name)) =
            pg_catalog.lower(pg_catalog.btrim(exercise.name))
        )
      order by pg_catalog.lower(pg_catalog.btrim(exercise.name)), exercise.id
    loop
      select custom.id into v_custom_id
      from public.training_custom_exercises as custom
      where custom.user_id = p_user_id
        and custom.portal_scope = p_portal_scope
        and pg_catalog.lower(pg_catalog.btrim(custom.name)) =
          pg_catalog.lower(pg_catalog.btrim(v_legacy.name))
        and custom.archived_at is null;
      if v_custom_id is null then
        insert into public.training_exercise_lineages (
          user_id, portal_scope, origin_kind, metadata
        ) values (
          p_user_id, p_portal_scope, 'scoped',
          pg_catalog.jsonb_build_object(
            'source', 'legacy-cycle-replacement',
            'sourceCycleId', v_cycle.id
          )
        ) returning id into v_lineage_id;
        insert into public.training_custom_exercises (
          user_id, portal_scope, lineage_id, name, muscle_group, video_url
        ) values (
          p_user_id, p_portal_scope, v_lineage_id,
          pg_catalog.btrim(v_legacy.name),
          private.infer_legacy_training_muscle_group(
            v_legacy.name, v_legacy.routine_name
          ), null
        ) returning id into v_custom_id;
        update public.training_exercise_lineages as lineage
        set custom_exercise_id = v_custom_id
        where lineage.id = v_lineage_id
          and lineage.user_id = p_user_id
          and lineage.portal_scope = p_portal_scope;
      end if;
    end loop;

    select pg_catalog.jsonb_build_object(
      'days', pg_catalog.jsonb_agg(day_payload order by day_order)
    ) into v_plan
    from (
      select
        ordered_day.day_order,
        pg_catalog.jsonb_build_object(
          'day', ordered_day.day_code,
          'name', ordered_day.routine_name,
          'order', ordered_day.day_order,
          'exercises', (
            select pg_catalog.jsonb_agg(
              (case when catalog.id is not null
                then pg_catalog.jsonb_build_object('catalogExerciseId', catalog.id)
                else pg_catalog.jsonb_build_object('customExerciseId', custom.id)
              end) || pg_catalog.jsonb_build_object(
                'order', exercise.sort_order,
                'technique', 'linear',
                'videoUrl', null,
                'sets', (
                  select pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                      'order', series_index - 1,
                      'targetReps', exercise.target_reps,
                      'targetKg', exercise.base_weight,
                      'toFailure', false,
                      'drops', '[]'::jsonb
                    ) order by series_index
                  )
                  from pg_catalog.generate_series(1, exercise.target_sets) as series_index
                )
              ) order by exercise.sort_order, exercise.id
            )
            from public.training_cycle_exercises as exercise
            left join public.training_exercise_catalog as catalog
              on pg_catalog.lower(pg_catalog.btrim(catalog.canonical_name)) =
                pg_catalog.lower(pg_catalog.btrim(exercise.name))
            left join public.training_custom_exercises as custom
              on custom.user_id = p_user_id
             and custom.portal_scope = p_portal_scope
             and pg_catalog.lower(pg_catalog.btrim(custom.name)) =
               pg_catalog.lower(pg_catalog.btrim(exercise.name))
             and custom.archived_at is null
            where exercise.day_id = ordered_day.day_id
              and exercise.cycle_id = v_cycle.id
              and exercise.user_id = p_user_id
              and exercise.deleted_at is null
          )
        ) as day_payload
      from (
        select
          day.id as day_id,
          day.day_code,
          routine.name as routine_name,
          row_number() over (
            order by day.sort_order, day.day_code, day.id
          )::integer - 1 as day_order
        from public.training_cycle_days as day
        join public.training_cycle_routines as routine
          on routine.id = day.routine_id
         and routine.cycle_id = day.cycle_id
         and routine.user_id = day.user_id
         and routine.deleted_at is null
        where day.cycle_id = v_cycle.id
          and day.user_id = p_user_id
          and day.week_index = 1
          and day.deleted_at is null
        order by day.sort_order, day.day_code, day.id
        limit 7
      ) as ordered_day
    ) as converted;
  end if;

  perform private.validate_training_cycle_plan(p_user_id, p_portal_scope, v_plan);
  return query select v_goal, v_plan;
end;
$function$;

revoke all on function private.training_cycle_replacement_source(uuid, text, uuid)
  from public, anon, authenticated, service_role;

create function public.replace_own_active_training_cycle_to_draft(
  p_request_id uuid,
  p_portal_scope text,
  p_expected_active_cycle_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '12s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_payload jsonb;
  v_receipt_draft_id uuid;
  v_receipt_version integer;
  v_active_cycle public.training_cycles;
  v_source record;
  v_result jsonb;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  perform private.lock_training_cycle_portal(v_user_id, p_portal_scope);

  if p_request_id is null or p_expected_active_cycle_id is null then
    raise exception 'invalid training cycle replacement request' using errcode = '22023';
  end if;
  perform private.validate_training_cycle_dates(p_start_date, p_end_date);

  v_payload := pg_catalog.jsonb_build_object(
    'portalScope', p_portal_scope,
    'sourceCycleId', p_expected_active_cycle_id,
    'startDate', p_start_date,
    'endDate', p_end_date
  );
  select receipt.aggregate_id, receipt.result_version
    into v_receipt_draft_id, v_receipt_version
  from private.find_training_cycle_receipt(
    v_user_id, p_portal_scope, p_request_id, 'draft_duplicate', v_payload
  ) as receipt;
  if v_receipt_draft_id is not null then
    return private.training_cycle_operation_result(
      p_request_id, 'draft_duplicate', v_receipt_draft_id, v_receipt_version
    );
  end if;

  select cycle.* into v_active_cycle
  from public.training_cycles as cycle
  where cycle.id = p_expected_active_cycle_id
    and cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status = 'active'
    and cycle.deleted_at is null
  for update;
  if v_active_cycle.id is null then
    raise exception 'confirmed active training cycle changed' using errcode = '40001';
  end if;

  if exists (
    select 1 from public.training_workout_readiness as readiness
    where readiness.user_id = v_user_id
      and readiness.cycle_id = v_active_cycle.id
      and readiness.training_session_id is null
      and readiness.payload->>'skipped' = 'false'
      and readiness.workout_started_at >= v_now - interval '36 hours'
      and readiness.workout_started_at <= v_now + interval '5 minutes'
  ) then
    raise exception 'active workout must finish before closing the cycle'
      using errcode = '55000';
  end if;

  select source.* into v_source
  from private.training_cycle_replacement_source(
    v_user_id, p_portal_scope, v_active_cycle.id
  ) as source;

  -- Starting a new cycle is an explicit decision to replace, not overwrite,
  -- a previous unrelated draft. Retire the old draft before creating the new
  -- one; any later failure rolls this update back with the cycle close.
  update public.training_cycle_drafts as draft
  set state = 'discarded', discarded_at = v_now
  where draft.user_id = v_user_id
    and draft.portal_scope = p_portal_scope
    and draft.state = 'draft';

  v_result := private.create_training_cycle_draft_record(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'draft_duplicate',
    'duplicate',
    v_active_cycle.id,
    v_source.goal,
    p_start_date,
    p_end_date,
    v_source.plan,
    v_payload
  );

  update public.training_cycles as cycle
  set status = 'completed', ended_at = v_now, closed_at = v_now,
      closed_reason = 'manual',
      summary_snapshot = coalesce(
        cycle.summary_snapshot,
        pg_catalog.jsonb_build_object(
          'source', 'cycle-redesign-manual-replacement',
          'planVersion', cycle.current_plan_version
        )
      )
  where cycle.id = v_active_cycle.id
    and cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status = 'active'
    and cycle.deleted_at is null;
  if not found then
    raise exception 'confirmed active training cycle changed' using errcode = '40001';
  end if;

  update public.training_cycle_notifications as notification
  set superseded_at = coalesce(notification.superseded_at, v_now)
  where notification.user_id = v_user_id
    and notification.portal_scope = p_portal_scope
    and notification.cycle_id = v_active_cycle.id
    and notification.superseded_at is null;

  return v_result;
end;
$function$;

revoke all on function public.replace_own_active_training_cycle_to_draft(
  uuid, text, uuid, date, date
) from public, anon, authenticated, service_role;
grant execute on function public.replace_own_active_training_cycle_to_draft(
  uuid, text, uuid, date, date
) to authenticated;

-- Serialize readiness inserts for legacy as well as canonical cycles with the
-- exact owner/portal lock used by replacement.
create or replace function private.guard_cycle_redesign_readiness_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_cycle public.training_cycles;
  v_today date := pg_catalog.timezone(
    'America/Santiago', pg_catalog.clock_timestamp()
  )::date;
begin
  select cycle.* into v_cycle
  from public.training_cycles as cycle
  where cycle.id = new.cycle_id
    and cycle.user_id = new.user_id
    and cycle.deleted_at is null;
  if v_cycle.id is null then return new; end if;
  if new.user_id is distinct from auth.uid() then
    raise exception 'training readiness ownership denied' using errcode = '42501';
  end if;

  perform private.lock_training_cycle_portal(new.user_id, v_cycle.portal_scope);
  select cycle.* into v_cycle
  from public.training_cycles as cycle
  where cycle.id = new.cycle_id
    and cycle.user_id = new.user_id
    and cycle.portal_scope = v_cycle.portal_scope
    and cycle.deleted_at is null;
  if v_cycle.status <> 'active' then
    raise exception 'training cycle is closed for new workouts' using errcode = '55000';
  end if;
  if v_cycle.current_plan_version_id is not null and (
    v_cycle.planned_end_date is null or v_cycle.planned_end_date < v_today
  ) then
    raise exception 'training cycle is closed for new workouts' using errcode = '55000';
  end if;
  return new;
end;
$function$;

do $postcheck$
begin
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'public.replace_own_active_training_cycle_to_draft(uuid,text,uuid,date,date)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'anon',
    'public.replace_own_active_training_cycle_to_draft(uuid,text,uuid,date,date)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'service_role',
    'public.replace_own_active_training_cycle_to_draft(uuid,text,uuid,date,date)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.complete_own_active_training_cycle_manually(uuid,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'atomic cycle replacement postcheck failed';
  end if;
end;
$postcheck$;

commit;
