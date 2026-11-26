-- Local preparation: delegated reads only. No change to owner-only cycle writes.
begin;

create function private.require_own_coach_student_training_subject(p_episode_id uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $fn$
declare v_student uuid;
begin
  if auth.uid() is null or p_episode_id is null then
    raise exception 'coach_student_training_forbidden' using errcode = '42501';
  end if;
  select episode.student_user_id into v_student
  from private.coach_relationship_episodes episode
  join public.coach_registrations registration
    on registration.user_id = episode.coach_user_id
  where episode.id = p_episode_id and episode.coach_user_id = auth.uid()
    and episode.ended_at is null;
  if v_student is null then
    raise exception 'coach_student_training_forbidden' using errcode = '42501';
  end if;
  return v_student;
end;
$fn$;
revoke all on function private.require_own_coach_student_training_subject(uuid)
  from public, anon, authenticated, service_role;

create function public.list_own_coach_student_training_cycles(
  p_episode_id uuid, p_limit integer default 30,
  p_before_created_at timestamptz default null, p_before_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = ''
set statement_timeout = '5s' as $fn$
declare v_student uuid; v_today date := (pg_catalog.timezone('America/Santiago', pg_catalog.clock_timestamp()))::date;
  v_result jsonb;
begin
  v_student := private.require_own_coach_student_training_subject(p_episode_id);
  if p_limit is null or p_limit not between 1 and 50
    or ((p_before_created_at is null) <> (p_before_id is null)) then
    raise exception 'invalid training cycle list request' using errcode = '22023';
  end if;
  with candidates as (
    select cycle.id, cycle.cycle_number, cycle.current_plan_version,
      cycle.current_plan_version_id, cycle.extension_count, cycle.closed_at,
      cycle.updated_at, cycle.created_at, cycle.status as stored_status,
      version.goal, version.start_date, version.end_date
    from public.training_cycles cycle
    join public.training_cycle_plan_versions version
      on version.id = cycle.current_plan_version_id
      and version.cycle_id = cycle.id and version.user_id = cycle.user_id
      and version.portal_scope = cycle.portal_scope
    where cycle.user_id = v_student and cycle.portal_scope = 'usuario'
      and cycle.deleted_at is null
      and (p_before_created_at is null
        or (cycle.created_at, cycle.id) < (p_before_created_at, p_before_id))
    order by cycle.created_at desc, cycle.id desc limit p_limit + 1
  ), page as (
    select * from candidates order by created_at desc, id desc limit p_limit
  )
  select pg_catalog.jsonb_build_object(
    'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'cycleId', item.id, 'cycleNumber', item.cycle_number,
      'goal', item.goal, 'startDate', item.start_date, 'endDate', item.end_date,
      'status', case when item.stored_status in ('completed','cancelled')
        or item.end_date < v_today then 'closed'
        when v_today >= item.end_date - 3 then 'expiring' else 'active' end,
      'version', item.current_plan_version, 'snapshotId', item.current_plan_version_id,
      'extensionCount', item.extension_count, 'closedAt', item.closed_at,
      'updatedAt', item.updated_at) order by item.created_at desc, item.id desc)
      from page item), '[]'::jsonb),
    'nextCursor', case when (select pg_catalog.count(*) from candidates) > p_limit
      then (select pg_catalog.jsonb_build_object('beforeCreatedAt', item.created_at,
        'beforeId', item.id) from page item order by item.created_at, item.id limit 1)
      else null end) into v_result;
  return v_result;
end;
$fn$;

create function public.get_own_coach_student_training_cycle(
  p_episode_id uuid, p_cycle_id uuid
) returns jsonb language plpgsql stable security definer set search_path = ''
set statement_timeout = '5s' as $fn$
declare v_student uuid; v_today date := (pg_catalog.timezone('America/Santiago', pg_catalog.clock_timestamp()))::date;
  v_result jsonb;
