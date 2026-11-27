-- Scheduler-only recovery of already reserved invitation mail.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function public.claim_due_coach_invitation_emails(p_capability text, p_limit integer default 25)
returns table (
  delivery_id uuid, invitation_id uuid, request_id uuid, coach_user_id uuid,
  audience text, operation_action text, idempotency_key uuid,
  recipient_email text, invited_email text, recipient_first_name text,
  coach_name text, invitation_code text, expires_at timestamptz,
  recipient_has_account boolean, attempt_token uuid, coach_email text
) language plpgsql volatile security definer set search_path = ''
set statement_timeout = '8s' as $fn$
declare v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if auth.uid() is not null or not private.verify_transactional_email_capability(p_capability) then
    raise exception 'invitation scheduler forbidden' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 25 then
    raise exception 'invitation scheduler invalid limit' using errcode = '22023';
  end if;
  return query with candidates as (
    select delivery.id from private.coach_invitation_email_deliveries delivery
    join private.coach_invitations invitation on invitation.id = delivery.invitation_id
      and invitation.coach_user_id = delivery.coach_user_id
    join private.coach_invitation_operations operation on operation.coach_user_id = delivery.coach_user_id
      and operation.request_id = delivery.request_id and operation.invitation_id = delivery.invitation_id
    join auth.users coach_auth on coach_auth.id = delivery.coach_user_id
      and coach_auth.email_confirmed_at is not null
    where invitation.state = 'pending' and invitation.invitation_code is not null
      and invitation.expires_at > v_now and invitation.generation = delivery.generation
      and operation.action in ('create','resend','regenerate') and operation.state = 'reserved'
      and delivery.attempt_count < 5
      and (delivery.audience <> 'coach' or delivery.recipient_email_snapshot =
        pg_catalog.lower(pg_catalog.btrim(coach_auth.email)))
      and (
        (delivery.status = 'pending' and delivery.attempt_count = 0)
        or (delivery.status = 'failed' and delivery.next_attempt_at <= v_now)
      )
    order by delivery.created_at, delivery.id for update of delivery skip locked limit p_limit
  ), claimed as (
    update private.coach_invitation_email_deliveries delivery
    set status = 'sending', attempt_count = delivery.attempt_count + 1,
      attempt_token = pg_catalog.gen_random_uuid(), claimed_at = v_now,
      next_attempt_at = null, provider_error_code = null, updated_at = v_now
    from candidates where delivery.id = candidates.id returning delivery.*
  ) select claimed.id, claimed.invitation_id, claimed.request_id, claimed.coach_user_id,
    claimed.audience, claimed.operation_action, claimed.idempotency_key,
    claimed.recipient_email_snapshot, invitation.recipient_email,
    case when claimed.audience = 'coach' then coach.first_name
      else pg_catalog.nullif(pg_catalog.btrim(profile.first_name), '') end,
    'Coach ' || pg_catalog.btrim(pg_catalog.concat_ws(' ', coach.first_name, coach.last_name)),
    invitation.invitation_code, invitation.expires_at,
    case when claimed.audience = 'student' then student_auth.id is not null else true end,
    claimed.attempt_token, pg_catalog.lower(pg_catalog.btrim(coach_auth.email))
  from claimed join private.coach_invitations invitation
    on invitation.id = claimed.invitation_id and invitation.coach_user_id = claimed.coach_user_id
  join public.coach_registrations coach on coach.user_id = claimed.coach_user_id
  join auth.users coach_auth on coach_auth.id = claimed.coach_user_id
  left join auth.users student_auth on pg_catalog.lower(pg_catalog.btrim(student_auth.email)) = invitation.recipient_email
  left join public.profiles profile on profile.id = student_auth.id;
end;
$fn$;

