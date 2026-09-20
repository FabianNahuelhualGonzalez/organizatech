-- COACH-LINK-CODE-DELIVERY-01: durable invitation-code notification and email delivery.
-- Local preparation only. Apply to QA first after audit and explicit authorization.
-- Provider I/O remains outside the invitation transaction.

begin;

create table private.coach_invitation_created_notifications (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null,
  coach_user_id uuid not null,
  generation integer not null check (generation > 0),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 1100),
  read_at timestamptz,
  created_at timestamptz not null,
  unique (invitation_id, generation),
  foreign key (invitation_id, coach_user_id)
    references private.coach_invitations(id, coach_user_id) on delete cascade
);

create index coach_invitation_created_notifications_owner
  on private.coach_invitation_created_notifications (coach_user_id, created_at desc, id desc);

create table private.coach_invitation_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  coach_user_id uuid not null,
  request_id uuid not null,
  invitation_id uuid not null,
  generation integer not null check (generation > 0),
  operation_action text not null check (operation_action in ('create', 'resend', 'regenerate')),
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
    check (status in ('pending', 'sending', 'sent', 'failed', 'ambiguous', 'superseded')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  attempt_token uuid,
  claimed_at timestamptz,
  next_attempt_at timestamptz,
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
  unique (coach_user_id, request_id, audience),
  foreign key (coach_user_id, request_id)
    references private.coach_invitation_operations(coach_user_id, request_id) on delete cascade,
  foreign key (invitation_id, coach_user_id)
    references private.coach_invitations(id, coach_user_id) on delete cascade,
  check (
    (status = 'sending' and attempt_token is not null and claimed_at is not null)
    or (status <> 'sending' and attempt_token is null)
  ),
  check (
    (status = 'sent' and provider_message_id is not null and sent_at is not null)
    or (status <> 'sent' and sent_at is null)
  )
);

create index coach_invitation_email_deliveries_recovery
  on private.coach_invitation_email_deliveries
    (coach_user_id, request_id, status, next_attempt_at, updated_at, id)
  where status in ('pending', 'sending', 'failed', 'ambiguous');

alter table private.coach_invitation_created_notifications enable row level security;
alter table private.coach_invitation_created_notifications force row level security;
alter table private.coach_invitation_email_deliveries enable row level security;
alter table private.coach_invitation_email_deliveries force row level security;

revoke all on table private.coach_invitation_created_notifications,
  private.coach_invitation_email_deliveries from public, anon, authenticated;

create function private.enqueue_coach_invitation_code_delivery()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $enqueue_coach_invitation_code_delivery$
declare
  v_invitation private.coach_invitations;
  v_coach_email text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if new.action not in ('create', 'resend', 'regenerate') or new.state <> 'reserved' then
    return new;
  end if;

  select invitation.* into v_invitation
  from private.coach_invitations as invitation
  where invitation.id = new.invitation_id
    and invitation.coach_user_id = new.coach_user_id;
  if not found
    or v_invitation.state <> 'pending'
    or v_invitation.invitation_code is null
    or v_invitation.generation <> new.generation then
    raise exception 'coach_invitation_delivery_state_conflict' using errcode = '40001';
  end if;

  select pg_catalog.lower(pg_catalog.btrim(auth_user.email)) into v_coach_email
  from auth.users as auth_user
  where auth_user.id = new.coach_user_id
    and auth_user.email is not null;
  if v_coach_email is null
    or pg_catalog.octet_length(v_coach_email) not between 3 and 254
    or v_coach_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'coach_invitation_delivery_state_conflict' using errcode = '40001';
  end if;

  if new.action in ('create', 'regenerate') then
    insert into private.coach_invitation_created_notifications (
      invitation_id, coach_user_id, generation, title, body, created_at
    ) values (
      v_invitation.id,
      new.coach_user_id,
      new.generation,
      'Código de vinculación creado',
      'Tu código de vinculación fue creado y vence en 7 días.',
      v_now
    ) on conflict (invitation_id, generation) do nothing;
  end if;

  insert into private.coach_invitation_email_deliveries (
    coach_user_id, request_id, invitation_id, generation, operation_action,
    audience, recipient_email_snapshot, recipient_fingerprint, idempotency_key,
    status, created_at, updated_at
  ) values
    (
      new.coach_user_id, new.request_id, v_invitation.id, new.generation, new.action,
      'student', v_invitation.recipient_email,
      private.transactional_email_sha256(v_invitation.recipient_email),
      private.transactional_email_idempotency_uuid(
        'organizatech:coach-invitation:v1:student:' || new.coach_user_id::text || ':' || new.request_id::text
      ),
      'pending', v_now, v_now
    ),
    (
      new.coach_user_id, new.request_id, v_invitation.id, new.generation, new.action,
      'coach', v_coach_email,
      private.transactional_email_sha256(v_coach_email),
      private.transactional_email_idempotency_uuid(
        'organizatech:coach-invitation:v1:coach:' || new.coach_user_id::text || ':'
          || new.request_id::text || ':' || v_coach_email
      ),
      'pending', v_now, v_now
    )
  on conflict (coach_user_id, request_id, audience) do nothing;
  return new;
