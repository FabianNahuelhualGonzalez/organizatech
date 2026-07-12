-- P0-D.1-QA-DATA: controlled cleanup for Supabase QA only.
--
-- MANUAL ENVIRONMENT GATE (required before execution):
--   1. Confirm in Supabase that the selected project ref is
--      fjjebhaqtrdbpxzxztmh (Organizatech QA).
--   2. Do not execute in Production.
--   3. Execute this script before applying P0-D.1. It aborts if the
--      P0-D.1 partial unique index already exists.
--
-- This script directly changes only public.training_sessions.deleted_at for the
-- six explicit candidate rows below. The sessions_set_updated_at trigger also
-- assigns updated_at; that is expected. The rollback restores functional
-- visibility but intentionally does not restore historical updated_at values.
-- This script does not insert, update, delete, move, or reassign
-- public.exercise_entries or public.training_workout_readiness.
-- No audit table is created or reused. Preserve the query output externally as
-- the execution evidence for this QA-only operation.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Informational only. PostgreSQL does not expose the Supabase project ref to
-- this session, so the project-ref gate above must be confirmed manually.
select current_database() as connected_database, current_user as executing_role;

-- Hold writes to the parent and child tables while assertions and postchecks
-- run. This prevents a concurrent session, entry, or readiness write from
-- invalidating the controlled result inside this transaction.
lock table public.training_sessions in share row exclusive mode;
lock table public.exercise_entries in share row exclusive mode;
lock table public.training_workout_readiness in share row exclusive mode;

create temp table qa_p0_d1_authorized_users (
  user_id uuid primary key
) on commit drop;

insert into qa_p0_d1_authorized_users (user_id) values
  ('e936bd5c-11fb-43cf-b31c-67125a4caf54');

create temp table qa_p0_d1_expected_groups (
  group_key text primary key,
  cycle_day_id uuid not null,
  trained_date date not null,
  canonical_session_id uuid not null,
  expected_active_count integer not null check (expected_active_count > 1)
) on commit drop;

insert into qa_p0_d1_expected_groups (
  group_key,
  cycle_day_id,
  trained_date,
  canonical_session_id,
  expected_active_count
) values
  ('g1', '2c8ecbc3-29ee-403a-9b5d-d88449b2cfa1', date '2026-06-05', '33ac7a6a-734c-4728-bcb5-afa10f3da630', 4),
  ('g2', '9d3630ad-eb30-4e81-b0a5-1f7c2e5a531f', date '2026-06-19', '683bdb4f-e430-4440-8a92-102a4b414ffc', 2),
  ('g3', '9d3630ad-eb30-4e81-b0a5-1f7c2e5a531f', date '2026-06-29', '1c7988de-635b-497e-a99d-98c4d6cdbab4', 2),
  ('g4', '9d3630ad-eb30-4e81-b0a5-1f7c2e5a531f', date '2026-07-01', 'f6370c81-b82b-41a1-b432-a357028b83d1', 2);

create temp table qa_p0_d1_expected_sessions (
  session_id uuid primary key,
  group_key text not null references qa_p0_d1_expected_groups(group_key),
  session_role text not null check (session_role in ('canonical', 'candidate'))
) on commit drop;

insert into qa_p0_d1_expected_sessions (session_id, group_key, session_role) values
  ('33ac7a6a-734c-4728-bcb5-afa10f3da630', 'g1', 'canonical'),
  ('63228bf9-b388-4c3c-a698-d43a6e6b1f32', 'g1', 'candidate'),
  ('8153f872-c6d2-420d-a20d-217a84761453', 'g1', 'candidate'),
  ('41478814-b303-4d7b-bad7-63476694b19b', 'g1', 'candidate'),
  ('683bdb4f-e430-4440-8a92-102a4b414ffc', 'g2', 'canonical'),
  ('3ce6cf45-ad52-4d82-ba4c-9fc36815b4d1', 'g2', 'candidate'),
  ('1c7988de-635b-497e-a99d-98c4d6cdbab4', 'g3', 'canonical'),
  ('f0519208-95fc-46d3-99e0-79841259dd1b', 'g3', 'candidate'),
  ('f6370c81-b82b-41a1-b432-a357028b83d1', 'g4', 'canonical'),
  ('558911af-922d-4f75-9771-34a21fe67f29', 'g4', 'candidate');

