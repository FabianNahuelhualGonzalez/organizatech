-- Synthetic admin episode fixtures only; this is NOT acceptance/consent QA.
begin;
create function pg_temp.assert_true(p_ok boolean, p_label text) returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'Assertion failed: %', p_label; end if; end;
$$;
create function pg_temp.expect_error(p_sql text, p_state text, p_message text default null)
returns void language plpgsql as $$
declare v_state text; v_message text;
begin
  begin execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    perform pg_temp.assert_true(v_state = p_state, 'expected sanitized SQLSTATE');
    if p_message is not null then
      perform pg_temp.assert_true(v_message = p_message, 'expected fixed sanitized message');
    end if;
    return;
  end;
  raise exception 'Assertion failed: expected rejection';
end;
$$;

insert into private.coach_invitations(id,coach_user_id,recipient_email,state,invitation_code,created_at,issued_at,expires_at)
  select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    'fixture@example.test','accepted',null,t,t,t+interval '168 hours'
  from generate_series(1,2) n cross join (select clock_timestamp()-interval '1 day' t) q;
insert into private.coach_relationship_episodes(id,invitation_id,coach_user_id,student_user_id,
  student_name_snapshot,student_email_snapshot,consented_at,linked_at,ended_at)
  select ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    '10000000-0000-4000-8000-000000000003','Synthetic Student','fixture@example.test',t,t,
    case when n=2 then clock_timestamp() else null end
  from generate_series(1,2) n cross join (select clock_timestamp()-interval '12 hours' t) q;

select pg_temp.assert_true(count(*)=3 and bool_and(c.relrowsecurity and c.relforcerowsecurity), 'all storage FORCE RLS')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname in ('coach_paid_period_registers','coach_paid_periods','coach_paid_period_operations');
select pg_temp.assert_true(count(*)=0, 'default deny has no policies') from pg_policies
  where schemaname='private' and tablename like 'coach_paid_period%';
