create extension if not exists "pgcrypto";

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null,
  current_streak integer not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid not null references public.routines(id) on delete cascade,
  name text not null,
  target_sets integer not null check (target_sets > 0),
  target_reps integer not null check (target_reps > 0),
  base_weight numeric(7,2) not null default 0,
  side_weight numeric(7,2),
  day text,
  notes text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_number integer not null check (week_number > 0),
  trained_at date not null,
  notes text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.exercise_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  weight numeric(7,2) not null default 0,
  previous_weight numeric(7,2) not null default 0,
  reps integer[] not null,
  rir text,
  notes text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index routines_user_name_idx on public.routines(user_id, name);
create index exercises_user_routine_idx on public.exercises(user_id, routine_id);
create index sessions_user_week_idx on public.training_sessions(user_id, week_number);
create index entries_user_exercise_idx on public.exercise_entries(user_id, exercise_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger routines_set_updated_at before update on public.routines
  for each row execute function public.set_updated_at();

create trigger exercises_set_updated_at before update on public.exercises
  for each row execute function public.set_updated_at();

create trigger sessions_set_updated_at before update on public.training_sessions
  for each row execute function public.set_updated_at();

create trigger entries_set_updated_at before update on public.exercise_entries
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1), 'Usuario'),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.routines enable row level security;
alter table public.exercises enable row level security;
alter table public.training_sessions enable row level security;
alter table public.exercise_entries enable row level security;

create policy "profiles own rows" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "routines own rows" on public.routines
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "exercises own rows" on public.exercises
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "sessions own rows" on public.training_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "entries own rows" on public.exercise_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
