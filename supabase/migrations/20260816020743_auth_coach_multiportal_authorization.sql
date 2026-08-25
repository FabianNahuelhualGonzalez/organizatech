-- AUTH-COACH-01: authoritative, self-service Coach registration.
--
-- Ownership is never supplied by the client. PostgreSQL derives user_id from
-- the authenticated request and column ACLs prevent PostgREST clients from
-- naming the ownership or audit columns in an INSERT.

create table public.coach_registrations (
  user_id uuid primary key default auth.uid()
    references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  birth_date date not null,
  gender text not null,
  phone_number text not null,
  professional_title text not null,
  created_at timestamptz not null default now(),
  constraint coach_registrations_first_name_length check (
    char_length(btrim(first_name)) between 1 and 80
  ),
  constraint coach_registrations_last_name_length check (
    char_length(btrim(last_name)) between 1 and 120
  ),
  constraint coach_registrations_gender_allowed check (
    gender in ('male', 'female', 'non_binary', 'prefer_not_to_say')
  ),
  constraint coach_registrations_phone_number_length check (
    char_length(btrim(phone_number)) between 1 and 30
  ),
  constraint coach_registrations_professional_title_length check (
    char_length(btrim(professional_title)) between 1 and 160
  )
);

alter table public.coach_registrations enable row level security;
alter table public.coach_registrations force row level security;

create policy "coach registrations select own row"
  on public.coach_registrations
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "coach registrations insert own row"
  on public.coach_registrations
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

revoke all privileges on table public.coach_registrations from public;
revoke all privileges on table public.coach_registrations from anon;
revoke all privileges on table public.coach_registrations from authenticated;

grant select on table public.coach_registrations to authenticated;
grant insert (
  first_name,
  last_name,
  birth_date,
  gender,
  phone_number,
  professional_title
) on table public.coach_registrations to authenticated;

create function public.register_own_coach(
  p_expected_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_birth_date date,
  p_gender text,
  p_phone_number text,
  p_professional_title text
)
returns public.coach_registrations
language plpgsql
security invoker
set search_path = ''
as $register_own_coach$
declare
  v_authenticated_user_id uuid := auth.uid();
  v_registration public.coach_registrations;
begin
  if v_authenticated_user_id is null
    or v_authenticated_user_id <> p_expected_user_id then
    raise exception 'coach registration identity mismatch' using errcode = '42501';
  end if;

  insert into public.coach_registrations (
    first_name,
    last_name,
    birth_date,
    gender,
    phone_number,
    professional_title
  )
  values (
    p_first_name,
    p_last_name,
    p_birth_date,
    p_gender,
    p_phone_number,
    p_professional_title
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
    raise exception 'coach registration could not be confirmed' using errcode = '42501';
  end if;

  return v_registration;
end;
$register_own_coach$;

revoke all on function public.register_own_coach(uuid, text, text, date, text, text, text) from public;
revoke all on function public.register_own_coach(uuid, text, text, date, text, text, text) from anon;
revoke all on function public.register_own_coach(uuid, text, text, date, text, text, text) from authenticated;
grant execute on function public.register_own_coach(uuid, text, text, date, text, text, text) to authenticated;
