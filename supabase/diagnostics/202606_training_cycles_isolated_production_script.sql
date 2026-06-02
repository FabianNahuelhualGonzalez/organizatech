-- Fase 2.2N - Script aislado para crear public.training_cycles.
-- NO EJECUTAR SIN APROBACION EXPLICITA - PRODUCCION - MODIFICA SCHEMA
--
-- Objetivo:
-- Aplicar exclusivamente el contenido de:
-- supabase/migrations/20260531_training_cycles.sql
-- sin usar supabase db push y sin arrastrar migraciones antiguas.
--
-- Restricciones:
-- - No toca public.training_sessions salvo SELECT de baseline.
-- - No toca public.exercise_entries salvo SELECT de baseline.
-- - No inserta datos.
-- - No hace backfill.
-- - No activa feature flags.
-- - No toca Vercel.
--
-- Ejecutar solo dentro de una ventana autorizada por Arquitectura.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $$
declare
  v_training_cycles_regclass regclass;
  v_set_updated_at_count integer;
  v_training_sessions_count bigint;
  v_training_sessions_active_count bigint;
  v_training_sessions_soft_deleted_count bigint;
  v_exercise_entries_count bigint;
  v_distinct_session_count bigint;
begin
  select to_regclass('public.training_cycles')
    into v_training_cycles_regclass;

  if v_training_cycles_regclass is not null then
    raise exception 'Abort: public.training_cycles already exists';
  end if;

  select count(*)
    into v_set_updated_at_count
  from information_schema.routines
  where routine_schema = 'public'
    and routine_name = 'set_updated_at'
    and data_type = 'trigger';

  if v_set_updated_at_count <> 1 then
    raise exception 'Abort: public.set_updated_at() trigger function is missing or ambiguous';
  end if;

  select
    count(*),
    count(*) filter (where deleted_at is null),
    count(*) filter (where deleted_at is not null)
  into
    v_training_sessions_count,
    v_training_sessions_active_count,
    v_training_sessions_soft_deleted_count
  from public.training_sessions;

  if v_training_sessions_count <> 36
    or v_training_sessions_active_count <> 11
    or v_training_sessions_soft_deleted_count <> 25 then
    raise exception 'Abort: training_sessions baseline mismatch. total=%, active=%, soft_deleted=%',
      v_training_sessions_count,
      v_training_sessions_active_count,
      v_training_sessions_soft_deleted_count;
  end if;

  select
    count(*),
    count(distinct session_id)
  into
    v_exercise_entries_count,
    v_distinct_session_count
  from public.exercise_entries;

  if v_exercise_entries_count <> 78
    or v_distinct_session_count <> 11 then
    raise exception 'Abort: exercise_entries baseline mismatch. total=%, distinct_session_count=%',
      v_exercise_entries_count,
      v_distinct_session_count;
  end if;
end;
$$;

create table public.training_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  cycle_number integer not null check (cycle_number > 0),
  cycle_type text null,
  goal text null,
  started_at timestamptz not null,
  ended_at timestamptz null,
  status text not null check (status in ('active', 'completed', 'cancelled')),
  plan_snapshot jsonb not null default '{}'::jsonb,
  summary_snapshot jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index training_cycles_user_status_idx
  on public.training_cycles(user_id, status);

create index training_cycles_user_created_idx
  on public.training_cycles(user_id, created_at);

create index training_cycles_user_deleted_at_idx
  on public.training_cycles(user_id, deleted_at);

create unique index training_cycles_one_active_per_user_idx
  on public.training_cycles(user_id)
  where status = 'active' and deleted_at is null;

create trigger training_cycles_set_updated_at
  before update on public.training_cycles
  for each row execute function public.set_updated_at();

alter table public.training_cycles enable row level security;

create policy "training cycles select own rows" on public.training_cycles
  for select
  using (auth.uid() = user_id);

create policy "training cycles insert own rows" on public.training_cycles
  for insert
  with check (auth.uid() = user_id);

create policy "training cycles update own rows" on public.training_cycles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

