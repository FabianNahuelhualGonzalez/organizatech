-- Local preparation only: Coach creates the first cycle or closes the last routine.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Transactional capability and durable actor audit. The INSERT capability is
-- written before the new cycle exists; the RPC must complete or all rows roll back.
create table private.coach_student_training_cycle_actions (
  student_user_id uuid not null,
  actor_user_id uuid not null,
  relationship_episode_id uuid not null references private.coach_relationship_episodes(id),
  request_id uuid not null,
  cycle_id uuid not null,
  action text not null check (action in ('create_cycle','close_last_routine')),
  expected_version integer,
  goal text not null,
  start_date date not null,
  end_date date not null,
  plan_hash bytea not null check (pg_catalog.octet_length(plan_hash) = 32),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (student_user_id, request_id),
  unique (cycle_id, action),
  check ((action = 'create_cycle' and expected_version is null)
    or (action = 'close_last_routine' and expected_version between 1 and 256))
);
alter table private.coach_student_training_cycle_actions enable row level security;
alter table private.coach_student_training_cycle_actions force row level security;
revoke all on private.coach_student_training_cycle_actions
  from public, anon, authenticated, service_role;

create function private.allow_coach_student_cycle_insert(
  p_new public.training_cycles, p_actor uuid
) returns boolean language sql volatile security invoker set search_path = '' as $fn$
  select exists (
    select 1 from private.coach_student_training_cycle_actions action
    join private.coach_relationship_episodes episode
      on episode.id = action.relationship_episode_id
      and episode.student_user_id = action.student_user_id
      and episode.coach_user_id = action.actor_user_id
      and episode.ended_at is null
    where action.action = 'create_cycle' and action.actor_user_id = p_actor
      and action.student_user_id = p_new.user_id and action.cycle_id = p_new.id
      and p_new.portal_scope = 'usuario' and p_new.status = 'active'
      and p_new.current_plan_version = 0 and p_new.current_plan_version_id is null
      and p_new.source_draft_id is null and p_new.source_cycle_id is null
      and p_new.goal = action.goal
      and private.training_cycle_request_hash(p_new.plan_snapshot) = action.plan_hash
      and p_new.planned_start_date = action.start_date
      and p_new.planned_end_date = action.end_date
  );
$fn$;

create function private.allow_coach_student_cycle_update(
  p_old public.training_cycles, p_new public.training_cycles, p_actor uuid
) returns boolean language sql volatile security invoker set search_path = '' as $fn$
  select p_old.id = p_new.id and p_old.user_id = p_new.user_id
    and p_old.portal_scope = 'usuario' and p_new.portal_scope = 'usuario'
    and p_old.status = 'active'
    and exists (
      select 1 from private.coach_student_training_cycle_actions action
      join private.coach_relationship_episodes episode
        on episode.id = action.relationship_episode_id
        and episode.student_user_id = action.student_user_id
        and episode.coach_user_id = action.actor_user_id
        and episode.ended_at is null
      where action.actor_user_id = p_actor
        and action.student_user_id = p_old.user_id and action.cycle_id = p_old.id
        and (
          (action.action = 'create_cycle'
            and p_old.current_plan_version = 0 and p_old.current_plan_version_id is null
            and p_new.status = 'active' and p_new.current_plan_version = 1
            and p_new.current_plan_version_id is not null
            and pg_catalog.to_jsonb(p_old) - array[
              'current_plan_version','current_plan_version_id','updated_at'
            ] = pg_catalog.to_jsonb(p_new) - array[
              'current_plan_version','current_plan_version_id','updated_at'
            ]
            and exists (select 1 from public.training_cycle_plan_versions version
              where version.id = p_new.current_plan_version_id
                and version.cycle_id = p_old.id and version.user_id = p_old.user_id
                and version.portal_scope = 'usuario' and version.version = 1
                and version.request_id = action.request_id
                and version.change_kind = 'activation'
                and version.source_version_id is null
                and version.goal = action.goal
                and private.training_cycle_request_hash(version.plan_payload) = action.plan_hash))
          or
          (action.action = 'close_last_routine'
            and action.expected_version = p_old.current_plan_version
            and p_old.current_plan_version_id is not null
            and p_new.current_plan_version = p_old.current_plan_version
            and p_new.current_plan_version_id = p_old.current_plan_version_id
            and p_new.status = 'completed' and p_new.closed_reason = 'manual'
            and p_new.closed_at is not null and p_new.ended_at = p_new.closed_at
            and pg_catalog.to_jsonb(p_old) - array[
              'status','ended_at','closed_at','closed_reason','summary_snapshot','updated_at'
            ] = pg_catalog.to_jsonb(p_new) - array[
              'status','ended_at','closed_at','closed_reason','summary_snapshot','updated_at'
            ]
            and exists (select 1 from public.training_cycle_plan_versions version
              where version.id = p_old.current_plan_version_id
                and version.cycle_id = p_old.id and version.user_id = p_old.user_id
                and version.portal_scope = 'usuario'
                and private.training_cycle_request_hash(version.plan_payload) = action.plan_hash
                and version.goal = action.goal
                and version.start_date = action.start_date
                and version.end_date = action.end_date))
        )
    );
