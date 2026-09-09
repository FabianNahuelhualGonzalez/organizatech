-- Local-only pgTAP coverage for the forward-only legacy compatibility bridge.

begin;
set local session_replication_role = replica;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  fixture.id,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  fixture.email,
  '',
  statement_timestamp(),
  '{}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(),
  statement_timestamp()
from (values
  ('91000000-0000-4000-8000-000000000001'::uuid, 'legacy-compatible@example.test'),
  ('91000000-0000-4000-8000-000000000002'::uuid, 'legacy-fallback@example.test'),
  ('91000000-0000-4000-8000-000000000003'::uuid, 'legacy-concurrent@example.test')
) as fixture(id, email);

insert into public.user_registrations (user_id)
values
  ('91000000-0000-4000-8000-000000000001'),
  ('91000000-0000-4000-8000-000000000002'),
  ('91000000-0000-4000-8000-000000000003');

insert into public.training_cycles (
  id, user_id, name, cycle_number, goal, started_at, status,
  plan_snapshot, portal_scope, current_plan_version,
  duration_weeks, planned_start_date, planned_end_date
)
values
  (
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'Legacy compatible', 1, 'volume', '2026-09-01T12:00:00Z', 'active',
    '{}', 'usuario', 0, 4, '2026-09-01', null
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000002',
    'Legacy unsupported', 1, 'volume', '2026-09-01T12:00:00Z', 'active',
    '{}', 'usuario', 0, 4, '2026-09-01', null
  ),
  (
    '92000000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000003',
    'Legacy concurrent', 1, 'strength', '2026-09-01T12:00:00Z', 'active',
    '{}', 'usuario', 0, 4, '2026-09-01', null
  );

insert into public.training_cycle_routines (id, user_id, cycle_id, name, sort_order)
values
  ('93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'Empuje', 0),
  ('93000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', 'Empuje', 0),
  ('93000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000003', 'Empuje', 0);

insert into public.training_cycle_days (
  id, user_id, cycle_id, routine_id, week_index, day_code, sort_order
)
values
  ('94000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 1, 'monday', 0),
  ('94000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000002', 1, 'monday', 0),
  ('94000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000003', 1, 'monday', 0),
  ('94000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000002', 2, 'monday', 0);

insert into public.training_cycle_exercises (
  id, user_id, cycle_id, day_id, name, target_sets, target_reps,
  base_weight, sort_order
)
values
  ('95000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'Press', 4, 10, 80, 0),
  ('95000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000002', 'Press', 4, 10, 80, 0),
  ('95000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000003', 'Press', 4, 10, 80, 0),
  ('95000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000004', 'Press', 4, 10, 80, 0);

-- Each otherwise representable fixture has exactly one unsupported field.
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
select ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', 'legacy-preserve-' || n || '@example.test', '{}', '{}'
from generate_series(11, 14) as n;
insert into public.user_registrations (user_id)
select ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
from generate_series(11, 14) as n;
insert into public.training_cycles (
  id, user_id, name, cycle_number, goal, started_at, status, plan_snapshot,
  portal_scope, current_plan_version, duration_weeks, planned_start_date
)
select ('92000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'Legacy preserved ' || n, 1, 'volume', '2026-09-01T12:00:00Z', 'active',
  '{}', 'usuario', 0, 4, '2026-09-01'
from generate_series(11, 14) as n;
insert into public.training_cycle_routines (id, user_id, cycle_id, name, sort_order, notes)
select ('93000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('92000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'Empuje', 0, case when n = 12 then 'Indicaciones de rutina' end
from generate_series(11, 14) as n;
insert into public.training_cycle_days (
  id, user_id, cycle_id, routine_id, week_index, day_code, sort_order, notes
)
select ('94000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('92000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('93000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  1, 'monday', 0, case when n = 13 then 'Indicaciones de día' end
from generate_series(11, 14) as n;
insert into public.training_cycle_exercises (
  id, user_id, cycle_id, day_id, name, target_sets, target_reps,
  base_weight, side_weight, sort_order, notes
)
select ('95000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('92000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('94000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'Press', 4, 10, 20, case when n = 11 then 10 else 0 end, 0,
  case when n = 14 then 'Indicaciones de ejercicio' end
from generate_series(11, 14) as n;

set local session_replication_role = origin;
commit;

begin;
select extensions.plan(42);

-- Both entry points must preserve all original rows and avoid partial writes.
create temp view legacy_preservation_state as
select n, jsonb_build_object(
  'training_cycles', (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb)
    from public.training_cycles as row
    where row.user_id = ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid),
  'training_cycle_routines', (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb)
    from public.training_cycle_routines as row
    where row.user_id = ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid),
  'training_cycle_days', (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb)
    from public.training_cycle_days as row
    where row.user_id = ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid),
  'training_cycle_exercises', (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb)
    from public.training_cycle_exercises as row
    where row.user_id = ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid),
  'training_cycle_plan_versions', (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb)
    from public.training_cycle_plan_versions as row
    where row.user_id = ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid),
  'training_exercise_lineages', (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb)
    from public.training_exercise_lineages as row
    where row.user_id = ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid),
  'training_custom_exercises', (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb)
    from public.training_custom_exercises as row
    where row.user_id = ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid),
  'training_cycle_drafts', (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb)
    from public.training_cycle_drafts as row
    where row.user_id = ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid),
  'training_cycle_notifications', (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb)
    from public.training_cycle_notifications as row
    where row.user_id = ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid)
) as payload
from generate_series(11, 14) as n;
create temp table legacy_preservation_before as select * from legacy_preservation_state;

