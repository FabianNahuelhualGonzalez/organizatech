-- Synthetic isolated PostgreSQL only. All fixtures/grants/helpers roll back.
begin;
create function pg_temp.check_true(p_value boolean, p_label text) returns void
language plpgsql as $$ begin
  if p_value is distinct from true then raise exception 'assertion failed: %', p_label; end if;
end $$;
create function pg_temp.expect_error(p_sql text, p_code text, p_label text) returns void
language plpgsql as $$ declare v_failed boolean := false; v_message text; v_detail text; begin
  begin execute p_sql;
  exception when others then
    if sqlstate <> p_code then raise exception 'wrong SQLSTATE: %', p_label; end if;
    if p_code = '22023' then
      get stacked diagnostics v_message = message_text, v_detail = pg_exception_detail;
      if v_message <> 'coach_invitation_list_invalid_input' or coalesce(v_detail, '') <> '' then
        raise exception 'unsanitized error: %', p_label;
      end if;
    end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'expected rejection: %', p_label; end if;
end $$;

do $$
declare v_fn record; v_table text;
begin
  select p.* into v_fn from pg_proc p where p.oid =
    'public.list_own_pending_coach_invitations(text,integer,timestamptz,uuid)'::regprocedure;
  perform pg_temp.check_true(v_fn.prosecdef and v_fn.provolatile = 'v'
    and v_fn.proconfig = array['search_path=""'] and v_fn.pronargdefaults = 4,
    'definer, volatile snapshot, empty search_path and defaults');
  perform pg_temp.check_true(not exists(select 1 from aclexplode(v_fn.proacl)
    where grantee = 0 and privilege_type = 'EXECUTE'), 'no PUBLIC execute');
  perform pg_temp.check_true(not has_function_privilege('anon',v_fn.oid,'EXECUTE')
    and has_function_privilege('authenticated',v_fn.oid,'EXECUTE'), 'only authenticated execute');
  foreach v_table in array array['coach_invitations','coach_invitation_operations','coach_relationship_episodes'] loop
    perform pg_temp.check_true((select relrowsecurity and relforcerowsecurity from pg_class
      where oid = ('private.' || v_table)::regclass), 'RLS remains enabled and forced');
    perform pg_temp.check_true(not exists(select 1 from pg_policy
      where polrelid = ('private.' || v_table)::regclass), 'default deny retained');
    perform pg_temp.check_true(not has_table_privilege('authenticated','private.' || v_table,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'no new table grants');
  end loop;
  set local role anon;
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations()','42501','anon denied');
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations()','42501','no identity');
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations()','42501','non Coach');
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
  perform pg_temp.check_true(public.list_own_pending_coach_invitations() - 'serverNow' =
    '{"totalPending":0,"matchingCount":0,"items":[],"nextCursor":null}'::jsonb,'empty owner result');
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations(null)','22023','null query');
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations(repeat('' '',255))','22023','raw bytes before trim');
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations(repeat(''é'',128))','22023','UTF8 byte bound');
  perform pg_temp.check_true(public.list_own_pending_coach_invitations(repeat('é',127))->>'matchingCount'='0','254 raw UTF8 bytes allowed');
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations('''',null)','22023','null limit');
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations('''',0)','22023','zero limit');
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations('''',-1)','22023','negative limit');
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations('''',51)','22023','limit above maximum');
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations('''',25,now(),null)','22023','half cursor time');
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations('''',25,null,gen_random_uuid())','22023','half cursor id');
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations('''',25,''infinity'',gen_random_uuid())','22023','infinity cursor');
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations('''',25,''-infinity'',gen_random_uuid())','22023','minus infinity cursor');
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations('''',25,''0001-01-01 BC'',gen_random_uuid())','22023','BC cursor');
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations('''',25,''10000-01-01+00'',gen_random_uuid())','22023','year above 9999');
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations(p_owner_id=>gen_random_uuid())','42883','no owner argument');
  perform pg_temp.expect_error('select public.list_own_pending_coach_invitations(p_state=>''accepted'')','42883','no arbitrary state argument');
  reset role;
end $$;

do $$
declare
  v_a uuid := '10000000-0000-4000-8000-000000000001';
  v_b uuid := '10000000-0000-4000-8000-000000000002';
  v_created timestamptz := date_trunc('second',clock_timestamp())-interval '30 days'+interval '123456 microseconds';
  v_email text; v_id uuid; v_i integer; v_page jsonb; v_first jsonb; v_item jsonb;
  v_cursor jsonb; v_next jsonb; v_before text; v_after text; v_all uuid[] := '{}';
  v_special text[] := array['café@example.test',U&'cafe\0301@example.test','élève@example.test',
    'literal%only@example.test','literal_only@example.test',E'literal\\only@example.test','søren@example.test'];
begin
  for v_i in 1..67 loop
    v_id := ('20000000-0000-4000-8000-' || lpad(v_i::text,12,'0'))::uuid;
    v_email := case when v_i <= 60 then 'bulk-' || lpad(v_i::text,3,'0') || '@example.test' else v_special[v_i-60] end;
    insert into private.coach_invitations(id,coach_user_id,recipient_email,invitation_code,created_at,issued_at,expires_at)
    values(v_id,v_a,v_email,private.new_coach_invitation_code(),
      v_created + case when v_i>60 then interval '1 microsecond' else interval '0' end,
      v_created + case when v_i=1 then interval '20 days' else interval '29 days' end,
      v_created + case when v_i=1 then interval '27 days' else interval '36 days' end);
  end loop;
  -- Excluded statuses are schema fixtures only, not an acceptance operation.
  insert into private.coach_invitations(coach_user_id,recipient_email,state,created_at,issued_at,expires_at,cancelled_at)
    values(v_a,'cancelled@example.test','cancelled',v_created,v_created,v_created+interval '168 hours',v_created),
      (v_a,'accepted@example.test','accepted',v_created,v_created,v_created+interval '168 hours',null);
  insert into private.coach_invitations(coach_user_id,recipient_email,invitation_code,created_at,issued_at,expires_at)
    values(v_b,'bulk-001@example.test',private.new_coach_invitation_code(),v_created,v_created,v_created+interval '168 hours');
  select md5(string_agg(row_to_json(i)::text,'|' order by i.id)) into v_before from private.coach_invitations i;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_a::text,true);
  v_first := public.list_own_pending_coach_invitations();
  perform pg_temp.check_true(v_first->>'totalPending'='67' and v_first->>'matchingCount'='67'
    and jsonb_array_length(v_first->'items')=25,'counts not page size; default 25');
  perform pg_temp.check_true((select array_agg(k order by k) from jsonb_object_keys(v_first) k)=
    array['items','matchingCount','nextCursor','serverNow','totalPending'],'exact envelope allowlist');
  perform pg_temp.check_true(v_first->>'serverNow' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}\.[0-9]{6}Z$','UTC microsecond server time');
  v_page := v_first;
  loop
    perform pg_temp.check_true(v_page->>'totalPending'='67' and v_page->>'matchingCount'='67','counts before cursor');
    for v_item in select value from jsonb_array_elements(v_page->'items') loop
      perform pg_temp.check_true((select array_agg(k order by k) from jsonb_object_keys(v_item) k)=
        array['createdAt','expiresAt','id','issuedAt','recipientEmail','state'],'exact item allowlist; no code/identity/activity');
      perform pg_temp.check_true((v_item->>'createdAt')::timestamptz <= (v_item->>'issuedAt')::timestamptz
        and (v_item->>'issuedAt')::timestamptz <= (v_page->>'serverNow')::timestamptz
        and (v_item->>'expiresAt')::timestamptz-(v_item->>'issuedAt')::timestamptz=interval '168 hours','coherent timestamps');
      perform pg_temp.check_true((v_item->>'state'='expired') =
        ((v_item->>'expiresAt')::timestamptz <= (v_page->>'serverNow')::timestamptz),'state as of server time');
      v_all := array_append(v_all,(v_item->>'id')::uuid);
    end loop;
    v_cursor := v_page->'nextCursor';
    exit when v_cursor = 'null'::jsonb;
    perform pg_temp.check_true(v_cursor = jsonb_build_object('createdAt',v_page#>>'{items,-1,createdAt}',
      'id',v_page#>>'{items,-1,id}'),'cursor is last returned item, not extra candidate');
    v_page := public.list_own_pending_coach_invitations('',25,(v_cursor->>'createdAt')::timestamptz,(v_cursor->>'id')::uuid);
  end loop;
  perform pg_temp.check_true(cardinality(v_all)=67 and (select count(distinct id) from unnest(v_all) id)=67,'complete pages with no duplicates');
  perform pg_temp.check_true(v_all=(select array_agg(('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid order by n desc)
    from generate_series(1,67) n),'descending time plus UUID ties and microseconds');
  perform pg_temp.check_true(jsonb_array_length(public.list_own_pending_coach_invitations('',50)->'items')=50,'page maximum allowed');
  perform pg_temp.check_true(public.list_own_pending_coach_invitations('bulk',50)->>'matchingCount'='60','matching count independent of limit');
  perform pg_temp.check_true(public.list_own_pending_coach_invitations(' CÁFÉ ')->>'matchingCount'='2','case and NFC/NFD accent insensitive');
  perform pg_temp.check_true(public.list_own_pending_coach_invitations(' ELEVE ')->>'matchingCount'='1','multiple accents');
  perform pg_temp.check_true(public.list_own_pending_coach_invitations('SØREN')->>'matchingCount'='1','Unicode lowercase not host ASCII locale');
  perform pg_temp.check_true(public.list_own_pending_coach_invitations('%')->>'matchingCount'='1','percent literal');
  perform pg_temp.check_true(public.list_own_pending_coach_invitations('_')->>'matchingCount'='1','underscore literal');
  perform pg_temp.check_true(public.list_own_pending_coach_invitations(E'\\')->>'matchingCount'='1','backslash literal');
  perform pg_temp.check_true(public.list_own_pending_coach_invitations(E'\tbulk')->>'matchingCount'='0','only ASCII space trimmed');
  perform pg_temp.check_true(public.list_own_pending_coach_invitations(U&'\0301')->>'matchingCount'='67','only combining mark normalizes empty');
  v_page := public.list_own_pending_coach_invitations('no-match');
  perform pg_temp.check_true(v_page->>'totalPending'='67' and v_page->>'matchingCount'='0'
    and v_page->'items'='[]'::jsonb and v_page->'nextCursor'='null'::jsonb,'no search results preserves total');
  perform pg_temp.check_true(public.list_own_pending_coach_invitations('',25,'0001-01-01+00',gen_random_uuid())->'items'='[]'::jsonb,'finite minimum cursor');
  perform pg_temp.check_true(jsonb_array_length(public.list_own_pending_coach_invitations('',25,
    '9999-12-31 23:59:59.999999+00',gen_random_uuid())->'items')=25,'finite future cursor no lookup');
  perform pg_temp.check_true(jsonb_array_length(public.list_own_pending_coach_invitations('',25,
    clock_timestamp()+interval '1 day',gen_random_uuid())->'items')=25,'missing anchor simply position');
  set local timezone='Pacific/Auckland';
  perform pg_temp.check_true(public.list_own_pending_coach_invitations()->'items'=v_first->'items','UTC projection independent of session timezone');
  perform set_config('request.jwt.claim.sub',v_b::text,true);
  v_page := public.list_own_pending_coach_invitations();
  perform pg_temp.check_true(v_page->>'totalPending'='1' and v_page->>'matchingCount'='1','other Coach only own counts');
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
  perform pg_temp.check_true(public.list_own_pending_coach_invitations()->>'totalPending'='0','empty Coach cannot discover another portfolio');
  reset role;
  -- Restore serialization timezone before comparing stored row fingerprints.
  set local timezone='UTC';
  select md5(string_agg(row_to_json(i)::text,'|' order by i.id)) into v_after from private.coach_invitations i;
  perform pg_temp.check_true(v_before=v_after and (select count(*) from private.coach_invitation_operations)=0
    and (select count(*) from private.coach_relationship_episodes)=0,'listing never changes data, reserves or links');

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_a::text,true);
  v_page := public.list_own_pending_coach_invitations('',1);
  v_cursor := v_page->'nextCursor';
  perform public.cancel_own_coach_invitation((v_cursor->>'id')::uuid,gen_random_uuid());
  v_next := public.list_own_pending_coach_invitations('',1,(v_cursor->>'createdAt')::timestamptz,(v_cursor->>'id')::uuid);
  perform pg_temp.check_true(v_next->>'totalPending'='66' and v_next#>>'{items,0,id}'=
    '20000000-0000-4000-8000-000000000066','cancelled anchor still pages without lookup');
  perform pg_temp.check_true(public.list_own_pending_coach_invitations('bulk-001')#>>'{items,0,state}'='expired','expired included');
  perform public.regenerate_own_coach_invitation('20000000-0000-4000-8000-000000000001',gen_random_uuid());
  v_page := public.list_own_pending_coach_invitations('bulk-001');
  perform pg_temp.check_true(v_page#>>'{items,0,state}'='pending' and v_page->>'matchingCount'='1'
    and (v_page#>>'{items,0,createdAt}')::timestamptz=v_created,'regeneration changes expiry not cursor identity');
  reset role;
end $$;

-- PostgreSQL 17 Unicode simple lowercase is authoritative. It intentionally does
-- not apply JavaScript's contextual final-sigma lowercasing to the query.
do $$
declare v_page jsonb;
begin
  perform pg_temp.check_true(lower('ΟΣ' collate pg_catalog.pg_c_utf8)='οσ','built-in simple lowercase sigma');
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
  perform public.create_own_coach_invitation('οσ@example.test',gen_random_uuid());
  v_page := public.list_own_pending_coach_invitations('ΟΣ');
  perform pg_temp.check_true(v_page->>'matchingCount'='1' and v_page#>>'{items,0,recipientEmail}'='οσ@example.test',
    'SQL-authoritative Unicode literal matching');
  reset role;
end $$;

-- Accidental direct read grants still leave FORCE RLS default-deny. Rollback only.
grant usage on schema private to authenticated;
grant select on private.coach_invitations to authenticated;
do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
  perform pg_temp.check_true((select count(*) from private.coach_invitations)=0,'RLS despite accidental SELECT grant');
  perform pg_temp.check_true(public.list_own_pending_coach_invitations()->>'totalPending'='66','narrow definer still owner scoped');
  reset role;
end $$;
rollback;
