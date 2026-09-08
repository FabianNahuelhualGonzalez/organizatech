-- Return the prepared replacement draft in the same transaction/response as
-- the active-cycle close. The previously introduced implementation remains
-- private so its locking, validation and receipt semantics stay canonical.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter function public.replace_own_active_training_cycle_to_draft(
  uuid, text, uuid, date, date
) set schema private;

alter function private.replace_own_active_training_cycle_to_draft(
  uuid, text, uuid, date, date
) rename to perform_active_training_cycle_replacement;

revoke all on function private.perform_active_training_cycle_replacement(
  uuid, text, uuid, date, date
) from public, anon, authenticated, service_role;

-- A replay must return the same prepared draft even if that draft was later
-- activated or discarded. Read the immutable version row and freeze the
-- response state instead of projecting mutable aggregate columns.
create function private.prepared_training_cycle_draft_snapshot_json(
  p_user_id uuid,
  p_portal_scope text,
  p_draft_id uuid,
  p_version integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  perform private.assert_training_cycle_portal_access(p_user_id, p_portal_scope);

  select pg_catalog.jsonb_build_object(
    'draftId', draft.id,
    'origin', draft.origin,
    'sourceCycleId', draft.source_cycle_id,
    'state', 'draft',
    'version', version.version,
    'goal', version.goal,
    'startDate', version.start_date,
    'endDate', version.end_date,
    'plan', version.plan_payload,
    'activatedCycleId', null,
    'createdAt', draft.created_at,
    'updatedAt', version.created_at
  ) into v_result
  from public.training_cycle_drafts as draft
  join public.training_cycle_draft_versions as version
    on version.draft_id = draft.id
   and version.user_id = draft.user_id
   and version.portal_scope = draft.portal_scope
   and version.version = p_version
  where draft.id = p_draft_id
    and draft.user_id = p_user_id
    and draft.portal_scope = p_portal_scope;

  if v_result is null then
    raise exception 'prepared training cycle draft not found' using errcode = 'P0002';
  end if;
  return v_result;
end;
$function$;

revoke all on function private.prepared_training_cycle_draft_snapshot_json(
  uuid, text, uuid, integer
) from public, anon, authenticated, service_role;

create function public.replace_own_active_training_cycle_to_draft(
  p_request_id uuid,
  p_portal_scope text,
  p_expected_active_cycle_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '12s'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_operation jsonb;
  v_draft_id uuid;
  v_version integer;
  v_draft jsonb;
begin
  v_operation := private.perform_active_training_cycle_replacement(
    p_request_id,
    p_portal_scope,
    p_expected_active_cycle_id,
    p_start_date,
    p_end_date
  );

  v_draft_id := (v_operation->>'aggregateId')::uuid;
  v_version := (v_operation->>'resultVersion')::integer;
  v_draft := private.prepared_training_cycle_draft_snapshot_json(
    v_user_id, p_portal_scope, v_draft_id, v_version
  );

  if v_draft->>'sourceCycleId' is distinct from p_expected_active_cycle_id::text
    or v_draft->>'origin' is distinct from 'duplicate'
    or v_draft->>'state' is distinct from 'draft'
  then
    raise exception 'prepared training cycle replacement is invalid'
      using errcode = 'XX000';
  end if;

  return pg_catalog.jsonb_build_object(
    'responseKind', 'prepared_draft',
    'requestId', p_request_id,
    'operationKind', 'draft_duplicate',
    'aggregateId', v_draft_id,
    'resultVersion', v_version,
    'draft', v_draft
  );
end;
$function$;

revoke all on function public.replace_own_active_training_cycle_to_draft(
  uuid, text, uuid, date, date
) from public, anon, authenticated, service_role;
grant execute on function public.replace_own_active_training_cycle_to_draft(
  uuid, text, uuid, date, date
) to authenticated;

do $postcheck$
begin
  if to_regprocedure(
    'public.replace_own_active_training_cycle_to_draft(uuid,text,uuid,date,date)'
  ) is null
    or to_regprocedure(
      'private.perform_active_training_cycle_replacement(uuid,text,uuid,date,date)'
    ) is null
    or has_function_privilege(
      'anon',
      'public.replace_own_active_training_cycle_to_draft(uuid,text,uuid,date,date)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      'public.replace_own_active_training_cycle_to_draft(uuid,text,uuid,date,date)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'private.perform_active_training_cycle_replacement(uuid,text,uuid,date,date)',
      'EXECUTE'
    )
  then
    raise exception 'cycle replacement snapshot response postcheck failed';
  end if;
end;
$postcheck$;

commit;
