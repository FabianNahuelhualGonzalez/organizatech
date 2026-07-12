-- P0-D.1-QA-DATA rollback for Supabase QA only.
--
-- WARNING: execute only with explicit authorization, only in project ref
-- fjjebhaqtrdbpxzxztmh, and only BEFORE P0-D.1 creates
-- training_sessions_user_cycle_day_trained_unique_idx.
--
-- This rollback directly restores deleted_at = null for exactly the six
-- candidate sessions. It never writes public.exercise_entries or
-- public.training_workout_readiness, and it never hard-deletes data.
--
-- The sessions_set_updated_at trigger assigns a new updated_at when deleted_at
-- is restored. This is expected: the rollback restores functional session
-- visibility, but intentionally does not restore the historical updated_at.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Manual environment gate: confirm the Supabase QA project ref outside SQL.
select current_database() as connected_database, current_user as executing_role;

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

do $rollback_precheck$
declare
  v_target_user_id uuid;
  v_authorized_user_count integer;
  v_expected_group_count integer;
  v_soft_deleted_candidate_count integer;
  v_active_canonical_count integer;
  v_mapping_count integer;
  v_unexpected_active_member_count integer;
  v_readiness_link_count integer;
begin
  select count(*)
  into v_authorized_user_count
  from qa_p0_d1_authorized_users;

  if v_authorized_user_count <> 1 then
    raise exception 'P0-D.1-QA-DATA rollback aborted: expected exactly one authorized user, found %', v_authorized_user_count;
  end if;

  select user_id
  into v_target_user_id
  from qa_p0_d1_authorized_users;

  if to_regclass('public.training_sessions_user_cycle_day_trained_unique_idx') is not null then
    raise exception 'P0-D.1-QA-DATA rollback aborted: P0-D.1 unique index already exists. This rollback is valid only before P0-D.1.';
  end if;

  select count(*)
  into v_expected_group_count
  from qa_p0_d1_expected_groups;

  if v_expected_group_count <> 4 then
    raise exception 'P0-D.1-QA-DATA rollback aborted: expected exactly 4 explicit groups, found %', v_expected_group_count;
  end if;

  select count(*)
  into v_soft_deleted_candidate_count
  from public.training_sessions s
  join qa_p0_d1_expected_sessions e on e.session_id = s.id
  where e.session_role = 'candidate'
    and s.deleted_at is not null;

  if v_soft_deleted_candidate_count <> 6 then
    raise exception 'P0-D.1-QA-DATA rollback aborted: expected exactly 6 soft-deleted candidates, found %', v_soft_deleted_candidate_count;
  end if;

  select count(*)
  into v_active_canonical_count
  from public.training_sessions s
  join qa_p0_d1_expected_sessions e on e.session_id = s.id
  where e.session_role = 'canonical'
    and s.user_id = v_target_user_id
    and s.deleted_at is null;

  if v_active_canonical_count <> 4 then
    raise exception 'P0-D.1-QA-DATA rollback aborted: expected exactly 4 active canonical sessions, found %', v_active_canonical_count;
  end if;

  select count(*)
  into v_mapping_count
  from qa_p0_d1_expected_sessions e
  join qa_p0_d1_expected_groups g on g.group_key = e.group_key
  join public.training_sessions s on s.id = e.session_id
  where s.user_id = v_target_user_id
    and s.cycle_day_id = g.cycle_day_id
    and s.trained_date = g.trained_date;

  if v_mapping_count <> 10 then
    raise exception 'P0-D.1-QA-DATA rollback aborted: explicit session-to-user/cycle-day/date mapping expected 10, found %', v_mapping_count;
  end if;

  select count(*)
  into v_unexpected_active_member_count
  from public.training_sessions s
  join qa_p0_d1_expected_groups g
    on g.cycle_day_id = s.cycle_day_id
   and g.trained_date = s.trained_date
  left join qa_p0_d1_expected_sessions e on e.session_id = s.id
  where s.user_id = v_target_user_id
    and s.deleted_at is null
    and (e.session_role is distinct from 'canonical');

  if v_unexpected_active_member_count <> 0 then
    raise exception 'P0-D.1-QA-DATA rollback aborted: found % non-canonical active session(s) in the four authorized groups', v_unexpected_active_member_count;
  end if;

  select count(*)
  into v_readiness_link_count
  from public.training_workout_readiness r
  join qa_p0_d1_expected_sessions e on e.session_id = r.training_session_id
  where e.session_role = 'candidate';

  if v_readiness_link_count <> 0 then
    raise exception 'P0-D.1-QA-DATA rollback aborted: % readiness link(s) reference candidate sessions', v_readiness_link_count;
  end if;
