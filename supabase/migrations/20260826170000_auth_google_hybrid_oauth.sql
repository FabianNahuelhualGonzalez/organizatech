-- AUTH-GOOGLE-01: explicit Google registration RPCs for hybrid memberships.
-- Prepared locally only. Apply to QA before PROD after independent audit.
begin;

create or replace function private.current_auth_identity_is_google()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from auth.identities as identity
      where identity.user_id = (select auth.uid())
        and identity.provider = 'google'
    );
$function$;

revoke all on function private.current_auth_identity_is_google() from public;
revoke all on function private.current_auth_identity_is_google() from anon;
revoke all on function private.current_auth_identity_is_google() from authenticated;

create function public.register_own_google_user(
  p_first_name text,
  p_last_name text,
  p_birth_date date,
  p_gender text,
  p_phone_number text
)
returns public.user_registrations
language plpgsql
security definer
set search_path = ''
as $register_own_google_user$
declare
  v_authenticated_user_id uuid := auth.uid();
  v_registration public.user_registrations;
  v_inserted_user_id uuid;
  v_first_name text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_first_name, '')), '[[:space:]]+', ' ', 'g');
  v_last_name text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_last_name, '')), '[[:space:]]+', ' ', 'g');
  v_phone_number text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_phone_number, '')), '[[:space:]]+', ' ', 'g');
  v_age_years integer;
begin
  if v_authenticated_user_id is null or not private.current_auth_identity_is_google() then
    raise exception 'Google user registration requires same-user Google identity'
      using errcode = '42501';
  end if;

  if p_birth_date is not null then
    v_age_years := pg_catalog.date_part('year', pg_catalog.age(current_date, p_birth_date));
  end if;
  if pg_catalog.char_length(v_first_name) not between 1 and 80
    or pg_catalog.char_length(v_last_name) not between 1 and 120
    or p_birth_date is null or p_birth_date > current_date
    or v_age_years not between 10 and 100
    or p_gender is null
    or p_gender not in ('male', 'female', 'non_binary', 'prefer_not_to_say')
    or pg_catalog.char_length(v_phone_number) not between 1 and 30
    or v_phone_number !~ '^[0-9+() -]+$'
  then
    raise exception 'invalid Google user registration payload' using errcode = '22023';
  end if;

  select registration.*
    into v_registration
    from public.user_registrations as registration
    where registration.user_id = v_authenticated_user_id;
  if v_registration.user_id is not null then return v_registration; end if;

  insert into public.user_registrations (user_id)
  values (v_authenticated_user_id)
  on conflict (user_id) do nothing
  returning user_id into v_inserted_user_id;

  if v_inserted_user_id is not null then
    update public.profiles as profile
    set
      display_name = pg_catalog.concat_ws(' ', v_first_name, v_last_name),
      first_name = v_first_name,
      last_name = v_last_name,
      birth_date = p_birth_date,
      gender = p_gender,
      phone_number = v_phone_number,
      updated_at = pg_catalog.statement_timestamp()
    where profile.id = v_authenticated_user_id;
    if not found then
      raise exception 'Google user profile could not be confirmed' using errcode = '42501';
    end if;
  end if;

  select registration.*
    into v_registration
    from public.user_registrations as registration
    where registration.user_id = v_authenticated_user_id;
  if v_registration.user_id is null or v_registration.user_id <> v_authenticated_user_id then
    raise exception 'Google user registration could not be confirmed' using errcode = '42501';
  end if;
  return v_registration;
end;
$register_own_google_user$;

revoke all on function public.register_own_google_user(text,text,date,text,text) from public;
revoke all on function public.register_own_google_user(text,text,date,text,text) from anon;
revoke all on function public.register_own_google_user(text,text,date,text,text) from authenticated;
grant execute on function public.register_own_google_user(text,text,date,text,text) to authenticated;

create function public.register_own_google_coach(
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
as $register_own_google_coach$
declare
  v_authenticated_user_id uuid := auth.uid();
  v_registration public.coach_registrations;
  v_inserted_user_id uuid;
  v_first_name text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_first_name, '')), '[[:space:]]+', ' ', 'g');
  v_last_name text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_last_name, '')), '[[:space:]]+', ' ', 'g');
  v_phone_number text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_phone_number, '')), '[[:space:]]+', ' ', 'g');
  v_professional_title text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_professional_title, '')), '[[:space:]]+', ' ', 'g');
  v_contact_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_contact_email, '')));
  v_age_years integer;
begin
  if v_authenticated_user_id is null or not private.current_auth_identity_is_google() then
    raise exception 'Google coach registration requires same-user Google identity'
      using errcode = '42501';
  end if;

  if p_birth_date is not null then
    v_age_years := pg_catalog.date_part('year', pg_catalog.age(current_date, p_birth_date));
  end if;
  if pg_catalog.char_length(v_first_name) not between 1 and 80
    or pg_catalog.char_length(v_last_name) not between 1 and 120
    or p_birth_date is null or p_birth_date > current_date
    or v_age_years not between 10 and 100
    or p_gender is null
    or p_gender not in ('male', 'female', 'non_binary', 'prefer_not_to_say')
    or pg_catalog.char_length(v_phone_number) not between 1 and 30
    or v_phone_number !~ '^[0-9+() -]+$'
    or pg_catalog.char_length(v_professional_title) not between 1 and 160
    or pg_catalog.char_length(v_contact_email) not between 6 and 254
    or v_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'invalid Google coach registration payload' using errcode = '22023';
  end if;

  select registration.*
    into v_registration
    from public.coach_registrations as registration
    where registration.user_id = v_authenticated_user_id;
  if v_registration.user_id is not null then return v_registration; end if;

  insert into public.coach_registrations (
    user_id,
    first_name,
    last_name,
    birth_date,
    gender,
    phone_number,
    professional_title,
    contact_email
  ) values (
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
  returning user_id into v_inserted_user_id;

  if v_inserted_user_id is not null then
    update public.profiles as profile
    set
      display_name = pg_catalog.concat_ws(' ', v_first_name, v_last_name),
      first_name = v_first_name,
      last_name = v_last_name,
      birth_date = p_birth_date,
      gender = p_gender,
      phone_number = v_phone_number,
      updated_at = pg_catalog.statement_timestamp()
    where profile.id = v_authenticated_user_id;
    if not found then
      raise exception 'Google coach profile could not be confirmed' using errcode = '42501';
    end if;
  end if;

  select registration.*
    into v_registration
    from public.coach_registrations as registration
    where registration.user_id = v_authenticated_user_id;
  if v_registration.user_id is null or v_registration.user_id <> v_authenticated_user_id then
    raise exception 'Google coach registration could not be confirmed' using errcode = '42501';
  end if;
  return v_registration;
end;
$register_own_google_coach$;

revoke all on function public.register_own_google_coach(text,text,date,text,text,text,text) from public;
revoke all on function public.register_own_google_coach(text,text,date,text,text,text,text) from anon;
revoke all on function public.register_own_google_coach(text,text,date,text,text,text,text) from authenticated;
grant execute on function public.register_own_google_coach(text,text,date,text,text,text,text) to authenticated;

alter table public.user_registrations enable row level security;
alter table public.user_registrations force row level security;
alter table public.coach_registrations enable row level security;
alter table public.coach_registrations force row level security;

commit;
