-- Forward-only: historical invitations and relationship episodes are untouched.
begin;

alter table private.coach_invitations
  add column amount_clp bigint check (amount_clp between 1 and 1000000000000),
  add column frequency text check (frequency in
    ('daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual')),
  add constraint coach_invitation_terms_together check ((amount_clp is null) = (frequency is null));

-- The former two-argument entry point cannot create an invitation without terms.
revoke execute on function public.create_own_coach_invitation(text, uuid)
  from public, anon, authenticated;

create function public.create_own_coach_invitation(
  p_recipient_email text, p_request_id uuid, p_amount_clp bigint, p_frequency text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := private.lock_coach_invitation_owner();
  v_email text;
  v_payload jsonb;
  v_existing private.coach_invitation_operations;
  v_result jsonb;
  v_invitation_id uuid;
  v_legacy private.coach_invitations;
  v_now timestamptz;
begin
  if p_request_id is null or p_recipient_email is null
    or octet_length(p_recipient_email) > 320
    or p_amount_clp is null or p_amount_clp not between 1 and 1000000000000
    or p_frequency is null or p_frequency not in
      ('daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual') then
    raise exception 'coach_invitation_invalid_input' using errcode = '22023';
  end if;
  v_email := lower(btrim(p_recipient_email));
  v_payload := jsonb_build_object('recipientEmail', v_email,
    'amountClp', p_amount_clp, 'frequency', p_frequency);

  -- Owner lock serializes the preflight with every old invitation command.
  -- A replay keeps its original terms; an old two-argument request cannot be adopted.
  select * into v_existing from private.coach_invitation_operations
    where coach_user_id = v_owner and request_id = p_request_id;
  if found then
    if v_existing.action <> 'create' or v_existing.payload <> v_payload then
      raise exception 'coach_invitation_request_conflict' using errcode = '22023';
    end if;
    return jsonb_build_object('status', 'recorded', 'serverNow', clock_timestamp(),
      'operation', private.coach_invitation_operation_view(v_owner, p_request_id));
  end if;

  -- A pending invitation from before this rule must not block a valid new one.
  -- Keep its row and history; retire its code only when replacement is recorded.
  select * into v_legacy from private.coach_invitations
    where coach_user_id = v_owner and recipient_email = v_email
      and state = 'pending' and amount_clp is null and frequency is null
    for update;
  if found then
    begin
      v_now := clock_timestamp();
      update private.coach_invitations set state = 'cancelled', invitation_code = null,
        cancelled_at = v_now where id = v_legacy.id and coach_user_id = v_owner;
      update private.coach_invitation_operations set state = 'cancelled'
        where invitation_id = v_legacy.id and coach_user_id = v_owner and state = 'reserved';
      v_result := private.mutate_coach_invitation('create', p_request_id,
        p_recipient_email, null, null);
      if v_result->>'status' = 'rate_limited' then
        -- The exception block rolls back only this replacement attempt.
        raise exception 'coach_invitation_replacement_rate_limited' using errcode = 'P0R01';
      end if;
    exception when sqlstate 'P0R01' then
      return v_result;
    end;
  else
    v_result := private.mutate_coach_invitation('create', p_request_id,
      p_recipient_email, null, null);
    if v_result->>'status' = 'rate_limited' then return v_result; end if;
  end if;
  v_invitation_id := (v_result->'operation'->>'invitationId')::uuid;
  update private.coach_invitations set amount_clp = p_amount_clp, frequency = p_frequency
    where id = v_invitation_id and coach_user_id = v_owner;
  update private.coach_invitation_operations set payload = v_payload
    where coach_user_id = v_owner and request_id = p_request_id;
  return v_result;
end;
$$;
revoke all on function public.create_own_coach_invitation(text, uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.create_own_coach_invitation(text, uuid, bigint, text)
  to authenticated;

-- The episode insert is the consent boundary. The trigger runs in that same
-- transaction, so a missing legacy invitation term rolls the entire link back.
create function private.start_coach_commercial_on_link()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_invitation private.coach_invitations;
  v_start date;
begin
  select * into v_invitation from private.coach_invitations
    where id = new.invitation_id and coach_user_id = new.coach_user_id;
  if not found or v_invitation.amount_clp is null or v_invitation.frequency is null then
    raise exception 'coach_invitation_terms_required' using errcode = 'P0C01';
  end if;
  v_start := (new.linked_at at time zone 'America/Santiago')::date;
  insert into private.coach_commercial_agreements
    (episode_id, coach_user_id, starts_on, ends_on, status, version, created_at)
    values (new.id, new.coach_user_id, v_start, null, 'active', gen_random_uuid(), new.linked_at);
  insert into private.coach_commercial_periods
    (episode_id, coach_user_id, starts_on, ends_before, amount_clp, frequency, confirmed_at)
    values (new.id, new.coach_user_id, v_start,
      private.coach_commercial_period_end(v_start, v_invitation.frequency),
      v_invitation.amount_clp, v_invitation.frequency, new.linked_at);
  return new;
end;
$$;
revoke all on function private.start_coach_commercial_on_link()
  from public, anon, authenticated;
create trigger coach_start_commercial_on_link
  after insert on private.coach_relationship_episodes
  for each row execute function private.start_coach_commercial_on_link();

-- Lookup reveals only a safe status after the existing code, recipient and
-- active-link checks have succeeded. No commercial amount is exposed.
create or replace function public.lookup_own_coach_invitation(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_identity record;
  v_now timestamptz;
  v_code text;
  v_fingerprint text;
  v_result jsonb;
begin
  select * into v_identity from private.student_coach_identity();
  v_now := clock_timestamp();
  if not private.reserve_student_coach_attempt(v_identity.student_user_id, v_now) then
    return jsonb_build_object('status', 'error_red');
  end if;
  v_code := private.normalize_student_coach_code(p_code);
  v_fingerprint := private.coach_invitation_code_fingerprint(v_code);
  v_result := private.student_coach_lookup_result(
    v_identity.student_user_id, v_identity.student_email, v_fingerprint, v_now);
  if v_result->>'status' = 'valido' and exists (
    select 1 from private.coach_invitation_code_history h
    join private.coach_invitations i on i.id = h.invitation_id
    where h.code_fingerprint = v_fingerprint
      and i.amount_clp is null and i.frequency is null
  ) then
    return jsonb_build_object('status', 'requiere_renovacion');
  end if;
  return v_result;
end;
$$;

commit;