set local role authenticated;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000011', true);
select extensions.is(
  public.adapt_own_active_legacy_training_cycle(
    '96000000-0000-4000-8000-000000000011', 'usuario',
    '92000000-0000-4000-8000-000000000011'
  )->>'status',
  'legacy_fallback',
  'side weight retain the operational legacy fallback'
);
select extensions.throws_ok(
  $$select public.replace_own_active_training_cycle_to_draft(
    '97000000-0000-4000-8000-000000000011', 'usuario',
    '92000000-0000-4000-8000-000000000011', '2026-10-01', '2026-10-28'
  )$$,
  '55000',
  'legacy training cycle cannot be converted safely',
  'side weight block replacement before any destructive write'
);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000012', true);
select extensions.is(
  public.adapt_own_active_legacy_training_cycle(
    '96000000-0000-4000-8000-000000000012', 'usuario',
    '92000000-0000-4000-8000-000000000012'
  )->>'status',
  'legacy_fallback',
  'routine notes retain the operational legacy fallback'
);
select extensions.throws_ok(
  $$select public.replace_own_active_training_cycle_to_draft(
    '97000000-0000-4000-8000-000000000012', 'usuario',
    '92000000-0000-4000-8000-000000000012', '2026-10-01', '2026-10-28'
  )$$,
  '55000',
  'legacy training cycle cannot be converted safely',
  'routine notes block replacement before any destructive write'
);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000013', true);
select extensions.is(
  public.adapt_own_active_legacy_training_cycle(
    '96000000-0000-4000-8000-000000000013', 'usuario',
    '92000000-0000-4000-8000-000000000013'
  )->>'status',
  'legacy_fallback',
  'day notes retain the operational legacy fallback'
);
select extensions.throws_ok(
  $$select public.replace_own_active_training_cycle_to_draft(
    '97000000-0000-4000-8000-000000000013', 'usuario',
    '92000000-0000-4000-8000-000000000013', '2026-10-01', '2026-10-28'
  )$$,
  '55000',
  'legacy training cycle cannot be converted safely',
  'day notes block replacement before any destructive write'
);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000014', true);
select extensions.is(
  public.adapt_own_active_legacy_training_cycle(
    '96000000-0000-4000-8000-000000000014', 'usuario',
    '92000000-0000-4000-8000-000000000014'
  )->>'status',
  'legacy_fallback',
  'exercise notes retain the operational legacy fallback'
);
select extensions.throws_ok(
  $$select public.replace_own_active_training_cycle_to_draft(
    '97000000-0000-4000-8000-000000000014', 'usuario',
    '92000000-0000-4000-8000-000000000014', '2026-10-01', '2026-10-28'
  )$$,
  '55000',
  'legacy training cycle cannot be converted safely',
  'exercise notes block replacement before any destructive write'
);
reset role;
select extensions.is(
  after.payload, before.payload,
  'unsupported legacy fixture ' || before.n || ' preserves all rows and creates no partial plan'
)
from legacy_preservation_before as before
join legacy_preservation_state as after using (n)
order by before.n;
select set_config('request.jwt.claim.sub', '', true);