end;
$rollback_precheck$;

-- Snapshot every functional session column before restoring visibility.
-- deleted_at and updated_at are excluded because this rollback and its trigger
-- intentionally change only those fields.
create temp table qa_p0_d1_session_snapshot on commit drop as
select
  s.id,
  to_jsonb(s) - array['deleted_at', 'updated_at']::text[] as functional_payload
from public.training_sessions s
join qa_p0_d1_expected_sessions e on e.session_id = s.id;

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

create temp table qa_p0_d1_restored_candidates (
  session_id uuid primary key
) on commit drop;

with restored as (
  update public.training_sessions s
  set deleted_at = null
  from qa_p0_d1_expected_sessions e
  where s.id = e.session_id
    and e.session_role = 'candidate'
    and s.deleted_at is not null
  returning s.id
)
insert into qa_p0_d1_restored_candidates (session_id)
select id
from restored;

do $rollback_postcheck$
declare
  v_target_user_id uuid;
  v_authorized_user_count integer;
  v_restored_count integer;
  v_active_target_count integer;
  v_bad_group_count integer;
  v_duplicate_group_count integer;
  v_unmapped_duplicate_count integer;
  v_missing_session_count integer;
  v_functional_session_change_count integer;
  v_entry_membership_change_count integer;
begin
  select count(*)
  into v_authorized_user_count
  from qa_p0_d1_authorized_users;

  if v_authorized_user_count <> 1 then
    raise exception 'P0-D.1-QA-DATA rollback aborted: expected exactly one authorized user, found %', v_authorized_user_count;
  end if;

  select user_id
  into v_target_user_id
  from qa_p0_d1_authorized_users;

  select count(*) into v_restored_count from qa_p0_d1_restored_candidates;
  if v_restored_count <> 6 then
    raise exception 'P0-D.1-QA-DATA rollback aborted: expected 6 restored candidates, restored %', v_restored_count;
  end if;

  select count(*)
  into v_active_target_count
  from public.training_sessions s
  join qa_p0_d1_expected_sessions e on e.session_id = s.id
  where s.deleted_at is null;

  if v_active_target_count <> 10 then
    raise exception 'P0-D.1-QA-DATA rollback aborted: expected 10 active target sessions after rollback, found %', v_active_target_count;
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
    raise exception 'P0-D.1-QA-DATA rollback aborted: one or more groups do not contain the expected 4/2/2/2 active sessions';
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
    raise exception 'P0-D.1-QA-DATA rollback aborted: expected exactly 4 active duplicate groups after rollback, found %', v_duplicate_group_count;
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
    raise exception 'P0-D.1-QA-DATA rollback aborted: active duplicate groups exist outside the four authorized groups';
  end if;

  select count(*)
  into v_missing_session_count
  from qa_p0_d1_session_snapshot before_snapshot
  left join public.training_sessions current_session on current_session.id = before_snapshot.id
  where current_session.id is null;

  if v_missing_session_count <> 0 then
    raise exception 'P0-D.1-QA-DATA rollback aborted: % target training_session row(s) disappeared during rollback', v_missing_session_count;
  end if;

  select count(*)
  into v_functional_session_change_count
  from qa_p0_d1_session_snapshot before_snapshot
  join public.training_sessions current_session on current_session.id = before_snapshot.id
  where before_snapshot.functional_payload is distinct from (
    to_jsonb(current_session) - array['deleted_at', 'updated_at']::text[]
  );

  if v_functional_session_change_count <> 0 then
    raise exception 'P0-D.1-QA-DATA rollback aborted: % target training_session row(s) changed outside deleted_at/updated_at', v_functional_session_change_count;
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
    raise exception 'P0-D.1-QA-DATA rollback aborted: exercise_entries changed session membership during rollback';
  end if;
