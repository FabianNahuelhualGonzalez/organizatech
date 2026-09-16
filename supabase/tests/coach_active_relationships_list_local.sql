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
      if v_message <> 'coach_active_relationship_list_invalid_input' or coalesce(v_detail, '') <> '' then
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
    'public.list_own_active_coach_relationships(text,integer,timestamptz,uuid)'::regprocedure;
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
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships()','42501','anon denied');
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships()','42501','no identity');
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships()','42501','non Coach');
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
  perform pg_temp.check_true(public.list_own_active_coach_relationships() - 'serverNow' =
    '{"totalActive":0,"matchingCount":0,"items":[],"nextCursor":null}'::jsonb,'empty owner result');
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships(null)','22023','null query');
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships(repeat('' '',255))','22023','raw bytes before trim');
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships(repeat(''é'',128))','22023','UTF8 byte bound');
  perform pg_temp.check_true(public.list_own_active_coach_relationships(repeat('é',127))->>'matchingCount'='0','254 raw UTF8 bytes allowed');
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships('''',null)','22023','null limit');
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships('''',0)','22023','zero limit');
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships('''',-1)','22023','negative limit');
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships('''',51)','22023','limit above maximum');
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships('''',25,now(),null)','22023','half cursor time');
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships('''',25,null,gen_random_uuid())','22023','half cursor id');
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships('''',25,''infinity'',gen_random_uuid())','22023','infinity cursor');
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships('''',25,''-infinity'',gen_random_uuid())','22023','minus infinity cursor');
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships('''',25,''0001-01-01 BC'',gen_random_uuid())','22023','BC cursor');
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships('''',25,''10000-01-01+00'',gen_random_uuid())','22023','year above 9999');
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships(p_owner_id=>gen_random_uuid())','42883','no owner argument');
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships(p_ended_at=>now())','42883','no arbitrary state argument');
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships('''',25,now(),''not-a-uuid'')','22P02','malformed UUID');
  perform pg_temp.expect_error('select public.list_own_active_coach_relationships('''',25,''not-a-date'',gen_random_uuid())','22007','malformed time');
  reset role;
end $$;

-- Admin-only schema fixtures reserve historical consent; no acceptance is enabled
-- or tested. Each active episode has a distinct synthetic student identity.
do $$
declare
  v_a uuid := '10000000-0000-4000-8000-000000000001';
  v_b uuid := '10000000-0000-4000-8000-000000000002';
  v_linked timestamptz := date_trunc('second',clock_timestamp())-interval '30 days'+interval '123456 microseconds';
  v_email text; v_name text; v_owner uuid; v_student uuid; v_invitation uuid; v_id uuid; v_i integer;
  v_page jsonb; v_first jsonb; v_item jsonb; v_cursor jsonb; v_next jsonb;
  v_before text; v_after text; v_all uuid[] := '{}';
  v_names text[] := array[' Café ',U&'cafe\0301','Élève','literal%only','literal_only',E'literal\\only','SØREN ΟΣ','dual'];