select extensions.ok(
  private.is_valid_training_youtube_url('https://www.youtube.com/watch?v=AbCdEfGhI_1'),
  'canonical YouTube watch URL is accepted'
);
select extensions.ok(
  private.canonical_training_youtube_url(
    'https://youtu.be/AbCdEfGhI_1?si=tracking-value'
  ) = 'https://www.youtube.com/watch?v=AbCdEfGhI_1',
  'valid YouTube variants are canonicalized without tracking'
);
select extensions.ok(
  not private.is_valid_training_youtube_url('https://youtu.be/short'),
  'short YouTube identifiers are rejected'
);
select extensions.ok(
  not private.is_valid_training_youtube_url('https://youtube.com/watch?v=AbCdEfGhI_1&v=ZyXwVuTsR_2'),
  'ambiguous duplicate video identifiers are rejected'
);
select extensions.is(
  (
    select default_video_url
    from public.training_exercise_catalog
    where id = '90000000-0000-4000-8000-000000000041'
  ),
  null::text,
  'a historical short identifier is degraded to null by the backfill'
);
select extensions.is(
  (
    select video_url
    from public.training_custom_exercises
    where user_id = '91000000-0000-4000-8000-000000000004'
      and name = 'Legacy URL válida'
  ),
  'https://www.youtube.com/watch?v=AbCdEfGhI_1',
  'a historical valid youtu.be variant is retained canonically'
);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000004', true);
select extensions.is(
  public.get_own_training_cycle_draft(
    'usuario',
    (
      select id from public.training_cycle_drafts
      where user_id = '91000000-0000-4000-8000-000000000004'
        and state = 'activated'
    )
  ) #>> '{plan,days,0,exercises,0,videoUrl}',
  null::text,
  'an activated historical draft remains readable when one URL was invalid'
);
select extensions.is(
  public.get_own_training_cycle_draft(
    'usuario',
    (
      select id from public.training_cycle_drafts
      where user_id = '91000000-0000-4000-8000-000000000004'
        and state = 'activated'
    )
  ) #>> '{plan,days,0,exercises,1,videoUrl}',
  'https://www.youtube.com/watch?v=AbCdEfGhI_1',
  'an activated historical draft exposes its valid URL canonically'
);
select extensions.is(
  private.training_cycle_snapshot_json(
    '91000000-0000-4000-8000-000000000004',
    'usuario',
    (
      select id from public.training_cycles
      where user_id = '91000000-0000-4000-8000-000000000004'
    ),
    pg_catalog.clock_timestamp()
  ) #>> '{plan,days,0,exercises,0,videoUrl}',
  null::text,
  'a historical cycle snapshot remains readable when one URL was invalid'
);
select extensions.is(
  private.training_cycle_snapshot_json(
    '91000000-0000-4000-8000-000000000004',
    'usuario',
    (
      select id from public.training_cycles
      where user_id = '91000000-0000-4000-8000-000000000004'
    ),
    pg_catalog.clock_timestamp()
  ) #>> '{plan,days,0,exercises,1,videoUrl}',
  'https://www.youtube.com/watch?v=AbCdEfGhI_1',
  'a historical cycle snapshot retains its valid URL canonically'
);
select extensions.is(
  public.duplicate_own_training_cycle_to_draft(
    '96000000-0000-4000-8000-000000000045',
    'usuario',
    (
      select id from public.training_cycles
      where user_id = '91000000-0000-4000-8000-000000000004'
    ),
    '2026-10-01',
    '2026-10-28'
  )->>'operationKind',
  'draft_duplicate',
  'a historical cycle with migrated URLs can be duplicated'
);
select extensions.is(
  public.get_own_training_cycle_draft('usuario', null)
    #>> '{plan,days,0,exercises,0,videoUrl}',
  null::text,
  'the duplicated draft keeps the invalid historical URL safely null'
);

