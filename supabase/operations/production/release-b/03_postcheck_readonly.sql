-- Release B - Production postcheck read-only for workout readiness v2.
-- Project ref: lzycxltqbrtsnwfdotqw.
-- No UUIDs, payloads, emails or personal data are returned.

begin transaction read only;

with table_state as (
  select c.oid, c.relrowsecurity, c.relacl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'training_workout_readiness'
    and c.relkind = 'r'
),
columns_expected as (
  select *
  from (values
    ('id', 'uuid', false),
    ('user_id', 'uuid', false),
    ('workout_attempt_id', 'uuid', false),
    ('cycle_id', 'uuid', false),
    ('cycle_day_id', 'uuid', false),
    ('workout_started_at', 'timestamp with time zone', false),
    ('local_date', 'date', false),
    ('payload', 'jsonb', false),
    ('training_session_id', 'uuid', true),
    ('created_at', 'timestamp with time zone', false),
    ('updated_at', 'timestamp with time zone', false)
  ) as expected(column_name, data_type, nullable_allowed)
),
column_checks as (
  select
    count(*) filter (
      where a.attname is not null
        and format_type(a.atttypid, a.atttypmod) = e.data_type
        and (e.nullable_allowed or a.attnotnull)
    ) = count(*) as required_columns_present,
    count(*) = 11 as expected_column_count
  from columns_expected e
  left join table_state ts on true
  left join pg_attribute a on a.attrelid = ts.oid
    and a.attname = e.column_name
    and a.attnum > 0
    and not a.attisdropped
),
default_checks as (
  select
    exists (
      select 1
      from table_state ts
      join pg_attribute a on a.attrelid = ts.oid and a.attname = 'id'
      join pg_attrdef d on d.adrelid = ts.oid and d.adnum = a.attnum
      where lower(pg_get_expr(d.adbin, d.adrelid)) like '%gen_random_uuid%'
    ) as id_default_gen_random_uuid,
    exists (
      select 1
      from table_state ts
      join pg_attribute a on a.attrelid = ts.oid and a.attname = 'created_at'
      join pg_attrdef d on d.adrelid = ts.oid and d.adnum = a.attnum
      where lower(pg_get_expr(d.adbin, d.adrelid)) like '%now%'
    ) as created_at_default_now,
    exists (
      select 1
      from table_state ts
      join pg_attribute a on a.attrelid = ts.oid and a.attname = 'updated_at'
      join pg_attrdef d on d.adrelid = ts.oid and d.adnum = a.attnum
      where lower(pg_get_expr(d.adbin, d.adrelid)) like '%now%'
    ) as updated_at_default_now
),
constraint_checks as (
  select
    exists (
      select 1
      from table_state ts
      join pg_constraint con on con.conrelid = ts.oid
      where con.conname = 'training_workout_readiness_pkey'
        and con.contype = 'p'
    ) as primary_key_present,
    exists (
      select 1
      from table_state ts
      join pg_constraint con on con.conrelid = ts.oid
      where con.conname = 'training_workout_readiness_user_attempt_key'
        and con.contype = 'u'
        and (
          select array_agg(att.attname::text order by ord.n)
          from unnest(con.conkey) with ordinality as ord(attnum, n)
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = ord.attnum
        ) = array['user_id','workout_attempt_id']::text[]
    ) as user_attempt_unique_present,
    exists (
      select 1
      from table_state ts
      join pg_constraint con on con.conrelid = ts.oid
      where con.contype = 'f'
        and con.confrelid = 'auth.users'::regclass
        and (
          select array_agg(att.attname::text order by ord.n)
          from unnest(con.conkey) with ordinality as ord(attnum, n)
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = ord.attnum
        ) = array['user_id']::text[]
        and (
          select array_agg(att.attname::text order by ord.n)
          from unnest(con.confkey) with ordinality as ord(attnum, n)
          join pg_attribute att on att.attrelid = con.confrelid and att.attnum = ord.attnum
        ) = array['id']::text[]
    ) as user_fk_exact_present,
    exists (
      select 1
      from table_state ts
      join pg_constraint con on con.conrelid = ts.oid
      where con.contype = 'f'
        and con.confrelid = 'public.training_cycles'::regclass
        and (
          select array_agg(att.attname::text order by ord.n)
          from unnest(con.conkey) with ordinality as ord(attnum, n)
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = ord.attnum
        ) = array['cycle_id','user_id']::text[]
        and (
          select array_agg(att.attname::text order by ord.n)
          from unnest(con.confkey) with ordinality as ord(attnum, n)
          join pg_attribute att on att.attrelid = con.confrelid and att.attnum = ord.attnum
        ) = array['id','user_id']::text[]
    ) as cycle_fk_exact_present,
    exists (
      select 1
      from table_state ts
      join pg_constraint con on con.conrelid = ts.oid
      where con.contype = 'f'
        and con.confrelid = 'public.training_cycle_days'::regclass
        and (
          select array_agg(att.attname::text order by ord.n)
          from unnest(con.conkey) with ordinality as ord(attnum, n)
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = ord.attnum
        ) = array['cycle_day_id','cycle_id']::text[]
        and (
          select array_agg(att.attname::text order by ord.n)
          from unnest(con.confkey) with ordinality as ord(attnum, n)
          join pg_attribute att on att.attrelid = con.confrelid and att.attnum = ord.attnum
        ) = array['id','cycle_id']::text[]
    ) as cycle_day_fk_exact_present,
    exists (
      select 1
      from table_state ts
      join pg_constraint con on con.conrelid = ts.oid
      where con.contype = 'f'
        and con.confrelid = 'public.training_sessions'::regclass
        and (
          select array_agg(att.attname::text order by ord.n)
          from unnest(con.conkey) with ordinality as ord(attnum, n)
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = ord.attnum
        ) = array['training_session_id']::text[]
        and (
          select array_agg(att.attname::text order by ord.n)
          from unnest(con.confkey) with ordinality as ord(attnum, n)
          join pg_attribute att on att.attrelid = con.confrelid and att.attnum = ord.attnum
        ) = array['id']::text[]
    ) as training_session_fk_exact_present
),
index_checks as (
  select
    exists (
      select 1
      from table_state ts
      join pg_index i on i.indrelid = ts.oid
      join pg_class idx on idx.oid = i.indexrelid
      where idx.relname = 'training_workout_readiness_session_key'
        and i.indisunique
        and (
          select array_agg(att.attname::text order by ord.n)
          from unnest(i.indkey::int2[]) with ordinality as ord(attnum, n)
          join pg_attribute att on att.attrelid = i.indrelid and att.attnum = ord.attnum
        ) = array['training_session_id']::text[]
        and lower(pg_get_expr(i.indpred, i.indrelid)) = 'training_session_id is not null'
    ) as session_unique_partial_index_present,
    exists (
      select 1
      from table_state ts
      join pg_index i on i.indrelid = ts.oid
      join pg_class idx on idx.oid = i.indexrelid
      where idx.relname = 'training_workout_readiness_user_created_idx'
        and (
          select array_agg(att.attname::text order by ord.n)
          from unnest(i.indkey::int2[]) with ordinality as ord(attnum, n)
          join pg_attribute att on att.attrelid = i.indrelid and att.attnum = ord.attnum
        ) = array['user_id','created_at']::text[]
    ) as user_created_index_present,
    exists (
      select 1
      from table_state ts
      join pg_index i on i.indrelid = ts.oid
      join pg_class idx on idx.oid = i.indexrelid
      where idx.relname = 'training_workout_readiness_cycle_day_created_idx'
        and (
          select array_agg(att.attname::text order by ord.n)
          from unnest(i.indkey::int2[]) with ordinality as ord(attnum, n)
          join pg_attribute att on att.attrelid = i.indrelid and att.attnum = ord.attnum
        ) = array['user_id','cycle_id','cycle_day_id','created_at']::text[]
    ) as cycle_day_created_index_present
),
trigger_checks as (
  select exists (
    select 1
    from table_state ts
    join pg_trigger t on t.tgrelid = ts.oid
    where not t.tgisinternal
      and t.tgname = 'training_workout_readiness_set_updated_at'
      and (t.tgtype & 1) = 1
      and (t.tgtype & 2) = 2
      and (t.tgtype & 16) = 16
      and t.tgfoid = 'public.set_updated_at()'::regprocedure
  ) as updated_at_trigger_present
),
rls_checks as (
  select
    coalesce((select relrowsecurity from table_state), false) as rls_enabled,
    exists (
      select 1
      from table_state ts
      join pg_policy p on p.polrelid = ts.oid
      where p.polname = 'workout readiness own select'
    ) as owner_select_policy_present
),
function_state as (
  select
    to_regprocedure('public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamp with time zone, jsonb)') as save_oid,
    to_regprocedure('public.link_training_workout_readiness_session_v2(uuid, uuid)') as link_oid
),
acl_counts as (
  select
    (
      select count(*)
      from table_state ts
      cross join lateral aclexplode(coalesce(ts.relacl, acldefault('r', ts.oid::regclass::oid))) acl
      join pg_roles grantee on grantee.oid = acl.grantee
      where grantee.rolname = 'service_role'
    ) as table_explicit_acl_rows,
    (
      select count(*)
      from function_state fs
      join pg_proc p on p.oid = fs.save_oid
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      join pg_roles grantee on grantee.oid = acl.grantee
      where grantee.rolname = 'service_role'
    ) as save_rpc_explicit_acl_rows,
    (
      select count(*)
      from function_state fs
      join pg_proc p on p.oid = fs.link_oid
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      join pg_roles grantee on grantee.oid = acl.grantee
      where grantee.rolname = 'service_role'
    ) as link_rpc_explicit_acl_rows
),
acl_checks as (
  select
    not has_table_privilege('anon', 'public.training_workout_readiness', 'select')
      and not has_table_privilege('anon', 'public.training_workout_readiness', 'insert')
      and not has_table_privilege('anon', 'public.training_workout_readiness', 'update')
      and not has_table_privilege('anon', 'public.training_workout_readiness', 'delete') as anon_table_no_privileges,
    has_table_privilege('authenticated', 'public.training_workout_readiness', 'select')
      and not has_table_privilege('authenticated', 'public.training_workout_readiness', 'insert')
      and not has_table_privilege('authenticated', 'public.training_workout_readiness', 'update')
      and not has_table_privilege('authenticated', 'public.training_workout_readiness', 'delete')
      and not has_table_privilege('authenticated', 'public.training_workout_readiness', 'truncate')
      and not has_table_privilege('authenticated', 'public.training_workout_readiness', 'references')
      and not has_table_privilege('authenticated', 'public.training_workout_readiness', 'trigger') as authenticated_table_expected_privileges,
    table_explicit_acl_rows = 0 as service_role_table_explicit_acl_absent,
    save_rpc_explicit_acl_rows = 0 as service_role_save_rpc_explicit_acl_absent,
    link_rpc_explicit_acl_rows = 0 as service_role_link_rpc_explicit_acl_absent
  from acl_counts
),
function_checks as (
  select
    save_oid is not null as save_rpc_present,
    link_oid is not null as link_rpc_present,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'save_training_workout_readiness_v2') = 1 as save_rpc_single_signature,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'link_training_workout_readiness_session_v2') = 1 as link_rpc_single_signature,
    exists (select 1 from pg_proc where oid = save_oid and prosecdef and proconfig @> array['search_path=public, pg_temp']) as save_rpc_security_and_search_path,
    exists (select 1 from pg_proc where oid = link_oid and prosecdef and proconfig @> array['search_path=public, pg_temp']) as link_rpc_security_and_search_path,
    position('on conflict on constraint training_workout_readiness_user_attempt_key' in lower(pg_get_functiondef(save_oid))) > 0 as save_rpc_uses_named_conflict_constraint,
    position('on conflict (user_id, workout_attempt_id)' in lower(pg_get_functiondef(save_oid))) = 0 as save_rpc_no_ambiguous_conflict_target,
    not has_function_privilege('anon', save_oid, 'execute') and not has_function_privilege('anon', link_oid, 'execute') as anon_rpc_no_execute,
    has_function_privilege('authenticated', save_oid, 'execute') and has_function_privilege('authenticated', link_oid, 'execute') as authenticated_rpc_execute
  from function_state
),
legacy_checks as (
  select
    to_regclass('public.training_daily_readiness') is not null as legacy_table_present,
    to_regprocedure('public.save_daily_training_readiness(jsonb)') is not null as legacy_rpc_present,
    not exists (
      select 1
      from pg_attribute
      where attrelid = 'public.training_daily_readiness'::regclass
        and attname = 'cycle_day_id'
        and attnum > 0
        and not attisdropped
    ) as legacy_cycle_day_id_absent,
    not exists (
      select 1
      from (
        select user_id, local_date
        from public.training_daily_readiness
        group by user_id, local_date
        having count(*) > 1
      ) duplicates
    ) as legacy_no_user_local_date_duplicates
),
counts as (
  select
    coalesce((select count(*) from public.training_workout_readiness), 0) as training_workout_readiness_rows,
    coalesce((select count(*) from public.training_daily_readiness), 0) as legacy_training_daily_readiness_rows,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'save_training_workout_readiness_v2') as save_training_workout_readiness_v2_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'link_training_workout_readiness_session_v2') as link_training_workout_readiness_session_v2_overloads,
    table_explicit_acl_rows,
    save_rpc_explicit_acl_rows,
    link_rpc_explicit_acl_rows
  from acl_counts
),
checks as (
  select 'training_workout_readiness_table_present' as check_name, exists (select 1 from table_state) as ok
  union all select 'required_columns_present', required_columns_present from column_checks
  union all select 'expected_column_count', expected_column_count from column_checks
  union all select 'id_default_gen_random_uuid', id_default_gen_random_uuid from default_checks
  union all select 'created_at_default_now', created_at_default_now from default_checks
  union all select 'updated_at_default_now', updated_at_default_now from default_checks
  union all select 'primary_key_present', primary_key_present from constraint_checks
  union all select 'user_attempt_unique_present', user_attempt_unique_present from constraint_checks
  union all select 'user_fk_exact_present', user_fk_exact_present from constraint_checks
  union all select 'cycle_fk_exact_present', cycle_fk_exact_present from constraint_checks
  union all select 'cycle_day_fk_exact_present', cycle_day_fk_exact_present from constraint_checks
  union all select 'training_session_fk_exact_present', training_session_fk_exact_present from constraint_checks
  union all select 'session_unique_partial_index_present', session_unique_partial_index_present from index_checks
  union all select 'user_created_index_present', user_created_index_present from index_checks
  union all select 'cycle_day_created_index_present', cycle_day_created_index_present from index_checks
  union all select 'updated_at_trigger_present', updated_at_trigger_present from trigger_checks
  union all select 'rls_enabled', rls_enabled from rls_checks
  union all select 'owner_select_policy_present', owner_select_policy_present from rls_checks
  union all select 'anon_table_no_privileges', anon_table_no_privileges from acl_checks
  union all select 'authenticated_table_expected_privileges', authenticated_table_expected_privileges from acl_checks
  union all select 'service_role_table_explicit_acl_absent', service_role_table_explicit_acl_absent from acl_checks
  union all select 'service_role_save_rpc_explicit_acl_absent', service_role_save_rpc_explicit_acl_absent from acl_checks
  union all select 'service_role_link_rpc_explicit_acl_absent', service_role_link_rpc_explicit_acl_absent from acl_checks
  union all select 'save_rpc_present', save_rpc_present from function_checks
  union all select 'link_rpc_present', link_rpc_present from function_checks
  union all select 'save_rpc_single_signature', save_rpc_single_signature from function_checks
  union all select 'link_rpc_single_signature', link_rpc_single_signature from function_checks
  union all select 'save_rpc_security_and_search_path', save_rpc_security_and_search_path from function_checks
  union all select 'link_rpc_security_and_search_path', link_rpc_security_and_search_path from function_checks
  union all select 'save_rpc_uses_named_conflict_constraint', save_rpc_uses_named_conflict_constraint from function_checks
  union all select 'save_rpc_no_ambiguous_conflict_target', save_rpc_no_ambiguous_conflict_target from function_checks
  union all select 'anon_rpc_no_execute', anon_rpc_no_execute from function_checks
  union all select 'authenticated_rpc_execute', authenticated_rpc_execute from function_checks
  union all select 'legacy_table_present', legacy_table_present from legacy_checks
  union all select 'legacy_rpc_present', legacy_rpc_present from legacy_checks
  union all select 'legacy_cycle_day_id_absent', legacy_cycle_day_id_absent from legacy_checks
  union all select 'legacy_no_user_local_date_duplicates', legacy_no_user_local_date_duplicates from legacy_checks
),
summary as (
  select bool_and(ok) as all_checks_ok from checks
)
select
  case
    when summary.all_checks_ok then 'PROD_READINESS_V2_VERIFIED'
    else 'PROD_READINESS_V2_POSTCHECK_FAILED'
  end as verdict,
  jsonb_object_agg(checks.check_name, checks.ok order by checks.check_name) as checks,
  (select to_jsonb(counts) from counts) as counts
from checks
cross join summary
group by summary.all_checks_ok;

rollback;
