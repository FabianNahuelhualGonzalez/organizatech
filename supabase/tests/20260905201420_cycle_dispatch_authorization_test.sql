-- LOCAL ONLY: isolated embedded fixture. No hosted Vault or provider is used.
begin;
select extensions.plan(28);
create schema if not exists vault;
create table vault.decrypted_secrets (name text, decrypted_secret text, created_at timestamptz);
insert into vault.decrypted_secrets values (
  'organizatech_training_cycle_lifecycle_rpc_secret',
  'local-dispatch-test-capability-not-a-secret', now()
);
create temp table dispatch_cases (label text primary key, delivery_id uuid, attempt_token uuid);
create function pg_temp.dispatch_case(p_label text, p_cycle_id uuid, p_event text)
returns void language plpgsql as $fixture$
declare
  v_notification uuid;
  v_delivery uuid;
  v_attempt uuid := gen_random_uuid();
begin
  select id into strict v_notification
  from public.training_cycle_notifications
  where cycle_id = p_cycle_id and event_kind = p_event and superseded_at is null;
  insert into private.training_cycle_notification_deliveries (
    notification_id, user_id, portal_scope, cycle_id, idempotency_key,
    status, attempt_count, attempt_token, claimed_at
  ) select id, user_id, portal_scope, cycle_id, gen_random_uuid(), 'sending', 1, v_attempt, now()
    from public.training_cycle_notifications where id = v_notification
  returning id into v_delivery;
  insert into dispatch_cases values (p_label, v_delivery, v_attempt);
end;
$fixture$;
create function pg_temp.authorize(p_label text)
returns boolean language sql as $fixture$
  select public.authorize_training_cycle_lifecycle_delivery(
    'local-dispatch-test-capability-not-a-secret', delivery_id, attempt_token
  ) from dispatch_cases where label = p_label
$fixture$;

select extensions.ok(has_function_privilege('anon',
  'public.authorize_training_cycle_lifecycle_delivery(text,uuid,uuid)', 'EXECUTE'),
  'system anon boundary is available with separate capability');
select extensions.ok(not has_function_privilege('authenticated',
  'public.authorize_training_cycle_lifecycle_delivery(text,uuid,uuid)', 'EXECUTE'),
  'authenticated cannot invoke system dispatch');
select extensions.ok(not has_function_privilege('service_role',
  'public.authorize_training_cycle_lifecycle_delivery(text,uuid,uuid)', 'EXECUTE'),
  'service_role cannot invoke system dispatch');

select pg_temp.dispatch_case('t0', '92000000-0000-4000-8000-000000000003', 'expires_t0');
select pg_temp.dispatch_case('extend-loses', '92000000-0000-4000-8000-000000000003', 'expires_t3');
select extensions.throws_ok(
  $$select public.authorize_training_cycle_lifecycle_delivery(
    'invalid-capability', delivery_id, attempt_token) from dispatch_cases where label = 't0'$$,
  '42501', 'training cycle dispatch unauthorized', 'invalid capability fails closed'
);
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok($$select pg_temp.authorize('t0')$$,
  '42501', 'training cycle dispatch unauthorized', 'a user JWT cannot use system dispatch');