do $discard_duplicate$
declare
  v_draft public.training_cycle_drafts;
begin
  select draft.* into strict v_draft
  from public.training_cycle_drafts as draft
  where draft.user_id = '91000000-0000-4000-8000-000000000004'
    and draft.state = 'draft';
  perform public.discard_own_training_cycle_draft(
    '96000000-0000-4000-8000-000000000046',
    'usuario',
    v_draft.id,
    v_draft.current_version
  );
end;
$discard_duplicate$;

select extensions.is(
  public.renew_own_closed_training_cycle_to_draft(
    '96000000-0000-4000-8000-000000000047',
    'usuario',
    (
      select id from public.training_cycles
      where user_id = '91000000-0000-4000-8000-000000000004'
    ),
    '2026-11-01',
    '2026-11-28'
  )->>'operationKind',
  'draft_renewal',
  'a historical closed cycle with migrated URLs can be renewed'
);
select extensions.is(
  public.get_own_training_cycle_draft('usuario', null)
    #>> '{plan,days,0,exercises,0,videoUrl}',
  null::text,
  'the renewal draft keeps the invalid historical URL safely null'
);
select extensions.is(
  public.get_own_training_cycle_draft('usuario', null)
    #>> '{plan,days,0,exercises,1,videoUrl}',
  'https://www.youtube.com/watch?v=AbCdEfGhI_1',
  'the renewal draft retains the valid historical URL canonically'
);
select set_config('request.jwt.claim.sub', '', true);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'service_role',
    'public.adapt_own_active_legacy_training_cycle(uuid,text,uuid)',
    'EXECUTE'
  ),
  'service_role cannot invoke the user adaptation RPC directly'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.adapt_own_active_legacy_training_cycle(
    '96000000-0000-4000-8000-000000000001', 'usuario',
    '92000000-0000-4000-8000-000000000002'
  )$$,
  '40001',
  'confirmed active training cycle changed',
  'an owner cannot adapt another owner cycle'
);
select extensions.is(
  public.adapt_own_active_legacy_training_cycle(
    '96000000-0000-4000-8000-000000000002', 'usuario',
    '92000000-0000-4000-8000-000000000001'
  )->>'status',
  'adapted',
  'a safely representable legacy cycle is adapted in place'
);
reset role;