do $precheck$
declare
  v_target_user_id uuid;
  v_authorized_user_count integer;
  v_target_ids uuid[];
  v_expected_group_count integer;
  v_expected_count integer;
  v_active_expected_count integer;
  v_completed_expected_count integer;
  v_mapping_count integer;
  v_bad_group_count integer;
  v_unexpected_member_count integer;
  v_duplicate_group_count integer;
  v_unmapped_duplicate_count integer;
  v_noncanonical_latest_count integer;
  v_readiness_link_count integer;
  v_legacy_audit_link_count integer := 0;
begin
  select count(*)
  into v_authorized_user_count
  from qa_p0_d1_authorized_users;

  if v_authorized_user_count <> 1 then
    raise exception 'P0-D.1-QA-DATA aborted: expected exactly one authorized user, found %', v_authorized_user_count;
  end if;

  select user_id
  into v_target_user_id
  from qa_p0_d1_authorized_users;

  if to_regclass('public.training_sessions_user_cycle_day_trained_unique_idx') is not null then
    raise exception 'P0-D.1-QA-DATA aborted: training_sessions_user_cycle_day_trained_unique_idx already exists. Run this cleanup only before P0-D.1.';
  end if;

  select count(*)
  into v_expected_group_count
  from qa_p0_d1_expected_groups;

  if v_expected_group_count <> 4 then
    raise exception 'P0-D.1-QA-DATA aborted: expected exactly 4 explicit groups, found %', v_expected_group_count;
  end if;

  select array_agg(session_id order by session_id), count(*)
  into v_target_ids, v_expected_count
  from qa_p0_d1_expected_sessions;

  if v_expected_count <> 10 then
    raise exception 'P0-D.1-QA-DATA aborted: expected exactly 10 explicit sessions, found %', v_expected_count;
  end if;

  select count(*)
  into v_active_expected_count
  from public.training_sessions s
  where s.id = any(v_target_ids)
    and s.deleted_at is null;

  if v_active_expected_count <> 10 then
    raise exception 'P0-D.1-QA-DATA aborted: expected the 10 explicit sessions to be active, found %', v_active_expected_count;
  end if;

  select count(*)
  into v_completed_expected_count
  from public.training_sessions s
  where s.id = any(v_target_ids)
    and s.status = 'completed';

  if v_completed_expected_count <> 10 then
    raise exception 'P0-D.1-QA-DATA aborted: expected the 10 explicit sessions to have status completed, found %', v_completed_expected_count;
  end if;

  select count(*)
  into v_mapping_count
  from qa_p0_d1_expected_sessions e
  join qa_p0_d1_expected_groups g on g.group_key = e.group_key
  join public.training_sessions s on s.id = e.session_id
  where s.user_id = v_target_user_id
    and s.cycle_day_id = g.cycle_day_id
    and s.trained_date = g.trained_date
    and s.deleted_at is null;

  if v_mapping_count <> 10 then
    raise exception 'P0-D.1-QA-DATA aborted: explicit session-to-user/cycle-day/date mapping expected 10, found %', v_mapping_count;
  end if;

  select count(*)
  into v_bad_group_count
  from qa_p0_d1_expected_groups g
  join lateral (
    select count(*) as active_count
    from public.training_sessions s
    where s.user_id = v_target_user_id
      and s.cycle_day_id = g.cycle_day_id
      and s.trained_date = g.trained_date
      and s.deleted_at is null
  ) actual on true
  where actual.active_count <> g.expected_active_count;

  if v_bad_group_count <> 0 then
    raise exception 'P0-D.1-QA-DATA aborted: one or more groups do not contain the exact expected active-member count';
  end if;

  select count(*)
  into v_unexpected_member_count
  from public.training_sessions s
  join qa_p0_d1_expected_groups g
    on g.cycle_day_id = s.cycle_day_id
   and g.trained_date = s.trained_date
  left join qa_p0_d1_expected_sessions e on e.session_id = s.id
  where s.user_id = v_target_user_id
    and s.deleted_at is null
    and e.session_id is null;

  if v_unexpected_member_count <> 0 then
    raise exception 'P0-D.1-QA-DATA aborted: found % unexpected active session(s) in the four explicit groups', v_unexpected_member_count;
  end if;

  select count(*)
  into v_duplicate_group_count
  from (
    select s.cycle_day_id, s.trained_date
    from public.training_sessions s
    where s.user_id = v_target_user_id
      and s.cycle_day_id is not null
      and s.deleted_at is null
    group by s.cycle_day_id, s.trained_date
    having count(*) > 1
  ) duplicate_groups;

  if v_duplicate_group_count <> 4 then
    raise exception 'P0-D.1-QA-DATA aborted: expected exactly 4 active duplicate groups for the QA user, found %', v_duplicate_group_count;
  end if;

  select count(*)
  into v_unmapped_duplicate_count
  from (
    select s.cycle_day_id, s.trained_date
    from public.training_sessions s
    where s.user_id = v_target_user_id
      and s.cycle_day_id is not null
      and s.deleted_at is null
    group by s.cycle_day_id, s.trained_date
    having count(*) > 1
  ) duplicate_groups
  left join qa_p0_d1_expected_groups g
    on g.cycle_day_id = duplicate_groups.cycle_day_id
   and g.trained_date = duplicate_groups.trained_date
  where g.group_key is null;

  if v_unmapped_duplicate_count <> 0 then
    raise exception 'P0-D.1-QA-DATA aborted: active duplicate groups exist outside the four authorized groups';
  end if;

  -- "Most recent" is deliberately defined as created_at DESC, then UUID DESC
  -- only to break a timestamp tie deterministically.
  select count(*)
  into v_noncanonical_latest_count
  from qa_p0_d1_expected_groups g
  join lateral (
    select s.id
    from public.training_sessions s
    where s.user_id = v_target_user_id
      and s.cycle_day_id = g.cycle_day_id
      and s.trained_date = g.trained_date
      and s.deleted_at is null
    order by s.created_at desc, s.id desc
    limit 1
  ) latest on true
  where latest.id <> g.canonical_session_id;

  if v_noncanonical_latest_count <> 0 then
    raise exception 'P0-D.1-QA-DATA aborted: an authorized canonical session is not the most recent row in its group';
  end if;

  select count(*)
  into v_readiness_link_count
  from public.training_workout_readiness r
  join qa_p0_d1_expected_sessions e on e.session_id = r.training_session_id
  where e.session_role = 'candidate';

  if v_readiness_link_count <> 0 then
    raise exception 'P0-D.1-QA-DATA aborted: % readiness link(s) reference candidate sessions', v_readiness_link_count;
  end if;

  -- Legacy audit is not reused. If it exists, its presence must not already
  -- reference any of these ten rows because that would require an explicit
  -- reconciliation decision before proceeding.
  if to_regclass('public.training_session_consolidation_audit') is not null then
    select count(*)
    into v_legacy_audit_link_count
    from public.training_session_consolidation_audit a
    where a.canonical_session_id = any(v_target_ids)
       or a.legacy_session_ids && v_target_ids;
  end if;

  if v_legacy_audit_link_count <> 0 then
    raise exception 'P0-D.1-QA-DATA aborted: % legacy consolidation-audit reference(s) found for target sessions', v_legacy_audit_link_count;
  end if;