select set_config('request.jwt.claim.sub', '', true);
select extensions.is(public.authorize_training_cycle_lifecycle_delivery(
  'local-dispatch-test-capability-not-a-secret',
  (select delivery_id from dispatch_cases where label = 't0'), gen_random_uuid()
), false, 'old or foreign attempt token cannot authorize');
select extensions.is(public.authorize_training_cycle_lifecycle_delivery(
  'local-dispatch-test-capability-not-a-secret', gen_random_uuid(), gen_random_uuid()
), false, 'unknown delivery cannot authorize');
select extensions.is(pg_temp.authorize('t0'), true, 'active T0 authorizes before extension');
select extensions.is(pg_temp.authorize('t0'), false, 'same attempt cannot dispatch twice');
select extensions.is(public.complete_training_cycle_lifecycle_delivery(
  'local-dispatch-test-capability-not-a-secret', delivery_id, attempt_token, 'sent', 'local-message'
), true, 'authorized delivery completes terminally')
from dispatch_cases where label = 't0';
select extensions.is(public.complete_training_cycle_lifecycle_delivery(
  'local-dispatch-test-capability-not-a-secret', delivery_id, attempt_token, 'sent', 'local-message'
), false, 'completion retry does not rewrite terminal state')
from dispatch_cases where label = 't0';

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
select extensions.lives_ok(
  $$select public.extend_own_active_training_cycle(
    '98000000-0000-4000-8000-000000000001', 'usuario',
    '92000000-0000-4000-8000-000000000003', 1, '2026-10-28'
  )$$, 'extension proceeds after authorization without a network lock'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select extensions.is(pg_temp.authorize('extend-loses'), false,
  'extension committed before authorization suppresses the old claim');
select extensions.is(
  (select status from private.training_cycle_notification_deliveries
   where id = (select delivery_id from dispatch_cases where label = 'extend-loses')),
  'rejected', 'stale claim is terminally rejected'
);

select pg_temp.dispatch_case('replace-loses', '92000000-0000-4000-8000-000000000003', 'expires_t1');
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
select extensions.lives_ok(
  $$select public.replace_own_active_training_cycle_to_draft(
    '98000000-0000-4000-8000-000000000002', 'usuario',
    '92000000-0000-4000-8000-000000000003', '2026-10-29', '2026-11-25'
  )$$, 'replacement proceeds with a claimed but unauthorized old email'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select extensions.is(pg_temp.authorize('replace-loses'), false,
  'replacement committed before authorization suppresses the old claim');

-- The historical closed owner has an independent portal lock and valid T+1.
insert into public.training_cycle_notifications (
  user_id, portal_scope, cycle_id, end_date_snapshot, event_kind, scheduled_on, title, body
)
select user_id, portal_scope, id, planned_end_date, 'closed_t1', planned_end_date + 1,
  'Ciclo finalizado', 'Tu ciclo finalizó.'
from public.training_cycles where user_id = '91000000-0000-4000-8000-000000000004'
on conflict (cycle_id, end_date_snapshot, event_kind) do update set superseded_at = null;
select pg_temp.dispatch_case('closed', id, 'closed_t1')
from public.training_cycles where user_id = '91000000-0000-4000-8000-000000000004';
select extensions.is(pg_temp.authorize('closed'), true,
  'closed T+1 for another owner remains eligible independently');

-- Snapshot divergence is rejected even if an old notification lacks its marker.
update public.training_cycle_notifications
set superseded_at = null where id = (
  select notification_id from private.training_cycle_notification_deliveries
  where id = (select delivery_id from dispatch_cases where label = 'extend-loses')
);
update private.training_cycle_notification_deliveries
set status = 'sending', provider_error_code = null,
  attempt_token = (select attempt_token from dispatch_cases where label = 'extend-loses')
where id = (select delivery_id from dispatch_cases where label = 'extend-loses');
select extensions.is(pg_temp.authorize('extend-loses'), false,
  'divergent end date and inactive state fail closed without superseded marker');

-- Real two-connection interleavings. All state is in the disposable local DB.
-- Commit fixtures so the two independent connections can observe them.
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select public.adapt_own_active_legacy_training_cycle(
  '98000000-0000-4000-8000-000000000003', 'usuario',
  '92000000-0000-4000-8000-000000000001'
);
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.dispatch_case('concurrent-extend', '92000000-0000-4000-8000-000000000001', 'expires_t3');
commit;
begin;

create function pg_temp.wait_for_advisory(p_application text)
returns boolean language plpgsql as $fixture$
begin
  for n in 1..100 loop
    if exists (select 1 from pg_stat_activity
      where application_name = p_application and wait_event = 'advisory') then
      return true;
    end if;
    perform pg_sleep(0.005);
    perform pg_stat_clear_snapshot();
  end loop;
  return false;
end;
$fixture$;
do $connections$
declare
  v_connection text := format(
    'dbname=%L host=%L port=%s user=postgres password=postgres',
    current_database(), split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port')
  );
  v_case record;
begin
  perform extensions.dblink_connect('dispatch_a', v_connection || ' application_name=dispatch_a');
  perform extensions.dblink_connect('dispatch_b', v_connection || ' application_name=dispatch_b');
  perform extensions.dblink_exec('dispatch_a',
    'begin; set local role authenticated; set local "request.jwt.claim.sub" = ''91000000-0000-4000-8000-000000000001''');
  perform * from extensions.dblink('dispatch_a',
    $$select public.extend_own_active_training_cycle(
      '98000000-0000-4000-8000-000000000004', 'usuario',
      '92000000-0000-4000-8000-000000000001', 1, '2026-10-28'
    )$$) as response(payload jsonb);
  perform extensions.dblink_exec('dispatch_b', 'begin; set local role anon');
  select * into strict v_case from dispatch_cases where label = 'concurrent-extend';
  perform extensions.dblink_send_query('dispatch_b', format(
    'select public.authorize_training_cycle_lifecycle_delivery(%L,%L,%L)',
    'local-dispatch-test-capability-not-a-secret', v_case.delivery_id, v_case.attempt_token
  ));
end;
$connections$;
select extensions.ok(pg_temp.wait_for_advisory('dispatch_b'),
  'authorization really waits while extension owns the portal lock');
select extensions.dblink_exec('dispatch_a', 'commit');
select extensions.is(payload, false, 'waiting authorization sees committed extension and denies')
from extensions.dblink_get_result('dispatch_b') as response(payload boolean);
select * from extensions.dblink_get_result('dispatch_b') as response(payload boolean);
select extensions.dblink_exec('dispatch_b', 'commit');

select pg_temp.dispatch_case('concurrent-authorize', '92000000-0000-4000-8000-000000000001', 'expires_t1');
commit;
begin;
do $authorization_first$
declare v_case record;
begin
  perform extensions.dblink_exec('dispatch_a', 'begin; set local role anon');
  select * into strict v_case from dispatch_cases where label = 'concurrent-authorize';
  perform * from extensions.dblink('dispatch_a', format(
    'select public.authorize_training_cycle_lifecycle_delivery(%L,%L,%L)',
    'local-dispatch-test-capability-not-a-secret', v_case.delivery_id, v_case.attempt_token
  )) as response(payload boolean);
  perform extensions.dblink_exec('dispatch_b',
    'begin; set local role authenticated; set local "request.jwt.claim.sub" = ''91000000-0000-4000-8000-000000000001''');
  perform extensions.dblink_send_query('dispatch_b',
    $$select public.extend_own_active_training_cycle(
      '98000000-0000-4000-8000-000000000005', 'usuario',
      '92000000-0000-4000-8000-000000000001', 2, '2026-11-28'
    )$$);
end;
$authorization_first$;
select extensions.ok(pg_temp.wait_for_advisory('dispatch_b'),
  'extension really waits only for the authorization transaction');
select extensions.dblink_exec('dispatch_a', 'commit');
select extensions.is(payload->>'operationKind', 'cycle_extend',
  'extension proceeds after authorization commit without waiting for provider I/O')
from extensions.dblink_get_result('dispatch_b') as response(payload jsonb);
select * from extensions.dblink_get_result('dispatch_b') as response(payload jsonb);
select extensions.dblink_exec('dispatch_b', 'commit');
select extensions.dblink_disconnect('dispatch_a');
select extensions.dblink_disconnect('dispatch_b');

select pg_temp.dispatch_case('retry', '92000000-0000-4000-8000-000000000001', 'expires_t1');
select extensions.is(pg_temp.authorize('retry'), true, 'first retryable attempt obtains authorization');
select extensions.is(public.complete_training_cycle_lifecycle_delivery(
  'local-dispatch-test-capability-not-a-secret', delivery_id, attempt_token, 'failed', null, 'rate_limited'
), true, 'known provider failure remains retryable')
from dispatch_cases where label = 'retry';
update private.training_cycle_notification_deliveries
set updated_at = now() - interval '10 minutes'
where id = (select delivery_id from dispatch_cases where label = 'retry');
create temp table retried_dispatch as
select * from public.claim_due_training_cycle_lifecycle_deliveries(
  'local-dispatch-test-capability-not-a-secret', 25
);
select extensions.ok(
  (select newer.attempt_token <> older.attempt_token
   from retried_dispatch newer join dispatch_cases older on older.delivery_id = newer.delivery_id
   where older.label = 'retry'),
  'real claim retry issues token B rather than reusing token A'
);
select extensions.is(pg_temp.authorize('retry'), false, 'token A cannot authorize the retried claim');
select extensions.is(public.authorize_training_cycle_lifecycle_delivery(
  'local-dispatch-test-capability-not-a-secret', newer.delivery_id, newer.attempt_token
), true, 'token B authorizes once after a known failed attempt')
from retried_dispatch newer join dispatch_cases older on older.delivery_id = newer.delivery_id
where older.label = 'retry';
select extensions.is(public.authorize_training_cycle_lifecycle_delivery(
  'local-dispatch-test-capability-not-a-secret', newer.delivery_id, newer.attempt_token
), false, 'token B cannot authorize a duplicate provider send')
from retried_dispatch newer join dispatch_cases older on older.delivery_id = newer.delivery_id
where older.label = 'retry';

select * from extensions.finish();
rollback;
