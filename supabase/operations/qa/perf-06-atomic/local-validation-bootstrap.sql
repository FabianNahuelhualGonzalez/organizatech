-- PostgreSQL 17.6 disposable-only baseline support for the native Node gate.
-- This is split into two phases by scripts/perf-06-local-bootstrap.mjs. It has
-- no client metacommands and must never be sent to QA or PROD.

-- PERF06_BOOTSTRAP_PHASE before_schema
do $$
begin
  if current_user::text <> 'postgres'
    or session_user::text <> 'postgres'
    or current_setting('server_version_num')::integer <> 170006
    or current_database() !~ '^perf06_'
  then
    raise exception 'local PERF-06 bootstrap environment rejected';
  end if;
end
$$;

create schema extensions;
create extension pgcrypto with schema extensions;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid()
returns uuid
language sql
stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null
);
alter table storage.objects enable row level security;
create function storage.foldername(name text)
returns text[]
language sql
immutable
as $$ select string_to_array(name, '/') $$;

-- Supabase PostgreSQL 17 defaults include MAINTAIN. These defaults reproduce
-- QA ACL lines for both historical and PERF-created objects.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;

-- PERF06_BOOTSTRAP_PHASE after_history
-- QA already has this material ACL before its version is registered. Repeating
-- the sixth PERF migration in the atomic runner is a material no-op.
revoke all on function public.save_daily_training_readiness(jsonb) from public;
revoke all on function public.save_daily_training_readiness(jsonb) from anon;
revoke all on function public.save_daily_training_readiness(jsonb) from service_role;
grant execute on function public.save_daily_training_readiness(jsonb) to authenticated;
grant execute on function public.save_daily_training_readiness(jsonb) to postgres;

-- This table is deliberately excluded from the approved schema fingerprint.
create table public.training_session_consolidation_audit (
  audit_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into auth.users (id, email)
values ('10000000-0000-4000-8000-000000000001', 'local-fixture@example.invalid');
insert into public.routines (id, user_id, name)
values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'local baseline routine'
);
insert into public.exercises (
  id, user_id, routine_id, name, target_sets, target_reps, base_weight
) values
  (
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'local pending one', 1, 1, 0
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'local pending two', 1, 1, 0
  );