begin
  v_student := private.require_own_coach_student_training_subject(p_episode_id);
  if p_cycle_id is null then
    raise exception 'invalid training cycle request' using errcode = '22023';
  end if;
  select pg_catalog.jsonb_build_object(
    'cycleId', cycle.id, 'portalScope', cycle.portal_scope,
    'cycleNumber', cycle.cycle_number, 'goal', version.goal,
    'startDate', version.start_date, 'endDate', version.end_date,
    'status', case when cycle.status in ('completed','cancelled')
      or version.end_date < v_today then 'closed'
      when v_today >= version.end_date - 3 then 'expiring' else 'active' end,
    'daysUntilEnd', version.end_date - v_today,
    'version', cycle.current_plan_version,
    'snapshotId', cycle.current_plan_version_id,
    'extensionCount', cycle.extension_count, 'sourceDraftId', cycle.source_draft_id,
    'sourceCycleId', cycle.source_cycle_id, 'closedAt', cycle.closed_at,
    'closedReason', cycle.closed_reason, 'createdAt', cycle.created_at,
    'updatedAt', cycle.updated_at,
    'plan', private.training_cycle_plan_snapshot_json(cycle.current_plan_version_id))
  into v_result from public.training_cycles cycle
  join public.training_cycle_plan_versions version
    on version.id = cycle.current_plan_version_id
    and version.cycle_id = cycle.id and version.user_id = cycle.user_id
    and version.portal_scope = cycle.portal_scope
  where cycle.id = p_cycle_id and cycle.user_id = v_student
    and cycle.portal_scope = 'usuario' and cycle.deleted_at is null;
  if v_result is null then
    raise exception 'training cycle not found' using errcode = 'P0002';
  end if;
  return v_result;
end;
$fn$;

create function public.get_own_coach_student_training_cycle_version(
  p_episode_id uuid, p_cycle_id uuid, p_version integer
) returns jsonb language plpgsql stable security definer set search_path = ''
set statement_timeout = '5s' as $fn$
declare v_student uuid; v_snapshot public.training_cycle_plan_versions;
begin
  v_student := private.require_own_coach_student_training_subject(p_episode_id);
  if p_cycle_id is null or p_version is null or p_version not between 1 and 256 then
    raise exception 'invalid training cycle version request' using errcode = '22023';
  end if;
  select version.* into v_snapshot from public.training_cycle_plan_versions version
  join public.training_cycles cycle on cycle.id = version.cycle_id
    and cycle.user_id = version.user_id and cycle.portal_scope = version.portal_scope
  where version.cycle_id = p_cycle_id and version.user_id = v_student
    and version.portal_scope = 'usuario' and version.version = p_version
    and cycle.deleted_at is null;
  if v_snapshot.id is null then
    raise exception 'training cycle version not found' using errcode = 'P0002';
  end if;
  return pg_catalog.jsonb_build_object(
    'cycleId', v_snapshot.cycle_id, 'snapshotId', v_snapshot.id,
    'version', v_snapshot.version, 'changeKind', v_snapshot.change_kind,
    'goal', v_snapshot.goal, 'startDate', v_snapshot.start_date,
    'endDate', v_snapshot.end_date, 'sourceSnapshotId', v_snapshot.source_version_id,
    'createdAt', v_snapshot.created_at,
    'plan', private.training_cycle_plan_snapshot_json(v_snapshot.id));
end;
$fn$;

revoke all on function public.list_own_coach_student_training_cycles(uuid,integer,timestamptz,uuid),
  public.get_own_coach_student_training_cycle(uuid,uuid),
  public.get_own_coach_student_training_cycle_version(uuid,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_own_coach_student_training_cycles(uuid,integer,timestamptz,uuid),
  public.get_own_coach_student_training_cycle(uuid,uuid),
  public.get_own_coach_student_training_cycle_version(uuid,uuid,integer)
  to authenticated;

commit;