end;
$precheck$;

-- Snapshot all functional session columns before the controlled visibility
-- change. deleted_at and updated_at are excluded because the update and its
-- trigger intentionally change only those fields.
create temp table qa_p0_d1_session_snapshot on commit drop as
select
  s.id,
  to_jsonb(s) - array['deleted_at', 'updated_at']::text[] as functional_payload
from public.training_sessions s
join qa_p0_d1_expected_sessions e on e.session_id = s.id;

-- Snapshot entry membership before changing parent visibility. The script never
-- writes exercise_entries; the postcheck compares these exact ID arrays.
create temp table qa_p0_d1_entry_snapshot on commit drop as
select
  e.session_id,
  coalesce(
    array_agg(entry_row.id order by entry_row.id) filter (where entry_row.id is not null),
    '{}'::uuid[]
  ) as entry_ids
from qa_p0_d1_expected_sessions e
left join public.exercise_entries entry_row on entry_row.session_id = e.session_id
group by e.session_id;

create temp table qa_p0_d1_updated_candidates (
  session_id uuid primary key
) on commit drop;

with updated as (
  update public.training_sessions s
  set deleted_at = statement_timestamp()
  from qa_p0_d1_expected_sessions e
  where s.id = e.session_id
    and e.session_role = 'candidate'
    and s.deleted_at is null
  returning s.id
)
insert into qa_p0_d1_updated_candidates (session_id)
select id
from updated;

do $postcheck$
declare
  v_target_user_id uuid;
  v_authorized_user_count integer;
  v_updated_count integer;
  v_soft_deleted_candidate_count integer;
  v_active_canonical_count integer;
  v_remaining_duplicate_group_count integer;
  v_missing_session_count integer;
  v_functional_session_change_count integer;
  v_entry_membership_change_count integer;
