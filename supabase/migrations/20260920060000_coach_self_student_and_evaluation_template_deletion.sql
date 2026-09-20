-- COACH-SELF-STUDENT-01: same-identity Coach/Usuario membership, self-linking,
-- self-evaluations and owner-only logical template deletion.
-- Local preparation only. Apply to QA first after audit and explicit authorization.

begin;

-- A self-link is a valid relationship. The existing partial unique index on
-- student_user_id remains the concurrency guard for exactly one active Coach.
alter table private.coach_relationship_episodes
  drop constraint coach_relationship_episodes_check;

-- Evaluation assignments follow the authorized relationship, including a
-- same-identity relationship. Immutable snapshots and historical FKs remain.
alter table private.evaluation_assignments
  drop constraint evaluation_assignments_check;

-- Explicit Usuario activation keeps auth.uid() as the only ownership source.
-- It does not create or switch Auth identities and remains idempotent.
create or replace function public.register_own_user()
returns public.user_registrations
language plpgsql
security definer
set search_path = ''
as $register_own_user$
declare
  v_authenticated_user_id uuid := auth.uid();
  v_registration public.user_registrations;
begin
  if v_authenticated_user_id is null then
    raise exception 'user registration requires authentication' using errcode = '42501';
  end if;

  select registration.*
    into v_registration
    from public.user_registrations as registration
    where registration.user_id = v_authenticated_user_id;

  if v_registration.user_id is not null then
    return v_registration;
  end if;

  insert into public.user_registrations default values
  on conflict (user_id) do nothing
  returning * into v_registration;

  if v_registration.user_id is null then
    select registration.*
      into v_registration
      from public.user_registrations as registration
      where registration.user_id = v_authenticated_user_id;
  end if;

  if v_registration.user_id is null
    or v_registration.user_id <> v_authenticated_user_id then
    raise exception 'user registration could not be confirmed' using errcode = '42501';
  end if;

  return v_registration;
end;
$register_own_user$;

revoke all on function public.register_own_user() from public, anon, authenticated;
grant execute on function public.register_own_user() to authenticated;

-- Repair the canonical identity lookup without changing its contract. COALESCE
-- is a SQL construct and cannot be schema-qualified as pg_catalog.coalesce.
create or replace function private.student_coach_identity()
returns table (student_user_id uuid, student_email text, student_name text)
language plpgsql
security definer
set search_path = ''
as $student_coach_identity$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'student_coach_link_forbidden' using errcode = '42501';
  end if;

  perform registration.user_id
  from public.user_registrations as registration
  where registration.user_id = v_user_id
  for update;
  if not found then
    raise exception 'student_coach_link_forbidden' using errcode = '42501';
  end if;

  return query
  select
    v_user_id,
    lower(btrim(auth_user.email)),
    coalesce(
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(pg_catalog.concat_ws(' ', profile.first_name, profile.last_name)), '')
    )
  from auth.users as auth_user
  left join public.profiles as profile on profile.id = auth_user.id
  where auth_user.id = v_user_id
    and auth_user.email is not null
    and coalesce(
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(pg_catalog.concat_ws(' ', profile.first_name, profile.last_name)), '')
    ) is not null;

  if not found then
    raise exception 'student_coach_link_forbidden' using errcode = '42501';
  end if;
end;
$student_coach_identity$;

revoke all on function private.student_coach_identity()
  from public, anon, authenticated;

