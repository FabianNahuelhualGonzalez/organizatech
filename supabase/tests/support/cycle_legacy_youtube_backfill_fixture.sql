-- Seed rows accepted by the original 6..64-character YouTube constraints.
-- This runs immediately before the forward migration so its backfill, reads,
-- duplication and renewal are exercised against realistic historical data.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91000000-0000-4000-8000-000000000004',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'legacy-youtube@example.test',
  '',
  statement_timestamp(),
  '{}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(),
  statement_timestamp()
);

insert into public.user_registrations (user_id)
values ('91000000-0000-4000-8000-000000000004');

insert into public.training_exercise_catalog (
  id, canonical_name, muscle_group, default_video_url, sort_order
) values (
  '90000000-0000-4000-8000-000000000041',
  'Legacy URL inválida',
  'pectoral',
  'https://youtu.be/AbCdEf',
  32000
);

select set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000004',
  false
);

do $fixture$
declare
  v_custom_result jsonb;
  v_custom_id uuid;
  v_draft_result jsonb;
  v_draft_id uuid;
  v_cycle_result jsonb;
  v_cycle_id uuid;
  v_plan jsonb;
begin
  v_custom_result := public.create_own_training_custom_exercise(
    '96000000-0000-4000-8000-000000000041',
    'usuario',
    'Legacy URL válida',
    'pectoral',
    'https://youtu.be/AbCdEfGhI_1?si=legacy-tracking'
  );
  v_custom_id := (v_custom_result->>'aggregateId')::uuid;

  v_plan := pg_catalog.jsonb_build_object(
    'days', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'day', 'monday',
        'name', 'Histórica',
        'order', 0,
        'exercises', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'catalogExerciseId', '90000000-0000-4000-8000-000000000041',
            'customExerciseId', null,
            'order', 0,
            'technique', 'linear',
            'videoUrl', 'https://youtu.be/AbCdEf',
            'sets', pg_catalog.jsonb_build_array(
              pg_catalog.jsonb_build_object(
                'order', 0, 'targetReps', 10, 'targetKg', 80,
                'toFailure', false, 'drops', '[]'::jsonb
              )
            )
          ),
          pg_catalog.jsonb_build_object(
            'catalogExerciseId', null,
            'customExerciseId', v_custom_id,
            'order', 1,
            'technique', 'linear',
            'videoUrl', 'https://youtu.be/AbCdEfGhI_1?si=legacy-tracking',
            'sets', pg_catalog.jsonb_build_array(
              pg_catalog.jsonb_build_object(
                'order', 0, 'targetReps', 10, 'targetKg', 40,
                'toFailure', false, 'drops', '[]'::jsonb
              )
            )
          )
        )
      )
    )
  );

  v_draft_result := public.create_own_training_cycle_draft(
    '96000000-0000-4000-8000-000000000042',
    'usuario',
    'manual',
    'volume',
    '2026-09-01',
    '2026-09-28',
    v_plan
  );
  v_draft_id := (v_draft_result->>'aggregateId')::uuid;

  v_cycle_result := public.activate_own_training_cycle_draft(
    '96000000-0000-4000-8000-000000000043',
    'usuario',
    v_draft_id,
    1
  );
  v_cycle_id := (v_cycle_result->>'aggregateId')::uuid;

  perform public.complete_own_active_training_cycle_manually(
    '96000000-0000-4000-8000-000000000044',
    'usuario',
    v_cycle_id
  );
end;
$fixture$;

select set_config('request.jwt.claim.sub', '', false);
