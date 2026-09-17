-- Additive generation-bound commands. Requires audited invitation persistence R2.
-- No legacy function/table/ACL changes, dispatcher, acceptance or training access.
begin;

create function private.coach_invitation_generation_operation_view(p_owner uuid, p_request uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_op private.coach_invitation_operations;
  v_expected numeric;
begin
  select o.* into v_op from private.coach_invitation_operations o
    where o.coach_user_id = p_owner and o.request_id = p_request;
  if not found then return null; end if;
  -- A legacy receipt is not evidence of a generation-bound intention.
  if v_op.action not in ('resend', 'regenerate') or v_op.state not in ('reserved', 'cancelled')
    or v_op.invitation_id is null or v_op.episode_id is not null or v_op.generation is null
    or jsonb_typeof(v_op.payload) is distinct from 'object'
    or jsonb_typeof(v_op.payload->'expectedGeneration') is distinct from 'number' then
    raise exception using errcode = '22023', message = 'coach_invitation_operation_contract_conflict';
  end if;
  v_expected := (v_op.payload->>'expectedGeneration')::numeric;
  if v_expected not between 1 and 2147483647 or trunc(v_expected) <> v_expected
    or v_op.payload <> jsonb_build_object('invitationId', v_op.invitation_id,
      'expectedGeneration', v_expected, 'contractVersion', 1)
    or v_op.generation::bigint <> v_expected + (case when v_op.action = 'regenerate' then 1 else 0 end)
    or not isfinite(v_op.reserved_at)
    or v_op.reserved_at < timestamptz '0001-01-01 00:00:00+00'
    or v_op.reserved_at >= timestamptz '10000-01-01 00:00:00+00' then
    raise exception using errcode = '22023', message = 'coach_invitation_operation_contract_conflict';
  end if;
  return jsonb_build_object('requestId', v_op.request_id, 'action', v_op.action,
    'state', v_op.state, 'invitationId', v_op.invitation_id,
    'expectedGeneration', v_expected::integer, 'generation', v_op.generation,
    'reservedAt', v_op.reserved_at);
end;
$$;

create function private.mutate_coach_invitation_for_generation(
  p_action text, p_invitation_id uuid, p_expected_generation integer, p_request_id uuid
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_owner uuid := private.lock_coach_invitation_owner();
  v_now timestamptz := clock_timestamp();
  v_payload jsonb;
  v_op private.coach_invitation_operations;
  v_generation integer;
  v_result jsonb;
  v_bound_count integer;
begin
  if p_action is null or p_action not in ('resend', 'regenerate')
    or p_invitation_id is null or p_request_id is null
    or p_expected_generation is null or p_expected_generation < 1 then
    raise exception using errcode = '22023', message = 'coach_invitation_invalid_input';
  end if;
  v_payload := jsonb_build_object('invitationId', p_invitation_id,
    'expectedGeneration', p_expected_generation, 'contractVersion', 1);

  -- Membership is already exclusively locked. This replay SELECT takes no
  -- operation row lock before invitation; it never adopts or rewrites v1.
  select o.* into v_op from private.coach_invitation_operations o
    where o.coach_user_id = v_owner and o.request_id = p_request_id;
  if found then
    if v_op.action <> p_action or v_op.payload <> v_payload then
      raise exception using errcode = '22023', message = 'coach_invitation_request_conflict';
    end if;
    return jsonb_build_object('status', 'recorded', 'serverNow', v_now,
      'operation', private.coach_invitation_generation_operation_view(v_owner, p_request_id));
  end if;

  select i.generation into v_generation from private.coach_invitations i
    where i.id = p_invitation_id and i.coach_user_id = v_owner for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'coach_invitation_not_found';
  end if;
  if v_generation <> p_expected_generation then
    raise exception using errcode = '55000', message = 'coach_invitation_generation_conflict';
  end if;
  if p_action = 'regenerate' and p_expected_generation = 2147483647 then
    raise exception using errcode = '55000', message = 'coach_invitation_generation_exhausted';
  end if;

  -- Reentrant acquisition of the same membership/invitation locks, no upgrades.
  -- R2 remains the authority for current state, expiry, quotas and secure codes.
  v_result := private.mutate_coach_invitation(p_action, p_request_id, null, p_invitation_id, null);
  if v_result->>'status' = 'rate_limited' then return v_result; end if;
  if v_result->>'status' is distinct from 'recorded' then
    raise exception using errcode = '40001', message = 'coach_invitation_retry_required';
  end if;

  -- The earlier absence check under the owner lock proves this row was created
  -- by this invocation. Bind it before commit; never upgrade a persisted receipt.
  update private.coach_invitation_operations o set payload = v_payload
    where o.coach_user_id = v_owner and o.request_id = p_request_id
      and o.action = p_action and o.invitation_id = p_invitation_id and o.episode_id is null
      and o.generation = p_expected_generation + case when p_action = 'regenerate' then 1 else 0 end
      and o.state = 'reserved' and o.payload = jsonb_build_object('invitationId', p_invitation_id)
    returning o.* into v_op;
  get diagnostics v_bound_count = row_count;
  if v_bound_count <> 1 or v_op.payload is distinct from v_payload then
    -- Uncaught exception rolls back the engine mutation and every quota receipt.
    raise exception using errcode = '40001', message = 'coach_invitation_retry_required';
  end if;
  return jsonb_build_object('status', 'recorded', 'serverNow', v_result->'serverNow',
    'operation', private.coach_invitation_generation_operation_view(v_owner, p_request_id));
end;
$$;

create function public.resend_own_coach_invitation_for_generation(
  p_invitation_id uuid, p_expected_generation integer, p_request_id uuid
)
returns jsonb language sql security definer set search_path = '' as $$
  select private.mutate_coach_invitation_for_generation('resend', p_invitation_id, p_expected_generation, p_request_id);
$$;

create function public.regenerate_own_coach_invitation_for_generation(
  p_invitation_id uuid, p_expected_generation integer, p_request_id uuid
)
returns jsonb language sql security definer set search_path = '' as $$
  select private.mutate_coach_invitation_for_generation('regenerate', p_invitation_id, p_expected_generation, p_request_id);
$$;

create function public.read_own_coach_invitation_generation_operation(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := private.lock_coach_invitation_owner();
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'coach_invitation_invalid_input';
  end if;
  return private.coach_invitation_generation_operation_view(v_owner, p_request_id);
end;
$$;

revoke all on function private.coach_invitation_generation_operation_view(uuid, uuid),
  private.mutate_coach_invitation_for_generation(text, uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.resend_own_coach_invitation_for_generation(uuid, integer, uuid),
  public.regenerate_own_coach_invitation_for_generation(uuid, integer, uuid),
  public.read_own_coach_invitation_generation_operation(uuid) from public, anon, authenticated;
grant execute on function public.resend_own_coach_invitation_for_generation(uuid, integer, uuid),
  public.regenerate_own_coach_invitation_for_generation(uuid, integer, uuid),
  public.read_own_coach_invitation_generation_operation(uuid) to authenticated;
commit;
