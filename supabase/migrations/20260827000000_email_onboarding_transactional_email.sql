-- EMAIL-ONBOARDING-01: private transactional-email outbox and narrow RPCs.
--
-- Prepared locally only. Apply to QA before PROD after independent audit.
-- No provider call is made from a database transaction: membership creation
-- only enqueues a durable welcome row, so a Brevo failure cannot roll back a
-- correctly-created account or membership.

begin;

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table private.transactional_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  -- No FK is possible here: the HTTP Send Email Hook is invoked inside the
  -- still-uncommitted GoTrue signup transaction, while this ledger RPC uses a
  -- separate transaction. A cleanup trigger below removes committed users'
  -- deliveries on deletion without blocking the signup hook on an invisible
  -- parent row.
  user_id uuid not null,
  delivery_kind text not null,
  template_version smallint not null default 1,
  event_key text not null,
  idempotency_key uuid not null,
  status text not null default 'pending',
  recipient_fingerprint text,
  attempt_count integer not null default 0,
  attempt_token uuid,
  last_attempt_at timestamptz,
  provider_message_id text,
  provider_error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint transactional_email_deliveries_kind_allowed check (
    delivery_kind in (
      'auth_confirmation_user',
      'auth_confirmation_coach',
      'auth_fallback',
      'welcome_user',
      'welcome_coach'
    )
  ),
  constraint transactional_email_deliveries_template_version_positive check (
    template_version > 0
  ),
  constraint transactional_email_deliveries_event_key_format check (
    event_key ~ '^[0-9a-f]{64}$'
  ),
  constraint transactional_email_deliveries_status_allowed check (
    status in ('pending', 'sent', 'failed')
  ),
  constraint transactional_email_deliveries_attempt_count_nonnegative check (
    attempt_count >= 0
  ),
  constraint transactional_email_deliveries_attempt_state check (
    (
      attempt_count = 0
      and recipient_fingerprint is null
      and last_attempt_at is null
      and attempt_token is null
    )
    or (
      attempt_count > 0
      and recipient_fingerprint is not null
      and last_attempt_at is not null
    )
  ),
  constraint transactional_email_deliveries_recipient_fingerprint_format check (
    recipient_fingerprint is null
    or recipient_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint transactional_email_deliveries_provider_message_id_format check (
    provider_message_id is null
    or (
      char_length(provider_message_id) between 1 and 512
      and provider_message_id !~ '[\r\n]'
    )
  ),
  constraint transactional_email_deliveries_provider_error_code_format check (
    provider_error_code is null
    or provider_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  constraint transactional_email_deliveries_terminal_state check (
    (
      status = 'pending'
      and provider_message_id is null
      and provider_error_code is null
      and sent_at is null
    )
    or (
      status = 'sent'
      and provider_message_id is not null
      and provider_error_code is null
      and sent_at is not null
      and attempt_token is null
    )
    or (
      status = 'failed'
      and provider_message_id is null
      and provider_error_code is not null
      and sent_at is null
      and attempt_token is null
    )
  ),
  constraint transactional_email_deliveries_event_unique unique (
    user_id,
    delivery_kind,
    event_key
  )
);

create index transactional_email_deliveries_own_claim_idx
  on private.transactional_email_deliveries (user_id, status, created_at)
  where status in ('pending', 'failed');

alter table private.transactional_email_deliveries enable row level security;
alter table private.transactional_email_deliveries force row level security;

revoke all privileges on table private.transactional_email_deliveries from public;
revoke all privileges on table private.transactional_email_deliveries from anon;
revoke all privileges on table private.transactional_email_deliveries from authenticated;

create function private.transactional_email_sha256(p_value text)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $transactional_email_sha256$
  select pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_value, 'UTF8'), 'sha256'),
    'hex'
  );
$transactional_email_sha256$;

revoke all on function private.transactional_email_sha256(text) from public;
revoke all on function private.transactional_email_sha256(text) from anon;
revoke all on function private.transactional_email_sha256(text) from authenticated;

create function private.transactional_email_idempotency_uuid(p_value text)
returns uuid
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $transactional_email_idempotency_uuid$
declare
  v_hash text := private.transactional_email_sha256(p_value);
