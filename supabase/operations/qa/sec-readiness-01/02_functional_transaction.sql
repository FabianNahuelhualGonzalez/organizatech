-- SEC-READINESS-01 - QA functional and malicious-payload probe.
-- Run only with separate QA authorization after the migration postulates pass.
-- Every write, including temporary context mutations, is discarded by ROLLBACK.
-- Never run in Production. The result never prints UUIDs or payloads.

begin;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

create temporary table sec_readiness_01_context (
  slot text primary key,
  user_id uuid not null,
  cycle_id uuid not null,
  cycle_day_id uuid not null,
  training_session_id uuid not null,
  session_created_at timestamptz not null,
  recent_attempts bigint not null
) on commit drop;

create temporary table sec_readiness_01_results (
  check_name text primary key,
  ok boolean not null
) on commit drop;

create temporary table sec_readiness_01_attempts (
  label text primary key,
  workout_attempt_id uuid not null,
  persisted_id uuid not null
) on commit drop;

create temporary table sec_readiness_01_baseline (
  legacy_readiness_rows bigint not null,
  training_session_rows bigint not null,
  exercise_entry_rows bigint not null
) on commit drop;

grant select on table pg_temp.sec_readiness_01_context to authenticated;
grant select, insert on table pg_temp.sec_readiness_01_results to authenticated;
grant select, insert on table pg_temp.sec_readiness_01_attempts to authenticated;

do $setup$
declare
  v_candidate_count integer;
begin
  if pg_catalog.to_regprocedure(
    'public.save_training_workout_readiness_v2(uuid,uuid,uuid,timestamp with time zone,jsonb)'
  ) is null then
    raise exception 'SEC-READINESS-01: falta RPC save esperado';
  end if;

  if pg_catalog.to_regprocedure(
    'public.link_training_workout_readiness_session_v2(uuid,uuid)'
  ) is null then
    raise exception 'SEC-READINESS-01: falta RPC link esperado';
  end if;

  with per_user_candidate as (
    select distinct on (cycle.user_id)
      cycle.user_id,
      cycle.id as cycle_id,
      cycle_day.id as cycle_day_id,
      session.id as training_session_id,
      session.created_at as session_created_at,
      (
        select pg_catalog.count(*)
        from public.training_workout_readiness as readiness
        where readiness.user_id = cycle.user_id
          and readiness.created_at >= pg_catalog.now() - interval '36 hours'
      ) as recent_attempts
    from public.training_cycles as cycle
    join public.training_cycle_days as cycle_day
      on cycle_day.cycle_id = cycle.id
     and cycle_day.user_id = cycle.user_id
     and cycle_day.deleted_at is null
    join public.training_sessions as session
      on session.user_id = cycle.user_id
     and session.cycle_id = cycle.id
     and session.cycle_day_id = cycle_day.id
     and session.deleted_at is null
     and session.created_at >= pg_catalog.now() - interval '35 hours'
     and session.created_at <= pg_catalog.now() + interval '5 minutes'
    left join public.training_workout_readiness as linked_readiness
      on linked_readiness.training_session_id = session.id
    where cycle.status = 'active'
      and cycle.deleted_at is null
      and linked_readiness.id is null
      and (
        select pg_catalog.count(*)
        from public.training_workout_readiness as readiness
        where readiness.user_id = cycle.user_id
          and readiness.created_at >= pg_catalog.now() - interval '36 hours'
      ) < 32
    order by cycle.user_id, session.created_at desc, session.id
  ),
  ranked as (
    select
      candidate.*,
      pg_catalog.row_number() over (order by candidate.user_id) as position
    from per_user_candidate as candidate
  )
  insert into pg_temp.sec_readiness_01_context (
    slot,
    user_id,
    cycle_id,
    cycle_day_id,
    training_session_id,
    session_created_at,
    recent_attempts
  )
  select
    case ranked.position when 1 then 'A' else 'B' end,
    ranked.user_id,
    ranked.cycle_id,
    ranked.cycle_day_id,
    ranked.training_session_id,
    ranked.session_created_at,
    ranked.recent_attempts
  from ranked
  where ranked.position <= 2;

  select pg_catalog.count(*) into v_candidate_count
  from pg_temp.sec_readiness_01_context;

  if v_candidate_count <> 2 then
    raise exception 'SEC-READINESS-01: se requieren dos usuarios QA materiales elegibles';
  end if;

  insert into pg_temp.sec_readiness_01_baseline (
    legacy_readiness_rows,
    training_session_rows,
    exercise_entry_rows
  )
  select
    (select pg_catalog.count(*) from public.training_daily_readiness),
    (select pg_catalog.count(*) from public.training_sessions),
    (select pg_catalog.count(*) from public.exercise_entries);
