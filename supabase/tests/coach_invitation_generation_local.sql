-- Isolated synthetic PostgreSQL only. All fixtures, helper grants and fault
-- injection roll back. This is not a migration or an acceptance test.
begin;
create function pg_temp.check_true(p_value boolean, p_label text) returns void
language plpgsql as $$ begin
  if p_value is distinct from true then raise exception 'assertion failed: %', p_label; end if;
end $$;
create function pg_temp.expect_error(p_sql text, p_code text, p_label text, p_message text default null)
returns void language plpgsql as $$
declare v_failed boolean := false; v_message text; v_detail text;
begin
  begin execute p_sql;
  exception when others then
    if sqlstate <> p_code then raise exception 'wrong SQLSTATE: %', p_label; end if;
    get stacked diagnostics v_message = message_text, v_detail = pg_exception_detail;
    if p_message is not null and (v_message <> p_message or coalesce(v_detail,'') <> '') then
      raise exception 'unsanitized error: %', p_label;
    end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'expected rejection: %', p_label; end if;
end $$;
create function pg_temp.invitation_fixture(p_owner uuid, p_generation integer default 1,
  p_issued timestamptz default clock_timestamp()-interval '2 minutes')
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into private.coach_invitations(id,coach_user_id,recipient_email,invitation_code,
    generation,created_at,issued_at,expires_at)
  values(v_id,p_owner,v_id::text||'@example.test',private.new_coach_invitation_code(),
    p_generation,least(p_issued,clock_timestamp()-interval '9 days'),p_issued,p_issued+interval '168 hours');
  return v_id;
end $$;