select extensions.is(
  (select status from public.training_cycles where id = '92000000-0000-4000-8000-000000000001'),
  'active',
  'adaptation preserves active status'
);
select extensions.is(
  (select planned_end_date::text from public.training_cycles where id = '92000000-0000-4000-8000-000000000001'),
  '2026-09-28',
  'four legacy weeks use an inclusive start plus 27 day end date'
);
select extensions.is(
  (select current_plan_version::text from public.training_cycles where id = '92000000-0000-4000-8000-000000000001'),
  '1',
  'adaptation attaches canonical version one to the same cycle'
);
select extensions.is(
  (select count(*)::text from public.training_cycle_days where cycle_id = '92000000-0000-4000-8000-000000000001'),
  '1',
  'adaptation does not duplicate legacy days'
);
select extensions.is(
  (select count(*)::text from public.training_cycle_exercises where cycle_id = '92000000-0000-4000-8000-000000000001'),
  '1',
  'adaptation does not duplicate legacy exercises'
);
select extensions.is(
  (select pg_catalog.string_agg(event_kind, ',' order by scheduled_on)
   from public.training_cycle_notifications
   where cycle_id = '92000000-0000-4000-8000-000000000001'),
  'expires_t7,expires_t3,expires_t1,expires_t0,closed_t1',
  'adaptation schedules T-7, T-3, T-1, T0 and post-close events'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select extensions.is(
  public.adapt_own_active_legacy_training_cycle(
    '96000000-0000-4000-8000-000000000003', 'usuario',
    '92000000-0000-4000-8000-000000000001'
  )->>'status',
  'already_canonical',
  'a retry with another request is an idempotent no-op'
);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select extensions.is(
  public.adapt_own_active_legacy_training_cycle(
    '96000000-0000-4000-8000-000000000004', 'usuario',
    '92000000-0000-4000-8000-000000000002'
  )->>'reason',
  'unsupported_plan',
  'multi-week legacy data fails safely without truncation'
);
reset role;
select extensions.is(
  (select current_plan_version_id::text from public.training_cycles where id = '92000000-0000-4000-8000-000000000002'),
  null::text,
  'unsupported legacy data remains untouched behind the legacy fallback'
);

do $concurrent_adaptation_setup$
declare
  v_connection text := pg_catalog.format(
    'dbname=%L host=%L port=%s user=postgres password=postgres',
    current_database(),
    pg_catalog.split_part(current_setting('unix_socket_directories'), ',', 1),
    current_setting('port')
  );
begin
  perform extensions.dblink_connect('legacy_adapt_1', v_connection);
  perform extensions.dblink_connect('legacy_adapt_2', v_connection);
  perform extensions.dblink_exec(
    'legacy_adapt_1',
    'begin; set local role authenticated; set local "request.jwt.claim.sub" = ''91000000-0000-4000-8000-000000000003'''
  );
  perform extensions.dblink_exec(
    'legacy_adapt_2',
    'begin; set local role authenticated; set local "request.jwt.claim.sub" = ''91000000-0000-4000-8000-000000000003'''
  );
  perform extensions.dblink_send_query(
    'legacy_adapt_1',
    $$select public.adapt_own_active_legacy_training_cycle(
      '96000000-0000-4000-8000-000000000005', 'usuario',
      '92000000-0000-4000-8000-000000000003'
    )$$
  );
  perform * from extensions.dblink_get_result('legacy_adapt_1') as result(payload jsonb);
  perform * from extensions.dblink_get_result('legacy_adapt_1') as result(payload jsonb);
  perform extensions.dblink_send_query(
    'legacy_adapt_2',
    $$select public.adapt_own_active_legacy_training_cycle(
      '96000000-0000-4000-8000-000000000006', 'usuario',
      '92000000-0000-4000-8000-000000000003'
    )$$
  );
end;
$concurrent_adaptation_setup$;

select extensions.is(
  extensions.dblink_is_busy('legacy_adapt_2'),
  1,
  'concurrent adaptations with different requests serialize on the portal lock'
);

do $concurrent_adaptation_finish$
begin
  perform extensions.dblink_exec('legacy_adapt_1', 'commit');
  perform * from extensions.dblink_get_result('legacy_adapt_2') as result(payload jsonb);
  perform * from extensions.dblink_get_result('legacy_adapt_2') as result(payload jsonb);
  perform extensions.dblink_exec('legacy_adapt_2', 'commit');
  perform extensions.dblink_disconnect('legacy_adapt_1');
  perform extensions.dblink_disconnect('legacy_adapt_2');
end;
$concurrent_adaptation_finish$;

select extensions.is(
  (select count(*)::text from public.training_cycle_plan_versions where cycle_id = '92000000-0000-4000-8000-000000000003'),
  '1',
  'serialized concurrent adaptation creates one canonical version'
);
select extensions.is(
  (select current_plan_version::text from public.training_cycles where id = '92000000-0000-4000-8000-000000000003'),
  '1',
  'serialized concurrent adaptation leaves one active canonical cycle'
);

select * from extensions.finish();
rollback;
