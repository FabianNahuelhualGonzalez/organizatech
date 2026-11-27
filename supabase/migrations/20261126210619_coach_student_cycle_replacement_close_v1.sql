-- Coach may close a linked student's active cycle before building its replacement.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table private.coach_student_training_cycle_actions
  drop constraint coach_student_training_cycle_actions_action_check,
  drop constraint coach_student_training_cycle_actions_check;
alter table private.coach_student_training_cycle_actions
  add constraint coach_student_training_cycle_actions_action_check
    check (action in ('create_cycle','close_last_routine','replace_cycle')),
  add constraint coach_student_training_cycle_actions_check
    check ((action = 'create_cycle' and expected_version is null)
      or (action in ('close_last_routine','replace_cycle') and expected_version between 1 and 256));

create or replace function private.allow_coach_student_cycle_update(
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
          (action.action in ('close_last_routine','replace_cycle')
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

create function public.close_own_coach_student_cycle_for_replacement(
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
    'cycleId',p_cycle_id,'expectedVersion',p_expected_version,'action','replace_cycle');
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
  if exists (select 1 from public.training_cycle_drafts draft
    where draft.user_id = v_student and draft.portal_scope = 'usuario'
      and draft.state = 'draft') then
    raise exception 'student already has a training draft' using errcode = '55000';
  end if;
  select version.* into v_version from public.training_cycle_plan_versions version
  where version.id = v_cycle.current_plan_version_id
    and version.cycle_id = v_cycle.id and version.user_id = v_student;
  if v_version.id is null then
    raise exception 'training cycle version unavailable' using errcode = '55000';
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
    'replace_cycle',p_expected_version,v_version.goal,
    v_version.start_date,v_version.end_date,
    private.training_cycle_request_hash(v_version.plan_payload));
  update public.training_cycles cycle set status = 'completed',
    ended_at = v_now, closed_at = v_now, closed_reason = 'manual',
    summary_snapshot = coalesce(cycle.summary_snapshot,
      pg_catalog.jsonb_build_object('source','coach-student-replacement-close',
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


revoke all on function public.close_own_coach_student_cycle_for_replacement(uuid,uuid,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.close_own_coach_student_cycle_for_replacement(uuid,uuid,uuid,integer)
  to authenticated;
commit;