begin
  -- RFC 4122 layout with deterministic SHA-256 material, version 8 marker and
  -- RFC variant bits. Brevo requires a UUID and receives this same value on
  -- every retry of the same logical delivery.
  return (
    pg_catalog.substr(v_hash, 1, 8) || '-' ||
    pg_catalog.substr(v_hash, 9, 4) || '-' ||
    '8' || pg_catalog.substr(v_hash, 14, 3) || '-' ||
    '8' || pg_catalog.substr(v_hash, 18, 3) || '-' ||
    pg_catalog.substr(v_hash, 21, 12)
  )::uuid;
end;
$transactional_email_idempotency_uuid$;

revoke all on function private.transactional_email_idempotency_uuid(text) from public;
revoke all on function private.transactional_email_idempotency_uuid(text) from anon;
revoke all on function private.transactional_email_idempotency_uuid(text) from authenticated;

-- The HTTP Send Email Hook receives the reloaded auth.users model from GoTrue,
-- including changes made by BEFORE INSERT triggers. Preserve only a validated,
-- presentation-only portal hint for the two confirmation variants. The private
-- pending row remains the sole membership authority.
create or replace function private.capture_auth_registration_pending_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $capture_auth_registration_pending_membership$
declare
  v_metadata jsonb;
  v_portal text;
  v_first_name text;
  v_last_name text;
  v_birth_date_text text;
  v_birth_date date;
  v_gender text;
  v_phone_number text;
  v_professional_title text;
  v_contact_email text;
  v_age_years integer;
  v_is_registration boolean;
