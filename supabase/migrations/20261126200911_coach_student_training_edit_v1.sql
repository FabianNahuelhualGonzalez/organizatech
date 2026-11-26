-- Local preparation: delegated edit of an existing active Usuario cycle.
-- Owner-facing RPCs still derive their identity from auth.uid().
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- The existing validation and persistence helpers use this guard. Their
-- privileged callers must still derive the student from an active episode;
-- authenticated clients have no direct EXECUTE on these private helpers.
create or replace function private.assert_training_cycle_portal_access(
  p_user_id uuid, p_portal_scope text
) returns void language plpgsql security invoker set search_path = '' as $fn$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or p_user_id is null
    or p_portal_scope not in ('usuario', 'coach') then
    raise exception 'training cycle portal access denied' using errcode = '42501';
  end if;
  if p_user_id = v_actor then
    if p_portal_scope = 'usuario' and exists (
      select 1 from public.user_registrations registration
      where registration.user_id = v_actor
    ) then return; end if;
    if p_portal_scope = 'coach' and exists (
      select 1 from public.coach_registrations registration
      where registration.user_id = v_actor
    ) then return; end if;
  elsif p_portal_scope = 'usuario' and exists (
    select 1 from private.coach_relationship_episodes episode
    join public.coach_registrations registration
      on registration.user_id = episode.coach_user_id
    where episode.coach_user_id = v_actor
      and episode.student_user_id = p_user_id and episode.ended_at is null
  ) then return;
  end if;
  raise exception 'training cycle portal access denied' using errcode = '42501';
end;
$fn$;
revoke all on function private.assert_training_cycle_portal_access(uuid,text)
  from public, anon, authenticated, service_role;

create table private.coach_student_training_edits (
  student_user_id uuid not null,
  actor_user_id uuid not null,
  relationship_episode_id uuid not null references private.coach_relationship_episodes(id),
  request_id uuid not null,
  cycle_id uuid not null,
  plan_version_id uuid not null references public.training_cycle_plan_versions(id),
  action text not null check (action in ('create_routine','modify_routine','remove_routine')),
  from_version integer not null,
  to_version integer not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (student_user_id, request_id),
  check (to_version = from_version + 1)
);
create index coach_student_training_edits_episode_time
  on private.coach_student_training_edits(relationship_episode_id, recorded_at desc);
alter table private.coach_student_training_edits enable row level security;
alter table private.coach_student_training_edits force row level security;
revoke all on private.coach_student_training_edits from public, anon, authenticated, service_role;

-- A committed audit row alone cannot authorize another write: its source
-- version, new immutable version, actor and active episode must all match the
-- exact UPDATE being executed. Direct client roles are rejected by the guard.
-- VOLATILE observes the audit row and version inserted earlier in this RPC.
create function private.allow_coach_student_training_cycle_update(
  p_old public.training_cycles, p_new public.training_cycles, p_actor uuid
) returns boolean language sql volatile security invoker set search_path = '' as $fn$
  select p_old.id = p_new.id
    and p_old.user_id = p_new.user_id
    and p_old.portal_scope = 'usuario' and p_new.portal_scope = 'usuario'
    and p_old.status = 'active' and p_new.status = 'active'
    and p_old.current_plan_version_id is not null
    and p_new.current_plan_version = p_old.current_plan_version + 1
    and p_new.current_plan_version_id is distinct from p_old.current_plan_version_id
    and pg_catalog.to_jsonb(p_old) - array[
      'goal','plan_snapshot','current_plan_version','current_plan_version_id','updated_at'
    ] = pg_catalog.to_jsonb(p_new) - array[
      'goal','plan_snapshot','current_plan_version','current_plan_version_id','updated_at'
    ]
    and exists (
      select 1 from private.coach_student_training_edits edit
      join private.coach_relationship_episodes episode
        on episode.id = edit.relationship_episode_id
        and episode.coach_user_id = edit.actor_user_id
        and episode.student_user_id = edit.student_user_id
        and episode.ended_at is null
      join public.training_cycle_plan_versions version
        on version.id = edit.plan_version_id
        and version.cycle_id = edit.cycle_id
        and version.user_id = edit.student_user_id
        and version.portal_scope = 'usuario'
        and version.request_id = edit.request_id
        and version.version = edit.to_version
      where edit.actor_user_id = p_actor and edit.student_user_id = p_old.user_id
        and edit.cycle_id = p_old.id
        and edit.from_version = p_old.current_plan_version
        and edit.to_version = p_new.current_plan_version
        and edit.plan_version_id = p_new.current_plan_version_id
        and version.source_version_id = p_old.current_plan_version_id
        and version.plan_payload = p_new.plan_snapshot
        and version.goal = p_new.goal
    );
$fn$;
revoke all on function private.allow_coach_student_training_cycle_update(
  public.training_cycles,public.training_cycles,uuid)
  from public, anon, authenticated, service_role;

