alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists birth_date date,
  add column if not exists gender text default 'not_specified';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_gender_allowed'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_gender_allowed
      check (
        gender is null or gender in (
          'male',
          'female',
          'non_binary',
          'prefer_not_to_say',
          'not_specified'
        )
      );
  end if;
end $$;
