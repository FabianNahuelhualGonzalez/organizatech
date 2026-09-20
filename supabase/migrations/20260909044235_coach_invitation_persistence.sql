-- Local preparation only. No acceptance endpoint, dispatcher, training grants or writes.
begin;
create schema if not exists private;

create table private.coach_invitations (
  id uuid primary key default gen_random_uuid(),
  coach_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null check (
    octet_length(recipient_email) between 3 and 254
    and recipient_email = lower(btrim(recipient_email))
    and recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  invitation_code text unique check (
    invitation_code ~ '^([ABCDEFGHJKLMNPQRSTUVWXYZ]{2}[23456789]-){2}[ABCDEFGHJKLMNPQRSTUVWXYZ]{2}[23456789]$'
  ),
  generation integer not null default 1 check (generation > 0),
  state text not null default 'pending' check (state in ('pending', 'cancelled', 'accepted')),
  created_at timestamptz not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  cancelled_at timestamptz,
  unique (id, coach_user_id),
  check (expires_at = issued_at + interval '168 hours'),
  check (issued_at >= created_at),
  check ((state = 'pending') = (invitation_code is not null)),
  check ((state = 'cancelled') = (cancelled_at is not null)),
  check (cancelled_at is null or cancelled_at >= created_at)
);
create index coach_invitations_owner_page on private.coach_invitations (coach_user_id, created_at desc, id desc);
-- Expired pending invitations use explicit regeneration; not a second invitation.
create unique index coach_invitation_one_pending_recipient on private.coach_invitations
  (coach_user_id, recipient_email) where state = 'pending';

-- Schema reservation only: no Coach/client RPC can create an episode or consent.
-- A future separately approved acceptance transaction must verify the recipient,
-- take the same Coach -> invitation locks, and obtain fresh student consent.
create table private.coach_relationship_episodes (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null unique,
  coach_user_id uuid not null references auth.users(id) on delete cascade,
  student_user_id uuid not null references public.user_registrations(user_id) on delete cascade,
  student_name_snapshot text not null check (char_length(btrim(student_name_snapshot)) between 1 and 201),
  student_email_snapshot text not null check (octet_length(student_email_snapshot) between 3 and 254),
  consented_at timestamptz not null,
  linked_at timestamptz not null,
  ended_at timestamptz,
  unique (id, coach_user_id),
  foreign key (invitation_id, coach_user_id) references private.coach_invitations(id, coach_user_id) on delete cascade,
  check (coach_user_id <> student_user_id),
  check (linked_at = consented_at),
  check (ended_at is null or ended_at >= linked_at)
);
create unique index coach_relationship_one_active_student on private.coach_relationship_episodes (student_user_id) where ended_at is null;
create index coach_relationship_owner_page on private.coach_relationship_episodes (coach_user_id, linked_at desc, id desc);
create index coach_relationship_student_history on private.coach_relationship_episodes (student_user_id, linked_at desc);
create index coach_relationship_active_recipient on private.coach_relationship_episodes
  (coach_user_id, lower(btrim(student_email_snapshot))) where ended_at is null;

create table private.coach_invitation_operations (
  coach_user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  action text not null check (action in ('create', 'resend', 'regenerate', 'cancel', 'revoke')),
  payload jsonb not null,
  invitation_id uuid,
  episode_id uuid,
  generation integer,
  reserved_at timestamptz not null,
  -- 'reserved' is deliberately NOT provider acceptance or delivery.
  state text not null check (state in ('reserved', 'completed', 'cancelled')),
  primary key (coach_user_id, request_id),
  foreign key (invitation_id, coach_user_id) references private.coach_invitations(id, coach_user_id) on delete cascade,
  foreign key (episode_id, coach_user_id) references private.coach_relationship_episodes(id, coach_user_id) on delete cascade,
  check ((action = 'revoke' and episode_id is not null and invitation_id is null and generation is null)
    or (action <> 'revoke' and invitation_id is not null and episode_id is null and generation > 0)),
  check ((action in ('create', 'resend', 'regenerate') and state in ('reserved', 'cancelled'))
    or (action in ('cancel', 'revoke') and state = 'completed'))
);
create index coach_invitation_creation_budget on private.coach_invitation_operations (coach_user_id, reserved_at desc) where action in ('create', 'regenerate');
create index coach_invitation_resend_budget on private.coach_invitation_operations (invitation_id, action, reserved_at desc);
create index coach_invitation_episode_operations on private.coach_invitation_operations (episode_id) where episode_id is not null;

alter table private.coach_invitations enable row level security;
alter table private.coach_invitations force row level security;
alter table private.coach_relationship_episodes enable row level security;
alter table private.coach_relationship_episodes force row level security;
alter table private.coach_invitation_operations enable row level security;
alter table private.coach_invitation_operations force row level security;
revoke all on table private.coach_invitations, private.coach_relationship_episodes,
  private.coach_invitation_operations from public, anon, authenticated;
-- No policies: default deny. No shared schema/default privileges are changed.

create function private.lock_coach_invitation_owner()
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_owner uuid := auth.uid();
begin
  if v_owner is null then
    raise exception 'coach_invitation_forbidden' using errcode = '42501';
  end if;
  -- Exclusive from the start, even on reads: no KEY SHARE -> UPDATE upgrade.
  -- All entry points use membership -> invitation/episode -> operations.
  perform r.user_id from public.coach_registrations r where r.user_id = v_owner for update;
  if not found then
    raise exception 'coach_invitation_forbidden' using errcode = '42501';
  end if;
  return v_owner;
end;
$$;
revoke all on function private.lock_coach_invitation_owner() from public, anon, authenticated;

create function private.new_coach_invitation_code()
returns text language plpgsql security invoker set search_path = '' as $$
declare v_result text := ''; v_byte integer; v_position integer;
begin
  for v_position in 1..9 loop
    if v_position in (4, 7) then v_result := v_result || '-'; end if;
    -- Core gen_random_uuid uses pg_strong_random. Its FIRST byte has no UUID
    -- version/variant bits. Rejection sampling avoids modulo bias for 24 letters.
    loop
      v_byte := pg_catalog.get_byte(pg_catalog.uuid_send(pg_catalog.gen_random_uuid()), 0);
      exit when v_position % 3 = 0 or v_byte < 240;
    end loop;
    v_result := v_result || case when v_position % 3 = 0
      then pg_catalog.substr('23456789', 1 + v_byte % 8, 1)
      else pg_catalog.substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + v_byte % 24, 1) end;
  end loop;
  return v_result;