-- Preserve every existing legacy guard rule; add only the verified Coach UPDATE.
create or replace function private.guard_training_cycle_legacy_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_is_direct_client boolean := current_user::pg_catalog.text in (
    'anon', 'authenticated', 'service_role'
  );
begin
  if current_user::pg_catalog.text = 'service_role' then
    raise exception 'training cycle direct service role write denied'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and v_actor_id is null then
    raise exception 'training cycle ownership denied' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if v_is_direct_client then
      if v_actor_id is null or new.user_id is distinct from v_actor_id then
        raise exception 'training cycle ownership denied' using errcode = '42501';
      end if;
      if new.portal_scope is distinct from 'usuario' then
        raise exception 'legacy training cycle writes require usuario portal'
          using errcode = '42501';
      end if;

      -- Canonical assignment is defense in depth for callers that still send
      -- the historical user_id field in their INSERT allowlist.
      new.user_id := v_actor_id;
      new.portal_scope := 'usuario';
    elsif v_actor_id is not null and new.user_id is distinct from v_actor_id then
      raise exception 'training cycle ownership denied' using errcode = '42501';
    end if;
  elsif v_is_direct_client then
    if v_actor_id is null
      or old.user_id is distinct from v_actor_id
      or new.user_id is distinct from v_actor_id
    then
      raise exception 'training cycle ownership denied' using errcode = '42501';
    end if;
    if old.portal_scope is distinct from 'usuario'
      or new.portal_scope is distinct from 'usuario'
    then
      raise exception 'legacy training cycle writes require usuario portal'
        using errcode = '42501';
    end if;

    new.user_id := v_actor_id;
    new.portal_scope := 'usuario';
  elsif v_actor_id is not null and new.user_id is distinct from v_actor_id
    and not coalesce(
      private.allow_coach_student_training_cycle_update(old, new, v_actor_id), false
    ) then
    raise exception 'training cycle ownership denied' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and (
    pg_catalog.char_length(pg_catalog.btrim(new.name)) not between 1 and 120
    or new.name ~ '[[:cntrl:]]'
    or (
      new.cycle_type is not null
      and (
        pg_catalog.char_length(new.cycle_type) > 120
        or new.cycle_type ~ '[[:cntrl:]]'
      )
    )
    or (
      new.goal is not null
      and (
        pg_catalog.char_length(new.goal) > 120
        or new.goal ~ '[[:cntrl:]]'
      )
    )
    or new.cycle_number not between 1 and 1000000
    or (
      new.duration_weeks is not null
      and new.duration_weeks not between 1 and 105
    )
    or (
      new.planned_start_date is not null
      and new.planned_end_date is not null
      and new.planned_end_date - new.planned_start_date > 730
    )
  ) then
    raise exception 'invalid legacy training cycle fields' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    if pg_catalog.octet_length(new.plan_snapshot::pg_catalog.text) > 262144
      or (
        new.summary_snapshot is not null
        and pg_catalog.octet_length(new.summary_snapshot::pg_catalog.text) > 262144
      )
    then
      raise exception 'training cycle snapshot exceeds size limit' using errcode = '54000';
    end if;
  elsif (
    new.plan_snapshot is distinct from old.plan_snapshot
    and pg_catalog.octet_length(new.plan_snapshot::pg_catalog.text) > 262144
  ) or (
    new.summary_snapshot is distinct from old.summary_snapshot
    and new.summary_snapshot is not null
    and pg_catalog.octet_length(new.summary_snapshot::pg_catalog.text) > 262144
  ) then
    raise exception 'training cycle snapshot exceeds size limit' using errcode = '54000';
  end if;

  if tg_op = 'INSERT' then
    -- Same key format as the cycle-redesign RPC boundary. Advisory locks are
    -- transaction scoped and re-entrant when this trigger is reached through
    -- an already locked RPC.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'organizatech:cycle-redesign:'
          || new.user_id::pg_catalog.text || ':' || new.portal_scope,
        0
      )
    );

    if exists (
      select 1
      from public.training_cycles as cycle
      where cycle.user_id = new.user_id
        and cycle.portal_scope = new.portal_scope
      order by cycle.created_at, cycle.id
      offset 999
      limit 1
    ) then
      raise exception using errcode = '54000', message = 'training cycle limit reached';
    end if;
  end if;

  return new;
end;
$function$;

create function public.edit_own_coach_student_active_training_cycle(
  p_episode_id uuid, p_request_id uuid, p_cycle_id uuid,
  p_expected_version integer, p_action text, p_goal text, p_plan jsonb
) returns jsonb language plpgsql volatile security definer set search_path = ''
set statement_timeout = '8s' as $fn$
declare
  v_actor uuid := auth.uid();
  v_student uuid;
  v_cycle public.training_cycles;
  v_payload jsonb;
  v_receipt_cycle_id uuid;
  v_receipt_version integer;
  v_old_plan jsonb;
  v_old_count integer;
  v_new_count integer;
  v_new_version integer;
  v_version_id uuid;
  v_today date;