end;
$enqueue_coach_invitation_code_delivery$;

revoke all on function private.enqueue_coach_invitation_code_delivery()
  from public, anon, authenticated;

create trigger on_coach_invitation_operation_enqueue_delivery
  after insert on private.coach_invitation_operations
  for each row execute function private.enqueue_coach_invitation_code_delivery();

create function private.supersede_coach_invitation_code_delivery()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $supersede_coach_invitation_code_delivery$
begin
  update private.coach_invitation_email_deliveries as delivery
  set status = 'superseded',
      attempt_token = null,
      next_attempt_at = null,
      provider_error_code = null,
      updated_at = pg_catalog.clock_timestamp()
  where delivery.invitation_id = new.id
    and delivery.coach_user_id = new.coach_user_id
    and delivery.status in ('pending', 'failed', 'ambiguous')
    and (new.state <> 'pending' or delivery.generation <> new.generation);
  return new;
end;
$supersede_coach_invitation_code_delivery$;

revoke all on function private.supersede_coach_invitation_code_delivery()
  from public, anon, authenticated;

create trigger on_coach_invitation_supersede_delivery
  after update of invitation_code, generation, state on private.coach_invitations
  for each row execute function private.supersede_coach_invitation_code_delivery();

create or replace function public.list_own_coach_link_notifications(
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
  select notification.id, notification.reference_id, notification.title,
    notification.body, notification.read_at, notification.created_at
  from (
    select link.id, link.episode_id as reference_id, link.title, link.body,
      link.read_at, link.created_at
    from private.coach_link_notifications as link
    where link.recipient_user_id = v_user_id
      and link.portal_scope = p_portal_scope
      and link.copy_state = 'ready'
    union all
    select created.id, created.invitation_id as reference_id, created.title, created.body,
      created.read_at, created.created_at
    from private.coach_invitation_created_notifications as created
    where created.coach_user_id = v_user_id
      and p_portal_scope = 'coach'
  ) as notification
  order by notification.created_at desc, notification.id desc
  limit p_limit;
end;
$list_own_coach_link_notifications$;

create or replace function public.mark_own_coach_link_notifications_read(
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
  v_count integer := 0;
  v_created_count integer := 0;
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

  if p_portal_scope = 'coach' then
    update private.coach_invitation_created_notifications as notification
    set read_at = pg_catalog.coalesce(notification.read_at, pg_catalog.clock_timestamp())
    where notification.coach_user_id = v_user_id
      and notification.id = any(p_notification_ids);
    get diagnostics v_created_count = row_count;
  end if;
  return v_count + v_created_count;
end;
$mark_own_coach_link_notifications_read$;

create function public.claim_own_coach_invitation_emails(
  p_capability text,
  p_request_id uuid default null,
  p_recover boolean default false,
  p_invitation_id uuid default null
)
returns table (
  delivery_id uuid,
  invitation_id uuid,
  request_id uuid,
  coach_user_id uuid,
  audience text,
  operation_action text,
  idempotency_key uuid,
  recipient_email text,
  invited_email text,
  recipient_first_name text,
  coach_name text,
  invitation_code text,
  expires_at timestamptz,
  recipient_has_account boolean,
  attempt_token uuid
)
language plpgsql
security definer
set search_path = ''
as $claim_own_coach_invitation_emails$
declare
  v_coach_user_id uuid;
  v_coach_email text;
begin
  if p_recover is null
    or (
      (case when p_request_id is not null then 1 else 0 end)
      + (case when p_recover then 1 else 0 end)
      + (case when p_invitation_id is not null then 1 else 0 end)
    ) <> 1
    or not private.verify_transactional_email_capability(p_capability) then
    raise exception 'coach invitation email claim requires authentication' using errcode = '42501';
  end if;
  v_coach_user_id := private.lock_coach_invitation_owner();

  select pg_catalog.lower(pg_catalog.btrim(auth_user.email)) into v_coach_email
  from auth.users as auth_user
  where auth_user.id = v_coach_user_id
    and auth_user.email is not null;
  if v_coach_email is null
    or pg_catalog.octet_length(v_coach_email) not between 3 and 254
    or v_coach_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'coach invitation email claim requires authentication' using errcode = '42501';
  end if;

  -- A definitive provider rejection or an unsent row can safely follow a
  -- verified Coach email change. Ambiguous/sending rows never retarget.
  update private.coach_invitation_email_deliveries as delivery
  set recipient_email_snapshot = v_coach_email,
      recipient_fingerprint = private.transactional_email_sha256(v_coach_email),
      idempotency_key = private.transactional_email_idempotency_uuid(
        'organizatech:coach-invitation:v1:coach:' || v_coach_user_id::text || ':'
          || delivery.request_id::text || ':' || v_coach_email
      ),
      updated_at = pg_catalog.clock_timestamp()
  where delivery.coach_user_id = v_coach_user_id
    and delivery.audience = 'coach'
    and delivery.status in ('pending', 'failed')
    and delivery.recipient_email_snapshot <> v_coach_email;

  return query
  with target_request as (
    select operation.request_id
    from private.coach_invitation_operations as operation
    where operation.coach_user_id = v_coach_user_id
      and operation.action in ('create', 'resend', 'regenerate')
      and operation.state = 'reserved'
      and (p_request_id is null or operation.request_id = p_request_id)
      and (p_invitation_id is null or operation.invitation_id = p_invitation_id)
      and exists (
        select 1
        from private.coach_invitation_email_deliveries as due
        join private.coach_invitations as current_invitation
          on current_invitation.id = due.invitation_id
          and current_invitation.coach_user_id = due.coach_user_id
        where due.coach_user_id = operation.coach_user_id
          and due.request_id = operation.request_id
          and current_invitation.state = 'pending'
          and current_invitation.invitation_code is not null
          and current_invitation.expires_at > pg_catalog.clock_timestamp()
          and current_invitation.generation = due.generation
          and due.attempt_count < 5
          and (due.audience <> 'coach' or due.recipient_email_snapshot = v_coach_email)
          and (
            (due.status = 'pending' and due.attempt_count = 0)
            or (due.status in ('failed', 'ambiguous')
              and due.next_attempt_at <= pg_catalog.clock_timestamp())
            or (due.status = 'sending'
              and due.claimed_at <= pg_catalog.clock_timestamp() - interval '10 minutes')
          )
      )
    order by operation.reserved_at, operation.request_id
    limit 1
  ),
  candidates as (
    select delivery.id
    from private.coach_invitation_email_deliveries as delivery
    join target_request as target on target.request_id = delivery.request_id
    join private.coach_invitation_operations as operation
      on operation.coach_user_id = delivery.coach_user_id
      and operation.request_id = delivery.request_id
    join private.coach_invitations as invitation
      on invitation.id = delivery.invitation_id
      and invitation.coach_user_id = delivery.coach_user_id
    where delivery.coach_user_id = v_coach_user_id
      and operation.action in ('create', 'resend', 'regenerate')
      and operation.state = 'reserved'
      and invitation.state = 'pending'
      and invitation.invitation_code is not null
      and invitation.expires_at > pg_catalog.clock_timestamp()
      and invitation.generation = delivery.generation
      and delivery.attempt_count < 5
      and (delivery.audience <> 'coach' or delivery.recipient_email_snapshot = v_coach_email)
      and (
        (delivery.status = 'pending' and delivery.attempt_count = 0)
        or (delivery.status in ('failed', 'ambiguous')
          and delivery.next_attempt_at <= pg_catalog.clock_timestamp())
        or (delivery.status = 'sending'
          and delivery.claimed_at <= pg_catalog.clock_timestamp() - interval '10 minutes')
      )
    order by delivery.created_at, delivery.id
    for update of delivery skip locked
    limit 2
  ),
  claimed as (
    update private.coach_invitation_email_deliveries as delivery
    set status = 'sending',
        attempt_count = delivery.attempt_count + 1,
        attempt_token = gen_random_uuid(),
        claimed_at = pg_catalog.clock_timestamp(),
        next_attempt_at = null,
        provider_error_code = null,
        updated_at = pg_catalog.clock_timestamp()
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  ),
  prepared as (
    select claimed.*,
      invitation.recipient_email,
      invitation.invitation_code,
      invitation.expires_at,
      coach.first_name as coach_first_name,
      pg_catalog.btrim(pg_catalog.concat_ws(' ', coach.first_name, coach.last_name)) as coach_full_name,
      student_auth.id as student_auth_id,
      nullif(pg_catalog.btrim(profile.first_name), '') as student_first_name
    from claimed
    join private.coach_invitations as invitation
      on invitation.id = claimed.invitation_id
      and invitation.coach_user_id = claimed.coach_user_id
    join public.coach_registrations as coach
      on coach.user_id = claimed.coach_user_id
    left join auth.users as student_auth
      on pg_catalog.lower(pg_catalog.btrim(student_auth.email)) = invitation.recipient_email
    left join public.profiles as profile
      on profile.id = student_auth.id
  )
  select
    prepared.id,
    prepared.invitation_id,
    prepared.request_id,
    prepared.coach_user_id,
    prepared.audience,
    prepared.operation_action,
    prepared.idempotency_key,
    prepared.recipient_email_snapshot,
    prepared.recipient_email,
    case when prepared.audience = 'coach'
      then prepared.coach_first_name else prepared.student_first_name end,
    'Coach ' || prepared.coach_full_name,
    prepared.invitation_code,
    prepared.expires_at,
    case when prepared.audience = 'student'
      then prepared.student_auth_id is not null else true end,
    prepared.attempt_token
  from prepared;
end;
$claim_own_coach_invitation_emails$;

create function public.complete_own_coach_invitation_email(
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
as $complete_own_coach_invitation_email$
declare
  v_coach_user_id uuid;
begin
  if p_delivery_id is null or p_attempt_token is null
    or not private.verify_transactional_email_capability(p_capability) then
    raise exception 'coach invitation email completion requires authentication' using errcode = '42501';
  end if;
  v_coach_user_id := private.lock_coach_invitation_owner();
  if p_outcome not in ('sent', 'failed', 'ambiguous') then
    raise exception 'invalid coach invitation email completion payload' using errcode = '22023';
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

  update private.coach_invitation_email_deliveries as delivery
  set status = p_outcome,
      attempt_token = null,
      provider_message_id = case when p_outcome = 'sent' then p_provider_message_id else null end,
      provider_error_code = case when p_outcome <> 'sent' then p_provider_error_code else null end,
      sent_at = case when p_outcome = 'sent' then pg_catalog.clock_timestamp() else null end,
      next_attempt_at = case
        when p_outcome = 'sent' or delivery.attempt_count >= 5 then null
        when p_outcome = 'ambiguous' then pg_catalog.clock_timestamp() + interval '10 minutes'
        when delivery.attempt_count = 1 then pg_catalog.clock_timestamp() + interval '1 minute'
        when delivery.attempt_count = 2 then pg_catalog.clock_timestamp() + interval '5 minutes'
        when delivery.attempt_count = 3 then pg_catalog.clock_timestamp() + interval '30 minutes'
        else pg_catalog.clock_timestamp() + interval '2 hours'
      end,
      updated_at = pg_catalog.clock_timestamp()
  where delivery.id = p_delivery_id
    and delivery.coach_user_id = v_coach_user_id
    and delivery.status = 'sending'
    and delivery.attempt_token = p_attempt_token;
  return found;
end;
$complete_own_coach_invitation_email$;

create function public.own_coach_invitation_email_delivery_complete(
  p_capability text,
  p_invitation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $own_coach_invitation_email_delivery_complete$
declare
  v_coach_user_id uuid;
begin
  if p_invitation_id is null
    or not private.verify_transactional_email_capability(p_capability) then
    raise exception 'coach invitation email status requires authentication' using errcode = '42501';
  end if;
  v_coach_user_id := private.lock_coach_invitation_owner();

  return pg_catalog.coalesce((
    select pg_catalog.count(distinct delivery.audience) = 2
    from private.coach_invitations as invitation
    join private.coach_invitation_email_deliveries as delivery
      on delivery.invitation_id = invitation.id
      and delivery.coach_user_id = invitation.coach_user_id
      and delivery.generation = invitation.generation
    where invitation.id = p_invitation_id
      and invitation.coach_user_id = v_coach_user_id
      and invitation.state = 'pending'
      and invitation.invitation_code is not null
      and invitation.expires_at > pg_catalog.clock_timestamp()
      and delivery.status = 'sent'
      and delivery.audience in ('student', 'coach')
  ), false);
end;
$own_coach_invitation_email_delivery_complete$;

revoke all on function public.claim_own_coach_invitation_emails(text, uuid, boolean, uuid),
  public.complete_own_coach_invitation_email(text, uuid, uuid, text, text, text),
  public.own_coach_invitation_email_delivery_complete(text, uuid)
  from public, anon, authenticated;

grant execute on function public.claim_own_coach_invitation_emails(text, uuid, boolean, uuid),
  public.complete_own_coach_invitation_email(text, uuid, uuid, text, text, text),
  public.own_coach_invitation_email_delivery_complete(text, uuid)
  to authenticated;

commit;
