-- Release B - Production service_role explicit ACL postcheck read-only.
-- Project ref: lzycxltqbrtsnwfdotqw.
-- Real Production result after rollout: all explicit service_role ACL counts were 0.
-- No UUIDs, payloads, emails or personal data are returned.

begin transaction read only;

with objects as (
  select
    'public.training_workout_readiness'::regclass as table_oid,
    to_regprocedure('public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamp with time zone, jsonb)') as save_rpc_oid,
    to_regprocedure('public.link_training_workout_readiness_session_v2(uuid, uuid)') as link_rpc_oid
),
acl_counts as (
  select
    (
      select count(*)
      from objects o
      join pg_class c on c.oid = o.table_oid
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
      join pg_roles grantee on grantee.oid = acl.grantee
      where grantee.rolname = 'service_role'
    ) as table_explicit_acl_rows,
    (
      select count(*)
      from objects o
      join pg_proc p on p.oid = o.save_rpc_oid
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      join pg_roles grantee on grantee.oid = acl.grantee
      where grantee.rolname = 'service_role'
    ) as save_rpc_explicit_acl_rows,
    (
      select count(*)
      from objects o
      join pg_proc p on p.oid = o.link_rpc_oid
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      join pg_roles grantee on grantee.oid = acl.grantee
      where grantee.rolname = 'service_role'
    ) as link_rpc_explicit_acl_rows
),
checks as (
  select 'service_role_table_explicit_acl_absent' as check_name, table_explicit_acl_rows = 0 as ok from acl_counts
  union all
  select 'service_role_save_rpc_explicit_acl_absent', save_rpc_explicit_acl_rows = 0 from acl_counts
  union all
  select 'service_role_link_rpc_explicit_acl_absent', link_rpc_explicit_acl_rows = 0 from acl_counts
),
summary as (
  select bool_and(ok) as all_checks_ok from checks
)
select
  case
    when summary.all_checks_ok then 'PROD_SERVICE_ROLE_EXPLICIT_ACL_CLEAN'
    else 'PROD_SERVICE_ROLE_EXPLICIT_ACL_FOUND'
  end as verdict,
  jsonb_object_agg(checks.check_name, checks.ok order by checks.check_name) as checks,
  (select to_jsonb(acl_counts) from acl_counts) as counts
from checks
cross join summary
group by summary.all_checks_ok;

rollback;