create function public.authorize_due_coach_invitation_email(
  p_capability text, p_delivery_id uuid, p_attempt_token uuid
) returns boolean language plpgsql volatile security definer set search_path = ''
set statement_timeout = '5s' as $fn$
begin
  if auth.uid() is not null or not private.verify_transactional_email_capability(p_capability) then
    raise exception 'invitation scheduler forbidden' using errcode = '42501';
  end if;
  return exists (
    select 1 from private.coach_invitation_email_deliveries delivery
    join private.coach_invitations invitation on invitation.id = delivery.invitation_id
      and invitation.coach_user_id = delivery.coach_user_id
    join private.coach_invitation_operations operation on operation.coach_user_id = delivery.coach_user_id
      and operation.request_id = delivery.request_id and operation.invitation_id = delivery.invitation_id
    join auth.users coach_auth on coach_auth.id = delivery.coach_user_id
    where delivery.id = p_delivery_id and delivery.attempt_token = p_attempt_token
      and delivery.status = 'sending' and invitation.state = 'pending'
      and invitation.invitation_code is not null and invitation.generation = delivery.generation
      and invitation.expires_at > pg_catalog.clock_timestamp()
      and operation.state = 'reserved' and operation.action in ('create','resend','regenerate')
      and (delivery.audience <> 'coach' or delivery.recipient_email_snapshot =
        pg_catalog.lower(pg_catalog.btrim(coach_auth.email)))
  );
end;
$fn$;

create function public.complete_due_coach_invitation_email(
  p_capability text, p_delivery_id uuid, p_attempt_token uuid, p_outcome text,
  p_provider_message_id text default null, p_provider_error_code text default null
) returns boolean language plpgsql volatile security definer set search_path = ''
set statement_timeout = '5s' as $fn$
begin
  if auth.uid() is not null or not private.verify_transactional_email_capability(p_capability) then
    raise exception 'invitation scheduler forbidden' using errcode = '42501';
  end if;
  if p_delivery_id is null or p_attempt_token is null or p_outcome not in ('sent','failed','ambiguous')
    or (p_outcome = 'sent' and (p_provider_message_id is null
      or pg_catalog.char_length(p_provider_message_id) not between 1 and 512
      or p_provider_message_id ~ '[\r\n]' or p_provider_error_code is not null))
    or (p_outcome <> 'sent' and (p_provider_message_id is not null
      or p_provider_error_code is null or p_provider_error_code !~ '^[a-z0-9_]{1,64}$')) then
    raise exception 'invitation scheduler invalid completion' using errcode = '22023';
  end if;
  update private.coach_invitation_email_deliveries delivery
  set status = p_outcome, attempt_token = null,
    provider_message_id = case when p_outcome = 'sent' then p_provider_message_id else null end,
    provider_error_code = case when p_outcome <> 'sent' then p_provider_error_code else null end,
    sent_at = case when p_outcome = 'sent' then pg_catalog.clock_timestamp() else null end,
    next_attempt_at = case when p_outcome = 'sent' or delivery.attempt_count >= 5 then null
      when p_outcome = 'ambiguous' then pg_catalog.clock_timestamp() + interval '10 minutes'
      when delivery.attempt_count = 1 then pg_catalog.clock_timestamp() + interval '1 minute'
      when delivery.attempt_count = 2 then pg_catalog.clock_timestamp() + interval '5 minutes'
      when delivery.attempt_count = 3 then pg_catalog.clock_timestamp() + interval '30 minutes'
      else pg_catalog.clock_timestamp() + interval '2 hours' end,
    updated_at = pg_catalog.clock_timestamp()
  where delivery.id = p_delivery_id and delivery.status = 'sending'
    and delivery.attempt_token = p_attempt_token;
  return found;
end;
$fn$;

revoke all on function public.claim_due_coach_invitation_emails(text,integer),
  public.authorize_due_coach_invitation_email(text,uuid,uuid),
  public.complete_due_coach_invitation_email(text,uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_due_coach_invitation_emails(text,integer),
  public.authorize_due_coach_invitation_email(text,uuid,uuid),
  public.complete_due_coach_invitation_email(text,uuid,uuid,text,text,text) to anon;
commit;
