-- AUTH-CONFIRM-01: confirmation-gated Usuario/Coach memberships.
--
-- The first real auth.users INSERT is authoritative. The browser sends one
-- allowlisted registration payload through Supabase Auth signUp metadata. A
-- BEFORE INSERT trigger derives ownership exclusively from NEW.id, persists the
-- pending membership in a private table, and removes every registration field
-- from raw_user_meta_data before auth.users is written.
--
-- If a duplicate signUp for an unconfirmed email updates raw_user_meta_data, a
-- separate BEFORE UPDATE trigger scrubs that retry payload without touching the
-- pending row. The first auth.users INSERT remains authoritative.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table private.auth_registration_pending_memberships (
  user_id uuid primary key,
  portal text not null,
  first_name text,
  last_name text,
  birth_date date,
  gender text,
  phone_number text,
  professional_title text,
  created_at timestamptz not null default statement_timestamp(),
  consumed_at timestamptz,
  constraint auth_registration_pending_memberships_user_fkey
    foreign key (user_id)
    references auth.users(id)
    on delete cascade
    deferrable initially deferred,
  constraint auth_registration_pending_memberships_portal_allowed check (
    portal in ('usuario', 'coach')
  ),
  constraint auth_registration_pending_memberships_payload_state check (
    (
      consumed_at is null
      and first_name is not null
      and last_name is not null
      and birth_date is not null
      and gender is not null
      and phone_number is not null
    )
    or (
      consumed_at is not null
      and consumed_at >= created_at
      and first_name is null
      and last_name is null
      and birth_date is null
      and gender is null
      and phone_number is null
      and professional_title is null
    )
  ),
  constraint auth_registration_pending_memberships_first_name_length check (
    first_name is null
    or char_length(btrim(first_name)) between 1 and 80
  ),
  constraint auth_registration_pending_memberships_last_name_length check (
    last_name is null
    or char_length(btrim(last_name)) between 1 and 120
  ),
  constraint auth_registration_pending_memberships_gender_allowed check (
    gender is null
    or gender in ('male', 'female', 'non_binary', 'prefer_not_to_say')
  ),
  constraint auth_registration_pending_memberships_phone_number_allowed check (
    phone_number is null
    or (
      char_length(btrim(phone_number)) between 1 and 30
      and phone_number ~ '^[0-9+() -]+$'
    )
  ),
  constraint auth_registration_pending_memberships_professional_title_scope check (
    consumed_at is not null
    or (
      portal = 'usuario'
      and professional_title is null
    )
    or (
      portal = 'coach'
      and professional_title is not null
      and char_length(btrim(professional_title)) between 1 and 160
    )
  )
);

-- user_id is both the primary key and the only lookup/FK key. Its primary-key
-- index covers capture uniqueness, confirmation reads, and ON DELETE CASCADE.
alter table private.auth_registration_pending_memberships enable row level security;
alter table private.auth_registration_pending_memberships force row level security;

revoke all privileges on table private.auth_registration_pending_memberships from public;
revoke all privileges on table private.auth_registration_pending_memberships from anon;
revoke all privileges on table private.auth_registration_pending_memberships from authenticated;

create function private.capture_auth_registration_pending_membership()
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
  v_age_years integer;
  v_is_registration boolean;
begin
  v_metadata := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_is_registration := (
    v_metadata ? 'organizatech_registration_portal'
    or v_metadata ? 'organizatech_registration_intent_id'
  );

  if not v_is_registration then
    return new;
  end if;

  -- Scrub before parsing or validation can return. Registration metadata may
  -- transport the initial payload, but it never survives in auth.users.
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

  -- Invalid or incomplete metadata fails closed: the Auth identity may be
  -- created, but no pending membership is persisted and no registration PII
  -- remains in raw_user_meta_data.
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
      and v_metadata ? 'professional_title'
    )
    or (
      v_portal = 'coach'
      and coalesce(char_length(v_professional_title), 0) not between 1 and 160
    ) then
    return new;
  end if;

  insert into private.auth_registration_pending_memberships (
    user_id,
    portal,
    first_name,
    last_name,
    birth_date,
    gender,
    phone_number,
    professional_title
  )
  values (
    new.id,
    v_portal,
    v_first_name,
    v_last_name,
    v_birth_date,
    v_gender,
    v_phone_number,
    case when v_portal = 'coach' then v_professional_title else null end
  );

  return new;
