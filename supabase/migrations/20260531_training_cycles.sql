-- Fase 2.2C - Migracion aditiva para ciclos de Training.
-- No toca public.training_sessions.
-- No toca public.exercise_entries.
-- No migra localStorage.
-- No crea datos iniciales.
--
-- Rollback conceptual, no ejecutar aqui:
-- 1. drop policy if exists ... on public.training_cycles;
-- 2. drop trigger if exists training_cycles_set_updated_at on public.training_cycles;
-- 3. drop index if exists training_cycles_one_active_per_user_idx;
-- 4. drop index if exists training_cycles_user_deleted_at_idx;
-- 5. drop index if exists training_cycles_user_created_idx;
-- 6. drop index if exists training_cycles_user_status_idx;
-- 7. drop table if exists public.training_cycles;

create table if not exists public.training_cycles (
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

create index if not exists training_cycles_user_status_idx
  on public.training_cycles(user_id, status);

create index if not exists training_cycles_user_created_idx
  on public.training_cycles(user_id, created_at);

create index if not exists training_cycles_user_deleted_at_idx
  on public.training_cycles(user_id, deleted_at);

create unique index if not exists training_cycles_one_active_per_user_idx
  on public.training_cycles(user_id)
  where status = 'active' and deleted_at is null;

drop trigger if exists training_cycles_set_updated_at on public.training_cycles;

create trigger training_cycles_set_updated_at
  before update on public.training_cycles
  for each row execute function public.set_updated_at();

alter table public.training_cycles enable row level security;

drop policy if exists "training cycles select own rows" on public.training_cycles;
create policy "training cycles select own rows" on public.training_cycles
  for select
  using (auth.uid() = user_id);

drop policy if exists "training cycles insert own rows" on public.training_cycles;
create policy "training cycles insert own rows" on public.training_cycles
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "training cycles update own rows" on public.training_cycles;
create policy "training cycles update own rows" on public.training_cycles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- No se crea policy de delete para authenticated.
-- No se agregan grants explicitos porque el repo no los define para tablas existentes con RLS.