begin
  v_metadata := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_is_registration := (
    v_metadata ? 'organizatech_registration_portal'
    or v_metadata ? 'organizatech_registration_intent_id'
  );

  -- A client can never mint the reserved presentation object directly.
  new.raw_user_meta_data := v_metadata - 'organizatech_email_presentation';
  if not v_is_registration then
    return new;
  end if;

  -- Registration metadata transports a one-time allowlisted payload only.
  -- Contact data and every authorization signal are removed before auth.users
  -- is persisted.
  if v_metadata ? 'display_name' then
    new.raw_user_meta_data := jsonb_build_object(
      'display_name',
      v_metadata -> 'display_name'
    );
  else
    new.raw_user_meta_data := '{}'::jsonb;
  end if;

  v_portal := nullif(btrim(v_metadata ->> 'organizatech_registration_portal'), '');
  v_first_name := regexp_replace(
    btrim(coalesce(v_metadata ->> 'first_name', '')),
    '[[:space:]]+',
    ' ',
    'g'
  );
  v_last_name := regexp_replace(
    btrim(coalesce(v_metadata ->> 'last_name', '')),
    '[[:space:]]+',
    ' ',
    'g'
  );
  v_birth_date_text := nullif(btrim(v_metadata ->> 'birth_date'), '');
  v_gender := nullif(btrim(v_metadata ->> 'gender'), '');
  v_phone_number := regexp_replace(
    btrim(coalesce(v_metadata ->> 'phone_number', '')),
    '[[:space:]]+',
    ' ',
    'g'
  );
  v_professional_title := nullif(
    regexp_replace(
      btrim(coalesce(v_metadata ->> 'professional_title', '')),
      '[[:space:]]+',
      ' ',
      'g'
    ),
    ''
  );
  v_contact_email := nullif(
    lower(btrim(coalesce(v_metadata ->> 'contact_email', ''))),
    ''
  );

  if v_portal = 'coach'
    and not (v_metadata ? 'contact_email') then
    v_contact_email := nullif(lower(btrim(new.email)), '');
  end if;

  begin
    if v_birth_date_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      v_birth_date := v_birth_date_text::date;
    end if;
  exception
    when datetime_field_overflow or invalid_datetime_format then
      v_birth_date := null;
  end;

  if v_birth_date is not null then
    v_age_years := date_part('year', age(current_date, v_birth_date));
  end if;

  if v_portal is null
    or v_portal not in ('usuario', 'coach')
    or char_length(v_first_name) not between 1 and 80
    or char_length(v_last_name) not between 1 and 120
    or v_birth_date is null
    or v_birth_date > current_date
    or v_age_years not between 10 and 100
    or v_gender is null
    or v_gender not in ('male', 'female', 'non_binary', 'prefer_not_to_say')
    or char_length(v_phone_number) not between 1 and 30
    or v_phone_number !~ '^[0-9+() -]+$'
    or (
      v_portal = 'usuario'
      and (
        v_metadata ? 'professional_title'
        or v_metadata ? 'contact_email'
      )
    )
    or (
      v_portal = 'coach'
      and (
        coalesce(char_length(v_professional_title), 0) not between 1 and 160
        or coalesce(char_length(v_contact_email), 0) not between 6 and 254
        or v_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    ) then
    return new;
  end if;

  new.raw_user_meta_data := jsonb_build_object(
    'display_name', pg_catalog.concat_ws(' ', v_first_name, v_last_name),
    'organizatech_email_presentation', jsonb_build_object('portal', v_portal)
  );

  insert into private.auth_registration_pending_memberships (
    user_id,
    portal,
    first_name,
    last_name,
    birth_date,
    gender,
    phone_number,
    professional_title,
    contact_email
  )
  values (
    new.id,
    v_portal,
    v_first_name,
    v_last_name,
    v_birth_date,
    v_gender,
    v_phone_number,
    case when v_portal = 'coach' then v_professional_title else null end,
    case when v_portal = 'coach' then v_contact_email else null end
  );

  return new;
end;
$capture_auth_registration_pending_membership$;

revoke all on function private.capture_auth_registration_pending_membership() from public;
revoke all on function private.capture_auth_registration_pending_membership() from anon;
revoke all on function private.capture_auth_registration_pending_membership() from authenticated;

create or replace function private.scrub_auth_registration_retry_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $scrub_auth_registration_retry_metadata$
declare
  v_metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_previous jsonb := coalesce(old.raw_user_meta_data, '{}'::jsonb);
  v_is_registration boolean := (
    v_metadata ? 'organizatech_registration_portal'
    or v_metadata ? 'organizatech_registration_intent_id'
  );
begin
  if not v_is_registration then
    return new;
  end if;

  new.raw_user_meta_data := '{}'::jsonb;

  if v_previous ? 'display_name' then
    new.raw_user_meta_data := new.raw_user_meta_data || jsonb_build_object(
      'display_name',
      v_previous -> 'display_name'
    );
  end if;

  -- A retry may refresh display metadata, but it can neither replace nor
  -- remove the first validated confirmation presentation.
  if v_previous ? 'organizatech_email_presentation' then
    new.raw_user_meta_data := new.raw_user_meta_data || jsonb_build_object(
      'organizatech_email_presentation',
      v_previous -> 'organizatech_email_presentation'
    );
  end if;

  return new;
end;
$scrub_auth_registration_retry_metadata$;

revoke all on function private.scrub_auth_registration_retry_metadata() from public;
revoke all on function private.scrub_auth_registration_retry_metadata() from anon;
revoke all on function private.scrub_auth_registration_retry_metadata() from authenticated;

create function private.protect_auth_email_presentation_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $protect_auth_email_presentation_metadata$
declare
  v_previous jsonb := coalesce(old.raw_user_meta_data, '{}'::jsonb);
begin
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb)
    - 'organizatech_email_presentation';

  if v_previous ? 'organizatech_email_presentation' then
    new.raw_user_meta_data := new.raw_user_meta_data || jsonb_build_object(
      'organizatech_email_presentation',
      v_previous -> 'organizatech_email_presentation'
    );
  end if;

  return new;
end;
$protect_auth_email_presentation_metadata$;

revoke all on function private.protect_auth_email_presentation_metadata() from public;
revoke all on function private.protect_auth_email_presentation_metadata() from anon;
revoke all on function private.protect_auth_email_presentation_metadata() from authenticated;

create trigger on_auth_user_01_protect_email_presentation_metadata
  before update of raw_user_meta_data on auth.users
  for each row
  execute function private.protect_auth_email_presentation_metadata();

create function private.enqueue_membership_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $enqueue_membership_welcome_email$
declare
  v_delivery_kind text;
  v_material text;