-- Preserve every lookup state and ownership check from STUDENT-COACH-LINK-01.
-- The only removed rejection is coach_user_id = student_user_id.
create or replace function private.student_coach_lookup_result(
  p_student_user_id uuid,
  p_student_email text,
  p_code_fingerprint text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $student_coach_lookup_result$
declare
  v_history private.coach_invitation_code_history;
  v_invitation private.coach_invitations;
  v_episode private.coach_relationship_episodes;
  v_active private.coach_relationship_episodes;
  v_coach_name text;
begin
  select history.* into v_history
  from private.coach_invitation_code_history as history
  where history.code_fingerprint = p_code_fingerprint;
  if not found then
    return jsonb_build_object('status', 'invalido');
  end if;

  select invitation.* into v_invitation
  from private.coach_invitations as invitation
  where invitation.id = v_history.invitation_id;
  if not found then
    return jsonb_build_object('status', 'invalido');
  end if;

  select episode.* into v_episode
  from private.coach_relationship_episodes as episode
  where episode.invitation_id = v_invitation.id;

  if v_history.retirement_reason = 'accepted' then
    if v_episode.student_user_id = p_student_user_id and v_episode.ended_at is null then
      v_coach_name := private.coach_public_name(v_invitation.coach_user_id);
      if v_coach_name is null then return jsonb_build_object('status', 'error_red'); end if;
      return jsonb_build_object('status', 'ya_aceptado', 'coachName', v_coach_name);
    end if;
    return jsonb_build_object('status', 'ya_usado');
  end if;
  if v_history.retirement_reason = 'cancelled' then
    return jsonb_build_object('status', 'cancelado');
  end if;
  if v_history.retirement_reason = 'regenerated' then
    return jsonb_build_object('status', 'ya_usado');
  end if;
  if private.coach_invitation_code_fingerprint(v_invitation.invitation_code)
    is distinct from p_code_fingerprint then
    return jsonb_build_object('status', 'invalido');
  end if;
  if v_invitation.state = 'cancelled' then
    return jsonb_build_object('status', 'cancelado');
  end if;
  if v_invitation.state = 'accepted' then
    return jsonb_build_object('status', 'ya_usado');
  end if;
  if v_invitation.expires_at <= p_now then
    return jsonb_build_object('status', 'vencido');
  end if;
  if v_invitation.recipient_email <> p_student_email then
    return jsonb_build_object('status', 'no_corresponde');
  end if;

  select episode.* into v_active
  from private.coach_relationship_episodes as episode
  where episode.student_user_id = p_student_user_id
    and episode.ended_at is null;
  if found then
    return jsonb_build_object('status', 'ya_tiene_coach');
  end if;

  v_coach_name := private.coach_public_name(v_invitation.coach_user_id);
  if v_coach_name is null then return jsonb_build_object('status', 'error_red'); end if;
  return jsonb_build_object('status', 'valido', 'coachName', v_coach_name);
end;
$student_coach_lookup_result$;

revoke all on function private.student_coach_lookup_result(uuid, text, text, timestamptz)
  from public, anon, authenticated;

-- Same transaction, locks, allowlists and durable events as the canonical
-- acceptance function. Equality of the two authenticated role memberships is
-- allowed; ownership still cannot be supplied by the client.
create or replace function public.accept_own_coach_invitation(p_code text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $accept_own_coach_invitation$
declare
  v_identity record;
  v_now timestamptz;
  v_code text;
  v_fingerprint text;
  v_history private.coach_invitation_code_history;
  v_invitation private.coach_invitations;
  v_episode private.coach_relationship_episodes;
  v_active private.coach_relationship_episodes;
  v_operation private.student_coach_link_operations;
  v_coach_name text;
  v_coach_email text;
  v_student_idempotency uuid;
  v_coach_idempotency uuid;
begin
  if p_request_id is null then
    raise exception 'student_coach_link_invalid_input' using errcode = '22023';
  end if;
  select * into v_identity from private.student_coach_identity();
  v_now := pg_catalog.clock_timestamp();
  v_code := private.normalize_student_coach_code(p_code);
  v_fingerprint := private.coach_invitation_code_fingerprint(v_code);

  select operation.* into v_operation
  from private.student_coach_link_operations as operation
  where operation.student_user_id = v_identity.student_user_id
    and operation.request_id = p_request_id;
  if found then
    if v_operation.code_fingerprint <> v_fingerprint then
      raise exception 'student_coach_link_request_conflict' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'status', v_operation.result_status,
      'coachName', v_operation.coach_name_snapshot
    );
  end if;

  if not private.reserve_student_coach_attempt(v_identity.student_user_id, v_now) then
    return jsonb_build_object('status', 'error_red');
  end if;

  select history.* into v_history
  from private.coach_invitation_code_history as history
  where history.code_fingerprint = v_fingerprint;
  if not found then return jsonb_build_object('status', 'invalido'); end if;

  perform coach.user_id
  from public.coach_registrations as coach
  where coach.user_id = v_history.coach_user_id
  for update;
  if not found then return jsonb_build_object('status', 'invalido'); end if;

  select invitation.* into v_invitation
  from private.coach_invitations as invitation
  where invitation.id = v_history.invitation_id
  for update;
  if not found then return jsonb_build_object('status', 'invalido'); end if;

  select history.* into v_history
  from private.coach_invitation_code_history as history
  where history.code_fingerprint = v_fingerprint;
  if not found then return jsonb_build_object('status', 'invalido'); end if;

  select episode.* into v_episode
  from private.coach_relationship_episodes as episode
  where episode.invitation_id = v_invitation.id
  for update;

  if v_history.retirement_reason = 'accepted' then
    if v_episode.student_user_id = v_identity.student_user_id and v_episode.ended_at is null then
      v_coach_name := private.coach_public_name(v_invitation.coach_user_id);
      if v_coach_name is null then return jsonb_build_object('status', 'error_red'); end if;
      insert into private.student_coach_link_operations (
        student_user_id, request_id, code_fingerprint, invitation_id, episode_id,
        coach_user_id, coach_name_snapshot, result_status, completed_at
      ) values (
        v_identity.student_user_id, p_request_id, v_fingerprint, v_invitation.id,
        v_episode.id, v_invitation.coach_user_id, v_coach_name, 'already_linked', v_now
      );
      return jsonb_build_object('status', 'already_linked', 'coachName', v_coach_name);
    end if;
    return jsonb_build_object('status', 'ya_usado');
  end if;
  if v_history.retirement_reason = 'cancelled' or v_invitation.state = 'cancelled' then
    return jsonb_build_object('status', 'cancelado');
  end if;
  if v_history.retirement_reason = 'regenerated' then
    return jsonb_build_object('status', 'ya_usado');
  end if;
  if private.coach_invitation_code_fingerprint(v_invitation.invitation_code)
    is distinct from v_fingerprint then
    return jsonb_build_object('status', 'invalido');
  end if;
  if v_invitation.state <> 'pending' then return jsonb_build_object('status', 'ya_usado'); end if;
  if v_invitation.expires_at <= v_now then return jsonb_build_object('status', 'vencido'); end if;
  if v_invitation.recipient_email <> v_identity.student_email then
    return jsonb_build_object('status', 'no_corresponde');
  end if;

  select episode.* into v_active
  from private.coach_relationship_episodes as episode
  where episode.student_user_id = v_identity.student_user_id
    and episode.ended_at is null
  for update;
  if found then return jsonb_build_object('status', 'ya_tiene_coach'); end if;

  v_coach_name := private.coach_public_name(v_invitation.coach_user_id);
  select lower(btrim(auth_user.email)) into v_coach_email
  from auth.users as auth_user
  where auth_user.id = v_invitation.coach_user_id and auth_user.email is not null;
  if v_coach_name is null or v_coach_email is null then
    return jsonb_build_object('status', 'error_red');
  end if;

  begin
    insert into private.coach_relationship_episodes (
      invitation_id, coach_user_id, student_user_id, student_name_snapshot,
      student_email_snapshot, consented_at, linked_at
    ) values (
      v_invitation.id, v_invitation.coach_user_id, v_identity.student_user_id,
      v_identity.student_name, v_identity.student_email, v_now, v_now
    ) returning * into v_episode;
  exception
    when unique_violation then
      return jsonb_build_object('status', 'ya_tiene_coach');
  end;

  update private.coach_invitations as invitation
  set state = 'accepted', invitation_code = null
  where invitation.id = v_invitation.id
    and invitation.coach_user_id = v_invitation.coach_user_id;

  insert into private.student_coach_link_operations (
    student_user_id, request_id, code_fingerprint, invitation_id, episode_id,
    coach_user_id, coach_name_snapshot, result_status, completed_at
  ) values (
    v_identity.student_user_id, p_request_id, v_fingerprint, v_invitation.id,
    v_episode.id, v_invitation.coach_user_id, v_coach_name, 'linked', v_now
  );

  insert into private.coach_link_notifications (
    episode_id, recipient_user_id, portal_scope, audience, copy_state,
    title, body, created_at
  ) values
    (
      v_episode.id, v_identity.student_user_id, 'usuario', 'student', 'ready',
      'Vinculación confirmada',
      'Ahora estás vinculado con Coach ' || v_coach_name || '.',
      v_now
    ),
    (
      v_episode.id, v_invitation.coach_user_id, 'coach', 'coach', 'ready',
      'Nuevo alumno vinculado',
      v_identity.student_name || ' se vinculó a tu cuenta.',
      v_now
    )
  on conflict (episode_id, recipient_user_id, portal_scope) do nothing;

  v_student_idempotency := private.transactional_email_idempotency_uuid(
    'organizatech:coach-link:v1:student:' || v_episode.id::text
  );
  v_coach_idempotency := private.transactional_email_idempotency_uuid(
    'organizatech:coach-link:v1:coach:' || v_episode.id::text
  );

  insert into private.coach_link_email_deliveries (
    episode_id, recipient_user_id, audience, recipient_email_snapshot,
    recipient_fingerprint, idempotency_key, status, created_at, updated_at
  ) values
    (
      v_episode.id, v_identity.student_user_id, 'student', v_identity.student_email,
      private.transactional_email_sha256(v_identity.student_email),
      v_student_idempotency, 'pending', v_now, v_now
    ),
    (
      v_episode.id, v_invitation.coach_user_id, 'coach', v_coach_email,
      private.transactional_email_sha256(v_coach_email),
      v_coach_idempotency, 'pending', v_now, v_now
    )
  on conflict (episode_id, recipient_user_id, audience) do nothing;

  return jsonb_build_object('status', 'linked', 'coachName', v_coach_name);
end;
$accept_own_coach_invitation$;

revoke all on function public.accept_own_coach_invitation(text, uuid)
  from public, anon, authenticated;
grant execute on function public.accept_own_coach_invitation(text, uuid)
  to authenticated;

-- "Eliminar" is a logical retirement. Assignments retain their FK to the
-- origin template and their immutable snapshot, responses and history.
create function public.delete_own_evaluation_template(p_template_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $delete_own_evaluation_template$
declare
  v_owner uuid := private.lock_coach_invitation_owner();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_template private.evaluation_templates;
begin
  if p_template_id is null then
    raise exception 'evaluation_invalid_template_id' using errcode = '22023';
  end if;

  select template.*
    into v_template
    from private.evaluation_templates as template
    where template.id = p_template_id
      and template.coach_user_id = v_owner
    for update;

  if not found then
    raise exception 'evaluation_template_not_found' using errcode = '42501';
  end if;

  if v_template.hidden_at is null then
    update private.evaluation_templates as template
    set hidden_at = v_now,
        updated_at = v_now
    where template.id = v_template.id
      and template.coach_user_id = v_owner;
  end if;

  return true;
end;
$delete_own_evaluation_template$;

revoke all on function public.delete_own_evaluation_template(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_own_evaluation_template(uuid)
  to authenticated;

commit;
