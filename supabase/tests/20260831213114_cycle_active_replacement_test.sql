-- Local-only pgTAP coverage for the forward-only active-cycle replacement RPC.
-- Run only against a disposable `supabase start` database with `supabase test db`.

begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, private, extensions, pg_catalog;
-- Load authoritative fixtures as the disposable database superuser. Runtime
-- trigger behavior is exercised below after restoring normal replication.
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
  ('81000000-0000-4000-8000-000000000001'::uuid, 'cycle-local-a@example.test'),
  ('81000000-0000-4000-8000-000000000002'::uuid, 'cycle-local-b@example.test'),
  ('81000000-0000-4000-8000-000000000003'::uuid, 'cycle-local-c@example.test'),
  ('81000000-0000-4000-8000-000000000004'::uuid, 'cycle-local-d@example.test')
) as fixture(id, email);

insert into public.user_registrations (user_id)
values
  ('81000000-0000-4000-8000-000000000001'),
  ('81000000-0000-4000-8000-000000000002'),
  ('81000000-0000-4000-8000-000000000003'),
  ('81000000-0000-4000-8000-000000000004');

insert into public.training_exercise_catalog (
  id, canonical_name, muscle_group, sort_order
) values (
  '80000000-0000-4000-8000-000000000001', 'Press', 'pectoral', 990
) on conflict (id) do nothing;

insert into public.training_cycles (
  id, user_id, name, cycle_number, goal, started_at, status,
  plan_snapshot, portal_scope, current_plan_version
)
values
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'Legacy A', 1, 'volume', now() - interval '30 days', 'active', '{}', 'usuario', 0),
  ('82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', 'Canonical B', 1, 'strength', now() - interval '30 days', 'active', '{}', 'usuario', 0),
  ('82000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000003', 'Workout C', 1, 'volume', now() - interval '10 days', 'active', '{}', 'usuario', 0),
  ('82000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000004', 'Concurrent D', 1, 'definition', now() - interval '20 days', 'active', '{}', 'usuario', 0);

insert into public.training_cycle_plan_versions (
  id, cycle_id, user_id, portal_scope, version, request_id, change_kind,
  goal, start_date, end_date, plan_payload
)
values (
  '83000000-0000-4000-8000-000000000002',
  '82000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000002',
  'usuario',
  1,
  '84000000-0000-4000-8000-000000000002',
  'activation',
  'strength',
  current_date - 30,
  current_date + 30,
  '{"days":[{"day":"monday","name":"Empuje","order":0,"exercises":[{"catalogExerciseId":"80000000-0000-4000-8000-000000000001","order":0,"technique":"linear","videoUrl":null,"sets":[{"order":0,"targetReps":10,"targetKg":80,"toFailure":false,"drops":[]}]}]}]}'
);

insert into public.training_cycle_plan_versions (
  id, cycle_id, user_id, portal_scope, version, request_id, change_kind,
  goal, start_date, end_date, plan_payload
) values (
  '83000000-0000-4000-8000-000000000004',
  '82000000-0000-4000-8000-000000000004',
  '81000000-0000-4000-8000-000000000004',
  'usuario', 1,
  '84000000-0000-4000-8000-000000000004',
  'activation', 'definition', current_date - 20, current_date + 20,
  '{"days":[{"day":"monday","name":"Empuje","order":0,"exercises":[{"catalogExerciseId":"80000000-0000-4000-8000-000000000001","order":0,"technique":"linear","videoUrl":null,"sets":[{"order":0,"targetReps":10,"targetKg":80,"toFailure":false,"drops":[]}]}]}]}'
);

update public.training_cycles
set
  current_plan_version = 1,
  current_plan_version_id = '83000000-0000-4000-8000-000000000002'
where id = '82000000-0000-4000-8000-000000000002';

update public.training_cycles
set current_plan_version = 1,
    current_plan_version_id = '83000000-0000-4000-8000-000000000004'
where id = '82000000-0000-4000-8000-000000000004';

