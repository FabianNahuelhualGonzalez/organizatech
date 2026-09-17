-- STUDENT-COACH-LINK-01: student lookup/consent/acceptance and durable delivery events.
-- Local preparation only. Apply to QA first after independent audit and product-copy approval.
-- No provider call is made inside the acceptance transaction.

begin;

create table private.coach_invitation_code_history (
  invitation_id uuid not null,
  coach_user_id uuid not null,
  generation integer not null check (generation > 0),
  code_fingerprint text not null unique check (code_fingerprint ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null,
  retired_at timestamptz,
  retirement_reason text check (
    retirement_reason is null or retirement_reason in ('accepted', 'cancelled', 'regenerated')
  ),
  primary key (invitation_id, generation),
  foreign key (invitation_id, coach_user_id)
    references private.coach_invitations(id, coach_user_id) on delete cascade,
  check ((retired_at is null) = (retirement_reason is null)),
  check (retired_at is null or retired_at >= issued_at)
);

create index coach_invitation_code_history_invitation
  on private.coach_invitation_code_history (invitation_id, generation desc);

create table private.student_coach_link_attempts (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references public.user_registrations(user_id) on delete cascade,
  attempted_at timestamptz not null
);

create index student_coach_link_attempts_recent
  on private.student_coach_link_attempts (student_user_id, attempted_at desc);

create table private.student_coach_link_operations (
  student_user_id uuid not null references public.user_registrations(user_id) on delete cascade,
  request_id uuid not null,
  code_fingerprint text not null check (code_fingerprint ~ '^[0-9a-f]{64}$'),
  invitation_id uuid not null,
  episode_id uuid not null,
  coach_user_id uuid not null,
  coach_name_snapshot text not null check (char_length(btrim(coach_name_snapshot)) between 1 and 201),
  result_status text not null check (result_status in ('linked', 'already_linked')),
  completed_at timestamptz not null,
  primary key (student_user_id, request_id),
  foreign key (invitation_id, coach_user_id)
    references private.coach_invitations(id, coach_user_id) on delete cascade,
  foreign key (episode_id, coach_user_id)
    references private.coach_relationship_episodes(id, coach_user_id) on delete cascade
);

create index student_coach_link_operations_episode
  on private.student_coach_link_operations (episode_id);

-- Product-approved copy is persisted already interpolated. The pending state is
-- retained only for forward-compatible drafts; this event is inserted ready.
create table private.coach_link_notifications (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references private.coach_relationship_episodes(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  portal_scope text not null check (portal_scope in ('usuario', 'coach')),
  audience text not null check (audience in ('student', 'coach')),
  event_kind text not null default 'coach_link_accepted'
    check (event_kind = 'coach_link_accepted'),
  copy_state text not null default 'ready'
    check (copy_state in ('pending_product_copy', 'ready')),
  title text check (title is null or char_length(title) between 1 and 120),
  body text check (body is null or char_length(body) between 1 and 1100),
  read_at timestamptz,
  created_at timestamptz not null,
  unique (episode_id, recipient_user_id, portal_scope),
  check (
    (copy_state = 'pending_product_copy' and title is null and body is null)
    or (copy_state = 'ready' and title is not null and body is not null)
  )
);

create index coach_link_notifications_owner_ready
  on private.coach_link_notifications (recipient_user_id, portal_scope, created_at desc, id desc)
  where copy_state = 'ready';

-- Provider delivery is a separate recovery workflow. These two rows are durable,
-- deterministic and verifiable; acceptance never waits for provider I/O.
create table private.coach_link_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references private.coach_relationship_episodes(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  audience text not null check (audience in ('student', 'coach')),
  recipient_email_snapshot text not null check (
    octet_length(recipient_email_snapshot) between 3 and 254
    and recipient_email_snapshot = lower(btrim(recipient_email_snapshot))
    and recipient_email_snapshot ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  recipient_fingerprint text not null check (recipient_fingerprint ~ '^[0-9a-f]{64}$'),
  idempotency_key uuid not null unique,
  template_version smallint not null default 1 check (template_version > 0),
  status text not null default 'pending'
    check (status in ('pending_product_copy', 'pending', 'sending', 'sent', 'failed', 'ambiguous')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  attempt_token uuid,
  claimed_at timestamptz,
  provider_message_id text check (
    provider_message_id is null
    or (char_length(provider_message_id) between 1 and 512 and provider_message_id !~ '[\r\n]')
  ),
  provider_error_code text check (
    provider_error_code is null or provider_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  sent_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (episode_id, recipient_user_id, audience),
  check (
    (status = 'sending' and attempt_token is not null and claimed_at is not null)
    or (status <> 'sending' and attempt_token is null)
  ),
  check (
    (status = 'sent' and provider_message_id is not null and sent_at is not null)
    or (status <> 'sent' and sent_at is null)
  )
);

create index coach_link_email_deliveries_recovery
  on private.coach_link_email_deliveries (status, updated_at, id)
  where status in ('pending', 'sending', 'failed', 'ambiguous');

alter table private.coach_invitation_code_history enable row level security;
alter table private.coach_invitation_code_history force row level security;
alter table private.student_coach_link_attempts enable row level security;
alter table private.student_coach_link_attempts force row level security;
alter table private.student_coach_link_operations enable row level security;
alter table private.student_coach_link_operations force row level security;
alter table private.coach_link_notifications enable row level security;
alter table private.coach_link_notifications force row level security;
alter table private.coach_link_email_deliveries enable row level security;
alter table private.coach_link_email_deliveries force row level security;

revoke all on table private.coach_invitation_code_history,
  private.student_coach_link_attempts,
  private.student_coach_link_operations,
  private.coach_link_notifications,
  private.coach_link_email_deliveries from public, anon, authenticated;

create function private.coach_invitation_code_fingerprint(p_code text)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $coach_invitation_code_fingerprint$
  select pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_code, 'UTF8'), 'sha256'),
    'hex'
  );
$coach_invitation_code_fingerprint$;

revoke all on function private.coach_invitation_code_fingerprint(text)
  from public, anon, authenticated;

-- Preserve every code that still exists when this migration is applied.
insert into private.coach_invitation_code_history (
  invitation_id,
  coach_user_id,
  generation,
  code_fingerprint,
  issued_at
)
select
  invitation.id,
  invitation.coach_user_id,
  invitation.generation,
  private.coach_invitation_code_fingerprint(invitation.invitation_code),
  invitation.issued_at
from private.coach_invitations as invitation
where invitation.invitation_code is not null;

create function private.track_coach_invitation_code_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $track_coach_invitation_code_history$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_reason text;
begin
  if tg_op = 'INSERT' then
    if new.invitation_code is not null then
      insert into private.coach_invitation_code_history (
        invitation_id, coach_user_id, generation, code_fingerprint, issued_at
      ) values (
        new.id,
        new.coach_user_id,
        new.generation,
        private.coach_invitation_code_fingerprint(new.invitation_code),
        new.issued_at
      );
    end if;
    return new;
  end if;

  if old.invitation_code is distinct from new.invitation_code and old.invitation_code is not null then
    v_reason := case
      when new.state = 'accepted' then 'accepted'
      when new.state = 'cancelled' then 'cancelled'
      else 'regenerated'
    end;
    update private.coach_invitation_code_history as history
    set retired_at = v_now,
        retirement_reason = v_reason
    where history.invitation_id = old.id
      and history.generation = old.generation
      and history.retired_at is null;
  end if;

  if new.invitation_code is not null
    and old.invitation_code is distinct from new.invitation_code then
    insert into private.coach_invitation_code_history (
      invitation_id, coach_user_id, generation, code_fingerprint, issued_at
    ) values (
      new.id,
      new.coach_user_id,
      new.generation,
      private.coach_invitation_code_fingerprint(new.invitation_code),
      new.issued_at
    );
  end if;
  return new;
end;
$track_coach_invitation_code_history$;

revoke all on function private.track_coach_invitation_code_history()
  from public, anon, authenticated;

create trigger on_coach_invitation_track_code_history
  after insert or update of invitation_code, state
  on private.coach_invitations
  for each row
  execute function private.track_coach_invitation_code_history();

create function private.normalize_student_coach_code(p_code text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $normalize_student_coach_code$
declare
  v_code text;
begin
  if p_code is null or octet_length(p_code) > 16 then
    raise exception 'student_coach_link_invalid_input' using errcode = '22023';
  end if;
  v_code := upper(p_code);
  if v_code !~ '^([ABCDEFGHJKLMNPQRSTUVWXYZ]{2}[23456789]){3}$' then
    raise exception 'student_coach_link_invalid_input' using errcode = '22023';
  end if;
  return pg_catalog.substr(v_code, 1, 3) || '-' ||
    pg_catalog.substr(v_code, 4, 3) || '-' || pg_catalog.substr(v_code, 7, 3);
end;
$normalize_student_coach_code$;

revoke all on function private.normalize_student_coach_code(text)
  from public, anon, authenticated;

create function private.student_coach_identity()
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
    pg_catalog.coalesce(
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(pg_catalog.concat_ws(' ', profile.first_name, profile.last_name)), '')
    )
  from auth.users as auth_user
  left join public.profiles as profile on profile.id = auth_user.id
  where auth_user.id = v_user_id
    and auth_user.email is not null
    and pg_catalog.coalesce(
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

create function private.reserve_student_coach_attempt(p_student_user_id uuid, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $reserve_student_coach_attempt$
declare
  v_recent integer;
  v_daily integer;
begin
  delete from private.student_coach_link_attempts as attempt
  where attempt.student_user_id = p_student_user_id
    and attempt.attempted_at <= p_now - interval '24 hours';

  select
    count(*) filter (where attempt.attempted_at > p_now - interval '15 minutes'),
    count(*)
  into v_recent, v_daily
  from private.student_coach_link_attempts as attempt
  where attempt.student_user_id = p_student_user_id
    and attempt.attempted_at > p_now - interval '24 hours';

  if v_recent >= 10 or v_daily >= 100 then
    return false;
  end if;

  insert into private.student_coach_link_attempts (student_user_id, attempted_at)
  values (p_student_user_id, p_now);
  return true;
end;
$reserve_student_coach_attempt$;

revoke all on function private.reserve_student_coach_attempt(uuid, timestamptz)
  from public, anon, authenticated;

create function private.coach_public_name(p_coach_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $coach_public_name$
  select nullif(btrim(pg_catalog.concat_ws(' ', coach.first_name, coach.last_name)), '')
  from public.coach_registrations as coach
  where coach.user_id = p_coach_user_id;
$coach_public_name$;

revoke all on function private.coach_public_name(uuid)
  from public, anon, authenticated;

create function private.student_coach_lookup_result(
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
  if v_invitation.coach_user_id = p_student_user_id then
    return jsonb_build_object('status', 'invalido');
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

create function public.lookup_own_coach_invitation(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $lookup_own_coach_invitation$
declare
  v_identity record;
  v_now timestamptz;
  v_code text;
  v_fingerprint text;
begin
  select * into v_identity from private.student_coach_identity();
  v_now := pg_catalog.clock_timestamp();
  if not private.reserve_student_coach_attempt(v_identity.student_user_id, v_now) then
    return jsonb_build_object('status', 'error_red');
  end if;
  v_code := private.normalize_student_coach_code(p_code);
  v_fingerprint := private.coach_invitation_code_fingerprint(v_code);
  return private.student_coach_lookup_result(
    v_identity.student_user_id,
    v_identity.student_email,
    v_fingerprint,
    v_now
  );
end;
$lookup_own_coach_invitation$;

create function public.read_own_active_coach_link()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $read_own_active_coach_link$
declare
  v_identity record;
  v_episode private.coach_relationship_episodes;
  v_coach_name text;
begin
  select * into v_identity from private.student_coach_identity();
  select episode.* into v_episode
  from private.coach_relationship_episodes as episode
  where episode.student_user_id = v_identity.student_user_id
    and episode.ended_at is null;
  if not found then return jsonb_build_object('status', 'none'); end if;
  v_coach_name := private.coach_public_name(v_episode.coach_user_id);
  if v_coach_name is null then return jsonb_build_object('status', 'none'); end if;
  return jsonb_build_object('status', 'linked', 'coachName', v_coach_name);
end;
$read_own_active_coach_link$;

create function public.accept_own_coach_invitation(p_code text, p_request_id uuid)
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

  -- Coach workflows lock membership before invitation. Acceptance uses the same
  -- order, then relies on the already-held student membership lock.
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

  -- The invitation lock may have waited for another acceptance. Refresh the
  -- history row after that wait so the response reflects the committed
  -- retirement reason instead of a pre-lock snapshot.
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
  if v_invitation.coach_user_id = v_identity.student_user_id then
    return jsonb_build_object('status', 'invalido');
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
      -- The partial unique active-student index is the final concurrency guard.
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

create function public.list_own_coach_link_notifications(
  p_portal_scope text,
  p_limit integer default 50
)
returns table (
  id uuid,
  episode_id uuid,
  title text,
  body text,
  read_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $list_own_coach_link_notifications$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null
    or p_portal_scope not in ('usuario', 'coach')
    or p_limit not between 1 and 100 then
    raise exception 'coach_link_notification_forbidden' using errcode = '42501';
  end if;
  if p_portal_scope = 'coach' and not exists (
    select 1 from public.coach_registrations as coach where coach.user_id = v_user_id
  ) then
    raise exception 'coach_link_notification_forbidden' using errcode = '42501';
  end if;
  return query
  select notification.id, notification.episode_id, notification.title, notification.body,
    notification.read_at, notification.created_at
  from private.coach_link_notifications as notification
  where notification.recipient_user_id = v_user_id
    and notification.portal_scope = p_portal_scope
    and notification.copy_state = 'ready'
  order by notification.created_at desc, notification.id desc
  limit p_limit;
end;
$list_own_coach_link_notifications$;

create function public.mark_own_coach_link_notifications_read(
  p_portal_scope text,
  p_notification_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $mark_own_coach_link_notifications_read$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null
    or p_portal_scope not in ('usuario', 'coach')
    or p_notification_ids is null
    or pg_catalog.cardinality(p_notification_ids) not between 1 and 50 then
    raise exception 'coach_link_notification_forbidden' using errcode = '42501';
  end if;
  update private.coach_link_notifications as notification
  set read_at = pg_catalog.coalesce(notification.read_at, pg_catalog.clock_timestamp())
  where notification.recipient_user_id = v_user_id
    and notification.portal_scope = p_portal_scope
    and notification.copy_state = 'ready'
    and notification.id = any(p_notification_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$mark_own_coach_link_notifications_read$;

-- Authenticated recovery boundary: only the linked student can trigger the two
-- deliveries created for their own episode. The capability remains server-only.
create function public.claim_own_coach_link_emails(p_capability text)
returns table (
  delivery_id uuid,
  episode_id uuid,
  student_user_id uuid,
  recipient_user_id uuid,
  audience text,
  idempotency_key uuid,
  recipient_email text,
  recipient_first_name text,
  coach_name text,
  student_name text,
  attempt_token uuid
)
language plpgsql
security definer
set search_path = ''
as $claim_own_coach_link_emails$
declare
  v_student_user_id uuid := auth.uid();
begin
  if v_student_user_id is null
    or not private.verify_transactional_email_capability(p_capability)
    or not exists (
      select 1 from public.user_registrations as registration
      where registration.user_id = v_student_user_id
    ) then
    raise exception 'coach link email claim requires authentication' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select delivery.id
    from private.coach_link_email_deliveries as delivery
    join private.coach_relationship_episodes as episode
      on episode.id = delivery.episode_id
    join auth.users as recipient
      on recipient.id = delivery.recipient_user_id
    where episode.student_user_id = v_student_user_id
      and episode.ended_at is null
      and pg_catalog.lower(pg_catalog.btrim(recipient.email)) = delivery.recipient_email_snapshot
      and delivery.attempt_count < 5
      and (
        delivery.status = 'failed'
        or (delivery.status = 'pending' and delivery.attempt_count = 0)
      )
    order by delivery.created_at, delivery.id
    for update of delivery skip locked
  ),
  claimed as (
    update private.coach_link_email_deliveries as delivery
    set status = 'sending',
        attempt_count = delivery.attempt_count + 1,
        attempt_token = gen_random_uuid(),
        claimed_at = pg_catalog.clock_timestamp(),
        provider_error_code = null,
        updated_at = pg_catalog.clock_timestamp()
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select
    claimed.id,
    claimed.episode_id,
    episode.student_user_id,
    claimed.recipient_user_id,
    claimed.audience,
    claimed.idempotency_key,
    claimed.recipient_email_snapshot,
    case
      when claimed.audience = 'student' then coalesce(
        nullif(pg_catalog.btrim(profile.first_name), ''),
        pg_catalog.split_part(episode.student_name_snapshot, ' ', 1)
      )
      else coach.first_name
    end,
    'Coach ' || pg_catalog.btrim(pg_catalog.concat_ws(' ', coach.first_name, coach.last_name)),
    episode.student_name_snapshot,
    claimed.attempt_token
  from claimed
  join private.coach_relationship_episodes as episode
    on episode.id = claimed.episode_id
  join public.coach_registrations as coach
    on coach.user_id = episode.coach_user_id
  left join public.profiles as profile
    on profile.id = episode.student_user_id;
end;
$claim_own_coach_link_emails$;

create function public.complete_own_coach_link_email(
  p_capability text,
  p_delivery_id uuid,
  p_attempt_token uuid,
  p_outcome text,
  p_provider_message_id text default null,
  p_provider_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $complete_own_coach_link_email$
declare
  v_student_user_id uuid := auth.uid();
begin
  if v_student_user_id is null
    or not private.verify_transactional_email_capability(p_capability) then
    raise exception 'coach link email completion requires authentication' using errcode = '42501';
  end if;
  if p_delivery_id is null or p_attempt_token is null
    or p_outcome not in ('sent', 'failed', 'ambiguous') then
    raise exception 'invalid coach link email completion payload' using errcode = '22023';
  end if;
  if p_outcome = 'sent' and (
    p_provider_message_id is null
    or pg_catalog.char_length(p_provider_message_id) not between 1 and 512
    or p_provider_message_id ~ '[\r\n]'
    or p_provider_error_code is not null
  ) then
    raise exception 'invalid provider success payload' using errcode = '22023';
  end if;
  if p_outcome <> 'sent' and (
    p_provider_message_id is not null
    or p_provider_error_code is null
    or p_provider_error_code !~ '^[a-z0-9_]{1,64}$'
  ) then
    raise exception 'invalid provider failure payload' using errcode = '22023';
  end if;

  update private.coach_link_email_deliveries as delivery
  set status = p_outcome,
      attempt_token = null,
      provider_message_id = case when p_outcome = 'sent' then p_provider_message_id else null end,
      provider_error_code = case when p_outcome <> 'sent' then p_provider_error_code else null end,
      sent_at = case when p_outcome = 'sent' then pg_catalog.clock_timestamp() else null end,
      updated_at = pg_catalog.clock_timestamp()
  where delivery.id = p_delivery_id
    and delivery.status = 'sending'
    and delivery.attempt_token = p_attempt_token
    and exists (
      select 1
      from private.coach_relationship_episodes as episode
      where episode.id = delivery.episode_id
        and episode.student_user_id = v_student_user_id
    );
  return found;
end;
$complete_own_coach_link_email$;

revoke all on function public.lookup_own_coach_invitation(text),
  public.read_own_active_coach_link(),
  public.accept_own_coach_invitation(text, uuid),
  public.list_own_coach_link_notifications(text, integer),
  public.mark_own_coach_link_notifications_read(text, uuid[]),
  public.claim_own_coach_link_emails(text),
  public.complete_own_coach_link_email(text, uuid, uuid, text, text, text)
  from public, anon, authenticated;

grant execute on function public.lookup_own_coach_invitation(text),
  public.read_own_active_coach_link(),
  public.accept_own_coach_invitation(text, uuid),
  public.list_own_coach_link_notifications(text, integer),
  public.mark_own_coach_link_notifications_read(text, uuid[]),
  public.claim_own_coach_link_emails(text),
  public.complete_own_coach_link_email(text, uuid, uuid, text, text, text)
  to authenticated;

commit;