end;
$rollback_postcheck$;

select
  g.group_key,
  g.cycle_day_id,
  g.trained_date,
  g.canonical_session_id,
  array_agg(e.session_id order by e.session_id) filter (where e.session_role = 'candidate') as restored_candidate_ids
from qa_p0_d1_expected_groups g
join qa_p0_d1_expected_sessions e on e.group_key = g.group_key
group by g.group_key, g.cycle_day_id, g.trained_date, g.canonical_session_id
order by g.group_key;

select
  count(*) filter (where s.deleted_at is null) as active_target_sessions,
  count(*) filter (where s.deleted_at is not null) as soft_deleted_target_sessions
from public.training_sessions s
join qa_p0_d1_expected_sessions e on e.session_id = s.id;

-- Final execution evidence. All values must match the documented rollback
-- contract before this transaction reaches COMMIT.
select
  (select count(*) from qa_p0_d1_restored_candidates) as restored_candidates,
  (select count(*)
   from public.training_sessions s
   join qa_p0_d1_expected_sessions e on e.session_id = s.id
   where s.deleted_at is null) as active_target_sessions,
  (select count(*)
   from qa_p0_d1_session_snapshot before_snapshot
   left join public.training_sessions current_session on current_session.id = before_snapshot.id
   where current_session.id is null) as missing_target_sessions,
  (select count(*)
   from (
     select s.cycle_day_id, s.trained_date
     from public.training_sessions s
     cross join qa_p0_d1_authorized_users a
     where s.user_id = a.user_id
       and s.cycle_day_id is not null
       and s.deleted_at is null
     group by s.cycle_day_id, s.trained_date
     having count(*) > 1
   ) duplicate_groups) as authorized_duplicate_groups,
  (select count(*)
   from (
     select s.cycle_day_id, s.trained_date
     from public.training_sessions s
     cross join qa_p0_d1_authorized_users a
     where s.user_id = a.user_id
       and s.cycle_day_id is not null
       and s.deleted_at is null
     group by s.cycle_day_id, s.trained_date
     having count(*) > 1
   ) duplicate_groups
   left join qa_p0_d1_expected_groups g
     on g.cycle_day_id = duplicate_groups.cycle_day_id
    and g.trained_date = duplicate_groups.trained_date
   where g.group_key is null) as unauthorized_duplicate_groups,
  (select count(*)
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
   where before_snapshot.entry_ids is distinct from after_snapshot.entry_ids) as entry_membership_changes,
  (select count(*)
   from public.training_workout_readiness r
   join qa_p0_d1_expected_sessions e on e.session_id = r.training_session_id
   where e.session_role = 'candidate') as readiness_links_to_candidates,
  (select count(*)
   from qa_p0_d1_session_snapshot before_snapshot
   join public.training_sessions current_session on current_session.id = before_snapshot.id
   where before_snapshot.functional_payload is distinct from (
     to_jsonb(current_session) - array['deleted_at', 'updated_at']::text[]
   )) as functional_session_changes;

select
  g.group_key,
  count(s.id) filter (where s.deleted_at is null) as active_sessions,
  g.expected_active_count
from qa_p0_d1_expected_groups g
join public.training_sessions s
  on s.cycle_day_id = g.cycle_day_id
 and s.trained_date = g.trained_date
cross join qa_p0_d1_authorized_users a
where s.user_id = a.user_id
group by g.group_key, g.expected_active_count
order by g.group_key;

commit;