begin
  -- SECURITY DEFINER is essential here because the membership tables have
  -- intentionally narrow grants and the outbox has no client policies. This
  -- trigger is not executable through the Data API and accepts no ownership
  -- input: NEW.user_id comes from the membership row that was actually written.
  if tg_table_schema <> 'public' or new.user_id is null then
    raise exception 'invalid welcome outbox trigger context' using errcode = '42501';
  end if;

  if tg_table_name = 'user_registrations' then
    v_delivery_kind := 'welcome_user';
    if not exists (
      select 1
      from public.user_registrations as registration
      where registration.user_id = new.user_id
    ) then
      raise exception 'user membership could not be confirmed' using errcode = '42501';
    end if;
  elsif tg_table_name = 'coach_registrations' then
    v_delivery_kind := 'welcome_coach';
    if not exists (
      select 1
      from public.coach_registrations as registration
      where registration.user_id = new.user_id
    ) then
      raise exception 'coach membership could not be confirmed' using errcode = '42501';
    end if;
  else
    raise exception 'invalid welcome outbox membership source' using errcode = '42501';
  end if;

  v_material := 'organizatech:email-onboarding:v1:' || v_delivery_kind || ':' || new.user_id::text;

  insert into private.transactional_email_deliveries (
    user_id,
    delivery_kind,
    template_version,
    event_key,
    idempotency_key
  )
  values (
    new.user_id,
    v_delivery_kind,
    1,
    private.transactional_email_sha256(v_material),
    private.transactional_email_idempotency_uuid(v_material)
  )
  on conflict (user_id, delivery_kind, event_key) do nothing;

  return new;
end;
$enqueue_membership_welcome_email$;

revoke all on function private.enqueue_membership_welcome_email() from public;
revoke all on function private.enqueue_membership_welcome_email() from anon;
revoke all on function private.enqueue_membership_welcome_email() from authenticated;

create trigger on_user_registration_enqueue_welcome_email
  after insert on public.user_registrations
  for each row
  execute function private.enqueue_membership_welcome_email();

create trigger on_coach_registration_enqueue_welcome_email
  after insert on public.coach_registrations
  for each row
  execute function private.enqueue_membership_welcome_email();

create function private.delete_transactional_email_deliveries_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $delete_transactional_email_deliveries_for_auth_user$
begin
  delete from private.transactional_email_deliveries as delivery
  where delivery.user_id = old.id;
  return old;
end;
$delete_transactional_email_deliveries_for_auth_user$;

revoke all on function private.delete_transactional_email_deliveries_for_auth_user() from public;
revoke all on function private.delete_transactional_email_deliveries_for_auth_user() from anon;
revoke all on function private.delete_transactional_email_deliveries_for_auth_user() from authenticated;

create trigger on_auth_user_delete_transactional_email_deliveries
  after delete on auth.users
  for each row
  execute function private.delete_transactional_email_deliveries_for_auth_user();