end;
$capture_auth_registration_pending_membership$;

revoke all on function private.capture_auth_registration_pending_membership() from public;
revoke all on function private.capture_auth_registration_pending_membership() from anon;
revoke all on function private.capture_auth_registration_pending_membership() from authenticated;

create function private.scrub_auth_registration_retry_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $scrub_auth_registration_retry_metadata$
declare
  v_metadata jsonb;
  v_is_registration boolean;
begin
  v_metadata := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_is_registration := (
    v_metadata ? 'organizatech_registration_portal'
    or v_metadata ? 'organizatech_registration_intent_id'
  );

  if not v_is_registration then
    return new;
  end if;

  -- A retry may refresh Auth metadata, but it cannot replace or update the
  -- private pending membership captured by the first auth.users INSERT.
  if v_metadata ? 'display_name' then
    new.raw_user_meta_data := jsonb_build_object(
      'display_name',
      v_metadata -> 'display_name'
    );
  else
    new.raw_user_meta_data := '{}'::jsonb;
  end if;

  return new;
end;
$scrub_auth_registration_retry_metadata$;

revoke all on function private.scrub_auth_registration_retry_metadata() from public;
revoke all on function private.scrub_auth_registration_retry_metadata() from anon;
revoke all on function private.scrub_auth_registration_retry_metadata() from authenticated;

create function private.finalize_auth_registration_pending_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $finalize_auth_registration_pending_membership$
declare
  v_pending private.auth_registration_pending_memberships%rowtype;
  v_profile_id uuid;
  v_inserted_user_id uuid;
begin
  if new.email_confirmed_at is null then
    return new;
  end if;

  -- This exception block is a PostgreSQL subtransaction. Any membership/profile
  -- failure rolls back inside the block and returns NEW, so email_confirmed_at
  -- is never reverted by expected or unexpected finalization errors.
  begin
    select pending.*
      into v_pending
      from private.auth_registration_pending_memberships as pending
      where pending.user_id = new.id
      for update;

    if not found or v_pending.consumed_at is not null then
      return new;
    end if;

    select profile.id
      into v_profile_id
      from public.profiles as profile
      where profile.id = new.id
      for update;

    if v_profile_id is null then
      return new;
    end if;

    v_inserted_user_id := null;

    if v_pending.portal = 'usuario' then
      insert into public.user_registrations (user_id)
      values (new.id)
      on conflict (user_id) do nothing
      returning user_id into v_inserted_user_id;
    elsif v_pending.portal = 'coach' then
      insert into public.coach_registrations (
        user_id,
        first_name,
        last_name,
        birth_date,
        gender,
        phone_number,
        professional_title
      )
      values (
        new.id,
        v_pending.first_name,
        v_pending.last_name,
        v_pending.birth_date,
        v_pending.gender,
        v_pending.phone_number,
        v_pending.professional_title
      )
      on conflict (user_id) do nothing
      returning user_id into v_inserted_user_id;
    else
      return new;
    end if;

    -- Existing memberships are authoritative and never overwritten. Profile
    -- fields are updated only when this finalizer inserted the requested row.
    if v_inserted_user_id is not null then
      update public.profiles as profile
      set
        display_name = concat_ws(' ', v_pending.first_name, v_pending.last_name),
        first_name = v_pending.first_name,
        last_name = v_pending.last_name,
        birth_date = v_pending.birth_date,
        gender = v_pending.gender,
        phone_number = v_pending.phone_number,
        updated_at = statement_timestamp()
      where profile.id = new.id;
    end if;

    update private.auth_registration_pending_memberships as pending
    set
      first_name = null,
      last_name = null,
      birth_date = null,
      gender = null,
      phone_number = null,
      professional_title = null,
      consumed_at = statement_timestamp()
    where pending.user_id = new.id
      and pending.consumed_at is null;
  exception
    when others then
      return new;
  end;

  return new;