do $$
declare v_fn record; v_table text; v_name text;
begin
  for v_fn in select p.*,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname in ('resend_own_coach_invitation_for_generation',
      'regenerate_own_coach_invitation_for_generation','read_own_coach_invitation_generation_operation'))
      or (n.nspname='private' and p.proname in ('mutate_coach_invitation_for_generation',
        'coach_invitation_generation_operation_view'))
  loop
    perform pg_temp.check_true(v_fn.proconfig=array['search_path=""']
      and v_fn.prosecdef=(v_fn.nspname='public') and v_fn.pronargdefaults=0,
      'new functions exact security modes and empty path, no optional ownership inputs');
    perform pg_temp.check_true(not exists(select 1 from aclexplode(v_fn.proacl)
      where grantee=0 and privilege_type='EXECUTE')
      and not has_function_privilege('anon',v_fn.oid,'EXECUTE')
      and has_function_privilege('authenticated',v_fn.oid,'EXECUTE')=(v_fn.nspname='public'),
      'public RPC authenticated only; private helpers inaccessible');
    perform pg_temp.check_true((select count(*)=1 from pg_proc p
      where p.pronamespace=v_fn.pronamespace and p.proname=v_fn.proname),'no overloads');
  end loop;
  perform pg_temp.check_true((select proargnames=array['p_invitation_id','p_expected_generation','p_request_id']
    from pg_proc where oid='public.resend_own_coach_invitation_for_generation(uuid,integer,uuid)'::regprocedure)
    and (select proargnames=array['p_invitation_id','p_expected_generation','p_request_id']
    from pg_proc where oid='public.regenerate_own_coach_invitation_for_generation(uuid,integer,uuid)'::regprocedure),
    'command input allowlist');
  foreach v_table in array array['coach_invitations','coach_invitation_operations','coach_relationship_episodes'] loop
    perform pg_temp.check_true((select relrowsecurity and relforcerowsecurity from pg_class
      where oid=('private.'||v_table)::regclass),'RLS enabled and forced');
    perform pg_temp.check_true(not exists(select 1 from pg_policy where polrelid=('private.'||v_table)::regclass)
      and not has_table_privilege('authenticated','private.'||v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
      'no policies or direct table grants');
  end loop;
  set local role anon;
  foreach v_name in array array['resend','regenerate'] loop
    perform pg_temp.expect_error(format('select public.%s_own_coach_invitation_for_generation(null,1,null)',v_name),
      '42501','anon cannot command');
  end loop;
  perform pg_temp.expect_error('select public.read_own_coach_invitation_generation_operation(null)',
    '42501','anon cannot read');
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.expect_error('select public.read_own_coach_invitation_generation_operation(gen_random_uuid())',
    '42501','null auth','coach_invitation_forbidden');
  foreach v_name in array array['resend','regenerate'] loop
    perform pg_temp.expect_error(format('select public.%s_own_coach_invitation_for_generation(gen_random_uuid(),1,gen_random_uuid())',v_name),
      '42501','null auth command','coach_invitation_forbidden');
  end loop;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
  perform pg_temp.expect_error('select public.resend_own_coach_invitation_for_generation(gen_random_uuid(),1,gen_random_uuid())',
    '42501','non Coach command','coach_invitation_forbidden');
  perform pg_temp.expect_error('select public.read_own_coach_invitation_generation_operation(gen_random_uuid())',
    '42501','non Coach read','coach_invitation_forbidden');
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
  perform pg_temp.check_true(public.read_own_coach_invitation_generation_operation(gen_random_uuid()) is null,'missing receipt is null');
  perform pg_temp.expect_error('select public.read_own_coach_invitation_generation_operation(null)',
    '22023','null read request','coach_invitation_invalid_input');
  foreach v_name in array array['resend','regenerate'] loop
    perform pg_temp.expect_error(format('select public.%s_own_coach_invitation_for_generation(null,1,gen_random_uuid())',v_name),
      '22023','null invitation','coach_invitation_invalid_input');
    perform pg_temp.expect_error(format('select public.%s_own_coach_invitation_for_generation(gen_random_uuid(),1,null)',v_name),
      '22023','null request','coach_invitation_invalid_input');
    perform pg_temp.expect_error(format('select public.%s_own_coach_invitation_for_generation(gen_random_uuid(),null,gen_random_uuid())',v_name),
      '22023','null generation','coach_invitation_invalid_input');
    perform pg_temp.expect_error(format('select public.%s_own_coach_invitation_for_generation(gen_random_uuid(),0,gen_random_uuid())',v_name),
      '22023','zero generation','coach_invitation_invalid_input');
    perform pg_temp.expect_error(format('select public.%s_own_coach_invitation_for_generation(gen_random_uuid(),-1,gen_random_uuid())',v_name),
      '22023','negative generation','coach_invitation_invalid_input');
  end loop;
  perform pg_temp.expect_error('select public.resend_own_coach_invitation_for_generation(''bad-uuid'',1,gen_random_uuid())',
    '22P02','UUID type rejects malformed input');
  perform pg_temp.expect_error('select public.resend_own_coach_invitation_for_generation(gen_random_uuid(),''2147483648'',gen_random_uuid())',
    '22003','integer type rejects overflow');
  perform pg_temp.expect_error('select public.resend_own_coach_invitation_for_generation(p_owner_id=>gen_random_uuid())',
    '42883','no client ownership parameter');
  perform pg_temp.expect_error('select private.mutate_coach_invitation_for_generation(''resend'',gen_random_uuid(),1,gen_random_uuid())',
    '42501','private helper is not an RPC');
  reset role;
  -- Supplemental default-deny test even if a future role accidentally had SELECT.
  perform pg_temp.invitation_fixture('10000000-0000-4000-8000-000000000001');
  perform pg_temp.check_true((select count(*)>0 from private.coach_invitations),'RLS fixture actually exists');
  grant usage on schema private to authenticated;
  grant select on private.coach_invitations to authenticated;
  set local role authenticated;
  perform pg_temp.check_true((select count(*)=0 from private.coach_invitations),'FORCE RLS has no allow policy');
  reset role;
  revoke select on private.coach_invitations from authenticated;
  revoke usage on schema private from authenticated;
end $$;

do $$
declare
  v_a uuid := '10000000-0000-4000-8000-000000000001';
  v_b uuid := '10000000-0000-4000-8000-000000000002';
  v_live uuid := pg_temp.invitation_fixture(v_a);
  v_foreign uuid := pg_temp.invitation_fixture(v_b);
  v_expired uuid := pg_temp.invitation_fixture(v_a,4,clock_timestamp()-interval '8 days');
  v_max uuid := pg_temp.invitation_fixture(v_a,2147483647);
  v_near_max uuid := pg_temp.invitation_fixture(v_a,2147483646,clock_timestamp()-interval '8 days');
  v_legacy uuid := pg_temp.invitation_fixture(v_a);
  v_req uuid := gen_random_uuid(); v_regen_req uuid := gen_random_uuid(); v_legacy_req uuid := gen_random_uuid();
  v_result jsonb; v_first jsonb; v_before jsonb; v_after jsonb; v_old_code text; v_payload jsonb;
  v_missing uuid := gen_random_uuid(); v_max_req uuid := gen_random_uuid(); v_bad jsonb;
begin
  select to_jsonb(i) into v_before from private.coach_invitations i where id=v_live;
  select invitation_code into v_old_code from private.coach_invitations where id=v_expired;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_a::text,true);
  perform pg_temp.expect_error(format('select public.resend_own_coach_invitation_for_generation(%L,1,%L)',v_foreign,v_missing),
    'P0002','cross-owner indistinguishable missing','coach_invitation_not_found');
  perform pg_temp.expect_error(format('select public.regenerate_own_coach_invitation_for_generation(%L,4,%L)',v_live,v_missing),
    '55000','generation checked before live state or quota','coach_invitation_generation_conflict');
  perform pg_temp.expect_error(format('select public.resend_own_coach_invitation_for_generation(%L,4,%L)',v_expired,v_missing),
    '55000','expired cannot resend','coach_invitation_state_conflict');
  perform pg_temp.expect_error(format('select public.regenerate_own_coach_invitation_for_generation(%L,1,%L)',v_live,v_missing),
    '55000','live cannot regenerate','coach_invitation_state_conflict');
  v_first := public.resend_own_coach_invitation_for_generation(v_live,1,v_req);
  perform pg_temp.check_true((select array_agg(k order by k) from jsonb_object_keys(v_first) k)=
    array['operation','serverNow','status'] and v_first->>'status'='recorded','exact command envelope');
  v_result := v_first->'operation';
  perform pg_temp.check_true((select array_agg(k order by k) from jsonb_object_keys(v_result) k)=
    array['action','expectedGeneration','generation','invitationId','requestId','reservedAt','state'],
    'exact seven field receipt; no code/email/episode/payload/owner');
  perform pg_temp.check_true(v_result->>'requestId'=v_req::text and v_result->>'action'='resend'
    and v_result->>'state'='reserved' and v_result->>'invitationId'=v_live::text
    and v_result->>'expectedGeneration'='1' and v_result->>'generation'='1'
    and (v_result->>'reservedAt')::timestamptz=(v_first->>'serverNow')::timestamptz,
    'resend confirms reservation only and exact references/time');
  perform pg_temp.check_true(public.read_own_coach_invitation_generation_operation(v_req)=v_result,'read bound receipt');
  perform pg_temp.check_true(public.resend_own_coach_invitation_for_generation(v_live,1,v_req)->'operation'=v_result,
    'exact replay preserves receipt and timestamp despite cooldown');
  perform pg_temp.expect_error(format('select public.resend_own_coach_invitation(%L,%L)',v_live,v_req),
    '22023','legacy cannot adopt bound request','coach_invitation_request_conflict');
  perform pg_temp.expect_error(format('select public.regenerate_own_coach_invitation_for_generation(%L,1,%L)',v_live,v_req),
    '22023','request action conflict','coach_invitation_request_conflict');
  perform pg_temp.expect_error(format('select public.resend_own_coach_invitation_for_generation(%L,2,%L)',v_live,v_req),
    '22023','request generation conflict','coach_invitation_request_conflict');
  perform pg_temp.expect_error(format('select public.resend_own_coach_invitation_for_generation(%L,1,%L)',v_expired,v_req),
    '22023','request invitation conflict','coach_invitation_request_conflict');
  perform set_config('request.jwt.claim.sub',v_b::text,true);
  perform pg_temp.check_true(public.read_own_coach_invitation_generation_operation(v_req) is null,'other owner request never disclosed');
  perform set_config('request.jwt.claim.sub',v_a::text,true);
  reset role;
  select to_jsonb(i) into v_after from private.coach_invitations i where id=v_live;
  perform pg_temp.check_true(v_before=v_after,'resend and replay do not change code/generation/expiry');
  perform pg_temp.check_true((select count(*)=1 from private.coach_invitation_operations where request_id=v_req),
    'one successful request uses one quota row');
  select payload into v_payload from private.coach_invitation_operations where request_id=v_req;
  perform pg_temp.check_true(v_payload=jsonb_build_object('invitationId',v_live,'expectedGeneration',1,'contractVersion',1),
    'stored exact intention binding');
  set local role authenticated;
  v_result := public.regenerate_own_coach_invitation_for_generation(v_expired,4,v_regen_req);
  perform pg_temp.check_true(v_result#>>'{operation,expectedGeneration}'='4'
    and v_result#>>'{operation,generation}'='5' and v_result#>>'{operation,action}'='regenerate','regeneration advances exactly once');
  perform pg_temp.check_true(public.regenerate_own_coach_invitation_for_generation(v_expired,4,v_regen_req)->'operation'=v_result->'operation',
    'regeneration replay occurs before new live-state rejection');
  reset role;
  perform pg_temp.check_true((select invitation_code <> v_old_code and generation=5
    and issued_at=(v_result->>'serverNow')::timestamptz and expires_at=issued_at+interval '168 hours'
    from private.coach_invitations where id=v_expired),'regeneration invalidates old code and starts exactly seven days');
  set local role authenticated;
  perform pg_temp.expect_error(format('select public.regenerate_own_coach_invitation_for_generation(%L,4,%L)',v_expired,v_missing),
    '55000','new request stale generation rejects','coach_invitation_generation_conflict');
  perform public.cancel_own_coach_invitation(v_expired,gen_random_uuid());
  perform pg_temp.check_true(public.regenerate_own_coach_invitation_for_generation(v_expired,4,v_regen_req)#>>'{operation,state}'='cancelled',
    'exact replay after cancellation reconciles cancelled receipt without mutation');
  perform pg_temp.check_true(public.read_own_coach_invitation_generation_operation(v_regen_req)->>'state'='cancelled',
    'read supports cancelled bound receipt');
  perform pg_temp.expect_error(format('select public.regenerate_own_coach_invitation_for_generation(%L,5,%L)',v_expired,v_missing),
    '55000','new request cancelled state rejects','coach_invitation_state_conflict');
  perform pg_temp.check_true(public.resend_own_coach_invitation_for_generation(v_max,2147483647,v_max_req)->>'status'='recorded',
    'resend MAX is valid without overflow');
  perform pg_temp.check_true(public.regenerate_own_coach_invitation_for_generation(v_near_max,2147483646,gen_random_uuid())#>>'{operation,generation}'='2147483647',
    'last representable regeneration is valid');
  perform pg_temp.expect_error(format('select public.regenerate_own_coach_invitation_for_generation(%L,2147483647,%L)',v_max,v_missing),
    '55000','regenerate MAX has fixed rejection','coach_invitation_generation_exhausted');
  perform public.resend_own_coach_invitation(v_legacy,v_legacy_req);
  perform pg_temp.expect_error(format('select public.resend_own_coach_invitation_for_generation(%L,1,%L)',v_legacy,v_legacy_req),
    '22023','bound command never upgrades legacy receipt','coach_invitation_request_conflict');
  perform pg_temp.expect_error(format('select public.read_own_coach_invitation_generation_operation(%L)',v_legacy_req),
    '22023','legacy read is incompatible, not adopted or missing','coach_invitation_operation_contract_conflict');
  reset role;
  perform pg_temp.check_true((select payload=jsonb_build_object('invitationId',v_legacy)
    from private.coach_invitation_operations where request_id=v_legacy_req),'legacy payload remains unchanged');
  perform pg_temp.check_true((select generation=5 and invitation_code is null and state='cancelled'
    from private.coach_invitations where id=v_expired),'replay did not reactivate cancelled invitation');
  perform pg_temp.check_true(not exists(select 1 from private.coach_invitation_operations where request_id=v_missing),
    'all rejected commands leave no operation');
  -- Admin-only corrupt receipt fixtures: never silently project incompatible data.
  foreach v_bad in array array[
    v_payload||'{"contractVersion":2}'::jsonb, v_payload||'{"extra":true}'::jsonb,
    v_payload||'{"expectedGeneration":0}'::jsonb, v_payload||'{"expectedGeneration":1.5}'::jsonb,
    v_payload||'{"expectedGeneration":2147483648}'::jsonb, v_payload||'{"expectedGeneration":"1"}'::jsonb,
    v_payload||'{"expectedGeneration":null}'::jsonb, v_payload||jsonb_build_object('invitationId',v_foreign),
    v_payload-'contractVersion', '[]'::jsonb
  ] loop
    update private.coach_invitation_operations set payload=v_bad where request_id=v_req;
    set local role authenticated;
    perform pg_temp.expect_error(format('select public.read_own_coach_invitation_generation_operation(%L)',v_req),
      '22023','malformed internal binding is rejected','coach_invitation_operation_contract_conflict');
    perform pg_temp.expect_error(format('select public.resend_own_coach_invitation_for_generation(%L,1,%L)',v_live,v_req),
      '22023','incompatible payload never rewritten on replay','coach_invitation_request_conflict');
    reset role;
  end loop;
  update private.coach_invitation_operations set payload=v_payload,generation=2 where request_id=v_req;
  set local role authenticated;
  perform pg_temp.expect_error(format('select public.read_own_coach_invitation_generation_operation(%L)',v_req),
    '22023','inconsistent outcome generation rejected','coach_invitation_operation_contract_conflict');
  reset role;
  update private.coach_invitation_operations set generation=1,reserved_at='infinity' where request_id=v_req;
  set local role authenticated;
  perform pg_temp.expect_error(format('select public.read_own_coach_invitation_generation_operation(%L)',v_req),
    '22023','infinite receipt time rejected','coach_invitation_operation_contract_conflict');
  reset role;
  update private.coach_invitation_operations set reserved_at=clock_timestamp() where request_id=v_req;
  update private.coach_invitation_operations set action='create' where request_id=v_req;
  set local role authenticated;
  perform pg_temp.expect_error(format('select public.read_own_coach_invitation_generation_operation(%L)',v_req),
    '22023','unapproved receipt action rejected','coach_invitation_operation_contract_conflict');
  reset role;
  update private.coach_invitation_operations set action='cancel',state='completed' where request_id=v_req;
  set local role authenticated;
  perform pg_temp.expect_error(format('select public.read_own_coach_invitation_generation_operation(%L)',v_req),
    '22023','completed cancellation cannot masquerade as reservation','coach_invitation_operation_contract_conflict');
  reset role;
  update private.coach_invitation_operations set action='resend',state='reserved',reserved_at='10000-01-01+00' where request_id=v_req;
  set local role authenticated;
  perform pg_temp.expect_error(format('select public.read_own_coach_invitation_generation_operation(%L)',v_req),
    '22023','finite receipt outside DTO year range rejected','coach_invitation_operation_contract_conflict');
  reset role;
  update private.coach_invitation_operations set reserved_at=clock_timestamp() where request_id=v_req;
end $$;

do $$
declare
  v_a uuid := '10000000-0000-4000-8000-000000000004';
  v_inv uuid := pg_temp.invitation_fixture(v_a,1,clock_timestamp()-interval '10 seconds');
  v_expired uuid := pg_temp.invitation_fixture(v_a,1,clock_timestamp()-interval '8 days');
  v_req uuid := gen_random_uuid(); v_result jsonb; v_before jsonb; v_i integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_a::text,true);
  v_result := public.resend_own_coach_invitation_for_generation(v_inv,1,v_req);
  perform pg_temp.check_true(v_result->>'status'='rate_limited'
    and (select array_agg(k order by k) from jsonb_object_keys(v_result) k)=array['retryAt','serverNow','status']
    and (v_result->>'retryAt')::timestamptz>(v_result->>'serverNow')::timestamptz,
    'cooldown has exact limited DTO with real future retryAt');
  perform pg_temp.check_true(public.read_own_coach_invitation_generation_operation(v_req) is null,'limited request has no operation');
  reset role;
  update private.coach_invitations set issued_at=now()-interval '8 days',
    expires_at=now()-interval '8 days'+interval '168 hours' where id=v_inv;
  set local role authenticated;
  perform public.regenerate_own_coach_invitation_for_generation(v_inv,1,gen_random_uuid());
  perform pg_temp.expect_error(format('select public.resend_own_coach_invitation_for_generation(%L,1,%L)',v_inv,v_req),
    '55000','limited old intention cannot act on later generation','coach_invitation_generation_conflict');
  reset role;
  -- Shared legacy create/regen budget: the previous regeneration plus nine create
  -- records makes ten within one hour, irrespective of receipt binding version.
  for v_i in 1..9 loop
    insert into private.coach_invitation_operations(coach_user_id,request_id,action,payload,
      invitation_id,generation,reserved_at,state) values(v_a,gen_random_uuid(),'create',
      '{"recipientEmail":"budget@example.test"}',v_inv,1,clock_timestamp()-interval '2 minutes','cancelled');
  end loop;
  select to_jsonb(i) into v_before from private.coach_invitations i where id=v_expired;
  set local role authenticated;
  v_result := public.regenerate_own_coach_invitation_for_generation(v_expired,1,v_req);
  perform pg_temp.check_true(v_result->>'status'='rate_limited'
    and public.read_own_coach_invitation_generation_operation(v_req) is null,'regenerate consumes shared hourly creation budget');
  reset role;
  perform pg_temp.check_true((select to_jsonb(i)=v_before from private.coach_invitations i where id=v_expired),
    'limited regeneration changes no invitation data');
  update private.coach_invitation_operations set reserved_at=clock_timestamp()-interval '2 hours' where coach_user_id=v_a;
  for v_i in 1..40 loop
    insert into private.coach_invitation_operations(coach_user_id,request_id,action,payload,
      invitation_id,generation,reserved_at,state) values(v_a,gen_random_uuid(),'create',
      '{"recipientEmail":"budget@example.test"}',v_inv,1,clock_timestamp()-interval '2 hours','cancelled');
  end loop;
  set local role authenticated;
  v_result := public.regenerate_own_coach_invitation_for_generation(v_expired,1,v_req);
  perform pg_temp.check_true(v_result->>'status'='rate_limited','regenerate also consumes shared 50 per day budget');
  reset role;
  update private.coach_invitation_operations set reserved_at=clock_timestamp()-interval '25 hours' where coach_user_id=v_a;
  update private.coach_invitations set issued_at=created_at+interval '8 days',
    expires_at=created_at+interval '15 days' where id=v_inv;
  for v_i in 1..3 loop
    insert into private.coach_invitation_operations(coach_user_id,request_id,action,payload,
      invitation_id,generation,reserved_at,state) values(v_a,gen_random_uuid(),'resend',
      jsonb_build_object('invitationId',v_inv),v_inv,2,clock_timestamp()-interval '2 hours','cancelled');
  end loop;
  set local role authenticated;
  v_result := public.resend_own_coach_invitation_for_generation(v_inv,2,v_req);
  perform pg_temp.check_true(v_result->>'status'='rate_limited','three legacy resends per day also bind new API budget');
  reset role;