begin
  for v_i in 1..70 loop
    v_id := ('30000000-0000-4000-8000-' || lpad(v_i::text,12,'0'))::uuid;
    v_invitation := ('20000000-0000-4000-8000-' || lpad(v_i::text,12,'0'))::uuid;
    v_student := ('40000000-0000-4000-8000-' || lpad(v_i::text,12,'0'))::uuid;
    v_owner := case when v_i=70 then v_b else v_a end;
    v_name := case when v_i<=60 then 'bulk-'||lpad(v_i::text,3,'0')
      when v_i<=68 then v_names[v_i-60] when v_i=69 then 'inactive-only' else ' Café ' end;
    v_email := case when v_i in (61,70) then 'café@example.test' when v_i=63 then 'élève@example.test'
      when v_i=65 then 'literal_only@example.test' when v_i=67 then 'dual@example.test'
      when v_i=68 then 'dual-other@example.test' else 'contact-'||v_i||'@example.test' end;
    insert into auth.users(id) values(v_student);
    insert into public.user_registrations(user_id) values(v_student);
    insert into private.coach_invitations(id,coach_user_id,recipient_email,state,created_at,issued_at,expires_at)
      values(v_invitation,v_owner,v_email,'accepted',v_linked,v_linked,v_linked+interval '168 hours');
    insert into private.coach_relationship_episodes(id,invitation_id,coach_user_id,student_user_id,
      student_name_snapshot,student_email_snapshot,consented_at,linked_at,ended_at)
      values(v_id,v_invitation,v_owner,v_student,v_name,v_email,
        v_linked+case when v_i>60 then interval '1 microsecond' else interval '0' end,
        v_linked+case when v_i>60 then interval '1 microsecond' else interval '0' end,
        case when v_i=69 then v_linked+interval '1 day' else null end);
  end loop;
  insert into private.coach_invitations(coach_user_id,recipient_email,invitation_code,created_at,issued_at,expires_at)
    values(v_a,'pending-only@example.test',private.new_coach_invitation_code(),v_linked,v_linked,v_linked+interval '168 hours');
  select md5(string_agg(row_to_json(e)::text,'|' order by e.id)) into v_before from private.coach_relationship_episodes e;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_a::text,true);
  v_first := public.list_own_active_coach_relationships();
  perform pg_temp.check_true(v_first->>'totalActive'='68' and v_first->>'matchingCount'='68'
    and jsonb_array_length(v_first->'items')=25,'counts not page size; default 25');
  perform pg_temp.check_true((select array_agg(k order by k) from jsonb_object_keys(v_first) k)=
    array['items','matchingCount','nextCursor','serverNow','totalActive'],'exact envelope allowlist');
  perform pg_temp.check_true(v_first->>'serverNow' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}\.[0-9]{6}Z$','UTC microsecond server time');
  v_page := v_first;
  loop
    perform pg_temp.check_true(v_page->>'totalActive'='68' and v_page->>'matchingCount'='68','counts before cursor');
    for v_item in select value from jsonb_array_elements(v_page->'items') loop
      perform pg_temp.check_true((select array_agg(k order by k) from jsonb_object_keys(v_item) k)=
        array['id','linkedAt','studentEmail','studentName'],'exact item allowlist; no ownership/activity/history/cycle');
      perform pg_temp.check_true(v_item->>'linkedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}\.[0-9]{6}Z$'
        and (v_item->>'linkedAt')::timestamptz <= (v_page->>'serverNow')::timestamptz,'UTC microsecond linked time');
      v_all := array_append(v_all,(v_item->>'id')::uuid);
    end loop;
    v_cursor := v_page->'nextCursor';
    exit when v_cursor = 'null'::jsonb;
    perform pg_temp.check_true(v_cursor = jsonb_build_object('linkedAt',v_page#>>'{items,-1,linkedAt}',
      'id',v_page#>>'{items,-1,id}'),'cursor exact allowlist and last returned item');
    v_page := public.list_own_active_coach_relationships('',25,(v_cursor->>'linkedAt')::timestamptz,(v_cursor->>'id')::uuid);
  end loop;
  perform pg_temp.check_true(cardinality(v_all)=68 and (select count(distinct id) from unnest(v_all) id)=68,'complete pages with no duplicates');
  perform pg_temp.check_true(v_all=(select array_agg(('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid order by n desc)
    from generate_series(1,68) n),'episode IDs, descending time plus UUID ties and microseconds');
  perform pg_temp.check_true(jsonb_array_length(public.list_own_active_coach_relationships('',50)->'items')=50,'page maximum allowed');
  v_page := public.list_own_active_coach_relationships('bulk',50);
  perform pg_temp.check_true(v_page->>'matchingCount'='60' and v_page->>'totalActive'='68','name matching count independent of page size');
  v_page := public.list_own_active_coach_relationships('bulk',50,
    (v_page#>>'{nextCursor,linkedAt}')::timestamptz,(v_page#>>'{nextCursor,id}')::uuid);
  perform pg_temp.check_true(v_page->>'matchingCount'='60' and jsonb_array_length(v_page->'items')=10
    and v_page->'nextCursor'='null'::jsonb,'filtered counts before cursor');
  perform pg_temp.check_true(public.list_own_active_coach_relationships(' CÁFÉ ')->>'matchingCount'='2','case and NFC/NFD accent insensitive');
  perform pg_temp.check_true(public.list_own_active_coach_relationships('café')#>>'{items,1,studentName}'=' Café ',
    'stored name snapshot projected unchanged');
  perform pg_temp.check_true(public.list_own_active_coach_relationships(' ELEVE ')->>'matchingCount'='1','multiple accents');
  perform pg_temp.check_true(public.list_own_active_coach_relationships('SØREN')->>'matchingCount'='1','Unicode lowercase not host ASCII locale');
  perform pg_temp.check_true(lower('ΟΣ' collate pg_catalog.pg_c_utf8)='οσ'
    and public.list_own_active_coach_relationships('οσ')->>'matchingCount'='1','Unicode simple sigma; SQL authoritative');
  perform pg_temp.check_true(public.list_own_active_coach_relationships('dual')->>'matchingCount'='2','email OR name without double counting');
  perform pg_temp.check_true(public.list_own_active_coach_relationships('CONTACT-1@')->>'matchingCount'='1','email-only substring');
  perform pg_temp.check_true(public.list_own_active_coach_relationships('%')->>'matchingCount'='1','percent literal');
  perform pg_temp.check_true(public.list_own_active_coach_relationships('_')->>'matchingCount'='1','underscore literal');
  perform pg_temp.check_true(public.list_own_active_coach_relationships(E'\\')->>'matchingCount'='1','backslash literal');
  perform pg_temp.check_true(public.list_own_active_coach_relationships(E'\tbulk')->>'matchingCount'='0','only ASCII space trimmed');
  perform pg_temp.check_true(public.list_own_active_coach_relationships(U&'\0301')->>'matchingCount'='68','combining mark normalizes empty');
  perform pg_temp.check_true(public.list_own_active_coach_relationships($q$' OR true --$q$)->>'matchingCount'='0','SQL-looking query remains literal');
  v_page := public.list_own_active_coach_relationships('inactive-only');
  perform pg_temp.check_true(v_page->>'totalActive'='68' and v_page->>'matchingCount'='0'
    and v_page->'items'='[]'::jsonb and v_page->'nextCursor'='null'::jsonb,'inactive excluded before search');
  perform pg_temp.check_true(public.list_own_active_coach_relationships('pending-only')->>'matchingCount'='0','pending invitation is not active relationship');
  perform pg_temp.check_true(public.list_own_active_coach_relationships('',25,'0001-01-01+00',gen_random_uuid())->'items'='[]'::jsonb,'finite minimum cursor');
  perform pg_temp.check_true(jsonb_array_length(public.list_own_active_coach_relationships('',25,
    '9999-12-31 23:59:59.999999+00',gen_random_uuid())->'items')=25,'finite future cursor no lookup');
  perform pg_temp.check_true(jsonb_array_length(public.list_own_active_coach_relationships('',25,
    v_linked+interval '1 microsecond','30000000-0000-4000-8000-000000000070')->'items')=25,'foreign anchor only filters own tuples');
  set local timezone='Pacific/Auckland';
  perform pg_temp.check_true(public.list_own_active_coach_relationships()->'items'=v_first->'items','UTC projection independent of session timezone');
  perform set_config('request.jwt.claim.sub',v_b::text,true);
  v_page := public.list_own_active_coach_relationships('cafe');
  perform pg_temp.check_true(v_page->>'totalActive'='1' and v_page->>'matchingCount'='1'
    and v_page#>>'{items,0,id}'='30000000-0000-4000-8000-000000000070','same snapshot across Coaches remains owner scoped');
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
  perform pg_temp.check_true(public.list_own_active_coach_relationships()->>'totalActive'='0','empty Coach cannot discover another portfolio');
  reset role;
  set local timezone='UTC';
  select md5(string_agg(row_to_json(e)::text,'|' order by e.id)) into v_after from private.coach_relationship_episodes e;
  perform pg_temp.check_true(v_before=v_after and (select count(*) from private.coach_invitation_operations)=0
    and (select count(*) from private.coach_invitations)=71,'listing never mutates episodes or reserves operations');

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_a::text,true);
  v_page := public.list_own_active_coach_relationships('',1);
  v_cursor := v_page->'nextCursor';
  perform public.revoke_own_coach_relationship((v_cursor->>'id')::uuid,gen_random_uuid());
  v_next := public.list_own_active_coach_relationships('',1,(v_cursor->>'linkedAt')::timestamptz,(v_cursor->>'id')::uuid);
  perform pg_temp.check_true(v_next->>'totalActive'='67' and v_next#>>'{items,0,id}'=
    '30000000-0000-4000-8000-000000000067','revoked anchor still pages without lookup');
  reset role;
end $$;

-- The existing episode schema does not forbid a finite future linked_at. The
-- list projects it as stored; serverNow is not a new business date constraint.
do $$
declare v_page jsonb;
begin
  update private.coach_relationship_episodes set linked_at='9999-12-31 23:59:59.999999+00',
    consented_at='9999-12-31 23:59:59.999999+00'
    where id='30000000-0000-4000-8000-000000000070';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
  v_page := public.list_own_active_coach_relationships();
  perform pg_temp.check_true(v_page#>>'{items,0,linkedAt}'='9999-12-31T23:59:59.999999Z'
    and v_page->>'totalActive'='1','finite future linkedAt retained without inventing a new restriction');
  reset role;
end $$;

-- Accidental direct read grants still leave FORCE RLS default-deny. Rollback only.
grant usage on schema private to authenticated;
grant select on private.coach_relationship_episodes to authenticated;
do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
  perform pg_temp.check_true((select count(*) from private.coach_relationship_episodes)=0,'RLS despite accidental SELECT grant');
  perform pg_temp.check_true(public.list_own_active_coach_relationships()->>'totalActive'='67','narrow definer still owner scoped');
  reset role;
end $$;
rollback;