end;
$setup$;

-- Structural defense: a privileged direct INSERT with an invalid oversized
-- payload must still fail before a row can be created. This probe is rolled back.
do $structural_guard$
declare
  v_context record;
  v_multibyte_payload jsonb := pg_catalog.jsonb_build_object(
    'skipped', true,
    'padding', pg_catalog.repeat('ñ', 600)
  );
begin
  select * into strict v_context
  from pg_temp.sec_readiness_01_context
  where slot = 'A';

  if pg_catalog.length(v_multibyte_payload::pg_catalog.text) >= 1024
    or pg_catalog.octet_length(v_multibyte_payload::pg_catalog.text) <= 1024 then
    raise exception 'multibyte fixture does not discriminate characters from UTF-8 bytes';
  end if;
  insert into pg_temp.sec_readiness_01_results values ('multibyte_payload_bytes_not_characters', true);

  begin
    insert into public.training_workout_readiness (
      user_id,
      workout_attempt_id,
      cycle_id,
      cycle_day_id,
      workout_started_at,
      local_date,
      payload
    )
    values (
      v_context.user_id,
      pg_catalog.gen_random_uuid(),
      v_context.cycle_id,
      v_context.cycle_day_id,
      v_context.session_created_at,
      (v_context.session_created_at at time zone 'America/Santiago')::pg_catalog.date,
      pg_catalog.jsonb_build_object(
        'skipped', true,
        'padding', pg_catalog.repeat('x', 2048)
      )
    );
    raise exception using errcode = 'P0002', message = 'structural oversized payload accepted';
  exception
    when sqlstate '22023' then
      insert into pg_temp.sec_readiness_01_results values ('structural_insert_guard_rejected_oversize', true);
  end;

  begin
    insert into public.training_workout_readiness (
      user_id,
      workout_attempt_id,
      cycle_id,
      cycle_day_id,
      workout_started_at,
      local_date,
      payload
    )
    values (
      v_context.user_id,
      pg_catalog.gen_random_uuid(),
      v_context.cycle_id,
      v_context.cycle_day_id,
      v_context.session_created_at,
      (v_context.session_created_at at time zone 'America/Santiago')::pg_catalog.date,
      v_multibyte_payload
    );
    raise exception using errcode = 'P0002', message = 'structural multibyte oversized payload accepted';
  exception
    when sqlstate '22023' then
      insert into pg_temp.sec_readiness_01_results values ('structural_insert_guard_rejected_multibyte_oversize', true);
  end;
end;
$structural_guard$;

select pg_catalog.set_config('request.jwt.claim.sub', context.user_id::pg_catalog.text, true)
from pg_temp.sec_readiness_01_context as context
where context.slot = 'A';
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $payload_and_quota$
declare
  v_context record;
  v_attempt_id uuid;
  v_first_attempt_id uuid := pg_catalog.gen_random_uuid();
  v_first record;
  v_retry record;
  v_link record;
  v_link_retry record;
  v_recent_count bigint;
  v_remaining integer;
  v_index integer;
  v_multibyte_payload jsonb := pg_catalog.jsonb_build_object(
    'skipped', true,
    'padding', pg_catalog.repeat('ñ', 600)
  );
