-- AUTH-COACH-01: authoritative, self-service Usuario registration.
--
-- public.profiles remains the common identity profile. This table is the
-- independent Usuario membership authority. Future profile creation does not
-- create a Usuario membership.

create table public.user_registrations (
  user_id uuid primary key default auth.uid()
    references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.user_registrations enable row level security;
alter table public.user_registrations force row level security;

create policy "user registrations select own row"
  on public.user_registrations
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all privileges on table public.user_registrations from public;
revoke all privileges on table public.user_registrations from anon;
revoke all privileges on table public.user_registrations from authenticated;

grant select on table public.user_registrations to authenticated;

create function public.register_own_user()
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

-- One-time legacy compatibility. transaction_timestamp() is fixed at the
-- beginning of the migration transaction, so only profiles that already
-- existed when this migration started are eligible. ON CONFLICT makes the
-- backfill idempotent without creating a future profiles -> membership path.
insert into public.user_registrations (user_id)
select profile.id
from public.profiles as profile
where profile.created_at <= transaction_timestamp()
on conflict (user_id) do nothing;