$fn$;
revoke all on function private.allow_coach_student_cycle_insert(public.training_cycles,uuid),
  private.allow_coach_student_cycle_update(public.training_cycles,public.training_cycles,uuid)
  from public, anon, authenticated, service_role;

-- A replacement of the historic trigger below adds only the two audited
-- delegated branches; all owner, direct-client, size and cycle-count guards remain.

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
    elsif v_actor_id is not null and new.user_id is distinct from v_actor_id
      and not coalesce(
        private.allow_coach_student_cycle_insert(new, v_actor_id), false
      ) then
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
    and not (
      coalesce(private.allow_coach_student_training_cycle_update(old, new, v_actor_id), false)
      or coalesce(private.allow_coach_student_cycle_update(old, new, v_actor_id), false)
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

create function public.create_own_coach_student_training_cycle(
  p_episode_id uuid, p_request_id uuid, p_goal text,
  p_start_date date, p_end_date date, p_plan jsonb
) returns jsonb language plpgsql volatile security definer set search_path = ''
set statement_timeout = '8s' as $fn$
declare
  v_actor uuid := auth.uid(); v_student uuid; v_cycle_id uuid := pg_catalog.gen_random_uuid();
  v_number integer; v_weeks integer; v_version_id uuid;
  v_payload jsonb; v_receipt_cycle_id uuid; v_receipt_version integer;
begin
  if v_actor is null or p_episode_id is null or p_request_id is null
    or p_goal is null or p_goal not in ('strength','volume','definition','deload') then
    raise exception 'invalid coach cycle creation' using errcode = '22023';
  end if;
  select episode.student_user_id into v_student
  from private.coach_relationship_episodes episode
  join public.coach_registrations registration on registration.user_id = episode.coach_user_id
  where episode.id = p_episode_id and episode.coach_user_id = v_actor
    and episode.ended_at is null for update of episode;
  if v_student is null then
    raise exception 'coach student training forbidden' using errcode = '42501';
  end if;
  perform private.lock_training_cycle_portal(v_student, 'usuario');
  v_payload := pg_catalog.jsonb_build_object('actor',v_actor,'episodeId',p_episode_id,
    'goal',p_goal,'startDate',p_start_date,'endDate',p_end_date,'plan',p_plan);
  select receipt.aggregate_id, receipt.result_version
    into v_receipt_cycle_id, v_receipt_version
  from private.find_training_cycle_receipt(
    v_student,'usuario',p_request_id,'cycle_activate',v_payload) receipt;
  if v_receipt_cycle_id is not null then
    return private.training_cycle_operation_result(
      p_request_id,'cycle_activate',v_receipt_cycle_id,v_receipt_version);
  end if;
  perform private.validate_training_cycle_dates(p_start_date,p_end_date);
  perform private.validate_training_cycle_plan(v_student,'usuario',p_plan);
  if p_end_date < (pg_catalog.timezone('America/Santiago',pg_catalog.clock_timestamp()))::date
    or exists (select 1 from public.training_cycles cycle
      where cycle.user_id = v_student and cycle.portal_scope = 'usuario'
        and cycle.status = 'active' and cycle.deleted_at is null)
    or exists (select 1 from public.training_cycle_drafts draft
      where draft.user_id = v_student and draft.portal_scope = 'usuario'
        and draft.state = 'draft') then
    raise exception 'active training cycle unavailable' using errcode = '55000';
  end if;
  if exists (select 1 from public.training_cycles cycle
    where cycle.user_id = v_student and cycle.portal_scope = 'usuario'
    order by cycle.created_at, cycle.id offset 999 limit 1) then
    raise exception 'training cycle limit reached' using errcode = '54000';
  end if;
  select coalesce(pg_catalog.max(cycle.cycle_number),0)+1 into v_number
  from public.training_cycles cycle
  where cycle.user_id = v_student and cycle.portal_scope = 'usuario';
  if v_number not between 1 and 1000000 then
    raise exception 'training cycle number limit reached' using errcode = '54000';
  end if;
  v_weeks := greatest(1,
    pg_catalog.ceil(((p_end_date-p_start_date)+1)::numeric/7)::integer);
  insert into private.coach_student_training_cycle_actions (
    student_user_id,actor_user_id,relationship_episode_id,request_id,cycle_id,
    action,goal,start_date,end_date,plan_hash
  ) values (v_student,v_actor,p_episode_id,p_request_id,v_cycle_id,
    'create_cycle',p_goal,p_start_date,p_end_date,
    private.training_cycle_request_hash(p_plan));
  insert into public.training_cycles (
    id,user_id,name,cycle_number,cycle_type,goal,started_at,ended_at,status,
    plan_snapshot,summary_snapshot,duration_weeks,planned_start_date,
    planned_end_date,portal_scope,current_plan_version,current_plan_version_id,
    source_draft_id,source_cycle_id,extension_count
  ) values (v_cycle_id,v_student,'Ciclo '||v_number::text,v_number,null,p_goal,
    p_start_date::timestamp at time zone 'America/Santiago',null,'active',
    p_plan,null,v_weeks,p_start_date,p_end_date,'usuario',0,null,null,null,0);
  v_version_id := private.persist_training_cycle_plan_version(
    v_student,'usuario',v_cycle_id,1,p_request_id,'activation',p_goal,
    p_start_date,p_end_date,null,p_plan);
  update public.training_cycles cycle
  set current_plan_version = 1, current_plan_version_id = v_version_id
  where cycle.id = v_cycle_id and cycle.user_id = v_student
    and cycle.portal_scope = 'usuario' and cycle.status = 'active'
    and cycle.current_plan_version = 0;
  if not found then
    raise exception 'training cycle activation conflict' using errcode = '40001';
  end if;
  perform private.schedule_training_cycle_notifications(
    v_student,'usuario',v_cycle_id,p_end_date);
  perform private.record_training_cycle_receipt(
    v_student,'usuario',p_request_id,'cycle_activate',v_payload,v_cycle_id,1);
  return private.training_cycle_operation_result(
    p_request_id,'cycle_activate',v_cycle_id,1);
end;
$fn$;

create function public.close_own_coach_student_last_routine(
  p_episode_id uuid, p_request_id uuid, p_cycle_id uuid, p_expected_version integer
) returns jsonb language plpgsql volatile security definer set search_path = ''
set statement_timeout = '8s' as $fn$
declare
  v_actor uuid := auth.uid(); v_student uuid; v_cycle public.training_cycles;
  v_version public.training_cycle_plan_versions; v_now timestamptz := pg_catalog.clock_timestamp();
  v_payload jsonb; v_receipt_cycle_id uuid; v_receipt_version integer;
begin
  if v_actor is null or p_episode_id is null or p_request_id is null
    or p_cycle_id is null or p_expected_version is null
    or p_expected_version not between 1 and 256 then
    raise exception 'invalid coach cycle closure' using errcode = '22023';
  end if;
  select episode.student_user_id into v_student
  from private.coach_relationship_episodes episode
  join public.coach_registrations registration on registration.user_id = episode.coach_user_id
  where episode.id = p_episode_id and episode.coach_user_id = v_actor
    and episode.ended_at is null for update of episode;
  if v_student is null then
    raise exception 'coach student training forbidden' using errcode = '42501';
  end if;
  perform private.lock_training_cycle_portal(v_student,'usuario');
  v_payload := pg_catalog.jsonb_build_object('actor',v_actor,'episodeId',p_episode_id,
    'cycleId',p_cycle_id,'expectedVersion',p_expected_version,'action','close_last_routine');
  select receipt.aggregate_id, receipt.result_version
    into v_receipt_cycle_id, v_receipt_version
  from private.find_training_cycle_receipt(
    v_student,'usuario',p_request_id,'cycle_close',v_payload) receipt;
  if v_receipt_cycle_id is not null then
    return private.training_cycle_operation_result(
      p_request_id,'cycle_close',v_receipt_cycle_id,v_receipt_version);
  end if;
  select cycle.* into v_cycle from public.training_cycles cycle
  where cycle.id = p_cycle_id and cycle.user_id = v_student
    and cycle.portal_scope = 'usuario' and cycle.deleted_at is null for update;
  if v_cycle.id is null or v_cycle.status <> 'active'
    or v_cycle.current_plan_version_id is null then
    raise exception 'training cycle not active' using errcode = '55000';
  end if;
  if v_cycle.current_plan_version is distinct from p_expected_version then
    raise exception 'training cycle version conflict' using errcode = '40001';
  end if;
  select version.* into v_version from public.training_cycle_plan_versions version
  where version.id = v_cycle.current_plan_version_id
    and version.cycle_id = v_cycle.id and version.user_id = v_student;
  if v_version.id is null
    or pg_catalog.jsonb_array_length(v_version.plan_payload->'days') <> 1 then
    raise exception 'cycle does not have one routine' using errcode = '22023';
  end if;
  v_now := pg_catalog.clock_timestamp();
  if exists (select 1 from public.training_workout_readiness readiness
    where readiness.user_id = v_student and readiness.cycle_id = v_cycle.id
      and readiness.training_session_id is null
      and readiness.payload->>'skipped' = 'false'
      and readiness.workout_started_at >= v_now - interval '36 hours'
      and readiness.workout_started_at <= v_now + interval '5 minutes') then
    raise exception 'active workout must finish before closing the cycle'
      using errcode = '55000';
  end if;
  insert into private.coach_student_training_cycle_actions (
    student_user_id,actor_user_id,relationship_episode_id,request_id,cycle_id,
    action,expected_version,goal,start_date,end_date,plan_hash
  ) values (v_student,v_actor,p_episode_id,p_request_id,v_cycle.id,
    'close_last_routine',p_expected_version,v_version.goal,
    v_version.start_date,v_version.end_date,
    private.training_cycle_request_hash(v_version.plan_payload));
  update public.training_cycles cycle set status = 'completed',
    ended_at = v_now, closed_at = v_now, closed_reason = 'manual',
    summary_snapshot = coalesce(cycle.summary_snapshot,
      pg_catalog.jsonb_build_object('source','coach-student-last-routine-close',
        'planVersion',cycle.current_plan_version))
  where cycle.id = v_cycle.id and cycle.user_id = v_student
    and cycle.portal_scope = 'usuario' and cycle.status = 'active'
    and cycle.current_plan_version = p_expected_version;
  if not found then
    raise exception 'training cycle version conflict' using errcode = '40001';
  end if;
  update public.training_cycle_notifications notification
  set superseded_at = coalesce(notification.superseded_at,v_now)
  where notification.user_id = v_student and notification.portal_scope = 'usuario'
    and notification.cycle_id = v_cycle.id and notification.superseded_at is null;
  perform private.record_training_cycle_receipt(
    v_student,'usuario',p_request_id,'cycle_close',v_payload,v_cycle.id,null);
  return private.training_cycle_operation_result(
    p_request_id,'cycle_close',v_cycle.id,null);
end;
$fn$;

revoke all on function public.create_own_coach_student_training_cycle(
  uuid,uuid,text,date,date,jsonb),
  public.close_own_coach_student_last_routine(uuid,uuid,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.create_own_coach_student_training_cycle(
  uuid,uuid,text,date,date,jsonb),
  public.close_own_coach_student_last_routine(uuid,uuid,uuid,integer)
  to authenticated;
commit;