begin
  select count(*)
  into v_authorized_user_count
  from qa_p0_d1_authorized_users;

  if v_authorized_user_count <> 1 then
    raise exception 'P0-D.1-QA-DATA aborted: expected exactly one authorized user, found %', v_authorized_user_count;
  end if;

  select user_id
  into v_target_user_id
  from qa_p0_d1_authorized_users;

  select count(*) into v_updated_count from qa_p0_d1_updated_candidates;
  if v_updated_count <> 6 then
    raise exception 'P0-D.1-QA-DATA aborted: expected 6 soft-deletes, updated %', v_updated_count;
  end if;

  select count(*)
  into v_soft_deleted_candidate_count
  from public.training_sessions s
  join qa_p0_d1_expected_sessions e on e.session_id = s.id
  where e.session_role = 'candidate'
    and s.deleted_at is not null;

  if v_soft_deleted_candidate_count <> 6 then
    raise exception 'P0-D.1-QA-DATA aborted: expected 6 soft-deleted candidates, found %', v_soft_deleted_candidate_count;
  end if;

  select count(*)
  into v_active_canonical_count
  from public.training_sessions s
  join qa_p0_d1_expected_sessions e on e.session_id = s.id
  where e.session_role = 'canonical'
    and s.deleted_at is null;

  if v_active_canonical_count <> 4 then
    raise exception 'P0-D.1-QA-DATA aborted: expected 4 active canonical sessions, found %', v_active_canonical_count;
  end if;

  select count(*)
  into v_remaining_duplicate_group_count
  from (
    select s.cycle_day_id, s.trained_date
    from public.training_sessions s
    where s.user_id = v_target_user_id
      and s.cycle_day_id is not null
      and s.deleted_at is null
    group by s.cycle_day_id, s.trained_date
    having count(*) > 1
  ) duplicate_groups;

  if v_remaining_duplicate_group_count <> 0 then
    raise exception 'P0-D.1-QA-DATA aborted: expected zero active duplicate groups after cleanup, found %', v_remaining_duplicate_group_count;
  end if;

  select count(*)
  into v_missing_session_count
  from qa_p0_d1_session_snapshot before_snapshot
  left join public.training_sessions current_session on current_session.id = before_snapshot.id
  where current_session.id is null;

  if v_missing_session_count <> 0 then
    raise exception 'P0-D.1-QA-DATA aborted: % target training_session row(s) disappeared during cleanup', v_missing_session_count;
  end if;

  select count(*)
  into v_functional_session_change_count
  from qa_p0_d1_session_snapshot before_snapshot
  join public.training_sessions current_session on current_session.id = before_snapshot.id
  where before_snapshot.functional_payload is distinct from (
    to_jsonb(current_session) - array['deleted_at', 'updated_at']::text[]
  );

  if v_functional_session_change_count <> 0 then
    raise exception 'P0-D.1-QA-DATA aborted: % target training_session row(s) changed outside deleted_at/updated_at', v_functional_session_change_count;
  end if;

  select count(*)
  into v_entry_membership_change_count
  from qa_p0_d1_entry_snapshot before_snapshot
  full join (
    select
      e.session_id,
      coalesce(
        array_agg(entry_row.id order by entry_row.id) filter (where entry_row.id is not null),
        '{}'::uuid[]
      ) as entry_ids
    from qa_p0_d1_expected_sessions e
    left join public.exercise_entries entry_row on entry_row.session_id = e.session_id
    group by e.session_id
  ) after_snapshot on after_snapshot.session_id = before_snapshot.session_id
  where before_snapshot.entry_ids is distinct from after_snapshot.entry_ids;

  if v_entry_membership_change_count <> 0 then
    raise exception 'P0-D.1-QA-DATA aborted: exercise_entries changed session membership during cleanup';
  end if;
end;
$postcheck$;

-- Exportable execution evidence. Capture these result sets before closing the
-- SQL Editor tab; no audit row is persisted by design.
select
  g.group_key,
  g.cycle_day_id,
  g.trained_date,
  g.canonical_session_id,
  array_agg(e.session_id order by e.session_id) filter (where e.session_role = 'candidate') as soft_deleted_candidate_ids
from qa_p0_d1_expected_groups g
join qa_p0_d1_expected_sessions e on e.group_key = g.group_key
group by g.group_key, g.cycle_day_id, g.trained_date, g.canonical_session_id
order by g.group_key;

select
  count(*) filter (where s.deleted_at is null) as active_target_sessions,
  count(*) filter (where s.deleted_at is not null) as soft_deleted_target_sessions
from public.training_sessions s
join qa_p0_d1_expected_sessions e on e.session_id = s.id;

commit;
