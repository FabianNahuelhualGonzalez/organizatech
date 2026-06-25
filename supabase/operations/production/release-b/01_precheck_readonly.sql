-- Release B - Production precheck read-only for workout readiness v2.
-- Project ref: lzycxltqbrtsnwfdotqw.
-- No UUIDs, payloads, emails or personal data are returned.

begin transaction read only;

with legacy_table as (
  select c.oid
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'training_daily_readiness'
    and c.relkind = 'r'
),
legacy_function as (
  select p.oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'save_daily_training_readiness'
    and pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb'
),
legacy_unique as (
  select con.oid
  from pg_constraint con
  join legacy_table lt on lt.oid = con.conrelid
  where con.contype = 'u'
    and (
      select array_agg(att.attname::text order by ord.n)
      from unnest(con.conkey) with ordinality as ord(attnum, n)
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = ord.attnum
    ) = array['user_id','local_date']
),
legacy_duplicates as (
  select count(*) as duplicate_user_local_date_groups
  from (
    select user_id, local_date
    from public.training_daily_readiness
    group by user_id, local_date
    having count(*) > 1
  ) duplicates
  where to_regclass('public.training_daily_readiness') is not null
),
legacy_counts as (
  select count(*) as legacy_training_daily_readiness_rows
  from public.training_daily_readiness
  where to_regclass('public.training_daily_readiness') is not null
),
base_tables as (
  select
    to_regclass('public.training_cycles') is not null as training_cycles_present,
    to_regclass('public.training_cycle_days') is not null as training_cycle_days_present,
    to_regclass('public.training_sessions') is not null as training_sessions_present
),
base_columns as (
  select
    exists (select 1 from pg_attribute where attrelid = 'public.training_cycles'::regclass and attname = 'id' and not attisdropped) as training_cycles_id_present,
    exists (select 1 from pg_attribute where attrelid = 'public.training_cycles'::regclass and attname = 'user_id' and not attisdropped) as training_cycles_user_id_present,
    exists (select 1 from pg_attribute where attrelid = 'public.training_cycles'::regclass and attname = 'deleted_at' and not attisdropped) as training_cycles_deleted_at_present,
    exists (select 1 from pg_attribute where attrelid = 'public.training_cycle_days'::regclass and attname = 'id' and not attisdropped) as training_cycle_days_id_present,
    exists (select 1 from pg_attribute where attrelid = 'public.training_cycle_days'::regclass and attname = 'cycle_id' and not attisdropped) as training_cycle_days_cycle_id_present,
    exists (select 1 from pg_attribute where attrelid = 'public.training_cycle_days'::regclass and attname = 'deleted_at' and not attisdropped) as training_cycle_days_deleted_at_present,
    exists (select 1 from pg_attribute where attrelid = 'public.training_sessions'::regclass and attname = 'id' and not attisdropped) as training_sessions_id_present,
    exists (select 1 from pg_attribute where attrelid = 'public.training_sessions'::regclass and attname = 'user_id' and not attisdropped) as training_sessions_user_id_present,
    exists (select 1 from pg_attribute where attrelid = 'public.training_sessions'::regclass and attname = 'cycle_id' and not attisdropped) as training_sessions_cycle_id_present,
    exists (select 1 from pg_attribute where attrelid = 'public.training_sessions'::regclass and attname = 'cycle_day_id' and not attisdropped) as training_sessions_cycle_day_id_present,
    exists (select 1 from pg_attribute where attrelid = 'public.training_sessions'::regclass and attname = 'created_at' and not attisdropped) as training_sessions_created_at_present,
    exists (select 1 from pg_attribute where attrelid = 'public.training_sessions'::regclass and attname = 'deleted_at' and not attisdropped) as training_sessions_deleted_at_present
),
base_constraints as (
  select
    exists (
      select 1
      from pg_constraint con
      where con.conrelid = 'public.training_cycles'::regclass
        and con.contype in ('p','u')
        and (
          select array_agg(att.attname::text order by ord.n)
          from unnest(con.conkey) with ordinality as ord(attnum, n)
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = ord.attnum
        ) = array['id','user_id']
    ) as training_cycles_id_user_id_unique_present,
    exists (
      select 1
      from pg_constraint con
      where con.conrelid = 'public.training_cycle_days'::regclass
        and con.contype in ('p','u')
        and (
          select array_agg(att.attname::text order by ord.n)
          from unnest(con.conkey) with ordinality as ord(attnum, n)
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = ord.attnum
        ) = array['id','cycle_id']
    ) as training_cycle_days_id_cycle_id_unique_present,
    exists (
      select 1
      from pg_constraint con
      where con.conrelid = 'public.training_sessions'::regclass
        and con.contype = 'p'
        and (
          select array_agg(att.attname::text order by ord.n)
          from unnest(con.conkey) with ordinality as ord(attnum, n)
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = ord.attnum
        ) = array['id']
    ) as training_sessions_id_pk_present
),
support_checks as (
  select
    to_regprocedure('public.gen_random_uuid()') is not null
      or to_regprocedure('extensions.gen_random_uuid()') is not null
      or to_regprocedure('pg_catalog.gen_random_uuid()') is not null as gen_random_uuid_available,
    to_regprocedure('public.set_updated_at()') is not null as set_updated_at_available,
    exists (select 1 from pg_timezone_names where name = 'America/Santiago') as america_santiago_timezone_valid
),
v2_objects as (
  select
    to_regclass('public.training_workout_readiness') is not null as table_present,
    (
      select count(*)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'save_training_workout_readiness_v2'
    ) as save_v2_overloads,
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'save_training_workout_readiness_v2'
        and pg_get_function_identity_arguments(p.oid) = 'p_workout_attempt_id uuid, p_cycle_id uuid, p_cycle_day_id uuid, p_workout_started_at timestamp with time zone, p_payload jsonb'
    ) as save_v2_signature_present,
    (
      select count(*)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'link_training_workout_readiness_session_v2'
    ) as link_v2_overloads,
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'link_training_workout_readiness_session_v2'
        and pg_get_function_identity_arguments(p.oid) = 'p_workout_attempt_id uuid, p_training_session_id uuid'
    ) as link_v2_signature_present
),
v2_state as (
  select
    table_present,
    save_v2_overloads,
    save_v2_signature_present,
    link_v2_overloads,
    link_v2_signature_present,
    (table_present and save_v2_overloads = 1 and save_v2_signature_present and link_v2_overloads = 1 and link_v2_signature_present) as v2_complete,
    (not table_present and save_v2_overloads = 0 and link_v2_overloads = 0) as v2_absent,
    not (
      (table_present and save_v2_overloads = 1 and save_v2_signature_present and link_v2_overloads = 1 and link_v2_signature_present)
      or (not table_present and save_v2_overloads = 0 and link_v2_overloads = 0)
    ) as v2_partial_or_incompatible
  from v2_objects
),
checks as (
  select 'legacy_table_present' as check_name, exists (select 1 from legacy_table) as ok
  union all
  select 'legacy_save_rpc_single_signature', (select count(*) from legacy_function) = 1
  union all
  select 'legacy_cycle_day_id_absent', not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.training_daily_readiness'::regclass
      and attname = 'cycle_day_id'
      and attnum > 0
      and not attisdropped
  )
  union all
  select 'legacy_user_local_date_unique_present', exists (select 1 from legacy_unique)
  union all
  select 'legacy_no_user_local_date_duplicates', coalesce((select duplicate_user_local_date_groups from legacy_duplicates), 0) = 0
  union all
  select 'training_cycles_present', training_cycles_present from base_tables
  union all
  select 'training_cycle_days_present', training_cycle_days_present from base_tables
  union all
  select 'training_sessions_present', training_sessions_present from base_tables
  union all
  select 'base_columns_present',
    training_cycles_id_present
    and training_cycles_user_id_present
    and training_cycles_deleted_at_present
    and training_cycle_days_id_present
    and training_cycle_days_cycle_id_present
    and training_cycle_days_deleted_at_present
    and training_sessions_id_present
    and training_sessions_user_id_present
    and training_sessions_cycle_id_present
    and training_sessions_cycle_day_id_present
    and training_sessions_created_at_present
    and training_sessions_deleted_at_present
  from base_columns
  union all
  select 'base_constraints_for_v2_fks_present',
    training_cycles_id_user_id_unique_present
    and training_cycle_days_id_cycle_id_unique_present
    and training_sessions_id_pk_present
  from base_constraints
  union all
  select 'gen_random_uuid_available', gen_random_uuid_available from support_checks
  union all
  select 'set_updated_at_available', set_updated_at_available from support_checks
  union all
  select 'america_santiago_timezone_valid', america_santiago_timezone_valid from support_checks
  union all
  select 'v2_not_partial_or_incompatible', not v2_partial_or_incompatible from v2_state
),
counts as (
  select
    coalesce((select legacy_training_daily_readiness_rows from legacy_counts), 0) as legacy_training_daily_readiness_rows,
    coalesce((select duplicate_user_local_date_groups from legacy_duplicates), 0) as legacy_duplicate_user_local_date_groups,
    (select table_present from v2_state) as training_workout_readiness_present,
    (select save_v2_overloads from v2_state) as save_training_workout_readiness_v2_overloads,
    (select link_v2_overloads from v2_state) as link_training_workout_readiness_session_v2_overloads
),
summary as (
  select
    bool_and(checks.ok) as all_checks_ok,
    (select v2_absent from v2_state) as v2_absent,
    (select v2_complete from v2_state) as v2_complete,
    (select v2_partial_or_incompatible from v2_state) as v2_partial_or_incompatible
  from checks
)
select
  case
    when summary.all_checks_ok and summary.v2_absent then 'PROD_READINESS_V2_READY'
    when summary.all_checks_ok and summary.v2_complete then 'PROD_READINESS_V2_ALREADY_PRESENT'
    else 'PROD_READINESS_V2_BLOCKED'
  end as verdict,
  jsonb_object_agg(checks.check_name, checks.ok order by checks.check_name) as checks,
  (select to_jsonb(counts) from counts) as counts
from checks
cross join summary
where summary.all_checks_ok is not null
group by summary.all_checks_ok, summary.v2_absent, summary.v2_complete;

rollback;