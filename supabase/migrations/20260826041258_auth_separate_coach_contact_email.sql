-- AUTH-HYBRID-01: shared or independent Auth identities for Coach membership.
--
-- An authenticated Usuario may activate Coach on the same auth.uid() through a
-- narrow RPC. A separate Coach identity still uses the confirmation-gated Auth
-- signup path. contact_email is professional contact data only: it is never an
-- Auth identifier, ownership input, or authorization signal. Historical Coach
-- memberships are preserved and receive their associated Auth email as contact
-- data during this one-time backfill.

begin;

alter table public.coach_registrations
  add column contact_email text;

alter table private.auth_registration_pending_memberships
  add column contact_email text;

update public.coach_registrations as registration
set contact_email = lower(btrim(auth_user.email))
from auth.users as auth_user
where auth_user.id = registration.user_id
  and registration.contact_email is null
  and auth_user.email is not null;

update private.auth_registration_pending_memberships as pending
set contact_email = lower(btrim(auth_user.email))
from auth.users as auth_user
where auth_user.id = pending.user_id
  and pending.portal = 'coach'
  and pending.consumed_at is null
  and pending.contact_email is null
  and auth_user.email is not null;

do $auth_separate_contact_backfill$
begin
  if exists (
    select 1
    from public.coach_registrations as registration
    where registration.contact_email is null
      or char_length(registration.contact_email) not between 6 and 254
      or registration.contact_email <> lower(btrim(registration.contact_email))
      or registration.contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception 'coach contact email backfill could not be validated';
  end if;

  if exists (
    select 1
    from private.auth_registration_pending_memberships as pending
    where pending.portal = 'coach'
      and pending.consumed_at is null
      and (
        pending.contact_email is null
        or char_length(pending.contact_email) not between 6 and 254
        or pending.contact_email <> lower(btrim(pending.contact_email))
        or pending.contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
  ) then
    raise exception 'pending coach contact email backfill could not be validated';
  end if;
end;
$auth_separate_contact_backfill$;

alter table public.coach_registrations
  alter column contact_email set not null,
  add constraint coach_registrations_contact_email_format check (
    char_length(contact_email) between 6 and 254
    and contact_email = lower(btrim(contact_email))
    and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );

-- Reassert both protections in the migration that opens the shared activation
-- path. FORCE RLS must not depend only on historical schema state.
alter table public.coach_registrations enable row level security;
alter table public.coach_registrations force row level security;

alter table private.auth_registration_pending_memberships
  add constraint auth_registration_pending_memberships_contact_email_scope check (
    (
      consumed_at is not null
      and contact_email is null
    )
    or (
      consumed_at is null
      and portal = 'usuario'
      and contact_email is null
    )
    or (
      consumed_at is null
      and portal = 'coach'
      and contact_email is not null
      and char_length(contact_email) between 6 and 254
      and contact_email = lower(btrim(contact_email))
      and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  );

-- Direct table writes remain closed. Separate accounts are still materialized
-- only by the confirmation trigger; shared activation is available exclusively
-- through the self-owned function below.
drop policy if exists "coach registrations insert own row"
  on public.coach_registrations;

revoke all privileges on table public.coach_registrations from public;
revoke all privileges on table public.coach_registrations from anon;
revoke all privileges on table public.coach_registrations from authenticated;
grant select on table public.coach_registrations to authenticated;

revoke all on function public.register_own_coach(
  uuid,
  text,
  text,
  date,
  text,
  text,
  text
) from public;

revoke all on function public.register_own_coach(
  uuid,
  text,
  text,
  date,
  text,
  text,
  text
) from anon;

revoke all on function public.register_own_coach(
  uuid,
  text,
  text,
  date,
  text,
  text,
  text
) from authenticated;

drop function if exists public.register_own_coach(
  uuid,
  text,
  text,
  date,
  text,
  text,
  text
);

create function public.register_own_coach(
  p_first_name text,
  p_last_name text,
  p_birth_date date,
  p_gender text,
  p_phone_number text,
  p_professional_title text,
  p_contact_email text
)
returns public.coach_registrations
language plpgsql
security definer
set search_path = ''
as $register_own_coach$
declare
  v_authenticated_user_id uuid := auth.uid();
  v_registration public.coach_registrations;
  v_first_name text := regexp_replace(
    btrim(coalesce(p_first_name, '')),
    '[[:space:]]+',
    ' ',
    'g'
  );
  v_last_name text := regexp_replace(
    btrim(coalesce(p_last_name, '')),
    '[[:space:]]+',
    ' ',
    'g'
  );
  v_phone_number text := regexp_replace(
    btrim(coalesce(p_phone_number, '')),
    '[[:space:]]+',
    ' ',
    'g'
  );
  v_professional_title text := regexp_replace(
    btrim(coalesce(p_professional_title, '')),
    '[[:space:]]+',
    ' ',
    'g'
  );
  v_contact_email text := lower(btrim(coalesce(p_contact_email, '')));
  v_age_years integer;
begin
  if v_authenticated_user_id is null then
    raise exception 'coach activation requires authentication' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.user_registrations as user_registration
    where user_registration.user_id = v_authenticated_user_id
  ) then
    raise exception 'coach activation requires user membership' using errcode = '42501';
  end if;

  select registration.*
    into v_registration
    from public.coach_registrations as registration
    where registration.user_id = v_authenticated_user_id;

  if v_registration.user_id is not null then
    return v_registration;
  end if;

  if p_birth_date is not null then
    v_age_years := date_part('year', age(current_date, p_birth_date));
  end if;

  if char_length(v_first_name) not between 1 and 80
    or char_length(v_last_name) not between 1 and 120
    or p_birth_date is null
    or p_birth_date > current_date
    or v_age_years not between 10 and 100
    or p_gender is null
    or p_gender not in ('male', 'female', 'non_binary', 'prefer_not_to_say')
    or char_length(v_phone_number) not between 1 and 30
    or v_phone_number !~ '^[0-9+() -]+$'
    or char_length(v_professional_title) not between 1 and 160
    or char_length(v_contact_email) not between 6 and 254
    or v_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid coach activation payload' using errcode = '22023';
  end if;

  insert into public.coach_registrations (
    user_id,
    first_name,
    last_name,
    birth_date,
    gender,
    phone_number,
    professional_title,
    contact_email
  )
  values (
    v_authenticated_user_id,
    v_first_name,
    v_last_name,
    p_birth_date,
    p_gender,
    v_phone_number,
    v_professional_title,
    v_contact_email
  )
  on conflict (user_id) do nothing
  returning * into v_registration;

  if v_registration.user_id is null then
    select registration.*
      into v_registration
      from public.coach_registrations as registration
      where registration.user_id = v_authenticated_user_id;
  end if;

  if v_registration.user_id is null
    or v_registration.user_id <> v_authenticated_user_id then
    raise exception 'coach activation could not be confirmed' using errcode = '42501';
  end if;

  return v_registration;
end;
$register_own_coach$;

revoke all on function public.register_own_coach(
  text,
  text,
  date,
  text,
  text,
  text,
  text
) from public;

revoke all on function public.register_own_coach(
  text,
  text,
  date,
  text,
  text,
  text,
  text
) from anon;

revoke all on function public.register_own_coach(
  text,
  text,
  date,
  text,
  text,
  text,
  text
) from authenticated;

grant execute on function public.register_own_coach(
  text,
  text,
  date,
  text,
  text,
  text,
  text
) to authenticated;

-- Password registrations cannot create a new dual identity in the opposite
-- direction either. Historical dual memberships remain idempotent because an
-- existing Usuario row is returned before the Coach-only guard is evaluated.
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

  if exists (
    select 1
    from public.coach_registrations as registration
    where registration.user_id = v_authenticated_user_id
  ) then
    raise exception 'user registration requires a separate auth identity'
      using errcode = '42501';
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

revoke all on function public.register_own_user() from public;
revoke all on function public.register_own_user() from anon;
revoke all on function public.register_own_user() from authenticated;
grant execute on function public.register_own_user() to authenticated;

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

  -- Forward-compatible rollout: the migration is applied before the new UI.
  -- An older Coach client has no contact_email key, so use the authoritative
  -- access email of this same NEW identity only for that absence case. An
  -- explicitly blank or invalid contact value still fails closed below.
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

create or replace function private.finalize_auth_registration_pending_membership()
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
        professional_title,
        contact_email
      )
      values (
        new.id,
        v_pending.first_name,
        v_pending.last_name,
        v_pending.birth_date,
        v_pending.gender,
        v_pending.phone_number,
        v_pending.professional_title,
        v_pending.contact_email
      )
      on conflict (user_id) do nothing
      returning user_id into v_inserted_user_id;
    else
      return new;
    end if;

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
      contact_email = null,
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

commit;