select pg_temp.assert_true(not has_table_privilege(role_name,'private.'||table_name,privilege), 'no direct table grants')
  from unnest(array['anon','authenticated']) role_name
  cross join unnest(array['coach_paid_period_registers','coach_paid_periods','coach_paid_period_operations']) table_name
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege;
select pg_temp.assert_true(p.prosecdef and p.proconfig=array['search_path=""']::text[]
    and has_function_privilege('authenticated',p.oid,'EXECUTE')
    and not has_function_privilege('anon',p.oid,'EXECUTE')
    and not exists (select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE'),
    'RPC security definer search_path and narrow grants')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('confirm_own_coach_paid_period','correct_own_coach_paid_period',
    'read_own_coach_paid_period','read_own_coach_paid_period_operation');
select pg_temp.assert_true(not p.prosecdef and p.proconfig=array['search_path=""']::text[]
    and not has_function_privilege('authenticated',p.oid,'EXECUTE')
    and not has_function_privilege('anon',p.oid,'EXECUTE'), 'private helpers not executable')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in ('coach_paid_period_date','coach_paid_period_receipt','write_coach_paid_period');
select pg_temp.assert_true(count(*)=4, 'only four public payment RPCs') from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%own_coach_paid_period%';
select pg_temp.assert_true(not exists(select 1 from unnest(p.proargnames) a
  where a in ('p_owner_id','p_coach_user_id','p_student_user_id','p_payload','p_state')), 'scalar ownership-free allowlists')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%own_coach_paid_period%';

select pg_temp.assert_true(private.coach_paid_period_date('0001-01-01')=date '0001-01-01'
  and private.coach_paid_period_date('9999-12-31')=date '9999-12-31'
  and private.coach_paid_period_date('2000-02-29')=date '2000-02-29', 'civil date inclusive bounds and leap century');
select pg_temp.expect_error($q$select private.coach_paid_period_date('1900-02-29')$q$,'22023','coach_paid_period_invalid_date');
select pg_temp.expect_error($q$select private.coach_paid_period_date('2026-09-０１')$q$,'22023','coach_paid_period_invalid_date');

set local role anon;
select pg_temp.expect_error($q$select public.read_own_coach_paid_period('40000000-0000-4000-8000-000000000001')$q$,'42501');
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error($q$select public.read_own_coach_paid_period('40000000-0000-4000-8000-000000000001')$q$,'42501');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select pg_temp.expect_error($q$select public.read_own_coach_paid_period('40000000-0000-4000-8000-000000000001')$q$,'42501');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.read_own_coach_paid_period('40000000-0000-4000-8000-000000000001');
reset role;
select pg_temp.assert_true(count(*)=0,'reading an unrecorded period makes no register') from private.coach_paid_period_registers;
select pg_temp.assert_true(count(*)=0,'reading an unrecorded period makes no operation') from private.coach_paid_period_operations;
set local role authenticated;
select set_config('DateStyle','SQL, DMY',true);
select set_config('TimeZone','Pacific/Auckland',true);
select pg_temp.expect_error($q$select public.read_own_coach_paid_period('40000000-0000-4000-8000-000000000002')$q$,'P0002','coach_paid_period_not_found');
select pg_temp.expect_error($q$select public.read_own_coach_paid_period('40000000-0000-4000-8000-999999999999')$q$,'P0002','coach_paid_period_not_found');
select pg_temp.expect_error($q$select public.confirm_own_coach_paid_period('40000000-0000-4000-8000-000000000002','2026-09-01','2026-09-30','00000000-0000-0000-0000-000000000000',gen_random_uuid())$q$,'P0002','coach_paid_period_not_found');

create temporary table payment_evidence(data jsonb);
do $$
declare
  e uuid := '40000000-0000-4000-8000-000000000001';
  zero uuid := '00000000-0000-0000-0000-000000000000';
  req uuid := gen_random_uuid();
  first_receipt jsonb;
  corrected jsonb;
  renewed jsonb;
  v uuid;
  p uuid;
  invalid text;
begin
  perform pg_temp.assert_true(public.read_own_coach_paid_period(e)=jsonb_build_object('linkEpisodeId',e,'version',zero,'period',null), 'unrecorded is null with initial version');
  perform pg_temp.assert_true(public.read_own_coach_paid_period_operation(req) is null,'unknown request is legitimate null');
  foreach invalid in array array['2026-02-29','2026-04-31','2026-13-01','2026-00-01','2026-01-00','0000-01-01','10000-01-01','2026-1-01',' 2026-01-01','2026-01-01 ','2026-01-01T00:00:00Z','infinity','2026-01-01 BC'] loop
    perform pg_temp.expect_error(format('select public.confirm_own_coach_paid_period(%L,%L,%L,%L,gen_random_uuid())',e,invalid,'2026-09-30',zero),'22023','coach_paid_period_invalid_date');
  end loop;
  perform pg_temp.expect_error(format('select public.confirm_own_coach_paid_period(%L,null,%L,%L,gen_random_uuid())',e,'2026-09-30',zero),'22023','coach_paid_period_invalid_date');
  perform pg_temp.expect_error(format('select public.confirm_own_coach_paid_period(%L,%L,%L,%L,gen_random_uuid())',e,'2026-09-30','2026-09-30',zero),'22023','coach_paid_period_invalid_dates');
  perform pg_temp.expect_error(format('select public.confirm_own_coach_paid_period(%L,%L,%L,%L,null)',e,'2026-09-01','2026-09-30',zero),'22023','coach_paid_period_invalid_input');
  first_receipt := public.confirm_own_coach_paid_period(e,'2024-02-29','2024-03-30',zero,req);
  perform pg_temp.assert_true(first_receipt->>'status'='recorded','explicit save only records a fact');
  perform pg_temp.assert_true(first_receipt#>>'{operation,period,start}'='2024-02-29'
    and first_receipt#>>'{operation,period,end}'='2024-03-30','civil DTO is independent of DateStyle and timezone');
  perform pg_temp.assert_true((select array_agg(k order by k) from jsonb_object_keys(first_receipt) k)=array['operation','status'],'response exact keys');
  perform pg_temp.assert_true((select array_agg(k order by k) from jsonb_object_keys(first_receipt->'operation') k)=array['action','period','recordedAt','requestId','version'],'receipt excludes ownership payload activity');
  perform pg_temp.assert_true((select array_agg(k order by k) from jsonb_object_keys(first_receipt#>'{operation,period}') k)=array['end','id','linkEpisodeId','start'],'period matches audited model');
  perform pg_temp.assert_true(public.confirm_own_coach_paid_period(e,'2024-02-29','2024-03-30',zero,req)=first_receipt,'identical replay same stable receipt');
  perform pg_temp.expect_error(format('select public.confirm_own_coach_paid_period(%L,%L,%L,%L,%L)',e,'2024-02-28','2024-03-30',zero,req),'22023','coach_paid_period_request_conflict');
  v := (first_receipt#>>'{operation,version}')::uuid;
  p := (first_receipt#>>'{operation,period,id}')::uuid;
  perform pg_temp.expect_error(format('select public.confirm_own_coach_paid_period(%L,%L,%L,%L,gen_random_uuid())',e,'2024-04-01','2024-04-30',zero),'40001','coach_paid_period_version_conflict');
  perform pg_temp.expect_error(format('select public.correct_own_coach_paid_period(%L,%L,%L,%L,%L,%L)',e,p,'2024-02-29','2024-03-30',zero,req),'22023','coach_paid_period_request_conflict');
  perform pg_temp.expect_error(format('select public.correct_own_coach_paid_period(%L,gen_random_uuid(),%L,%L,%L,gen_random_uuid())',e,'2024-02-29','2024-03-30',v),'P0002','coach_paid_period_not_found');
  corrected := public.correct_own_coach_paid_period(e,p,'2024-03-01','2024-03-31',v,gen_random_uuid());
  perform pg_temp.assert_true(corrected#>>'{operation,period,id}'=p::text,'correction preserves period identity');
  perform pg_temp.assert_true(public.read_own_coach_paid_period_operation(req)=first_receipt->'operation','old receipt dates immutable after correction');
  v := (corrected#>>'{operation,version}')::uuid;
  perform pg_temp.expect_error(format('select public.confirm_own_coach_paid_period(%L,%L,%L,%L,gen_random_uuid())',e,'2024-03-31','2024-04-30',v),'22023','coach_paid_period_invalid_dates');
  renewed := public.confirm_own_coach_paid_period(e,'2024-04-01','2024-04-30',v,gen_random_uuid());
  perform pg_temp.assert_true(renewed#>>'{operation,period,id}'<>p::text,'explicit renewal new identity');
  v := (renewed#>>'{operation,version}')::uuid;
  perform pg_temp.expect_error(format('select public.correct_own_coach_paid_period(%L,%L,%L,%L,%L,gen_random_uuid())',e,p,'2024-03-01','2024-04-01',v),'22023','coach_paid_period_invalid_dates');
  perform pg_temp.expect_error(format('select public.correct_own_coach_paid_period(%L,%L,%L,%L,%L,gen_random_uuid())',e,renewed#>>'{operation,period,id}','2024-03-31','2024-04-30',v),'22023','coach_paid_period_invalid_dates');
  perform pg_temp.assert_true(public.read_own_coach_paid_period(e)->'period'=renewed#>'{operation,period}','latest commercial period, not training-derived');
  perform public.revoke_own_coach_relationship(e,gen_random_uuid());
  perform pg_temp.expect_error(format('select public.confirm_own_coach_paid_period(%L,%L,%L,%L,gen_random_uuid())',e,'2024-05-01','2024-05-31',v),'55000','coach_paid_period_inactive_relationship');
  perform pg_temp.expect_error(format('select public.correct_own_coach_paid_period(%L,%L,%L,%L,%L,gen_random_uuid())',e,p,'2024-03-01','2024-03-30',v),'55000','coach_paid_period_inactive_relationship');
  perform pg_temp.expect_error(format('select public.confirm_own_coach_paid_period(%L,%L,%L,%L,%L)',e,'2024-02-29','2024-03-30',zero,req),'55000','coach_paid_period_inactive_relationship');
  perform pg_temp.assert_true(public.read_own_coach_paid_period(e)->'period'=renewed#>'{operation,period}','own commercial facts survive unlink');
  perform pg_temp.assert_true(public.read_own_coach_paid_period_operation(req)=first_receipt->'operation','read-only reconciliation remains after unlink');
  insert into payment_evidence values(jsonb_build_object('requestId',req,'first',p,'renewed',renewed#>>'{operation,period,id}'));
end;
$$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true(public.read_own_coach_paid_period_operation((data->>'requestId')::uuid) is null,'cross-owner request cannot reveal fact') from payment_evidence;
select pg_temp.expect_error($q$select public.read_own_coach_paid_period('40000000-0000-4000-8000-000000000001')$q$,'P0002','coach_paid_period_not_found');
select pg_temp.expect_error($q$select public.confirm_own_coach_paid_period('40000000-0000-4000-8000-000000000002','2026-09-01','2026-09-30','00000000-0000-0000-0000-000000000000',gen_random_uuid())$q$,'55000','coach_paid_period_inactive_relationship');
reset role;
select pg_temp.assert_true(count(*)=2,'two periods retained, no failed or automatic writes') from private.coach_paid_periods;
select pg_temp.assert_true(count(*)=3,'three immutable successful operations only') from private.coach_paid_period_operations;
select pg_temp.assert_true(previous_start=date '2024-02-29' and previous_end=date '2024-03-30','correction retains previous dates') from private.coach_paid_period_operations where action='correct';
select pg_temp.assert_true(count(*)=1,'read before save does not persist registers') from private.coach_paid_period_registers;
select pg_temp.expect_error($q$update private.coach_paid_periods set ends_on=starts_on$q$,'23514');
select pg_temp.expect_error($q$update private.coach_paid_periods set starts_on='0001-01-01 BC'$q$,'23514');
select pg_temp.expect_error($q$update private.coach_paid_periods set ends_on='infinity'$q$,'23514');
select pg_temp.expect_error($q$update private.coach_paid_periods set coach_user_id='10000000-0000-4000-8000-000000000002'$q$,'23503');

-- Defense in depth even if a future grant accidentally opens a table.
grant usage on schema private to authenticated;
grant select,insert,update,delete on private.coach_paid_period_registers,private.coach_paid_periods,private.coach_paid_period_operations to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true(count(*)=0,'RLS SELECT default deny despite grant') from private.coach_paid_periods;
select pg_temp.assert_true(count(*)=0,'RLS operation default deny despite grant') from private.coach_paid_period_operations;
with changed as (update private.coach_paid_periods set ends_on=ends_on+1 returning id)
select pg_temp.assert_true(count(*)=0,'RLS UPDATE default deny despite grant') from changed;
with removed as (delete from private.coach_paid_periods returning id)
select pg_temp.assert_true(count(*)=0,'RLS DELETE default deny despite grant') from removed;
select pg_temp.expect_error($q$insert into private.coach_paid_period_registers values(gen_random_uuid(),'10000000-0000-4000-8000-000000000001',gen_random_uuid())$q$,'42501');
reset role;
rollback;