begin
  select * into strict v_context
  from pg_temp.sec_readiness_01_context
  where slot = 'A';

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      v_context.session_created_at, '[]'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'non-object payload accepted';
  exception when sqlstate '22023' then
    insert into pg_temp.sec_readiness_01_results values ('payload_non_object_rejected', true);
  end;

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      v_context.session_created_at, '{}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'payload without skipped accepted';
  exception when sqlstate '22023' then
    insert into pg_temp.sec_readiness_01_results values ('payload_missing_skipped_rejected', true);
  end;

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      v_context.session_created_at, '{"skipped":"true"}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'string skipped accepted';
  exception when sqlstate '22023' then
    insert into pg_temp.sec_readiness_01_results values ('payload_skipped_wrong_type_rejected', true);
  end;

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      v_context.session_created_at, '{"skipped":null}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'null skipped accepted';
  exception when sqlstate '22023' then
    insert into pg_temp.sec_readiness_01_results values ('payload_skipped_null_rejected', true);
  end;

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      v_context.session_created_at, v_multibyte_payload
    );
    raise exception using errcode = 'P0002', message = 'RPC multibyte oversized payload accepted';
  exception when sqlstate '22023' then
    insert into pg_temp.sec_readiness_01_results values ('payload_multibyte_oversize_rejected', true);
  end;

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      v_context.session_created_at, '{"skipped":true,"extra":1}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'skipped extra key accepted';
  exception when sqlstate '22023' then
    insert into pg_temp.sec_readiness_01_results values ('payload_skipped_extra_rejected', true);
  end;

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      v_context.session_created_at,
      '{"skipped":false,"motivation":4,"hydration":4,"sleep":4,"energy":4,"extra":1}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'full extra key accepted';
  exception when sqlstate '22023' then
    insert into pg_temp.sec_readiness_01_results values ('payload_full_extra_rejected', true);
  end;

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      v_context.session_created_at,
      pg_catalog.jsonb_build_object('skipped', true, 'padding', pg_catalog.repeat('x', 2048))
    );
    raise exception using errcode = 'P0002', message = 'oversized payload accepted';
  exception when sqlstate '22023' then
    insert into pg_temp.sec_readiness_01_results values ('payload_oversize_new_attempt_rejected', true);
  end;

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      v_context.session_created_at, null::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'SQL null payload accepted';
  exception when sqlstate '22023' then
    insert into pg_temp.sec_readiness_01_results values ('payload_sql_null_rejected', true);
  end;

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      v_context.session_created_at, 'null'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'JSON null payload accepted';
  exception when sqlstate '22023' then
    insert into pg_temp.sec_readiness_01_results values ('payload_json_null_rejected', true);
  end;

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      v_context.session_created_at,
      '{"skipped":false,"motivation":"4","hydration":4,"sleep":4,"energy":4}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'wrong score type accepted';
  exception when sqlstate '22023' then
    insert into pg_temp.sec_readiness_01_results values ('payload_wrong_type_rejected', true);
  end;

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      v_context.session_created_at,
      '{"skipped":false,"motivation":null,"hydration":4,"sleep":4,"energy":4}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'null score accepted';
  exception when sqlstate '22023' then
    insert into pg_temp.sec_readiness_01_results values ('payload_null_score_rejected', true);
  end;

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      v_context.session_created_at,
      '{"skipped":false,"motivation":4.5,"hydration":4,"sleep":4,"energy":4}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'fractional score accepted';
  exception when sqlstate '22023' then
    insert into pg_temp.sec_readiness_01_results values ('payload_fraction_rejected', true);
  end;

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      v_context.session_created_at,
      '{"skipped":false,"motivation":0,"hydration":4,"sleep":4,"energy":4}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'score below range accepted';
  exception when sqlstate '22023' then
    insert into pg_temp.sec_readiness_01_results values ('payload_below_range_rejected', true);
  end;

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      v_context.session_created_at,
      '{"skipped":false,"motivation":8,"hydration":4,"sleep":4,"energy":4}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'score above range accepted';
  exception when sqlstate '22023' then
    insert into pg_temp.sec_readiness_01_results values ('payload_above_range_rejected', true);
  end;

  select * into strict v_first
  from public.save_training_workout_readiness_v2(
    v_first_attempt_id,
    v_context.cycle_id,
    v_context.cycle_day_id,
    v_context.session_created_at,
    '{"skipped":false,"motivation":4,"hydration":5,"sleep":6,"energy":7}'::pg_catalog.jsonb
  );

  if v_first.context_mismatch is not false or v_first.user_id <> v_context.user_id then
    raise exception 'valid full payload did not persist with the expected owner';
  end if;
  insert into pg_temp.sec_readiness_01_attempts values ('A_FIRST', v_first_attempt_id, v_first.id);
  insert into pg_temp.sec_readiness_01_results values ('payload_full_valid_preserved', true);

  begin
    perform public.save_training_workout_readiness_v2(
      v_first_attempt_id, v_context.cycle_id, v_context.cycle_day_id,
      v_context.session_created_at,
      pg_catalog.jsonb_build_object('skipped', true, 'padding', pg_catalog.repeat('x', 2048))
    );
    raise exception using errcode = 'P0002', message = 'oversized existing attempt accepted';
  exception when sqlstate '22023' then
    insert into pg_temp.sec_readiness_01_results values ('payload_oversize_existing_attempt_rejected', true);
  end;

  v_remaining := 31 - v_context.recent_attempts;
  for v_index in 1..v_remaining loop
    v_attempt_id := pg_catalog.gen_random_uuid();
    perform public.save_training_workout_readiness_v2(
      v_attempt_id,
      v_context.cycle_id,
      v_context.cycle_day_id,
      pg_catalog.now(),
      '{"skipped":true}'::pg_catalog.jsonb
    );
  end loop;

  select pg_catalog.count(*) into v_recent_count
  from public.training_workout_readiness as readiness
  where readiness.user_id = v_context.user_id
    and readiness.created_at >= pg_catalog.now() - interval '36 hours';

  if v_recent_count <> 32 then
    raise exception 'attempt 32 was not the exact allowed boundary: %', v_recent_count;
  end if;
  insert into pg_temp.sec_readiness_01_results values ('attempt_32_allowed', true);

  select * into strict v_retry
  from public.save_training_workout_readiness_v2(
    v_first_attempt_id,
    v_context.cycle_id,
    v_context.cycle_day_id,
    v_context.session_created_at,
    '{"skipped":false,"motivation":4,"hydration":5,"sleep":6,"energy":7}'::pg_catalog.jsonb
  );

  if v_retry.id <> v_first.id or v_retry.context_mismatch is not false then
    raise exception 'retry at quota was not idempotent';
  end if;
  insert into pg_temp.sec_readiness_01_results values ('retry_at_quota_idempotent', true);

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      pg_catalog.now(), '{"skipped":true}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'attempt 33 accepted';
  exception when sqlstate '54000' then
    insert into pg_temp.sec_readiness_01_results values ('attempt_33_rejected', true);
  end;

  if not exists (
    select 1
    from pg_catalog.pg_locks as lock
    where lock.pid = pg_catalog.pg_backend_pid()
      and lock.locktype = 'advisory'
      and lock.granted
  ) then
    raise exception 'user advisory transaction lock is not held';
  end if;
  insert into pg_temp.sec_readiness_01_results values ('advisory_xact_lock_held', true);

  select * into strict v_link
  from public.link_training_workout_readiness_session_v2(
    v_first_attempt_id,
    v_context.training_session_id
  );
  if v_link.linked is not true or v_link.already_linked is not false then
    raise exception 'first link call failed';
  end if;
  insert into pg_temp.sec_readiness_01_results values ('link_first_call_operational', true);

  select * into strict v_link_retry
  from public.link_training_workout_readiness_session_v2(
    v_first_attempt_id,
    v_context.training_session_id
  );
  if v_link_retry.id <> v_link.id
    or v_link_retry.linked is not true
    or v_link_retry.already_linked is not true then
    raise exception 'link retry was not idempotent';
  end if;
  insert into pg_temp.sec_readiness_01_results values ('link_retry_idempotent', true);

  begin
    insert into public.training_workout_readiness (
      user_id, workout_attempt_id, cycle_id, cycle_day_id,
      workout_started_at, local_date, payload
    ) values (
      v_context.user_id, pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      pg_catalog.now(), (pg_catalog.now() at time zone 'America/Santiago')::pg_catalog.date,
      '{"skipped":true}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'authenticated direct INSERT accepted';
  exception when sqlstate '42501' then
    insert into pg_temp.sec_readiness_01_results values ('direct_insert_denied', true);
  end;

  begin
    update public.training_workout_readiness
    set payload = payload
    where user_id = v_context.user_id and workout_attempt_id = v_first_attempt_id;
    raise exception using errcode = 'P0002', message = 'authenticated direct UPDATE accepted';
  exception when sqlstate '42501' then
    insert into pg_temp.sec_readiness_01_results values ('direct_update_denied', true);
  end;

  begin
    delete from public.training_workout_readiness
    where user_id = v_context.user_id and workout_attempt_id = v_first_attempt_id;
    raise exception using errcode = 'P0002', message = 'authenticated direct DELETE accepted';
  exception when sqlstate '42501' then
    insert into pg_temp.sec_readiness_01_results values ('direct_delete_denied', true);
  end;
end;
$payload_and_quota$;

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', context.user_id::pg_catalog.text, true)
from pg_temp.sec_readiness_01_context as context
where context.slot = 'B';
set local role authenticated;

do $user_b$
declare
  v_context record;
  v_shared_attempt uuid;
  v_b_row record;
  v_visible bigint;
begin
  select * into strict v_context
  from pg_temp.sec_readiness_01_context
  where slot = 'B';
  select workout_attempt_id into strict v_shared_attempt
  from pg_temp.sec_readiness_01_attempts
  where label = 'A_FIRST';

  select * into strict v_b_row
  from public.save_training_workout_readiness_v2(
    v_shared_attempt,
    v_context.cycle_id,
    v_context.cycle_day_id,
    v_context.session_created_at,
    '{"skipped":true}'::pg_catalog.jsonb
  );
  if v_b_row.user_id <> v_context.user_id or v_b_row.context_mismatch is not false then
    raise exception 'user B save did not preserve B ownership';
  end if;
  insert into pg_temp.sec_readiness_01_attempts values ('B_SHARED', v_shared_attempt, v_b_row.id);
  insert into pg_temp.sec_readiness_01_results values ('user_b_legitimate_payload_preserved', true);

  select pg_catalog.count(*) into v_visible
  from public.training_workout_readiness
  where workout_attempt_id = v_shared_attempt;
  if v_visible <> 1 then
    raise exception 'user B can see another identity for shared attempt';
  end if;
  insert into pg_temp.sec_readiness_01_results values ('user_b_cannot_see_user_a', true);
end;
$user_b$;

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', context.user_id::pg_catalog.text, true)
from pg_temp.sec_readiness_01_context as context
where context.slot = 'A';
set local role authenticated;

do $user_a_isolation$
declare
  v_shared_attempt uuid;
  v_visible bigint;
begin
  select workout_attempt_id into strict v_shared_attempt
  from pg_temp.sec_readiness_01_attempts
  where label = 'A_FIRST';

  select pg_catalog.count(*) into v_visible
  from public.training_workout_readiness
  where workout_attempt_id = v_shared_attempt;
  if v_visible <> 1 then
    raise exception 'user A can see another identity for shared attempt';
  end if;
  insert into pg_temp.sec_readiness_01_results values ('user_a_cannot_see_user_b', true);
end;
$user_a_isolation$;

reset role;

do $lock_keys$
declare
  v_distinct_locks bigint;
begin
  select pg_catalog.count(distinct (lock.classid, lock.objid))
  into v_distinct_locks
  from pg_catalog.pg_locks as lock
  where lock.pid = pg_catalog.pg_backend_pid()
    and lock.locktype = 'advisory'
    and lock.granted;

  if v_distinct_locks < 2 then
    raise exception 'A and B did not retain distinct advisory lock keys';
  end if;
  insert into pg_temp.sec_readiness_01_results values ('per_user_lock_keys_distinct', true);
end;
$lock_keys$;

select pg_catalog.set_config('request.jwt.claim.sub', context.user_id::pg_catalog.text, true)
from pg_temp.sec_readiness_01_context as context
where context.slot = 'A';
set local role authenticated;

do $foreign_context$
declare
  v_a record;
  v_b record;
begin
  select * into strict v_a from pg_temp.sec_readiness_01_context where slot = 'A';
  select * into strict v_b from pg_temp.sec_readiness_01_context where slot = 'B';

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_b.cycle_id, v_b.cycle_day_id,
      pg_catalog.now(), '{"skipped":true}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'foreign cycle accepted';
  exception when sqlstate 'P0001' then
    insert into pg_temp.sec_readiness_01_results values ('foreign_cycle_rejected', true);
  end;

  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_a.cycle_id, v_b.cycle_day_id,
      pg_catalog.now(), '{"skipped":true}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'foreign day accepted';
  exception when sqlstate 'P0001' then
    insert into pg_temp.sec_readiness_01_results values ('foreign_day_rejected', true);
  end;
end;
$foreign_context$;

reset role;
update public.training_cycles as cycle
set status = 'completed'
from pg_temp.sec_readiness_01_context as context
where context.slot = 'A' and cycle.id = context.cycle_id;
set local role authenticated;

do $inactive_cycle$
declare v_context record;
begin
  select * into strict v_context from pg_temp.sec_readiness_01_context where slot = 'A';
  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      pg_catalog.now(), '{"skipped":true}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'inactive cycle accepted';
  exception when sqlstate 'P0001' then
    insert into pg_temp.sec_readiness_01_results values ('inactive_cycle_rejected', true);
  end;
end;
$inactive_cycle$;

reset role;
update public.training_cycles as cycle
set status = 'active'
from pg_temp.sec_readiness_01_context as context
where context.slot = 'A' and cycle.id = context.cycle_id;

update public.training_cycles as cycle
set deleted_at = pg_catalog.now()
from pg_temp.sec_readiness_01_context as context
where context.slot = 'A' and cycle.id = context.cycle_id;
set local role authenticated;

do $deleted_cycle$
declare v_context record;
begin
  select * into strict v_context from pg_temp.sec_readiness_01_context where slot = 'A';
  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      pg_catalog.now(), '{"skipped":true}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'deleted cycle accepted';
  exception when sqlstate 'P0001' then
    insert into pg_temp.sec_readiness_01_results values ('deleted_cycle_rejected', true);
  end;
end;
$deleted_cycle$;

reset role;
update public.training_cycles as cycle
set deleted_at = null
from pg_temp.sec_readiness_01_context as context
where context.slot = 'A' and cycle.id = context.cycle_id;

update public.training_cycle_days as cycle_day
set deleted_at = pg_catalog.now()
from pg_temp.sec_readiness_01_context as context
where context.slot = 'A' and cycle_day.id = context.cycle_day_id;
set local role authenticated;

do $deleted_day$
declare v_context record;
begin
  select * into strict v_context from pg_temp.sec_readiness_01_context where slot = 'A';
  begin
    perform public.save_training_workout_readiness_v2(
      pg_catalog.gen_random_uuid(), v_context.cycle_id, v_context.cycle_day_id,
      pg_catalog.now(), '{"skipped":true}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0002', message = 'deleted day accepted';
  exception when sqlstate 'P0001' then
    insert into pg_temp.sec_readiness_01_results values ('deleted_day_rejected', true);
  end;
end;
$deleted_day$;

reset role;
update public.training_cycle_days as cycle_day
set deleted_at = null
from pg_temp.sec_readiness_01_context as context
where context.slot = 'A' and cycle_day.id = context.cycle_day_id;

do $final_checks$
declare
  v_baseline record;
  v_legacy_after bigint;
  v_sessions_after bigint;
  v_entries_after bigint;
begin
  select * into strict v_baseline from pg_temp.sec_readiness_01_baseline;
  select pg_catalog.count(*) into v_legacy_after from public.training_daily_readiness;
  select pg_catalog.count(*) into v_sessions_after from public.training_sessions;
  select pg_catalog.count(*) into v_entries_after from public.exercise_entries;

  if v_legacy_after <> v_baseline.legacy_readiness_rows then
    raise exception 'legacy readiness row count changed';
  end if;
  insert into pg_temp.sec_readiness_01_results values ('legacy_count_unchanged', true);

  if v_sessions_after <> v_baseline.training_session_rows then
    raise exception 'training_sessions row count changed';
  end if;
  insert into pg_temp.sec_readiness_01_results values ('training_sessions_unchanged', true);

  if v_entries_after <> v_baseline.exercise_entry_rows then
    raise exception 'exercise_entries row count changed';
  end if;
  insert into pg_temp.sec_readiness_01_results values ('exercise_entries_unchanged', true);
end;
$final_checks$;

select
  case
    when pg_catalog.bool_and(results.ok) then 'SEC_READINESS_01_FUNCTIONAL_VERIFIED'
    else 'SEC_READINESS_01_FUNCTIONAL_FAILED'
  end as verdict,
  pg_catalog.jsonb_object_agg(results.check_name, results.ok order by results.check_name) as checks,
  pg_catalog.jsonb_build_object(
    'checks_run', pg_catalog.count(*),
    'temporary_attempt_rows', (
      select pg_catalog.count(*)
      from public.training_workout_readiness as readiness
      join pg_temp.sec_readiness_01_context as context
        on context.user_id = readiness.user_id
      where readiness.created_at >= pg_catalog.now() - interval '36 hours'
    )
  ) as counts
from pg_temp.sec_readiness_01_results as results;

rollback;