do $$
declare
  v_training_cycles_regclass regclass;
  v_training_cycles_count bigint;
  v_expected_columns_count integer;
  v_expected_indexes_count integer;
  v_expected_policies_count integer;
  v_delete_policies_count integer;
  v_trigger_count integer;
  v_rls_enabled boolean;
  v_training_sessions_count bigint;
  v_training_sessions_active_count bigint;
  v_training_sessions_soft_deleted_count bigint;
  v_exercise_entries_count bigint;
  v_distinct_session_count bigint;
begin
  select to_regclass('public.training_cycles')
    into v_training_cycles_regclass;

  if v_training_cycles_regclass is null then
    raise exception 'Postcheck failed: public.training_cycles does not exist';
  end if;

  select count(*)
    into v_training_cycles_count
  from public.training_cycles;

  if v_training_cycles_count <> 0 then
    raise exception 'Postcheck failed: public.training_cycles must be empty, count=%',
      v_training_cycles_count;
  end if;

  select count(*)
    into v_expected_columns_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'training_cycles'
    and column_name in (
      'id',
      'user_id',
      'name',
      'cycle_number',
      'cycle_type',
      'goal',
      'started_at',
      'ended_at',
      'status',
      'plan_snapshot',
      'summary_snapshot',
      'created_at',
      'updated_at',
      'deleted_at'
    );

  if v_expected_columns_count <> 14 then
    raise exception 'Postcheck failed: expected 14 columns, found %',
      v_expected_columns_count;
  end if;

  select count(*)
    into v_expected_indexes_count
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'training_cycles'
    and indexname in (
      'training_cycles_pkey',
      'training_cycles_user_status_idx',
      'training_cycles_user_created_idx',
      'training_cycles_user_deleted_at_idx',
      'training_cycles_one_active_per_user_idx'
    );

  if v_expected_indexes_count <> 5 then
    raise exception 'Postcheck failed: expected 5 indexes, found %',
      v_expected_indexes_count;
  end if;

  select c.relrowsecurity
    into v_rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'training_cycles';

  if v_rls_enabled is not true then
    raise exception 'Postcheck failed: RLS is not enabled on public.training_cycles';
  end if;

  select count(*)
    into v_expected_policies_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'training_cycles'
    and cmd in ('SELECT', 'INSERT', 'UPDATE');

  if v_expected_policies_count <> 3 then
    raise exception 'Postcheck failed: expected 3 select/insert/update policies, found %',
      v_expected_policies_count;
  end if;

  select count(*)
    into v_delete_policies_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'training_cycles'
    and cmd = 'DELETE';

  if v_delete_policies_count <> 0 then
    raise exception 'Postcheck failed: delete policy exists on public.training_cycles';
  end if;

  select count(*)
    into v_trigger_count
  from information_schema.triggers
  where event_object_schema = 'public'
    and event_object_table = 'training_cycles'
    and trigger_name = 'training_cycles_set_updated_at';

  if v_trigger_count <> 1 then
    raise exception 'Postcheck failed: updated_at trigger missing';
  end if;

  select
    count(*),
    count(*) filter (where deleted_at is null),
    count(*) filter (where deleted_at is not null)
  into
    v_training_sessions_count,
    v_training_sessions_active_count,
    v_training_sessions_soft_deleted_count
  from public.training_sessions;

  if v_training_sessions_count <> 36
    or v_training_sessions_active_count <> 11
    or v_training_sessions_soft_deleted_count <> 25 then
    raise exception 'Postcheck failed: training_sessions baseline changed. total=%, active=%, soft_deleted=%',
      v_training_sessions_count,
      v_training_sessions_active_count,
      v_training_sessions_soft_deleted_count;
  end if;

  select
    count(*),
    count(distinct session_id)
  into
    v_exercise_entries_count,
    v_distinct_session_count
  from public.exercise_entries;

  if v_exercise_entries_count <> 78
    or v_distinct_session_count <> 11 then
    raise exception 'Postcheck failed: exercise_entries baseline changed. total=%, distinct_session_count=%',
      v_exercise_entries_count,
      v_distinct_session_count;
  end if;
end;
$$;

commit;