begin
  if v_actor is null or p_episode_id is null or p_request_id is null
    or p_cycle_id is null or p_expected_version is null
    or p_expected_version not between 1 and 255
    or p_action is null
    or p_action not in ('create_routine','modify_routine','remove_routine')
    or p_goal is null
    or p_goal not in ('strength','volume','definition','deload')
    or p_plan is null then
    raise exception 'invalid coach training edit request' using errcode = '22023';
  end if;

  -- Holding the relationship row prevents an unlink from completing mid-write.
  select episode.student_user_id into v_student
  from private.coach_relationship_episodes episode
  join public.coach_registrations registration
    on registration.user_id = episode.coach_user_id
  where episode.id = p_episode_id and episode.coach_user_id = v_actor
    and episode.ended_at is null
  for update of episode;
  if v_student is null then
    raise exception 'coach student training forbidden' using errcode = '42501';
  end if;
  perform private.lock_training_cycle_portal(v_student, 'usuario');
  v_today := (pg_catalog.timezone('America/Santiago', pg_catalog.clock_timestamp()))::date;
  v_payload := pg_catalog.jsonb_build_object(
    'actor', v_actor, 'episodeId', p_episode_id, 'cycleId', p_cycle_id,
    'expectedVersion', p_expected_version, 'action', p_action,
    'goal', p_goal, 'plan', p_plan);

  select receipt.aggregate_id, receipt.result_version
    into v_receipt_cycle_id, v_receipt_version
  from private.find_training_cycle_receipt(
    v_student, 'usuario', p_request_id, 'cycle_edit', v_payload) receipt;
  if v_receipt_cycle_id is not null then
    return private.training_cycle_operation_result(
      p_request_id, 'cycle_edit', v_receipt_cycle_id, v_receipt_version);
  end if;

  select cycle.* into v_cycle from public.training_cycles cycle
  where cycle.id = p_cycle_id and cycle.user_id = v_student
    and cycle.portal_scope = 'usuario' and cycle.deleted_at is null
  for update;
  if v_cycle.id is null then
    raise exception 'training cycle not found' using errcode = 'P0002';
  end if;
  if v_cycle.status <> 'active' or v_cycle.current_plan_version_id is null
    or v_cycle.planned_end_date < v_today then
    raise exception 'training cycle is not editable' using errcode = '55000';
  end if;
  if v_cycle.current_plan_version is distinct from p_expected_version then
    raise exception 'training cycle version conflict' using errcode = '40001';
  end if;

  select version.plan_payload into v_old_plan
  from public.training_cycle_plan_versions version
  where version.id = v_cycle.current_plan_version_id
    and version.cycle_id = v_cycle.id and version.user_id = v_student;
  if v_old_plan is null then
    raise exception 'training cycle version not found' using errcode = 'P0002';
  end if;
  perform private.validate_training_cycle_plan(v_student, 'usuario', p_plan);
  v_old_count := pg_catalog.jsonb_array_length(v_old_plan->'days');
  v_new_count := pg_catalog.jsonb_array_length(p_plan->'days');
  if v_old_plan = p_plan or not (
    (p_action = 'create_routine' and v_new_count = v_old_count + 1)
    or (p_action = 'modify_routine' and v_new_count = v_old_count)
    or (p_action = 'remove_routine' and v_new_count = v_old_count - 1)
  ) then
    raise exception 'invalid coach routine action' using errcode = '22023';
  end if;

  v_new_version := v_cycle.current_plan_version + 1;
  v_version_id := private.persist_training_cycle_plan_version(
    v_student, 'usuario', v_cycle.id, v_new_version, p_request_id, 'edit',
    p_goal, v_cycle.planned_start_date, v_cycle.planned_end_date,
    v_cycle.current_plan_version_id, p_plan);
  insert into private.coach_student_training_edits (
    student_user_id, actor_user_id, relationship_episode_id, request_id,
    cycle_id, plan_version_id, action, from_version, to_version
  ) values (
    v_student, v_actor, p_episode_id, p_request_id,
    v_cycle.id, v_version_id, p_action, p_expected_version, v_new_version);
  update public.training_cycles cycle
  set goal = p_goal, plan_snapshot = p_plan,
    current_plan_version = v_new_version, current_plan_version_id = v_version_id
  where cycle.id = v_cycle.id and cycle.user_id = v_student
    and cycle.portal_scope = 'usuario' and cycle.status = 'active'
    and cycle.current_plan_version = p_expected_version;
  if not found then
    raise exception 'training cycle version conflict' using errcode = '40001';
  end if;
  perform private.record_training_cycle_receipt(
    v_student, 'usuario', p_request_id, 'cycle_edit', v_payload,
    v_cycle.id, v_new_version);
  return private.training_cycle_operation_result(
    p_request_id, 'cycle_edit', v_cycle.id, v_new_version);
end;
$fn$;

revoke all on function public.edit_own_coach_student_active_training_cycle(
  uuid,uuid,uuid,integer,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.edit_own_coach_student_active_training_cycle(
  uuid,uuid,uuid,integer,text,text,jsonb) to authenticated;
commit;