end;
$finalize_auth_registration_pending_membership$;

revoke all on function private.finalize_auth_registration_pending_membership() from public;
revoke all on function private.finalize_auth_registration_pending_membership() from anon;
revoke all on function private.finalize_auth_registration_pending_membership() from authenticated;

-- BEFORE INSERT is required so NEW.raw_user_meta_data is scrubbed in the same
-- transaction. The deferred FK permits the child row to reference NEW.id until
-- auth.users finishes inserting the parent row.
create trigger on_auth_user_00_capture_registration_pending
  before insert on auth.users
  for each row
  execute function private.capture_auth_registration_pending_membership();

-- Some hosted Auth retry paths can issue an UPDATE instead of another INSERT.
-- The OR condition recognizes either approved registration signal. The trigger
-- only rewrites NEW.raw_user_meta_data and never touches the first pending row.
create trigger on_auth_user_00_scrub_registration_retry_metadata
  before update of raw_user_meta_data on auth.users
  for each row
  when (
    new.raw_user_meta_data ? 'organizatech_registration_portal'
    or new.raw_user_meta_data ? 'organizatech_registration_intent_id'
  )
  execute function private.scrub_auth_registration_retry_metadata();

-- Existing on_auth_user_created sorts before this z-prefixed AFTER INSERT
-- trigger, ensuring public.profiles exists if Confirm email is misconfigured
-- with autoconfirm. Normal confirmation uses the UPDATE trigger below.
create trigger on_auth_user_zz_finalize_registration_pending_created
  after insert on auth.users
  for each row
  when (new.email_confirmed_at is not null)
  execute function private.finalize_auth_registration_pending_membership();

create trigger on_auth_user_zz_finalize_registration_pending_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function private.finalize_auth_registration_pending_membership();

create function public.get_own_auth_registration_confirmation()
returns table (
  status text,
  portal text
)
language plpgsql
security definer
set search_path = ''
as $get_own_auth_registration_confirmation$
declare
  v_authenticated_user_id uuid := auth.uid();
  v_portal text;
  v_consumed_at timestamptz;
  v_membership_exists boolean := false;
begin
  if v_authenticated_user_id is null then
    raise exception 'registration confirmation requires authentication'
      using errcode = '42501';
  end if;

  select pending.portal, pending.consumed_at
    into v_portal, v_consumed_at
    from private.auth_registration_pending_memberships as pending
    join auth.users as auth_user on auth_user.id = pending.user_id
    where pending.user_id = v_authenticated_user_id
      and auth_user.email_confirmed_at is not null;

  if not found then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  if v_portal = 'usuario' then
    select exists (
      select 1
      from public.user_registrations as registration
      where registration.user_id = v_authenticated_user_id
    ) into v_membership_exists;
  elsif v_portal = 'coach' then
    select exists (
      select 1
      from public.coach_registrations as registration
      where registration.user_id = v_authenticated_user_id
    ) into v_membership_exists;
  end if;

  if v_consumed_at is not null and v_membership_exists then
    return query select 'confirmed'::text, v_portal;
    return;
  end if;

  return query select 'invalid'::text, v_portal;
end;
$get_own_auth_registration_confirmation$;

revoke all on function public.get_own_auth_registration_confirmation() from public;
revoke all on function public.get_own_auth_registration_confirmation() from anon;
revoke all on function public.get_own_auth_registration_confirmation() from authenticated;
grant execute on function public.get_own_auth_registration_confirmation() to authenticated;
