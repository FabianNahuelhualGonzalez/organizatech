-- ISOLATED SYNTHETIC DATABASE ONLY. Executed by the companion local runner.
-- Every fixture and helper below is rolled back. No pgTAP/remote prerequisite.
begin;
create function pg_temp.check_true(p_value boolean, p_label text) returns void
language plpgsql as $$ begin
  if p_value is distinct from true then raise exception 'assertion failed: %', p_label; end if;
end $$;
create function pg_temp.expect_error(p_sql text, p_code text, p_label text) returns void
language plpgsql as $$ declare v_failed boolean := false; begin
  begin execute p_sql;
  exception when others then
    if sqlstate <> p_code then raise exception 'wrong SQLSTATE: %', p_label; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'expected rejection: %', p_label; end if;
end $$;

do $$
declare
  v_table text; v_role text; v_fn record;
  v_read text := 'select public.read_own_coach_invitation(null)';
begin
  foreach v_table in array array['coach_invitations', 'coach_invitation_operations', 'coach_relationship_episodes'] loop
    perform pg_temp.check_true((select relrowsecurity and relforcerowsecurity from pg_class
      where oid = ('private.' || v_table)::regclass), 'ENABLE/FORCE RLS');
    perform pg_temp.check_true(not exists(select 1 from pg_policy where polrelid = ('private.' || v_table)::regclass), 'default deny policies');
    foreach v_role in array array['anon', 'authenticated'] loop
      perform pg_temp.check_true(not has_table_privilege(v_role, 'private.' || v_table,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'no direct table privileges');
    end loop;
  end loop;
  for v_fn in select p.oid, p.prosecdef, p.proconfig, p.proacl, p.proowner, p.pronamespace
    from pg_proc p where p.proname in (
      'create_own_coach_invitation', 'resend_own_coach_invitation', 'regenerate_own_coach_invitation',
      'cancel_own_coach_invitation', 'revoke_own_coach_relationship', 'read_own_coach_invitation',
      'read_own_coach_invitation_operation', 'read_own_coach_relationship', 'lock_coach_invitation_owner',
      'new_coach_invitation_code', 'coach_invitation_view', 'coach_invitation_operation_view', 'mutate_coach_invitation'
    ) loop
    perform pg_temp.check_true(v_fn.proconfig = array['search_path=""'], 'pinned empty search_path');
    perform pg_temp.check_true(not exists(select 1 from aclexplode(coalesce(v_fn.proacl, acldefault('f',v_fn.proowner)))
      where grantee = 0 and privilege_type = 'EXECUTE'), 'no PUBLIC execute');
    perform pg_temp.check_true(not has_function_privilege('anon',v_fn.oid,'EXECUTE'), 'no anon execute');
    perform pg_temp.check_true(has_function_privilege('authenticated',v_fn.oid,'EXECUTE') =
      (v_fn.pronamespace = 'public'::regnamespace), 'only public narrow wrappers callable');
    perform pg_temp.check_true(v_fn.prosecdef = (v_fn.pronamespace = 'public'::regnamespace), 'definer only boundary');
  end loop;
  perform pg_temp.check_true(not exists(select 1 from pg_proc where pronamespace = 'public'::regnamespace
    and proname ~ 'accept.*coach|link.*coach'), 'no acceptance/linking endpoint');
  set local role anon;
  perform pg_temp.expect_error(v_read,'42501','anon read');
  perform pg_temp.expect_error('select public.create_own_coach_invitation(''a@example.test'',gen_random_uuid())','42501','anon write');
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','','true');
  perform pg_temp.expect_error(v_read,'42501','no identity');
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
  perform pg_temp.expect_error(v_read,'42501','student without Coach');
  perform pg_temp.expect_error('select public.revoke_own_coach_relationship(null,gen_random_uuid())','42501','student revoke');
  reset role;
end $$;

do $$
declare
  v_request uuid := gen_random_uuid(); v_id uuid; v_new_id uuid; v_result jsonb;
  v_detail jsonb; v_old_code text; v_old_expiry text; v_start timestamptz;
  v_resend uuid := gen_random_uuid(); v_regenerate uuid := gen_random_uuid();
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_other uuid := '10000000-0000-4000-8000-000000000002';
  v_missing uuid := gen_random_uuid();
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform pg_temp.expect_error('select public.create_own_coach_invitation(null,gen_random_uuid())','22023','null email');
  perform pg_temp.expect_error('select public.create_own_coach_invitation(''a@@example.test'',gen_random_uuid())','22023','email structure');
  perform pg_temp.expect_error('select public.create_own_coach_invitation(repeat(''a'',321),gen_random_uuid())','22023','email bounds');
  perform pg_temp.expect_error('select public.create_own_coach_invitation(''a@example.test'',null)','22023','null request');
  perform pg_temp.expect_error('select public.create_own_coach_invitation(p_recipient_email=>''a@example.test'',p_request_id=>gen_random_uuid(),p_owner_id=>gen_random_uuid())','42883','no ownership argument');
  perform pg_temp.expect_error('select private.new_coach_invitation_code()','42501','private helper blocked');
  perform pg_temp.expect_error('select * from private.coach_invitations','42501','private table blocked');
  perform pg_temp.expect_error('insert into private.coach_relationship_episodes default values','42501','cannot create episode');
  v_result := public.create_own_coach_invitation(' Synthetic.Person@Example.Test ',v_request);
  v_id := (v_result#>>'{operation,invitationId}')::uuid;
  perform pg_temp.check_true(v_result->>'status' = 'recorded' and v_result#>>'{operation,state}' = 'reserved','reservation only');
  perform pg_temp.check_true(not (v_result ? 'code') and not (v_result->'operation' ? 'payload'),'no code or payload in operation');
  v_detail := public.read_own_coach_invitation(v_id);
  v_old_code := v_detail->>'code'; v_old_expiry := v_detail->>'expiresAt';
  perform pg_temp.check_true(v_detail->>'recipientEmail' = 'synthetic.person@example.test','normalized email');
  perform pg_temp.check_true(v_old_code ~ '^([ABCDEFGHJKLMNPQRSTUVWXYZ]{2}[23456789]-){2}[ABCDEFGHJKLMNPQRSTUVWXYZ]{2}[23456789]$','code format');
  perform pg_temp.check_true((v_old_expiry)::timestamptz - (v_detail->>'issuedAt')::timestamptz = interval '168 hours','seven exact days');
  perform pg_temp.check_true(public.create_own_coach_invitation('synthetic.person@example.test',v_request)->'operation' = v_result->'operation','normalized retry idempotent');
  v_new_id := gen_random_uuid();
  perform pg_temp.expect_error(format('select public.create_own_coach_invitation('' SYNTHETIC.PERSON@EXAMPLE.TEST '',%L)',v_new_id),'55000','different request cannot duplicate own pending recipient');
  perform pg_temp.check_true(public.read_own_coach_invitation_operation(v_new_id) is null,'rejected pending duplicate consumes no quota');
  perform pg_temp.expect_error(format('select public.create_own_coach_invitation(''changed@example.test'',%L)',v_request),'22023','request payload conflict');
  perform pg_temp.expect_error(format('select public.cancel_own_coach_invitation(%L,%L)',v_id,v_request),'22023','request action conflict');
  perform pg_temp.check_true(public.read_own_coach_invitation_operation(v_request) = v_result->'operation','timeout reconciles persisted operation');
  perform pg_temp.check_true(public.read_own_coach_invitation_operation(v_missing) is null,'unknown request no receipt');
  perform pg_temp.check_true(public.resend_own_coach_invitation(v_id,v_resend)->>'status' = 'rate_limited','initial 60 second cooldown');
  perform pg_temp.expect_error(format('select public.regenerate_own_coach_invitation(%L,gen_random_uuid())',v_id),'55000','cannot regenerate pending');

  perform set_config('request.jwt.claim.sub',v_other::text,true);
  perform pg_temp.expect_error(format('select public.read_own_coach_invitation(%L)',v_id),'P0002','cross Coach read');
  perform pg_temp.expect_error(format('select public.resend_own_coach_invitation(%L,gen_random_uuid())',v_id),'P0002','cross Coach resend');
  perform pg_temp.expect_error(format('select public.cancel_own_coach_invitation(%L,gen_random_uuid())',v_id),'P0002','cross Coach cancel');
  perform pg_temp.expect_error(format('select public.regenerate_own_coach_invitation(%L,gen_random_uuid())',v_id),'P0002','cross Coach regenerate');
  perform pg_temp.check_true(public.read_own_coach_invitation_operation(v_request) is null,'cross Coach operation hidden');
  -- Same address at another Coach behaves like any address. No global-account lookup.
  v_result := public.create_own_coach_invitation('synthetic.person@example.test',v_request);
  perform pg_temp.check_true(v_result->>'status' = 'recorded','same email and request id independent Coach');
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  reset role;
  perform pg_temp.check_true((select count(*) from private.coach_relationship_episodes)=0,'inviting never links');
  -- Exact expiry boundary uses the same projection as the RPC without waiting seven days.
  perform pg_temp.check_true(private.coach_invitation_view(v_owner,v_id,v_old_expiry::timestamptz)->>'code' is null,'expiry exact boundary no code');
  perform pg_temp.check_true(private.coach_invitation_view(v_owner,v_id,v_old_expiry::timestamptz)->>'state' = 'expired','expiry exact state');
  perform pg_temp.check_true(private.coach_invitation_view(v_owner,v_id,v_old_expiry::timestamptz-interval '1 microsecond')->>'code' is not null,'before expiry pending');

  v_start := clock_timestamp() - interval '60 seconds';
  update private.coach_invitations set created_at=v_start,issued_at=v_start,expires_at=v_start+interval '168 hours' where id=v_id;
  set local role authenticated;
  v_result := public.resend_own_coach_invitation(v_id,v_resend);
  perform pg_temp.check_true(v_result#>>'{operation,state}' = 'reserved','resend after exact cooldown');
  v_detail := public.read_own_coach_invitation(v_id);
  perform pg_temp.check_true(v_detail->>'code' = v_old_code and (v_detail->>'expiresAt')::timestamptz=v_start+interval '168 hours','resend preserves code and expiry');
  perform pg_temp.check_true(public.resend_own_coach_invitation(v_id,v_resend)->'operation' = v_result->'operation','resend retry consumes no quota');
  reset role;
  -- Backdate ONLY synthetic admin fixtures; production has no timestamp inputs.
  update private.coach_invitation_operations set reserved_at=clock_timestamp()-interval '120 seconds' where request_id=v_resend and coach_user_id=v_owner;
  set local role authenticated;
  perform pg_temp.check_true(public.resend_own_coach_invitation(v_id,gen_random_uuid())->>'status'='recorded','second resend');
  reset role;
  update private.coach_invitation_operations set reserved_at=clock_timestamp()-interval '120 seconds' where invitation_id=v_id and action='resend';
  set local role authenticated;
  perform pg_temp.check_true(public.resend_own_coach_invitation(v_id,gen_random_uuid())->>'status'='recorded','third resend');
  reset role;
  update private.coach_invitation_operations set reserved_at=clock_timestamp()-interval '120 seconds' where invitation_id=v_id and action='resend';
  set local role authenticated;
  v_result := public.resend_own_coach_invitation(v_id,gen_random_uuid());
  perform pg_temp.check_true(v_result->>'status'='rate_limited' and (v_result->>'retryAt')::timestamptz>(v_result->>'serverNow')::timestamptz,'fourth resend limited with retryAt');
  reset role;
  update private.coach_invitation_operations set reserved_at=clock_timestamp()-interval '24 hours' where invitation_id=v_id and action='resend';
  set local role authenticated;
  perform pg_temp.check_true(public.resend_own_coach_invitation(v_id,gen_random_uuid())->>'status'='recorded','24 hour resend boundary expires');
  reset role;
  v_start := clock_timestamp()-interval '168 hours';
  update private.coach_invitations set created_at=v_start,issued_at=v_start,expires_at=v_start+interval '168 hours' where id=v_id;
  set local role authenticated;
  perform pg_temp.check_true(public.read_own_coach_invitation(v_id)->>'code' is null,'expired detail redacts code');
  perform pg_temp.expect_error('select public.create_own_coach_invitation(''synthetic.person@example.test'',gen_random_uuid())','55000','expired pending requires explicit regeneration, not another invitation');
  perform pg_temp.expect_error(format('select public.resend_own_coach_invitation(%L,gen_random_uuid())',v_id),'55000','expired resend forbidden');
  v_result := public.regenerate_own_coach_invitation(v_id,v_regenerate);
  v_detail := public.read_own_coach_invitation(v_id);
  perform pg_temp.check_true(v_result#>>'{operation,state}'='reserved' and (v_detail->>'generation')::int=2,'explicit regeneration reserves generation 2');
  perform pg_temp.check_true(v_detail->>'code' <> v_old_code,'old code replaced');
  perform pg_temp.check_true((v_detail->>'expiresAt')::timestamptz-(v_detail->>'issuedAt')::timestamptz=interval '168 hours','regenerated seven days');
  perform pg_temp.check_true(public.regenerate_own_coach_invitation(v_id,v_regenerate)->'operation'=v_result->'operation','regenerate retry does not rotate again');
  perform pg_temp.check_true(public.read_own_coach_invitation_operation(v_request)->>'state'='cancelled','old dispatch reservation invalidated');
  perform public.cancel_own_coach_invitation(v_id,gen_random_uuid());
  v_detail := public.read_own_coach_invitation(v_id);
  perform pg_temp.check_true(v_detail->>'state'='cancelled' and v_detail->>'code' is null,'cancel invalidates code');
  perform pg_temp.check_true(public.read_own_coach_invitation_operation(v_regenerate)->>'state'='cancelled','cancel invalidates outbox');
  perform pg_temp.check_true(public.create_own_coach_invitation('synthetic.person@example.test',v_request)#>>'{operation,state}'='cancelled','late response reconciles cancellation without resurrection');
  perform pg_temp.expect_error(format('select public.regenerate_own_coach_invitation(%L,gen_random_uuid())',v_id),'55000','cancelled not regeneratable');
  v_new_id := (public.create_own_coach_invitation('synthetic.person@example.test',gen_random_uuid())#>>'{operation,invitationId}')::uuid;
  perform pg_temp.check_true(v_new_id <> v_id,'cancelled invitation permits a genuinely new own invitation');
  reset role;
  perform pg_temp.check_true(not exists(select 1 from private.coach_invitations where invitation_code=v_old_code),'previous code has no match');
end $$;

-- Schema-only episode fixtures, NOT an acceptance RPC or completed consent QA.
do $$
declare
  v_a uuid := '10000000-0000-4000-8000-000000000001';
  v_b uuid := '10000000-0000-4000-8000-000000000002';
  v_s uuid := '10000000-0000-4000-8000-000000000003';
  v_i uuid; v_i2 uuid; v_e uuid; v_request uuid := gen_random_uuid(); v_detail jsonb; v_end text;
begin
  insert into private.coach_invitations(coach_user_id,recipient_email,state,created_at,issued_at,expires_at)
    select v_a,'student@example.test','accepted',t,t,t+interval '168 hours' from (select clock_timestamp() t) q returning id into v_i;
  -- Use a single clock for equality constraints.
  insert into private.coach_invitations(coach_user_id,recipient_email,state,created_at,issued_at,expires_at)
    select v_b,'student@example.test','accepted',t,t,t+interval '168 hours' from (select clock_timestamp() t) q returning id into v_i2;
  insert into private.coach_relationship_episodes(invitation_id,coach_user_id,student_user_id,student_name_snapshot,student_email_snapshot,consented_at,linked_at)
    select v_i,v_a,v_s,'Synthetic Student','student@example.test',t,t from (select clock_timestamp() t) q returning id into v_e;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_a::text,true);
  perform pg_temp.expect_error(format('select public.create_own_coach_invitation('' STUDENT@EXAMPLE.TEST '',%L)',v_request),'55000','active own recipient cannot receive a new invitation');
  perform pg_temp.check_true(public.read_own_coach_invitation_operation(v_request) is null,'rejected active duplicate consumes no quota');
  reset role;
  perform pg_temp.expect_error(format('insert into private.coach_relationship_episodes(invitation_id,coach_user_id,student_user_id,student_name_snapshot,student_email_snapshot,consented_at,linked_at) values(%L,%L,%L,''Synthetic Student'',''student@example.test'',now(),now())',v_i2,v_b,v_s),'23505','one active Coach per student');
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_b::text,true);
  perform pg_temp.expect_error(format('select public.revoke_own_coach_relationship(%L,gen_random_uuid())',v_e),'P0002','cross Coach revoke');
  perform pg_temp.expect_error(format('select public.read_own_coach_relationship(%L)',v_e),'P0002','cross Coach episode');
  perform set_config('request.jwt.claim.sub',v_a::text,true);
  perform public.revoke_own_coach_relationship(v_e,v_request);
  v_detail := public.read_own_coach_relationship(v_e); v_end := v_detail->>'endedAt';
  perform pg_temp.check_true(v_end is not null and v_detail->>'studentName'='Synthetic Student' and v_detail->>'studentEmail'='student@example.test','revocation preserves identity snapshot');
  perform public.revoke_own_coach_relationship(v_e,v_request);
  perform pg_temp.expect_error(format('select public.revoke_own_coach_relationship(%L,gen_random_uuid())',v_e),'55000','new request cannot append to already revoked episode');
  perform pg_temp.check_true(public.read_own_coach_relationship(v_e)->>'endedAt'=v_end,'revocation timestamp immutable on retry');
  perform pg_temp.check_true(public.create_own_coach_invitation('student@example.test',gen_random_uuid())->>'status'='recorded','ended episode permits fresh invitation, not revived consent');
  reset role;
  insert into private.coach_relationship_episodes(invitation_id,coach_user_id,student_user_id,student_name_snapshot,student_email_snapshot,consented_at,linked_at)
    select v_i2,v_b,v_s,'New consent snapshot','student@example.test',t,t from (select clock_timestamp() t) q;
  perform pg_temp.check_true((select count(*) from private.coach_relationship_episodes where student_user_id=v_s)=2,'new episode does not overwrite old episode');
  perform pg_temp.check_true((select count(*) from private.coach_relationship_episodes where student_user_id=v_s and ended_at is null)=1,'one active after new synthetic consent');
  -- Account removal is distinct from unlink. New FKs must not block the existing
  -- Auth -> Usuario membership deletion path; no training tables exist here.
  delete from auth.users where id=v_s;
  perform pg_temp.check_true(not exists(select 1 from private.coach_relationship_episodes where student_user_id=v_s),'student account cascade does not fail');
  perform pg_temp.check_true(not exists(select 1 from private.coach_invitation_operations where episode_id=v_e),'episode operations cascade');
  delete from public.coach_registrations where user_id=v_a;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_a::text,true);
  perform pg_temp.expect_error(format('select public.read_own_coach_relationship(%L)',v_e),'42501','removed membership cannot read snapshot');
  perform pg_temp.expect_error('select public.create_own_coach_invitation(''a@example.test'',gen_random_uuid())','42501','removed membership cannot invite');
  reset role;
end $$;

-- Force an internal code collision in the isolated transaction only. The public
-- error must never retain PostgreSQL's unique-violation DETAIL with the code.
do $$
declare v_definition text; v_code text; v_failed boolean := false; v_message text; v_detail text;
begin
  select pg_get_functiondef('private.new_coach_invitation_code()'::regprocedure) into v_definition;
  select invitation_code into v_code from private.coach_invitations where invitation_code is not null limit 1;
  perform pg_temp.check_true(v_code is not null,'collision fixture exists');
  execute format('create or replace function private.new_coach_invitation_code() returns text language sql security invoker set search_path = '''' as $fixed$ select %L::text $fixed$',v_code);
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
  begin
    perform public.create_own_coach_invitation('collision@example.test',gen_random_uuid());
  exception when sqlstate '40001' then
    v_failed := true;
    get stacked diagnostics v_message = message_text, v_detail = pg_exception_detail;
    perform pg_temp.check_true(v_message='coach_invitation_retry_required','collision error sanitized');
    perform pg_temp.check_true(position(v_code in coalesce(v_detail,''))=0,'no code in exception detail');
  end;
  perform pg_temp.check_true(v_failed,'bounded collision retry rejects');
  reset role;
  execute v_definition;
end $$;

-- Test RLS itself in addition to ACL: accidental grants still expose no rows.
-- These temporary grants are inside the rollback-only synthetic transaction.
grant usage on schema private to authenticated;
grant select,insert,update,delete on private.coach_invitations,
  private.coach_relationship_episodes,private.coach_invitation_operations to authenticated;
do $$
declare v_count integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
  perform pg_temp.check_true((select count(*) from private.coach_invitations)=0,'RLS read remains default deny despite grant');
  perform pg_temp.check_true((select count(*) from private.coach_relationship_episodes)=0,'episode RLS read deny');
  perform pg_temp.check_true((select count(*) from private.coach_invitation_operations)=0,'operation RLS read deny');
  perform pg_temp.expect_error('insert into private.coach_invitations(coach_user_id,recipient_email,invitation_code,created_at,issued_at,expires_at) values(auth.uid(),''synthetic@example.test'',''AA2-AA2-AA2'',now(),now(),now()+interval ''168 hours'')','42501','RLS insert default deny despite grant');
  update private.coach_invitations set coach_user_id=auth.uid();
  get diagnostics v_count = row_count;
  perform pg_temp.check_true(v_count=0,'RLS no ownership update');
  delete from private.coach_invitations;
  get diagnostics v_count = row_count;
  perform pg_temp.check_true(v_count=0,'RLS no delete');
  reset role;
end $$;
rollback;
