-- Release B - D2 - QA postcheck read-only.
-- Ejecutar solo en Supabase QA: fjjebhaqtrdbpxzxztmh.
-- No ejecutar automaticamente ni en Production.

begin transaction read only;

with table_target as (
  select c.oid, c.relacl, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'training_workout_readiness'
    and c.relkind = 'r'
),
columns_expected(column_name, type_name, is_nullable, has_default) as (
  values
    ('id', 'uuid', false, true),
    ('user_id', 'uuid', false, false),
    ('workout_attempt_id', 'uuid', false, false),
    ('cycle_id', 'uuid', false, false),
    ('cycle_day_id', 'uuid', false, false),
    ('workout_started_at', 'timestamp with time zone', false, false),
    ('local_date', 'date', false, false),
    ('payload', 'jsonb', false, false),
    ('training_session_id', 'uuid', true, false),
    ('created_at', 'timestamp with time zone', false, true),
    ('updated_at', 'timestamp with time zone', false, true)
),
columns_found as (
  select
    a.attname::text as column_name,
    format_type(a.atttypid, a.atttypmod) as type_name,
    not a.attnotnull as is_nullable,
    d.oid is not null as has_default
  from table_target t
  join pg_attribute a on a.attrelid = t.oid
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum > 0
    and not a.attisdropped
),
constraint_columns as (
  select
    con.oid as constraint_oid,
    con.conname,
    con.contype,
    con.conrelid,
    con.confrelid,
    con.confdeltype,
    array_agg(src.attname::text order by src_ord.n) as source_columns,
    array_agg(dst.attname::text order by dst_ord.n) as target_columns
  from pg_constraint con
  join unnest(con.conkey) with ordinality as src_ord(attnum, n) on true
  join pg_attribute src on src.attrelid = con.conrelid and src.attnum = src_ord.attnum
  left join unnest(con.confkey) with ordinality as dst_ord(attnum, n) on dst_ord.n = src_ord.n
  left join pg_attribute dst on dst.attrelid = con.confrelid and dst.attnum = dst_ord.attnum
  where con.conrelid = coalesce((select oid from table_target), 0::oid)
  group by con.oid, con.conname, con.contype, con.conrelid, con.confrelid, con.confdeltype
),
index_info as (
  select
    cls.relname as index_name,
    idx.indisunique,
    array_agg(att.attname::text order by ord.n) as columns,
    pg_get_expr(idx.indpred, idx.indrelid) as predicate
  from table_target t
  join pg_index idx on idx.indrelid = t.oid
  join pg_class cls on cls.oid = idx.indexrelid
  join unnest(idx.indkey) with ordinality as ord(attnum, n) on true
  join pg_attribute att on att.attrelid = t.oid and att.attnum = ord.attnum
  group by cls.relname, idx.indisunique, idx.indpred, idx.indrelid
),
trigger_info as (
  select
    trg.tgname,
    trg.tgfoid,
    trg.tgtype,
    trg.tgisinternal
  from table_target t
  join pg_trigger trg on trg.tgrelid = t.oid
),
policy_info as (
  select
    pol.polname,
    pol.polcmd,
    pol.polroles,
    pg_get_expr(pol.polqual, pol.polrelid) as using_expr
  from table_target t
  join pg_policy pol on pol.polrelid = t.oid
),
role_oids as (
  select
    (select oid from pg_roles where rolname = 'authenticated') as authenticated_oid,
    (select oid from pg_roles where rolname = 'anon') as anon_oid,
    (select oid from pg_roles where rolname = 'service_role') as service_role_oid
),
table_acl as (
  select
    acl.grantee,
    acl.privilege_type
  from table_target t
  cross join lateral aclexplode(coalesce(t.relacl, '{}'::aclitem[])) as acl
),
functions_target as (
  select
    p.oid,
    p.proname,
    pg_get_function_identity_arguments(p.oid) as identity_args,
    p.prosecdef,
    p.proconfig,
    p.proacl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('save_training_workout_readiness_v2', 'link_training_workout_readiness_session_v2')
),
function_acl as (
  select
    f.proname,
    f.identity_args,
    acl.grantee,
    acl.privilege_type
  from functions_target f
  cross join lateral aclexplode(coalesce(f.proacl, '{}'::aclitem[])) as acl
),
checks as (
  select 'table_present' as check_name,
    exists (select 1 from table_target) as ok
  union all
  select 'columns_exact',
    not exists (
      select column_name, type_name, is_nullable, has_default from columns_expected
      except
      select column_name, type_name, is_nullable, has_default from columns_found
    )
    and not exists (
      select column_name, type_name, is_nullable, has_default from columns_found
      except
      select column_name, type_name, is_nullable, has_default from columns_expected
    )
  union all
  select 'primary_key_id',
    exists (
      select 1 from constraint_columns
      where contype = 'p'
        and source_columns = array['id']
    )
  union all
  select 'unique_user_attempt',
    exists (
      select 1 from constraint_columns
      where contype = 'u'
        and source_columns = array['user_id','workout_attempt_id']
    )
  union all
  select 'cycle_user_fk_present',
    exists (
      select 1
      from constraint_columns cc
      where cc.contype = 'f'
        and cc.conrelid = (select oid from table_target)
        and cc.confrelid = 'public.training_cycles'::regclass
        and cc.source_columns = array['cycle_id','user_id']
        and cc.target_columns = array['id','user_id']
        and cc.confdeltype = 'r'
    )
  union all
  select 'cycle_day_cycle_fk_present',
    exists (
      select 1
      from constraint_columns cc
      where cc.contype = 'f'
        and cc.conrelid = (select oid from table_target)
        and cc.confrelid = 'public.training_cycle_days'::regclass
        and cc.source_columns = array['cycle_day_id','cycle_id']
        and cc.target_columns = array['id','cycle_id']
        and cc.confdeltype = 'r'
    )
  union all
  select 'session_fk_present',
    exists (
      select 1
      from constraint_columns cc
      where cc.contype = 'f'
        and cc.conrelid = (select oid from table_target)
        and cc.confrelid = 'public.training_sessions'::regclass
        and cc.source_columns = array['training_session_id']
        and cc.target_columns = array['id']
        and cc.confdeltype = 'r'
    )
  union all
  select 'session_unique_partial_present',
    exists (
      select 1 from index_info
      where index_name = 'training_workout_readiness_session_key'
        and indisunique
        and columns = array['training_session_id']
        and predicate = '(training_session_id IS NOT NULL)'
    )
  union all
  select 'user_created_index_present',
    exists (
      select 1 from index_info
      where index_name = 'training_workout_readiness_user_created_idx'
        and columns = array['user_id','created_at']
    )
  union all
  select 'cycle_day_created_index_present',
    exists (
      select 1 from index_info
      where index_name = 'training_workout_readiness_cycle_day_created_idx'
        and columns = array['user_id','cycle_id','cycle_day_id','created_at']
    )
  union all
  select 'payload_check_present',
    exists (
      select 1 from pg_constraint con
      where con.conrelid = (select oid from table_target)
        and con.contype = 'c'
        and con.conname = 'training_workout_readiness_payload_check'
        and pg_get_constraintdef(con.oid) ilike '%skipped%'
        and pg_get_constraintdef(con.oid) ilike '%motivation%'
        and pg_get_constraintdef(con.oid) ilike '%hydration%'
        and pg_get_constraintdef(con.oid) ilike '%sleep%'
        and pg_get_constraintdef(con.oid) ilike '%energy%'
    )
  union all
  select 'updated_at_trigger_present',
    exists (
      select 1 from trigger_info
      where tgname = 'training_workout_readiness_set_updated_at'
        and tgfoid = to_regprocedure('public.set_updated_at()')
        and not tgisinternal
        and (tgtype & 2) = 2
        and (tgtype & 16) = 16
        and (tgtype & 1) = 1
    )
  union all
  select 'rls_enabled',
    exists (select 1 from table_target where relrowsecurity)
  union all
  select 'policy_exact_select_own',
    (select count(*) from policy_info) = 1
    and exists (
      select 1
      from policy_info p
      cross join role_oids r
      where p.polcmd = 'r'
        and p.polroles = array[r.authenticated_oid]
        and p.using_expr = '(auth.uid() = user_id)'
    )
  union all
  select 'policy_no_writes',
    not exists (select 1 from policy_info where polcmd in ('a','w','d','*'))
  union all
  select 'table_public_no_explicit_grants',
    not exists (select 1 from table_acl where grantee = 0)
  union all
  select 'table_anon_no_explicit_grants',
    not exists (
      select 1 from table_acl acl cross join role_oids roles
      where acl.grantee = roles.anon_oid
    )
  union all
  select 'table_service_role_no_explicit_grants',
    not exists (
      select 1 from table_acl acl cross join role_oids roles
      where acl.grantee = roles.service_role_oid
    )
  union all
  select 'table_authenticated_select_only',
    not exists (
      select 1 from table_acl acl cross join role_oids roles
      where acl.grantee = roles.authenticated_oid
        and acl.privilege_type <> 'SELECT'
    )
    and exists (
      select 1 from table_acl acl cross join role_oids roles
      where acl.grantee = roles.authenticated_oid
        and acl.privilege_type = 'SELECT'
    )
  union all
  select 'save_v2_single_overload',
    (select count(*) from functions_target where proname = 'save_training_workout_readiness_v2') = 1
    and exists (
      select 1 from functions_target
      where proname = 'save_training_workout_readiness_v2'
        and identity_args = 'p_workout_attempt_id uuid, p_cycle_id uuid, p_cycle_day_id uuid, p_workout_started_at timestamp with time zone, p_payload jsonb'
    )
  union all
  select 'link_v2_single_overload',
    (select count(*) from functions_target where proname = 'link_training_workout_readiness_session_v2') = 1
    and exists (
      select 1 from functions_target
      where proname = 'link_training_workout_readiness_session_v2'
        and identity_args = 'p_workout_attempt_id uuid, p_training_session_id uuid'
    )
  union all
  select 'rpc_security_definer_search_path',
    not exists (
      select 1 from functions_target
      where not prosecdef
        or not ('search_path=public, pg_temp' = any(coalesce(proconfig, array[]::text[])))
    )
    and (select count(*) from functions_target) = 2
  union all
  select 'rpc_authenticated_execute',
    not exists (
      select 1 from functions_target f
      where not exists (
        select 1
        from function_acl acl
        cross join role_oids roles
        where acl.proname = f.proname
          and acl.identity_args = f.identity_args
          and acl.grantee = roles.authenticated_oid
          and acl.privilege_type = 'EXECUTE'
      )
    )
    and (select count(*) from functions_target) = 2
  union all
  select 'rpc_public_no_execute',
    not exists (
      select 1 from function_acl
      where grantee = 0 and privilege_type = 'EXECUTE'
    )
  union all
  select 'rpc_anon_no_execute',
    not exists (
      select 1 from function_acl acl cross join role_oids roles
      where acl.grantee = roles.anon_oid
        and acl.privilege_type = 'EXECUTE'
    )
  union all
  select 'rpc_service_role_no_explicit_execute',
    not exists (
      select 1 from function_acl acl cross join role_oids roles
      where acl.grantee = roles.service_role_oid
        and acl.privilege_type = 'EXECUTE'
    )
  union all
  select 'legacy_table_present',
    to_regclass('public.training_daily_readiness') is not null
  union all
  select 'legacy_rpc_present',
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'save_daily_training_readiness'
        and pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb'
    )
  union all
  select 'legacy_cycle_day_id_absent',
    not exists (
      select 1
      from pg_attribute a
      where a.attrelid = 'public.training_daily_readiness'::regclass
        and a.attname = 'cycle_day_id'
        and a.attnum > 0
        and not a.attisdropped
    )
),
row_counts as (
  select
    (select count(*) from public.training_workout_readiness) as training_workout_readiness_rows,
    (select count(*) from public.training_daily_readiness) as legacy_training_daily_readiness_rows
)
select
  case when bool_and(ok) then 'D2_QA_VERIFIED' else 'D2_QA_FAILED' end as verdict,
  jsonb_object_agg(check_name, ok order by check_name) as checks,
  (select to_jsonb(row_counts) from row_counts) as row_counts
from checks;

rollback;