end;
$$;
revoke all on function private.new_coach_invitation_code() from public, anon, authenticated;

create function private.coach_invitation_view(p_owner uuid, p_id uuid, p_now timestamptz)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'recipientEmail', i.recipient_email,
    'state', case when i.state = 'pending' and i.expires_at <= p_now then 'expired' else i.state end,
    'generation', i.generation, 'createdAt', i.created_at, 'issuedAt', i.issued_at,
    'expiresAt', i.expires_at, 'cancelledAt', i.cancelled_at,
    'code', case when i.state = 'pending' and i.expires_at > p_now then i.invitation_code else null end)
  from private.coach_invitations i where i.id = p_id and i.coach_user_id = p_owner;
$$;
revoke all on function private.coach_invitation_view(uuid, uuid, timestamptz) from public, anon, authenticated;

create function private.coach_invitation_operation_view(p_owner uuid, p_request uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('requestId', o.request_id, 'action', o.action, 'state', o.state,
    'invitationId', o.invitation_id, 'episodeId', o.episode_id,
    'generation', o.generation, 'reservedAt', o.reserved_at)
  from private.coach_invitation_operations o where o.coach_user_id = p_owner and o.request_id = p_request;
$$;
revoke all on function private.coach_invitation_operation_view(uuid, uuid) from public, anon, authenticated;

-- Internal command engine. Public wrappers below are the complete write allowlist.
create function private.mutate_coach_invitation(
  p_action text, p_request_id uuid, p_email text, p_invitation_id uuid, p_episode_id uuid
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_owner uuid := private.lock_coach_invitation_owner();
  -- Read time AFTER the exclusive lock: a queued request must not reuse stale time.
  v_now timestamptz := clock_timestamp();
  v_email text;
  v_payload jsonb;
  v_op private.coach_invitation_operations;
  v_inv private.coach_invitations;
  v_episode private.coach_relationship_episodes;
  v_times timestamptz[];
  v_retry timestamptz;
  v_code text;
  v_attempt integer;
  v_generated boolean := false;
begin
  if p_request_id is null or p_action is null
    or p_action not in ('create', 'resend', 'regenerate', 'cancel', 'revoke') then
    raise exception 'coach_invitation_invalid_input' using errcode = '22023';
  end if;
  if p_action = 'create' then
    if p_email is null or octet_length(p_email) > 320 then
      raise exception 'coach_invitation_invalid_input' using errcode = '22023';
    end if;
    v_email := lower(btrim(p_email));
    if octet_length(v_email) not between 3 and 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or p_invitation_id is not null or p_episode_id is not null then
      raise exception 'coach_invitation_invalid_input' using errcode = '22023';
    end if;
    v_payload := jsonb_build_object('recipientEmail', v_email);
  elsif p_action = 'revoke' then
    if p_episode_id is null or p_email is not null or p_invitation_id is not null then
      raise exception 'coach_invitation_invalid_input' using errcode = '22023';
    end if;
    v_payload := jsonb_build_object('episodeId', p_episode_id);
  else
    if p_invitation_id is null or p_email is not null or p_episode_id is not null then
      raise exception 'coach_invitation_invalid_input' using errcode = '22023';
    end if;
    v_payload := jsonb_build_object('invitationId', p_invitation_id);
  end if;

  -- No mutation precedes replay reconciliation; successful request ids persist.
  select * into v_op from private.coach_invitation_operations o
    where o.coach_user_id = v_owner and o.request_id = p_request_id;
  if found then
    if v_op.action <> p_action or v_op.payload <> v_payload then
      raise exception 'coach_invitation_request_conflict' using errcode = '22023';
    end if;
    return jsonb_build_object('status', 'recorded', 'serverNow', v_now,
      'operation', private.coach_invitation_operation_view(v_owner, p_request_id));
  end if;

  if p_action = 'revoke' then
    select * into v_episode from private.coach_relationship_episodes e
      where e.id = p_episode_id and e.coach_user_id = v_owner for update;
    if not found then
      raise exception 'coach_invitation_not_found' using errcode = 'P0002';
    end if;
    if v_episode.ended_at is not null then
      -- Same request was reconciled above. A new request must not append unlimited
      -- operations to an already closed episode or rewrite its historic date.
      raise exception 'coach_invitation_state_conflict' using errcode = '55000';
    end if;
    -- Preserve the original episode and identity snapshots.
    update private.coach_relationship_episodes set ended_at = v_now
      where id = p_episode_id and coach_user_id = v_owner;
    insert into private.coach_invitation_operations
      (coach_user_id, request_id, action, payload, episode_id, reserved_at, state)
      values (v_owner, p_request_id, p_action, v_payload, p_episode_id, v_now, 'completed');
  else
    if p_action = 'create' then
      -- Repeat the form's own-portfolio checks under the same exclusive Coach
      -- lock, after idempotent replay and before consuming any quota. Never look
      -- up global accounts or the portfolio of another Coach by recipient email.
      if exists (select 1 from private.coach_relationship_episodes e
        where e.coach_user_id = v_owner and e.ended_at is null
          and lower(btrim(e.student_email_snapshot)) = v_email) then
        raise exception 'coach_invitation_already_active' using errcode = '55000';
      end if;
      if exists (select 1 from private.coach_invitations i
        where i.coach_user_id = v_owner and i.recipient_email = v_email and i.state = 'pending') then
        raise exception 'coach_invitation_already_pending' using errcode = '55000';
      end if;
    end if;
    if p_action <> 'create' then
      select * into v_inv from private.coach_invitations i
        where i.id = p_invitation_id and i.coach_user_id = v_owner for update;
      if not found then
        raise exception 'coach_invitation_not_found' using errcode = 'P0002';
      end if;
      if v_inv.state <> 'pending' then
        raise exception 'coach_invitation_state_conflict' using errcode = '55000';
      end if;
      if (p_action = 'resend' and v_inv.expires_at <= v_now)
        or (p_action = 'regenerate' and v_inv.expires_at > v_now) then
        raise exception 'coach_invitation_state_conflict' using errcode = '55000';
      end if;
    end if;

    if p_action in ('create', 'regenerate') then
      select array_agg(q.reserved_at order by q.reserved_at desc) into v_times from (
        select o.reserved_at from private.coach_invitation_operations o
        where o.coach_user_id = v_owner and o.action in ('create', 'regenerate')
          and o.reserved_at > v_now - interval '24 hours'
        order by o.reserved_at desc limit 50
      ) q;
      v_retry := greatest(v_times[10] + interval '1 hour', v_times[50] + interval '24 hours');
    elsif p_action = 'resend' then
      select array_agg(q.reserved_at order by q.reserved_at desc) into v_times from (
        select o.reserved_at from private.coach_invitation_operations o
        where o.invitation_id = v_inv.id and o.action = 'resend'
          and o.reserved_at > v_now - interval '24 hours'
        order by o.reserved_at desc limit 3
      ) q;
      v_retry := greatest(v_inv.issued_at + interval '60 seconds',
        v_times[1] + interval '60 seconds', v_times[3] + interval '24 hours');
    end if;
    if v_retry > v_now then
      return jsonb_build_object('status', 'rate_limited', 'serverNow', v_now, 'retryAt', v_retry);
    end if;

    if p_action in ('create', 'regenerate') then
      -- Global unique index arbitrates inter-Coach collisions. Never expose a code
      -- via constraint-error DETAIL; bounded collision handling emits a generic error.
      for v_attempt in 1..8 loop
        v_code := private.new_coach_invitation_code();
        if v_code is not distinct from v_inv.invitation_code then continue; end if;
        begin
          if p_action = 'create' then
            insert into private.coach_invitations
              (coach_user_id, recipient_email, invitation_code, created_at, issued_at, expires_at)
              values (v_owner, v_email, v_code, v_now, v_now, v_now + interval '168 hours')
              returning * into v_inv;
          else
            update private.coach_invitations set invitation_code = v_code,
              generation = generation + 1, issued_at = v_now, expires_at = v_now + interval '168 hours'
              where id = v_inv.id and coach_user_id = v_owner returning * into v_inv;
          end if;
          v_generated := true;
          exit;
        exception when unique_violation then
          if v_attempt = 8 then
            raise exception 'coach_invitation_retry_required' using errcode = '40001';
          end if;
        end;
      end loop;
      if not v_generated then
        raise exception 'coach_invitation_retry_required' using errcode = '40001';
      end if;
    elsif p_action = 'cancel' then
      update private.coach_invitations set state = 'cancelled', invitation_code = null, cancelled_at = v_now
        where id = v_inv.id and coach_user_id = v_owner;
    end if;
    if p_action in ('cancel', 'regenerate') then
      update private.coach_invitation_operations set state = 'cancelled'
        where invitation_id = v_inv.id and coach_user_id = v_owner and state = 'reserved';
    end if;
    insert into private.coach_invitation_operations
      (coach_user_id, request_id, action, payload, invitation_id, generation, reserved_at, state)
      values (v_owner, p_request_id, p_action, v_payload, v_inv.id, v_inv.generation, v_now,
        case when p_action = 'cancel' then 'completed' else 'reserved' end);
  end if;
  return jsonb_build_object('status', 'recorded', 'serverNow', v_now,
    'operation', private.coach_invitation_operation_view(v_owner, p_request_id));
end;
$$;
revoke all on function private.mutate_coach_invitation(text, uuid, text, uuid, uuid) from public, anon, authenticated;

-- Definers expose only exact arguments; the private engine checks live membership
-- and auth.uid() on every invocation. No owner/student/state/code/audit inputs.
create function public.create_own_coach_invitation(p_recipient_email text, p_request_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select private.mutate_coach_invitation('create', p_request_id, p_recipient_email, null, null);
$$;
create function public.resend_own_coach_invitation(p_invitation_id uuid, p_request_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select private.mutate_coach_invitation('resend', p_request_id, null, p_invitation_id, null);
$$;
create function public.regenerate_own_coach_invitation(p_invitation_id uuid, p_request_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select private.mutate_coach_invitation('regenerate', p_request_id, null, p_invitation_id, null);
$$;
create function public.cancel_own_coach_invitation(p_invitation_id uuid, p_request_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select private.mutate_coach_invitation('cancel', p_request_id, null, p_invitation_id, null);
$$;
create function public.revoke_own_coach_relationship(p_episode_id uuid, p_request_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select private.mutate_coach_invitation('revoke', p_request_id, null, null, p_episode_id);
$$;

create function public.read_own_coach_invitation(p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := private.lock_coach_invitation_owner(); v_result jsonb;
begin
  v_result := private.coach_invitation_view(v_owner, p_invitation_id, clock_timestamp());
  if v_result is null then raise exception 'coach_invitation_not_found' using errcode = 'P0002'; end if;
  return v_result;
end;
$$;
create function public.read_own_coach_invitation_operation(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := private.lock_coach_invitation_owner();
begin
  -- Missing request is not a failed delivery. It means no persisted reservation.
  return private.coach_invitation_operation_view(v_owner, p_request_id);
end;
$$;
create function public.read_own_coach_relationship(p_episode_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := private.lock_coach_invitation_owner(); v_result jsonb;
begin
  select jsonb_build_object('id', e.id, 'studentName', e.student_name_snapshot,
    'studentEmail', e.student_email_snapshot, 'linkedAt', e.linked_at, 'endedAt', e.ended_at)
    into v_result from private.coach_relationship_episodes e
    where e.id = p_episode_id and e.coach_user_id = v_owner;
  if v_result is null then raise exception 'coach_invitation_not_found' using errcode = 'P0002'; end if;
  return v_result;
end;
$$;

revoke all on function public.create_own_coach_invitation(text, uuid),
  public.resend_own_coach_invitation(uuid, uuid), public.regenerate_own_coach_invitation(uuid, uuid),
  public.cancel_own_coach_invitation(uuid, uuid), public.revoke_own_coach_relationship(uuid, uuid),
  public.read_own_coach_invitation(uuid), public.read_own_coach_invitation_operation(uuid),
  public.read_own_coach_relationship(uuid) from public, anon, authenticated;
grant execute on function public.create_own_coach_invitation(text, uuid),
  public.resend_own_coach_invitation(uuid, uuid), public.regenerate_own_coach_invitation(uuid, uuid),
  public.cancel_own_coach_invitation(uuid, uuid), public.revoke_own_coach_relationship(uuid, uuid),
  public.read_own_coach_invitation(uuid), public.read_own_coach_invitation_operation(uuid),
  public.read_own_coach_relationship(uuid) to authenticated;
commit;
