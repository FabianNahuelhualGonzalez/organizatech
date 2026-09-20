-- CYCLE-REDESIGN-ACTIVE-REPLACEMENT-01
-- Forward-only bridge for legacy and canonical active cycles.
--
-- The original redesign intentionally rejects a second active cycle. This
-- migration keeps that invariant and adds an explicit, owner-confirmed manual
-- close before the user enters the new-cycle builder.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table private.training_cycle_operation_receipts
  drop constraint training_cycle_operation_receipts_operation_allowed,
  add constraint training_cycle_operation_receipts_operation_allowed check (
    operation_kind in (
      'custom_exercise_create', 'draft_create', 'draft_save', 'draft_duplicate',
      'draft_renewal', 'draft_discard', 'cycle_activate', 'cycle_close',
      'cycle_edit', 'cycle_extend', 'cycle_execution_record',
      'notifications_mark_read'
    )
  );

create function public.get_own_active_training_cycle_guard(
  p_portal_scope text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_cycle public.training_cycles;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);

  select cycle.*
    into v_cycle
  from public.training_cycles as cycle
  where cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status = 'active'
    and cycle.deleted_at is null;

  if v_cycle.id is null then
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'cycleId', v_cycle.id,
    'hasCanonicalPlan', v_cycle.current_plan_version_id is not null
  );
end;
$function$;

revoke all on function public.get_own_active_training_cycle_guard(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_own_active_training_cycle_guard(text)
  to authenticated;

create function public.complete_own_active_training_cycle_manually(
  p_request_id uuid,
  p_portal_scope text,
  p_expected_active_cycle_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '8s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_payload jsonb;
  v_receipt_cycle_id uuid;
  v_receipt_version integer;
  v_active_cycle public.training_cycles;
begin
  perform private.assert_training_cycle_portal_access(v_user_id, p_portal_scope);
  perform private.lock_training_cycle_portal(v_user_id, p_portal_scope);

  if p_request_id is null
    or p_expected_active_cycle_id is null
  then
    raise exception 'invalid manual training cycle close request' using errcode = '22023';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'portalScope', p_portal_scope,
    'expectedActiveCycleId', p_expected_active_cycle_id
  );

  select receipt.aggregate_id, receipt.result_version
    into v_receipt_cycle_id, v_receipt_version
  from private.find_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'cycle_close',
    v_payload
  ) as receipt;

  if v_receipt_cycle_id is not null then
    return private.training_cycle_operation_result(
      p_request_id,
      'cycle_close',
      v_receipt_cycle_id,
      v_receipt_version
    );
  end if;

  select cycle.*
    into v_active_cycle
  from public.training_cycles as cycle
  where cycle.id = p_expected_active_cycle_id
    and cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status = 'active'
    and cycle.deleted_at is null
  for update;

  if v_active_cycle.id is null then
    raise exception 'confirmed active training cycle changed' using errcode = '40001';
  end if;

  -- A manual replacement must not interrupt the durable in-progress workout
  -- signal used by the automatic lifecycle worker.
  if exists (
    select 1
    from public.training_workout_readiness as readiness
    where readiness.user_id = v_user_id
      and readiness.cycle_id = v_active_cycle.id
      and readiness.training_session_id is null
      and readiness.payload->>'skipped' = 'false'
      and readiness.workout_started_at >= v_now - interval '36 hours'
      and readiness.workout_started_at <= v_now + interval '5 minutes'
  ) then
    raise exception 'active workout must finish before closing the cycle'
      using errcode = '55000';
  end if;

  update public.training_cycles as cycle
  set
    status = 'completed',
    ended_at = v_now,
    closed_at = v_now,
    closed_reason = 'manual',
    summary_snapshot = coalesce(
      cycle.summary_snapshot,
      pg_catalog.jsonb_build_object(
        'source', 'cycle-redesign-manual-replacement',
        'planVersion', cycle.current_plan_version
      )
    )
  where cycle.id = v_active_cycle.id
    and cycle.user_id = v_user_id
    and cycle.portal_scope = p_portal_scope
    and cycle.status = 'active'
    and cycle.deleted_at is null;

  if not found then
    raise exception 'confirmed active training cycle changed' using errcode = '40001';
  end if;

  update public.training_cycle_notifications as notification
  set superseded_at = coalesce(notification.superseded_at, v_now)
  where notification.user_id = v_user_id
    and notification.portal_scope = p_portal_scope
    and notification.cycle_id = v_active_cycle.id
    and notification.superseded_at is null;

  perform private.record_training_cycle_receipt(
    v_user_id,
    p_portal_scope,
    p_request_id,
    'cycle_close',
    v_payload,
    v_active_cycle.id,
    null
  );

  return private.training_cycle_operation_result(
    p_request_id,
    'cycle_close',
    v_active_cycle.id,
    null
  );
end;
$function$;

revoke all on function public.complete_own_active_training_cycle_manually(
  uuid, text, uuid
) from public, anon, authenticated, service_role;

do $postcheck$
begin
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_own_active_training_cycle_guard(text)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'anon',
    'public.get_own_active_training_cycle_guard(text)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'service_role',
    'public.get_own_active_training_cycle_guard(text)',
    'EXECUTE'
  ) then
    raise exception 'cycle replacement postcheck failed: guard grants';
  end if;

  if pg_catalog.has_function_privilege(
    'authenticated',
    'public.complete_own_active_training_cycle_manually(uuid,text,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'anon',
    'public.complete_own_active_training_cycle_manually(uuid,text,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'service_role',
    'public.complete_own_active_training_cycle_manually(uuid,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'cycle replacement postcheck failed: mutation grants';
  end if;
end;
$postcheck$;

commit;