insert into public.training_cycle_routines (id, user_id, cycle_id, name)
values (
  '85000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  'Empuje legacy'
);
insert into public.training_cycle_days (
  id, user_id, cycle_id, routine_id, week_index, day_code
) values (
  '86000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001', 1, 'monday'
);
insert into public.training_cycle_exercises (
  id, user_id, cycle_id, day_id, name, target_sets, target_reps, base_weight
) values (
  '8a000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001', 'Remo artesanal con barra', 4, 10, 80
);

insert into public.training_cycle_routines (id, user_id, cycle_id, name)
values (
  '85000000-0000-4000-8000-000000000003',
  '81000000-0000-4000-8000-000000000003',
  '82000000-0000-4000-8000-000000000003',
  'Workout guard'
);

insert into public.training_cycle_days (
  id, user_id, cycle_id, routine_id, week_index, day_code
)
values (
  '86000000-0000-4000-8000-000000000003',
  '81000000-0000-4000-8000-000000000003',
  '82000000-0000-4000-8000-000000000003',
  '85000000-0000-4000-8000-000000000003',
  1,
  'monday'
);

insert into public.training_workout_readiness (
  id, user_id, workout_attempt_id, cycle_id, cycle_day_id,
  workout_started_at, local_date, payload
)
values (
  '87000000-0000-4000-8000-000000000003',
  '81000000-0000-4000-8000-000000000003',
  '88000000-0000-4000-8000-000000000003',
  '82000000-0000-4000-8000-000000000003',
  '86000000-0000-4000-8000-000000000003',
  now(),
  current_date,
  '{"skipped":false,"motivation":5,"hydration":5,"sleep":5,"energy":5}'
);

insert into public.training_cycle_drafts (
  id, user_id, portal_scope, origin, state, current_version
) values (
  '8b000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000002',
  'usuario', 'manual', 'draft', 1
);
insert into public.training_cycle_draft_versions (
  draft_id, user_id, portal_scope, version, request_id, operation_kind,
  goal, start_date, end_date, plan_payload
) values (
  '8b000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000002',
  'usuario', 1,
  '8c000000-0000-4000-8000-000000000002',
  'create', 'volume', '2026-09-01', '2026-10-13',
  '{"days":[{"day":"monday","name":"Viejo","order":0,"exercises":[{"catalogExerciseId":"80000000-0000-4000-8000-000000000001","order":0,"technique":"linear","videoUrl":null,"sets":[{"order":0,"targetReps":8,"targetKg":50,"toFailure":false,"drops":[]}]}]}]}'
);

set local session_replication_role = origin;

commit;
begin;

select extensions.plan(25);

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);