end $$;

-- Admin-only fault injection, automatically removed by ROLLBACK.
create function pg_temp.break_new_binding() returns trigger language plpgsql as $$
begin
  if new.payload ? 'contractVersion' then
    if current_setting('coach_test.binding_fault',true)='skip' then return null; end if;
    if current_setting('coach_test.binding_fault',true)='rewrite' then new.payload=old.payload; end if;
  end if;
  return new;
end $$;
create trigger test_binding_failure before update of payload on private.coach_invitation_operations
for each row execute function pg_temp.break_new_binding();
do $$
declare
  v_owner uuid := '10000000-0000-4000-8000-000000000002';
  v_inv uuid := pg_temp.invitation_fixture(v_owner,9,clock_timestamp()-interval '8 days');
  v_req uuid := gen_random_uuid(); v_prior uuid := gen_random_uuid();
  v_before jsonb; v_operation_before jsonb; v_mode text;
begin
  insert into private.coach_invitation_operations(coach_user_id,request_id,action,payload,
    invitation_id,generation,reserved_at,state) values(v_owner,v_prior,'resend',
    jsonb_build_object('invitationId',v_inv),v_inv,9,clock_timestamp()-interval '9 days','reserved');
  select to_jsonb(i) into v_before from private.coach_invitations i where id=v_inv;
  select to_jsonb(o) into v_operation_before from private.coach_invitation_operations o where request_id=v_prior;
  foreach v_mode in array array['skip','rewrite'] loop
    perform set_config('coach_test.binding_fault',v_mode,true);
    set local role authenticated;
    perform set_config('request.jwt.claim.sub',v_owner::text,true);
    perform pg_temp.expect_error(format('select public.regenerate_own_coach_invitation_for_generation(%L,9,%L)',v_inv,v_req),
      '40001','binding failure rolls back engine','coach_invitation_retry_required');
    reset role;
    perform pg_temp.check_true((select to_jsonb(i)=v_before from private.coach_invitations i where id=v_inv),
      'failed binding restores code/generation/expiry');
    perform pg_temp.check_true((select to_jsonb(o)=v_operation_before from private.coach_invitation_operations o where request_id=v_prior)
      and not exists(select 1 from private.coach_invitation_operations where request_id=v_req),
      'failed binding restores prior reservation and creates no quota receipt');
  end loop;
  perform set_config('coach_test.binding_fault','',true);
  set local role authenticated;
  perform pg_temp.check_true(public.regenerate_own_coach_invitation_for_generation(v_inv,9,v_req)->>'status'='recorded',
    'same request can explicitly reconcile after technical rollback');
  reset role;
  perform pg_temp.check_true((select count(*)=0 from private.coach_relationship_episodes),
    'no relationship, consent or training fixture needed');
end $$;
rollback;
