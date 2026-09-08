-- Make the atomic replacement response self-contained. Exercise descriptors
-- are resolved under the authenticated owner/portal in the same transaction,
-- so newly materialized legacy custom exercises need no follow-up read.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.replace_own_active_training_cycle_to_draft(
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
  v_operation jsonb;
  v_draft_id uuid;
  v_version integer;
  v_draft jsonb;
  v_sources jsonb;
  v_reference_count integer;
begin
  v_operation := private.perform_active_training_cycle_replacement(
    p_request_id,
    p_portal_scope,
    p_expected_active_cycle_id,
    p_start_date,
    p_end_date
  );

  v_draft_id := (v_operation->>'aggregateId')::uuid;
  v_version := (v_operation->>'resultVersion')::integer;
  v_draft := private.prepared_training_cycle_draft_snapshot_json(
    v_user_id, p_portal_scope, v_draft_id, v_version
  );

  if v_draft->>'sourceCycleId' is distinct from p_expected_active_cycle_id::text
    or v_draft->>'origin' is distinct from 'duplicate'
    or v_draft->>'state' is distinct from 'draft'
  then
    raise exception 'prepared training cycle replacement is invalid'
      using errcode = 'XX000';
  end if;

  with referenced as (
    select distinct
      nullif(exercise->>'catalogExerciseId', '')::uuid as catalog_id,
      nullif(exercise->>'customExerciseId', '')::uuid as custom_id
    from jsonb_array_elements(v_draft->'plan'->'days') as day_row(day_value)
    cross join lateral jsonb_array_elements(day_row.day_value->'exercises') as exercise_row(exercise)
  ), descriptors as (
    select
      'catalog'::text as source_kind,
      catalog.id,
      catalog.canonical_name as source_name,
      catalog.muscle_group,
      catalog.default_video_url as video_url
    from referenced
    join public.training_exercise_catalog as catalog
      on catalog.id = referenced.catalog_id
    where catalog.is_active
    union all
    select
      'custom'::text,
      custom.id,
      custom.name,
      custom.muscle_group,
      custom.video_url
    from referenced
    join public.training_custom_exercises as custom
      on custom.id = referenced.custom_id
     and custom.user_id = v_user_id
     and custom.portal_scope = p_portal_scope
    where custom.archived_at is null
  )
  select
    count(*)::integer,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'kind', descriptors.source_kind,
          'id', descriptors.id,
          'name', descriptors.source_name,
          'muscleGroup', descriptors.muscle_group,
          'videoUrl', descriptors.video_url
        ) order by descriptors.source_kind, descriptors.id
      ),
      '[]'::jsonb
    )
  into v_reference_count, v_sources
  from descriptors;

  if v_reference_count > 200
    or v_reference_count is distinct from (
      select count(*)::integer
      from (
        select distinct
          nullif(exercise->>'catalogExerciseId', '')::uuid,
          nullif(exercise->>'customExerciseId', '')::uuid
        from jsonb_array_elements(v_draft->'plan'->'days') as day_row(day_value)
        cross join lateral jsonb_array_elements(day_row.day_value->'exercises') as exercise_row(exercise)
      ) as referenced_sources
    )
  then
    raise exception 'prepared training cycle exercise descriptors are invalid'
      using errcode = 'XX000';
  end if;

  return jsonb_build_object(
    'responseKind', 'prepared_draft',
    'requestId', p_request_id,
    'operationKind', 'draft_duplicate',
    'aggregateId', v_draft_id,
    'resultVersion', v_version,
    'draft', v_draft,
    'exerciseSources', v_sources
  );
end;
$function$;

revoke all on function public.replace_own_active_training_cycle_to_draft(
  uuid, text, uuid, date, date
) from public, anon, authenticated, service_role;
grant execute on function public.replace_own_active_training_cycle_to_draft(
  uuid, text, uuid, date, date
) to authenticated;

commit;
