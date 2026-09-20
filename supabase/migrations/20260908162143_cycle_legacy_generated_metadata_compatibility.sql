-- Accept metadata emitted by the old production form, not free-form notes.
-- No routine/day/exercise row or historical training record is changed here.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function private.is_generated_legacy_cycle_note(
  p_note text,
  p_kind text,
  p_day_code text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  with label as (
    select case p_day_code
      when 'monday' then 'Lunes' when 'tuesday' then 'Martes'
      when 'wednesday' then 'Miércoles' when 'thursday' then 'Jueves'
      when 'friday' then 'Viernes' when 'saturday' then 'Sábado'
      when 'sunday' then 'Domingo'
    end as day_name
  )
  select coalesce(
    pg_catalog.btrim(coalesce(p_note, '')) = ''
    or case p_kind
      when 'routine' then pg_catalog.btrim(p_note) in (
        'Plan cycle-scoped 2.2AT para ' || day_name || '.',
        'Rutina creada para ' || day_name || '.'
      )
      when 'day' then pg_catalog.btrim(p_note) = 'Dia planificado: ' || day_name || '.'
      when 'exercise' then pg_catalog.btrim(p_note) in (
        'Ejercicio planificado para ' || day_name || '.',
        'Ejercicio agregado al plan activo para ' || day_name || '.',
        'Ejercicio actualizado para ' || day_name || '.'
      )
      else false
    end,
    false
  ) from label
$function$;

revoke all on function private.is_generated_legacy_cycle_note(text,text,text)
  from public, anon, authenticated, service_role;

create or replace function private.training_cycle_replacement_source(
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
            -- Retain user annotations in the legacy flow; only exact app-generated
            -- labels are safe to omit from the new payload (original rows remain).
            or not private.is_generated_legacy_cycle_note(routine.notes, 'routine', day.day_code)
            or not private.is_generated_legacy_cycle_note(day.notes, 'day', day.day_code)
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
          or not private.is_generated_legacy_cycle_note(exercise.notes, 'exercise', day.day_code)
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

    v_goal := case pg_catalog.lower(pg_catalog.btrim(coalesce(v_cycle.goal, '')))
      when 'strength' then 'strength' when 'fuerza' then 'strength'
      when 'volume' then 'volume' when 'volumen' then 'volume'
      when 'hipertrofia' then 'volume'
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

-- CREATE OR REPLACE retains the existing protected identity and grants.
revoke all on function private.training_cycle_replacement_source(uuid,text,uuid)
  from public, anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