create function private.transactional_email_constant_time_equal(
  p_left bytea,
  p_right bytea
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $transactional_email_constant_time_equal$
declare
  v_difference integer := 0;
  v_index integer;
begin
  if pg_catalog.octet_length(p_left) <> 32
    or pg_catalog.octet_length(p_right) <> 32 then
    return false;
  end if;

  for v_index in 0..31 loop
    v_difference := v_difference
      | (pg_catalog.get_byte(p_left, v_index) # pg_catalog.get_byte(p_right, v_index));
  end loop;
  return v_difference = 0;
end;
$transactional_email_constant_time_equal$;

revoke all on function private.transactional_email_constant_time_equal(bytea, bytea) from public;
revoke all on function private.transactional_email_constant_time_equal(bytea, bytea) from anon;
revoke all on function private.transactional_email_constant_time_equal(bytea, bytea) from authenticated;

create function private.verify_transactional_email_capability(p_capability text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $verify_transactional_email_capability$
declare
  v_expected_capability text;
begin
  select secret.decrypted_secret
    into v_expected_capability
    from vault.decrypted_secrets as secret
    where secret.name = 'organizatech_email_ledger_rpc_secret'
    order by secret.created_at desc
    limit 1;

  if p_capability is null
    or v_expected_capability is null
    or pg_catalog.char_length(p_capability) not between 32 and 512
    or pg_catalog.char_length(v_expected_capability) not between 32 and 512
    or p_capability ~ '[[:cntrl:][:space:]]'
    or v_expected_capability ~ '[[:cntrl:][:space:]]' then
    return false;
  end if;

  return private.transactional_email_constant_time_equal(
    extensions.digest(pg_catalog.convert_to(p_capability, 'UTF8'), 'sha256'),
    extensions.digest(pg_catalog.convert_to(v_expected_capability, 'UTF8'), 'sha256')
  );
exception
  when others then
    return false;
end;
$verify_transactional_email_capability$;

revoke all on function private.verify_transactional_email_capability(text) from public;
revoke all on function private.verify_transactional_email_capability(text) from anon;
revoke all on function private.verify_transactional_email_capability(text) from authenticated;

create function public.claim_own_transactional_welcome_emails(p_capability text)
returns table (
  delivery_id uuid,
  user_id uuid,
  template_key text,
  idempotency_key uuid,
  recipient_email text,
  first_name text,
  last_name text,
  attempt_token uuid
)
language plpgsql
security definer
set search_path = ''
as $claim_own_transactional_welcome_emails$
declare
  v_authenticated_user_id uuid := auth.uid();
  v_recipient_email text;
begin
  if v_authenticated_user_id is null
    or not private.verify_transactional_email_capability(p_capability) then
    raise exception 'welcome email claim requires authentication' using errcode = '42501';
  end if;

  select pg_catalog.lower(pg_catalog.btrim(auth_user.email))
    into v_recipient_email
    from auth.users as auth_user
    where auth_user.id = v_authenticated_user_id
      and auth_user.email_confirmed_at is not null;

  if v_recipient_email is null
    or pg_catalog.char_length(v_recipient_email) not between 6 and 254
    or v_recipient_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'authenticated email could not be confirmed' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select delivery.id
    from private.transactional_email_deliveries as delivery
    where delivery.user_id = v_authenticated_user_id
      and delivery.delivery_kind in ('welcome_user', 'welcome_coach')
      and (
        (
          delivery.delivery_kind = 'welcome_user'
          and exists (
            select 1
            from public.user_registrations as registration
            where registration.user_id = v_authenticated_user_id
          )
        )
        or (
          delivery.delivery_kind = 'welcome_coach'
          and exists (
            select 1
            from public.coach_registrations as registration
            where registration.user_id = v_authenticated_user_id
          )
        )
      )
      -- A pending delivery with an attempted send is ambiguous. It must be
      -- reconciled manually or by a future controlled worker, never reclaimed here.
      and (
        delivery.status = 'failed'
        or (
          delivery.status = 'pending'
          and delivery.attempt_count = 0
        )
      )
    order by delivery.created_at, delivery.id
    for update skip locked
  ),
  claimed as (
    update private.transactional_email_deliveries as delivery
    set
      status = 'pending',
      recipient_fingerprint = private.transactional_email_sha256(
        'recipient:' || v_authenticated_user_id::text || ':' || v_recipient_email
      ),
      attempt_count = delivery.attempt_count + 1,
      attempt_token = gen_random_uuid(),
      last_attempt_at = pg_catalog.clock_timestamp(),
      provider_error_code = null,
      updated_at = pg_catalog.clock_timestamp()
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select
    claimed.id,
    claimed.user_id,
    claimed.delivery_kind,
    claimed.idempotency_key,
    v_recipient_email,
    case
      when claimed.delivery_kind = 'welcome_coach' then pg_catalog.coalesce(coach.first_name, '')
      else pg_catalog.coalesce(profile.first_name, '')
    end,
    case
      when claimed.delivery_kind = 'welcome_coach' then pg_catalog.coalesce(coach.last_name, '')
      else pg_catalog.coalesce(profile.last_name, '')
    end,
    claimed.attempt_token
  from claimed
  left join public.profiles as profile
    on profile.id = claimed.user_id
  left join public.coach_registrations as coach
    on coach.user_id = claimed.user_id;
end;
$claim_own_transactional_welcome_emails$;

revoke all on function public.claim_own_transactional_welcome_emails(text) from public;
revoke all on function public.claim_own_transactional_welcome_emails(text) from anon;
revoke all on function public.claim_own_transactional_welcome_emails(text) from authenticated;
grant execute on function public.claim_own_transactional_welcome_emails(text) to authenticated;

create function public.complete_own_transactional_welcome_email(
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
as $complete_own_transactional_welcome_email$
declare
  v_authenticated_user_id uuid := auth.uid();
begin
  if v_authenticated_user_id is null
    or not private.verify_transactional_email_capability(p_capability) then
    raise exception 'welcome email completion requires authentication' using errcode = '42501';
  end if;

  if p_delivery_id is null or p_attempt_token is null or p_outcome not in ('sent', 'failed') then
    raise exception 'invalid welcome email completion payload' using errcode = '22023';
  end if;

  if p_outcome = 'sent' and (
    p_provider_message_id is null
    or pg_catalog.char_length(p_provider_message_id) not between 1 and 512
    or p_provider_message_id ~ '[\r\n]'
    or p_provider_error_code is not null
  ) then
    raise exception 'invalid provider success payload' using errcode = '22023';
  end if;

  if p_outcome = 'failed' and (
    p_provider_message_id is not null
    or p_provider_error_code is null
    or p_provider_error_code !~ '^[a-z0-9_]{1,64}$'
  ) then
    raise exception 'invalid provider failure payload' using errcode = '22023';
  end if;

  update private.transactional_email_deliveries as delivery
  set
    status = p_outcome,
    attempt_token = null,
    provider_message_id = case when p_outcome = 'sent' then p_provider_message_id else null end,
    provider_error_code = case when p_outcome = 'failed' then p_provider_error_code else null end,
    sent_at = case when p_outcome = 'sent' then pg_catalog.clock_timestamp() else null end,
    updated_at = pg_catalog.clock_timestamp()
  where delivery.id = p_delivery_id
    and delivery.user_id = v_authenticated_user_id
    and delivery.delivery_kind in ('welcome_user', 'welcome_coach')
    and delivery.status = 'pending'
    and delivery.attempt_token = p_attempt_token;

  return found;
end;
$complete_own_transactional_welcome_email$;

revoke all on function public.complete_own_transactional_welcome_email(text, uuid, uuid, text, text, text) from public;
revoke all on function public.complete_own_transactional_welcome_email(text, uuid, uuid, text, text, text) from anon;
revoke all on function public.complete_own_transactional_welcome_email(text, uuid, uuid, text, text, text) from authenticated;
grant execute on function public.complete_own_transactional_welcome_email(text, uuid, uuid, text, text, text) to authenticated;

create function public.claim_auth_transactional_email(
  p_payload text,
  p_recipient_slot text,
  p_event_id text,
  p_capability text
)
returns table (
  delivery_id uuid,
  user_id uuid,
  template_key text,
  idempotency_key uuid,
  recipient_email text,
  first_name text,
  last_name text,
  attempt_token uuid
)
language plpgsql
security definer
set search_path = ''
as $claim_auth_transactional_email$
declare
  v_event jsonb;
  v_user_id uuid;
  v_signed_email text;
  v_signed_new_email text;
  v_action_type text;
  v_token_hash text;
  v_recipient_email text;
  v_delivery_kind text := 'auth_fallback';
  v_first_name text := '';
  v_last_name text := '';
  v_portal text;
  v_material text;
  v_event_key text;
  v_idempotency_key uuid;
begin
  -- This is the only anonymous SECURITY DEFINER boundary. It is essential for
  -- the signed Auth webhook, which has no user JWT. The Edge Function verifies
  -- the Standard Webhooks signature over the raw body first. This RPC then
  -- requires a separate Edge/Vault capability, so direct anon calls cannot
  -- write or forge the private ledger. The signed user snapshot is used instead
  -- of requerying auth.users because signup is still uncommitted and invisible
  -- to this independent PostgREST transaction.
  if not private.verify_transactional_email_capability(p_capability)
    or p_payload is null
    or pg_catalog.octet_length(p_payload) not between 2 and 65536
    or p_event_id is null
    or pg_catalog.char_length(p_event_id) not between 1 and 200
    or p_event_id ~ '[[:cntrl:][:space:]]' then
    raise exception 'invalid send email hook proof' using errcode = '42501';
  end if;

  begin
    v_event := p_payload::jsonb;
    v_user_id := (v_event #>> '{user,id}')::uuid;
  exception
    when others then
      raise exception 'invalid send email hook payload' using errcode = '22023';
  end;

  v_action_type := pg_catalog.btrim(pg_catalog.coalesce(
    v_event #>> '{email_data,email_action_type}',
    ''
  ));
  if v_action_type not in (
    'signup',
    'recovery',
    'invite',
    'magiclink',
    'email_change',
    'email',
    'reauthentication',
    'password_changed_notification',
    'email_changed_notification',
    'phone_changed_notification',
    'identity_linked_notification',
    'identity_unlinked_notification',
    'mfa_factor_enrolled_notification',
    'mfa_factor_unenrolled_notification'
  ) then
    raise exception 'unsupported auth email action' using errcode = '22023';
  end if;

  v_signed_email := pg_catalog.lower(pg_catalog.btrim(pg_catalog.coalesce(
    v_event #>> '{user,email}',
    ''
  )));
  v_signed_new_email := pg_catalog.lower(pg_catalog.btrim(pg_catalog.coalesce(
    v_event #>> '{user,new_email}',
    ''
  )));

  if v_action_type = 'email_change' then
    if p_recipient_slot = 'current'
      and pg_catalog.coalesce(v_event #>> '{email_data,token_hash_new}', '') <> '' then
      v_recipient_email := v_signed_email;
      v_token_hash := v_event #>> '{email_data,token_hash_new}';
    elsif p_recipient_slot = 'new'
      and v_signed_new_email <> ''
      and pg_catalog.coalesce(v_event #>> '{email_data,token_hash}', '') <> '' then
      v_recipient_email := v_signed_new_email;
      v_token_hash := v_event #>> '{email_data,token_hash}';
    else
      raise exception 'invalid email change recipient slot' using errcode = '22023';
    end if;
  elsif v_action_type in (
    'password_changed_notification',
    'email_changed_notification',
    'phone_changed_notification',
    'identity_linked_notification',
    'identity_unlinked_notification',
    'mfa_factor_enrolled_notification',
    'mfa_factor_unenrolled_notification'
  ) then
    if p_recipient_slot <> 'primary' then
      raise exception 'invalid notification recipient slot' using errcode = '22023';
    end if;
    v_recipient_email := case
      when v_action_type = 'email_changed_notification' then
        pg_catalog.lower(pg_catalog.btrim(pg_catalog.coalesce(
          v_event #>> '{email_data,old_email}',
          ''
        )))
      else v_signed_email
    end;
    v_token_hash := '';
  else
    if p_recipient_slot <> 'primary' then
      raise exception 'invalid auth email recipient slot' using errcode = '22023';
    end if;
    v_recipient_email := v_signed_email;
    v_token_hash := v_event #>> '{email_data,token_hash}';
  end if;

  if v_recipient_email is null
    or pg_catalog.char_length(v_recipient_email) not between 6 and 254
    or v_recipient_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or v_token_hash is null
    or pg_catalog.char_length(v_token_hash) > 2048
    or (
      v_action_type not in (
        'password_changed_notification',
        'email_changed_notification',
        'phone_changed_notification',
        'identity_linked_notification',
        'identity_unlinked_notification',
        'mfa_factor_enrolled_notification',
        'mfa_factor_unenrolled_notification'
      )
      and pg_catalog.char_length(v_token_hash) < 1
    ) then
    raise exception 'invalid auth email delivery data' using errcode = '22023';
  end if;

  v_portal := pg_catalog.btrim(pg_catalog.coalesce(
    v_event #>> '{user,user_metadata,organizatech_email_presentation,portal}',
    ''
  ));
  v_first_name := pg_catalog.btrim(pg_catalog.coalesce(
    v_event #>> '{user,user_metadata,display_name}',
    ''
  ));
  v_last_name := '';

  if pg_catalog.char_length(v_first_name) not between 1 and 201 then
    v_portal := '';
    v_first_name := '';
  end if;

  if v_action_type = 'signup' and v_portal = 'usuario' then
    v_delivery_kind := 'auth_confirmation_user';
  elsif v_action_type = 'signup' and v_portal = 'coach' then
    v_delivery_kind := 'auth_confirmation_coach';
  else
    if pg_catalog.char_length(v_first_name) > 201 then
      v_first_name := '';
    end if;
  end if;

  v_material := 'organizatech:email-onboarding:v1:' || v_user_id::text || ':' ||
    v_action_type || ':' || p_recipient_slot || ':' ||
    case when v_token_hash = '' then p_event_id else v_token_hash end;
  v_event_key := private.transactional_email_sha256(v_material);
  v_idempotency_key := private.transactional_email_idempotency_uuid(v_material);

  return query
  with claimed as (
    insert into private.transactional_email_deliveries (
      user_id,
      delivery_kind,
      template_version,
      event_key,
      idempotency_key,
      status,
      recipient_fingerprint,
      attempt_count,
      attempt_token,
      last_attempt_at
    )
    values (
      v_user_id,
      v_delivery_kind,
      1,
      v_event_key,
      v_idempotency_key,
      'pending',
      private.transactional_email_sha256(
        'recipient:' || v_user_id::text || ':' || v_recipient_email
      ),
      1,
      gen_random_uuid(),
      pg_catalog.clock_timestamp()
    )
    on conflict (user_id, delivery_kind, event_key) do update
    set
      status = 'pending',
      recipient_fingerprint = excluded.recipient_fingerprint,
      attempt_count = private.transactional_email_deliveries.attempt_count + 1,
      attempt_token = gen_random_uuid(),
      last_attempt_at = pg_catalog.clock_timestamp(),
      provider_error_code = null,
      updated_at = pg_catalog.clock_timestamp()
    -- A pending attempted send has an ambiguous provider result. Leave it for
    -- manual reconciliation or a future controlled worker instead of reclaiming it.
    where private.transactional_email_deliveries.status = 'failed'
    returning private.transactional_email_deliveries.*
  )
  select
    claimed.id,
    claimed.user_id,
    claimed.delivery_kind,
    claimed.idempotency_key,
    v_recipient_email,
    v_first_name,
    v_last_name,
    claimed.attempt_token
  from claimed;
end;
$claim_auth_transactional_email$;

revoke all on function public.claim_auth_transactional_email(text, text, text, text) from public;
revoke all on function public.claim_auth_transactional_email(text, text, text, text) from anon;
revoke all on function public.claim_auth_transactional_email(text, text, text, text) from authenticated;
grant execute on function public.claim_auth_transactional_email(text, text, text, text) to anon;

create function public.complete_auth_transactional_email(
  p_payload text,
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
as $complete_auth_transactional_email$
declare
  v_event jsonb;
  v_user_id uuid;
begin
  if not private.verify_transactional_email_capability(p_capability)
    or p_payload is null
    or pg_catalog.octet_length(p_payload) not between 2 and 65536 then
    raise exception 'invalid send email hook proof' using errcode = '42501';
  end if;

  begin
    v_event := p_payload::jsonb;
    v_user_id := (v_event #>> '{user,id}')::uuid;
  exception
    when others then
      raise exception 'invalid send email hook payload' using errcode = '22023';
  end;

  if p_delivery_id is null or p_attempt_token is null or p_outcome not in ('sent', 'failed') then
    raise exception 'invalid auth email completion payload' using errcode = '22023';
  end if;

  if p_outcome = 'sent' and (
    p_provider_message_id is null
    or pg_catalog.char_length(p_provider_message_id) not between 1 and 512
    or p_provider_message_id ~ '[\r\n]'
    or p_provider_error_code is not null
  ) then
    raise exception 'invalid provider success payload' using errcode = '22023';
  end if;

  if p_outcome = 'failed' and (
    p_provider_message_id is not null
    or p_provider_error_code is null
    or p_provider_error_code !~ '^[a-z0-9_]{1,64}$'
  ) then
    raise exception 'invalid provider failure payload' using errcode = '22023';
  end if;

  update private.transactional_email_deliveries as delivery
  set
    status = p_outcome,
    attempt_token = null,
    provider_message_id = case when p_outcome = 'sent' then p_provider_message_id else null end,
    provider_error_code = case when p_outcome = 'failed' then p_provider_error_code else null end,
    sent_at = case when p_outcome = 'sent' then pg_catalog.clock_timestamp() else null end,
    updated_at = pg_catalog.clock_timestamp()
  where delivery.id = p_delivery_id
    and delivery.user_id = v_user_id
    and delivery.delivery_kind in (
      'auth_confirmation_user',
      'auth_confirmation_coach',
      'auth_fallback'
    )
    and delivery.status = 'pending'
    and delivery.attempt_token = p_attempt_token;

  return found;
end;
$complete_auth_transactional_email$;

revoke all on function public.complete_auth_transactional_email(text, text, uuid, uuid, text, text, text) from public;
revoke all on function public.complete_auth_transactional_email(text, text, uuid, uuid, text, text, text) from anon;
revoke all on function public.complete_auth_transactional_email(text, text, uuid, uuid, text, text, text) from authenticated;
grant execute on function public.complete_auth_transactional_email(text, text, uuid, uuid, text, text, text) to anon;

commit;
