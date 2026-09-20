-- Minimal pre-20260829200846 Supabase-compatible baseline.
-- Objects introduced by migrations 846/847 are deliberately absent here.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
create schema extensions;
alter role postgres set search_path = public, private, extensions, pg_catalog;
create extension pgcrypto with schema extensions;
create extension dblink with schema extensions;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := statement_timestamp(); return new; end
$$;
-- Pre-existing transactional email primitives referenced (but not owned) by
-- the cycle API migration. These definitions are copied byte-for-byte in
-- behavior from 20260827000000_email_onboarding_transactional_email.sql.
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
  return (
    pg_catalog.substr(v_hash, 1, 8) || '-' ||
    pg_catalog.substr(v_hash, 9, 4) || '-' ||
    '8' || pg_catalog.substr(v_hash, 14, 3) || '-' ||
    '8' || pg_catalog.substr(v_hash, 18, 3) || '-' ||
    pg_catalog.substr(v_hash, 21, 12)
  )::uuid;
end;
$transactional_email_idempotency_uuid$;
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
create table auth.users (
  id uuid primary key, instance_id uuid, aud text, role text, email text,
  encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz
);
create table public.user_registrations (user_id uuid primary key references auth.users(id));
create table public.coach_registrations (user_id uuid primary key references auth.users(id));
create table public.exercises (
  id uuid primary key default extensions.gen_random_uuid(), user_id uuid not null references auth.users(id),
  name text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table public.training_sessions (
  id uuid primary key default extensions.gen_random_uuid(), user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table public.exercise_entries (
  id uuid primary key default extensions.gen_random_uuid(), user_id uuid not null references auth.users(id),
  exercise_id uuid references public.exercises(id), created_at timestamptz not null default now()
);
create table public.training_cycles (
  id uuid primary key default extensions.gen_random_uuid(), user_id uuid not null references auth.users(id),
  name text not null, cycle_number integer not null check (cycle_number > 0), cycle_type text, goal text,
  started_at timestamptz not null, ended_at timestamptz,
  status text not null check (status in ('active','completed','cancelled')),
  plan_snapshot jsonb not null default '{}'::jsonb, summary_snapshot jsonb,
  duration_weeks integer, planned_start_date date, planned_end_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  constraint training_cycles_id_user_id_unique unique(id,user_id)
);
create unique index training_cycles_one_active_per_user_idx on public.training_cycles(user_id)
  where status='active' and deleted_at is null;
create table public.training_cycle_routines (
  id uuid primary key default extensions.gen_random_uuid(), user_id uuid not null references auth.users(id),
  cycle_id uuid not null references public.training_cycles(id), name text not null, sort_order integer not null default 0,
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table public.training_cycle_days (
  id uuid primary key default extensions.gen_random_uuid(), user_id uuid not null references auth.users(id),
  cycle_id uuid not null references public.training_cycles(id), routine_id uuid not null references public.training_cycle_routines(id),
  week_index integer not null default 1, day_code text not null, sort_order integer not null default 0, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  constraint training_cycle_days_id_cycle_key unique(id,cycle_id)
);
create table public.training_cycle_exercises (
  id uuid primary key default extensions.gen_random_uuid(), user_id uuid not null references auth.users(id),
  cycle_id uuid not null references public.training_cycles(id), day_id uuid not null references public.training_cycle_days(id),
  name text not null, target_sets integer not null, target_reps integer not null, base_weight numeric(7,2) not null default 0,
  side_weight numeric(7,2), sort_order integer not null default 0, notes text,
  source_legacy_exercise_id uuid references public.exercises(id), exercise_lineage_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  constraint training_cycle_exercises_id_cycle_key unique(id,cycle_id)
);
create table public.training_exercise_lineages (
  id uuid primary key default extensions.gen_random_uuid(), user_id uuid not null references auth.users(id),
  source_legacy_exercise_id uuid references public.exercises(id), origin_kind text not null default 'scoped' check(origin_kind in ('legacy','scoped')),
  origin_training_cycle_exercise_id uuid references public.training_cycle_exercises(id), metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint training_exercise_lineages_user_id_id_key unique(user_id,id)
);
alter table public.training_cycle_exercises add constraint training_cycle_exercises_lineage_fk
  foreign key(user_id,exercise_lineage_id) references public.training_exercise_lineages(user_id,id);
create table public.training_workout_readiness (
  id uuid primary key default extensions.gen_random_uuid(), user_id uuid not null references auth.users(id), workout_attempt_id uuid not null,
  cycle_id uuid not null, cycle_day_id uuid not null, workout_started_at timestamptz not null, local_date date not null, payload jsonb not null,
  training_session_id uuid references public.training_sessions(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint training_workout_readiness_user_attempt_key unique(user_id,workout_attempt_id),
  constraint training_workout_readiness_cycle_user_fk foreign key(cycle_id,user_id) references public.training_cycles(id,user_id),
  constraint training_workout_readiness_cycle_day_cycle_fk foreign key(cycle_day_id,cycle_id) references public.training_cycle_days(id,cycle_id)
);
alter table public.training_cycles enable row level security;
alter table public.training_exercise_lineages enable row level security;
create policy "lineages own rows select" on public.training_exercise_lineages for select to authenticated using(user_id=auth.uid());
create policy "lineages own rows insert" on public.training_exercise_lineages for insert to authenticated with check(user_id=auth.uid());
create policy "lineages own rows update" on public.training_exercise_lineages for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
grant usage on schema public,auth,extensions to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant execute on all functions in schema auth to authenticated;