select extensions.is(
  public.get_own_active_training_cycle_guard('usuario')->>'hasCanonicalPlan',
  'false',
  'legacy active cycle is visible to the authoritative guard'
);

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select extensions.is(
  public.get_own_active_training_cycle_guard('usuario')->>'hasCanonicalPlan',
  'true',
  'canonical active cycle is visible to the authoritative guard'
);

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.replace_own_active_training_cycle_to_draft(
    '89000000-0000-4000-8000-000000000001', 'usuario',
    '82000000-0000-4000-8000-000000000002', '2026-09-01', '2026-10-13'
  )$$,
  '40001',
  'confirmed active training cycle changed',
  'an owner cannot close another owner cycle by expected id'
);
reset role;
select extensions.is(
  (select status from public.training_cycles where id = '82000000-0000-4000-8000-000000000002'),
  'active',
  'BOLA failure leaves the foreign cycle active'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.replace_own_active_training_cycle_to_draft(
    '89000000-0000-4000-8000-000000000002', 'coach',
    '82000000-0000-4000-8000-000000000001', '2026-09-01', '2026-10-13'
  )$$,
  '42501',
  'coach portal membership required',
  'portal scope requires its authoritative membership'
);

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.replace_own_active_training_cycle_to_draft(
    '89000000-0000-4000-8000-000000000003', 'usuario',
    '82000000-0000-4000-8000-000000000003', '2026-09-01', '2026-10-13'
  )$$,
  '55000',
  'active workout must finish before closing the cycle',
  'an in-progress workout blocks manual replacement'
);
reset role;
select extensions.is(
  (select status from public.training_cycles where id = '82000000-0000-4000-8000-000000000003'),
  'active',
  'workout guard rolls the close back safely'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select extensions.is(
  public.replace_own_active_training_cycle_to_draft(
    '89000000-0000-4000-8000-000000000004', 'usuario',
    '82000000-0000-4000-8000-000000000001', '2026-09-01', '2026-10-13'
  )->>'operationKind',
  'draft_duplicate',
  'legacy active cycle prepares a canonical replacement draft'
);
select extensions.is(
  public.replace_own_active_training_cycle_to_draft(
    '89000000-0000-4000-8000-000000000004', 'usuario',
    '82000000-0000-4000-8000-000000000001', '2026-09-01', '2026-10-13'
  )->>'responseKind',
  'prepared_draft',
  'atomic replacement returns the prepared draft in the same response'
);
select extensions.is(
  public.replace_own_active_training_cycle_to_draft(
    '89000000-0000-4000-8000-000000000004', 'usuario',
    '82000000-0000-4000-8000-000000000001', '2026-09-01', '2026-10-13'
  )->'draft'->>'sourceCycleId',
  '82000000-0000-4000-8000-000000000001',
  'inline prepared draft identifies the exact cycle that was closed'
);
select extensions.is(
  public.replace_own_active_training_cycle_to_draft(
    '89000000-0000-4000-8000-000000000004', 'usuario',
    '82000000-0000-4000-8000-000000000001', '2026-09-01', '2026-10-13'
  )->'exerciseSources'->0->>'kind',
  'custom',
  'legacy replacement returns the newly materialized custom source inline'
);
select extensions.is(
  public.replace_own_active_training_cycle_to_draft(
    '89000000-0000-4000-8000-000000000004', 'usuario',
    '82000000-0000-4000-8000-000000000001', '2026-09-01', '2026-10-13'
  )->'exerciseSources'->0->>'name',
  'Remo artesanal con barra',
  'inline custom source preserves its bounded owner-scoped display metadata'
);
select extensions.is(
  public.replace_own_active_training_cycle_to_draft(
    '89000000-0000-4000-8000-000000000004', 'usuario',
    '82000000-0000-4000-8000-000000000001', '2026-09-01', '2026-10-13'
  )::text,
  public.replace_own_active_training_cycle_to_draft(
    '89000000-0000-4000-8000-000000000004', 'usuario',
    '82000000-0000-4000-8000-000000000001', '2026-09-01', '2026-10-13'
  )::text,
  'idempotent replay returns the same complete prepared-draft response'
);
reset role;
select extensions.is(
  (select status from public.training_cycles where id = '82000000-0000-4000-8000-000000000001'),
  'completed',
  'legacy cycle is completed after confirmation'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select extensions.ok(
  public.replace_own_active_training_cycle_to_draft(
    '89000000-0000-4000-8000-000000000004', 'usuario',
    '82000000-0000-4000-8000-000000000001', '2026-09-01', '2026-10-13'
  )->'draft'->'plan'->'days'->0->'exercises'->0->>'customExerciseId' is not null,
  'legacy exercise without catalog becomes an owner-scoped custom identity'
);
select extensions.is(
  public.replace_own_active_training_cycle_to_draft(
    '89000000-0000-4000-8000-000000000004', 'usuario',
    '82000000-0000-4000-8000-000000000001', '2026-09-01', '2026-10-13'
  )->>'operationKind',
  'draft_duplicate',
  'same request is idempotent after the cycle is closed'
);

reset role;
select extensions.is(
  (select count(*)::text from private.training_cycle_operation_receipts
   where request_id = '89000000-0000-4000-8000-000000000004'),
  '1',
  'idempotent replay writes one receipt'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select extensions.throws_ok(
  $$select public.replace_own_active_training_cycle_to_draft(
    '89000000-0000-4000-8000-000000000005', 'usuario',
    '82000000-0000-4000-8000-000000000099', '2026-09-01', '2026-10-13'
  )$$,
  '40001',
  'confirmed active training cycle changed',
  'wrong expected cycle id fails closed'
);
reset role;
select extensions.is(
  (select status from public.training_cycles where id = '82000000-0000-4000-8000-000000000002'),
  'active',
  'wrong expected id preserves canonical active cycle'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select extensions.is(
  public.replace_own_active_training_cycle_to_draft(
    '89000000-0000-4000-8000-000000000006', 'usuario',
    '82000000-0000-4000-8000-000000000002', '2026-09-01', '2026-10-13'
  )->>'operationKind',
  'draft_duplicate',
  'canonical cycle atomically prepares its replacement'
);
reset role;
select extensions.is(
  (select status from public.training_cycles where id = '82000000-0000-4000-8000-000000000002'),
  'completed',
  'canonical cycle is completed'
);
select extensions.is(
  (select state from public.training_cycle_drafts where id = '8b000000-0000-4000-8000-000000000002'),
  'discarded',
  'an incompatible prior remote draft is retired instead of overwritten'
);

do $concurrent_close_setup$
declare
  v_connection text := pg_catalog.format(
    'dbname=%L host=%L port=%s user=postgres password=postgres',
    current_database(),
    pg_catalog.split_part(current_setting('unix_socket_directories'), ',', 1),
    current_setting('port')
  );
begin
  perform extensions.dblink_connect('cycle_close_1', v_connection);
  perform extensions.dblink_connect('cycle_close_2', v_connection);
  perform extensions.dblink_exec(
    'cycle_close_1',
    'begin; set local role authenticated; set local "request.jwt.claim.sub" = ''81000000-0000-4000-8000-000000000004'''
  );
  perform extensions.dblink_exec(
    'cycle_close_2',
    'begin; set local role authenticated; set local "request.jwt.claim.sub" = ''81000000-0000-4000-8000-000000000004'''
  );
  perform extensions.dblink_send_query(
    'cycle_close_1',
    $$select public.replace_own_active_training_cycle_to_draft(
      '89000000-0000-4000-8000-000000000007', 'usuario',
      '82000000-0000-4000-8000-000000000004', '2026-09-01', '2026-10-13'
    )$$
  );
  perform *
  from extensions.dblink_get_result('cycle_close_1') as result(payload jsonb);
  perform *
  from extensions.dblink_get_result('cycle_close_1') as result(payload jsonb);
  perform extensions.dblink_send_query(
    'cycle_close_2',
    $$select public.replace_own_active_training_cycle_to_draft(
      '89000000-0000-4000-8000-000000000007', 'usuario',
      '82000000-0000-4000-8000-000000000004', '2026-09-01', '2026-10-13'
    )$$
  );
end;
$concurrent_close_setup$;
select extensions.is(
  extensions.dblink_is_busy('cycle_close_2'),
  1,
  'concurrent replay waits on the owner/portal transaction lock'
);
do $concurrent_close_finish$
begin
  perform extensions.dblink_exec('cycle_close_1', 'commit');
  perform *
  from extensions.dblink_get_result('cycle_close_2') as result(payload jsonb);
  perform *
  from extensions.dblink_get_result('cycle_close_2') as result(payload jsonb);
  perform extensions.dblink_exec('cycle_close_2', 'commit');
  perform extensions.dblink_disconnect('cycle_close_1');
  perform extensions.dblink_disconnect('cycle_close_2');
end;
$concurrent_close_finish$;

select extensions.is(
  (select status from public.training_cycles where id = '82000000-0000-4000-8000-000000000004'),
  'completed',
  'serialized concurrent close completes the cycle once'
);
select extensions.is(
  (select count(*)::text from private.training_cycle_operation_receipts
   where request_id = '89000000-0000-4000-8000-000000000007'),
  '1',
  'serialized concurrent replay records one receipt'
);

select * from extensions.finish();
rollback;
