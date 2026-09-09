-- CYCLE-REDESIGN-BACKEND-01
-- Forward-only persistence for draftable, versioned training cycles.
--
-- This migration deliberately does not alter public.training_sessions or
-- public.exercise_entries. Existing cycle-scoped tables remain the runtime
-- compatibility bridge while the tables below keep immutable plan snapshots.

begin;

-- Bound DDL lock waits without leaking session-wide settings. These values are
-- intentionally higher than the online RPC budgets below, because adding
-- constraints may inspect existing legacy rows during the QA-first rollout.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.training_cycles
  add column portal_scope text not null default 'usuario',
  add column current_plan_version integer not null default 0,
  add column current_plan_version_id uuid null,
  add column source_draft_id uuid null,
  add column source_cycle_id uuid null,
  add column extension_count integer not null default 0,
  add column closed_at timestamptz null,
  add column closed_reason text null,
  add constraint training_cycles_portal_scope_allowed
    check (portal_scope in ('usuario', 'coach')),
  add constraint training_cycles_current_plan_version_bounded
    check (current_plan_version between 0 and 256),
  add constraint training_cycles_extension_count_bounded
    check (extension_count between 0 and 256),
  add constraint training_cycles_closed_reason_allowed
    check (closed_reason is null or closed_reason in ('expired', 'manual'));

alter table public.training_cycles
  add constraint training_cycles_id_owner_portal_key
    unique (id, user_id, portal_scope),
  add constraint training_cycles_source_cycle_owner_portal_fk
    foreign key (source_cycle_id, user_id, portal_scope)
    references public.training_cycles(id, user_id, portal_scope)
    on delete no action
    deferrable initially deferred;

comment on column public.training_cycles.portal_scope is
  'Product portal context. Historical rows are Usuario; ownership remains auth.uid().';
comment on column public.training_cycles.current_plan_version_id is
  'Current immutable cycle-redesign plan snapshot. Null on legacy-only cycles.';

drop index if exists public.training_cycles_one_active_per_user_idx;
create unique index training_cycles_one_active_per_identity_portal_idx
  on public.training_cycles(user_id, portal_scope)
  where status = 'active' and deleted_at is null;

create index training_cycles_owner_portal_status_idx
  on public.training_cycles(user_id, portal_scope, status, created_at desc, id)
  where deleted_at is null;

-- Keep the legacy client path available, but prevent it from assigning any new
-- lifecycle/portal column. New redesign writes use the RPC boundary only.
revoke insert, update on table public.training_cycles from authenticated;
grant insert (
  user_id,
  name,
  cycle_number,
  cycle_type,
  goal,
  started_at,
  ended_at,
  status,
  plan_snapshot,
  summary_snapshot,
  duration_weeks,
  planned_start_date,
  planned_end_date
) on table public.training_cycles to authenticated;
grant update (
  status,
  ended_at,
  summary_snapshot
) on table public.training_cycles to authenticated;

alter table public.training_cycles enable row level security;
alter table public.training_cycles force row level security;

-- Keep the legacy INSERT/UPDATE shape intact for existing clients, while
-- enforcing the same ownership, resource and concurrency boundaries in the
-- database. This trigger also covers legacy SECURITY DEFINER creation RPCs:
-- those RPCs retain their API, but cannot bypass the bounded table write.
create function private.guard_training_cycle_legacy_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_is_direct_client boolean := current_user::pg_catalog.text in (
    'anon', 'authenticated', 'service_role'
  );
begin
  if current_user::pg_catalog.text = 'service_role' then
    raise exception 'training cycle direct service role write denied'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and v_actor_id is null then
    raise exception 'training cycle ownership denied' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if v_is_direct_client then
      if v_actor_id is null or new.user_id is distinct from v_actor_id then
        raise exception 'training cycle ownership denied' using errcode = '42501';
      end if;
      if new.portal_scope is distinct from 'usuario' then
        raise exception 'legacy training cycle writes require usuario portal'
          using errcode = '42501';
      end if;

      -- Canonical assignment is defense in depth for callers that still send
      -- the historical user_id field in their INSERT allowlist.
      new.user_id := v_actor_id;
      new.portal_scope := 'usuario';
    elsif v_actor_id is not null and new.user_id is distinct from v_actor_id then
      raise exception 'training cycle ownership denied' using errcode = '42501';
    end if;
  elsif v_is_direct_client then
    if v_actor_id is null
      or old.user_id is distinct from v_actor_id
      or new.user_id is distinct from v_actor_id
    then
      raise exception 'training cycle ownership denied' using errcode = '42501';
    end if;
    if old.portal_scope is distinct from 'usuario'
      or new.portal_scope is distinct from 'usuario'
    then
      raise exception 'legacy training cycle writes require usuario portal'
        using errcode = '42501';
    end if;

    new.user_id := v_actor_id;
    new.portal_scope := 'usuario';
  elsif v_actor_id is not null and new.user_id is distinct from v_actor_id then
    raise exception 'training cycle ownership denied' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and (
    pg_catalog.char_length(pg_catalog.btrim(new.name)) not between 1 and 120
    or new.name ~ '[[:cntrl:]]'
    or (
      new.cycle_type is not null
      and (
        pg_catalog.char_length(new.cycle_type) > 120
        or new.cycle_type ~ '[[:cntrl:]]'
      )
    )
    or (
      new.goal is not null
      and (
        pg_catalog.char_length(new.goal) > 120
        or new.goal ~ '[[:cntrl:]]'
      )
    )
    or new.cycle_number not between 1 and 1000000
    or (
      new.duration_weeks is not null
      and new.duration_weeks not between 1 and 105
    )
    or (
      new.planned_start_date is not null
      and new.planned_end_date is not null
      and new.planned_end_date - new.planned_start_date > 730
    )
  ) then
    raise exception 'invalid legacy training cycle fields' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    if pg_catalog.octet_length(new.plan_snapshot::pg_catalog.text) > 262144
      or (
        new.summary_snapshot is not null
        and pg_catalog.octet_length(new.summary_snapshot::pg_catalog.text) > 262144
      )
    then
      raise exception 'training cycle snapshot exceeds size limit' using errcode = '54000';
    end if;
  elsif (
    new.plan_snapshot is distinct from old.plan_snapshot
    and pg_catalog.octet_length(new.plan_snapshot::pg_catalog.text) > 262144
  ) or (
    new.summary_snapshot is distinct from old.summary_snapshot
    and new.summary_snapshot is not null
    and pg_catalog.octet_length(new.summary_snapshot::pg_catalog.text) > 262144
  ) then
    raise exception 'training cycle snapshot exceeds size limit' using errcode = '54000';
  end if;

  if tg_op = 'INSERT' then
    -- Same key format as the cycle-redesign RPC boundary. Advisory locks are
    -- transaction scoped and re-entrant when this trigger is reached through
    -- an already locked RPC.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'organizatech:cycle-redesign:'
          || new.user_id::pg_catalog.text || ':' || new.portal_scope,
        0
      )
    );

    if exists (
      select 1
      from public.training_cycles as cycle
      where cycle.user_id = new.user_id
        and cycle.portal_scope = new.portal_scope
      order by cycle.created_at, cycle.id
      offset 999
      limit 1
    ) then
      raise exception using errcode = '54000', message = 'training cycle limit reached';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function private.guard_training_cycle_legacy_write()
  from public, anon, authenticated, service_role;

create trigger training_cycles_guard_legacy_write
  before insert or update on public.training_cycles
  for each row execute function private.guard_training_cycle_legacy_write();

create table public.training_exercise_catalog (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  muscle_group text not null,
  default_video_url text null,
  is_active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint training_exercise_catalog_name_length check (
    char_length(btrim(canonical_name)) between 1 and 120
  ),
  constraint training_exercise_catalog_muscle_group_allowed check (
    muscle_group in (
      'pectoral', 'hombros', 'triceps', 'dorsal', 'biceps', 'trapecio',
      'cuadriceps', 'femoral', 'gluteos', 'pantorrillas',
      'pierna_completa', 'abdomen'
    )
  ),
  constraint training_exercise_catalog_video_length check (
    default_video_url is null
    or (
      char_length(default_video_url) between 19 and 500
      and default_video_url !~ '[[:cntrl:][:space:]]'
      and default_video_url ~ '^https://((www\.|m\.)?youtube\.com/(watch\?[^[:space:]]*v=[A-Za-z0-9_-]{6,64}[^[:space:]]*|shorts/[A-Za-z0-9_-]{6,64}[^[:space:]]*|embed/[A-Za-z0-9_-]{6,64}[^[:space:]]*)|youtu\.be/[A-Za-z0-9_-]{6,64}[^[:space:]]*)$'
    )
  ),
  constraint training_exercise_catalog_sort_order_bounded check (
    sort_order between 0 and 32767
  )
);

create unique index training_exercise_catalog_canonical_name_idx
  on public.training_exercise_catalog(lower(btrim(canonical_name)));
create index training_exercise_catalog_active_group_order_idx
  on public.training_exercise_catalog(muscle_group, sort_order, id)
  where is_active;

drop trigger if exists training_exercise_catalog_set_updated_at
  on public.training_exercise_catalog;
create trigger training_exercise_catalog_set_updated_at
  before update on public.training_exercise_catalog
  for each row execute function public.set_updated_at();

-- Historical lineages remain portal-neutral (NULL). Every source introduced by
-- the redesign is portal-scoped, so the same global catalog exercise resolves
-- to a different lineage in Usuario and Coach even for the same auth identity.
alter table public.training_exercise_lineages
  add column portal_scope text null,
  add constraint training_exercise_lineages_portal_scope_allowed
    check (portal_scope is null or portal_scope in ('usuario', 'coach')),
  add constraint training_exercise_lineages_id_owner_portal_key
    unique (id, user_id, portal_scope);

create table public.training_custom_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  portal_scope text not null,
  lineage_id uuid not null,
  name text not null,
  muscle_group text not null,
  video_url text null,
  archived_at timestamptz null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint training_custom_exercises_id_owner_portal_key
    unique (id, user_id, portal_scope),
  constraint training_custom_exercises_owner_portal_lineage_key
    unique (user_id, portal_scope, lineage_id),
  constraint training_custom_exercises_owner_lineage_fk
    foreign key (lineage_id, user_id, portal_scope)
    references public.training_exercise_lineages(id, user_id, portal_scope)
    on delete no action
    deferrable initially deferred,
  constraint training_custom_exercises_portal_scope_allowed
    check (portal_scope in ('usuario', 'coach')),
  constraint training_custom_exercises_name_length check (
    char_length(btrim(name)) between 1 and 120
  ),
  constraint training_custom_exercises_muscle_group_allowed check (
    muscle_group in (
      'pectoral', 'hombros', 'triceps', 'dorsal', 'biceps', 'trapecio',
      'cuadriceps', 'femoral', 'gluteos', 'pantorrillas',
      'pierna_completa', 'abdomen'
    )
  ),
  constraint training_custom_exercises_video_length check (
    video_url is null
    or (
      char_length(video_url) between 19 and 500
      and video_url !~ '[[:cntrl:][:space:]]'
      and video_url ~ '^https://((www\.|m\.)?youtube\.com/(watch\?[^[:space:]]*v=[A-Za-z0-9_-]{6,64}[^[:space:]]*|shorts/[A-Za-z0-9_-]{6,64}[^[:space:]]*|embed/[A-Za-z0-9_-]{6,64}[^[:space:]]*)|youtu\.be/[A-Za-z0-9_-]{6,64}[^[:space:]]*)$'
    )
  )
);

create unique index training_custom_exercises_owner_portal_name_idx
  on public.training_custom_exercises(user_id, portal_scope, lower(btrim(name)))
  where archived_at is null;
create index training_custom_exercises_owner_portal_created_idx
  on public.training_custom_exercises(user_id, portal_scope, created_at, id)
  where archived_at is null;

drop trigger if exists training_custom_exercises_set_updated_at
  on public.training_custom_exercises;
create trigger training_custom_exercises_set_updated_at
  before update on public.training_custom_exercises
  for each row execute function public.set_updated_at();

alter table public.training_exercise_lineages
  add column catalog_exercise_id uuid null
    references public.training_exercise_catalog(id) on delete restrict,
  add column custom_exercise_id uuid null
    references public.training_custom_exercises(id)
    on delete no action
    deferrable initially deferred,
  add constraint training_exercise_lineages_redesign_source_shape
    check (num_nonnulls(catalog_exercise_id, custom_exercise_id) <= 1),
  add constraint training_exercise_lineages_redesign_source_kind check (
    num_nonnulls(catalog_exercise_id, custom_exercise_id) = 0
    or (
      portal_scope is not null
      and origin_kind = 'scoped'
      and source_legacy_exercise_id is null
    )
  ),
  add constraint training_exercise_lineages_redesign_source_portal_shape check (
    portal_scope is not null
    or num_nonnulls(catalog_exercise_id, custom_exercise_id) = 0
  ),
  add constraint training_exercise_lineages_catalog_resolution_key
    unique (id, user_id, portal_scope, catalog_exercise_id),
  add constraint training_exercise_lineages_custom_resolution_key
    unique (id, user_id, portal_scope, custom_exercise_id);

create unique index training_exercise_lineages_owner_portal_catalog_idx
  on public.training_exercise_lineages(user_id, portal_scope, catalog_exercise_id)
  where catalog_exercise_id is not null;
create unique index training_exercise_lineages_owner_portal_custom_idx
  on public.training_exercise_lineages(user_id, portal_scope, custom_exercise_id)
  where custom_exercise_id is not null;

-- Preserve the historical table-level INSERT contract, while making the two
-- new identity columns server-only. Existing legacy/scoped inserts continue
-- with both columns null; cycle-redesign SECURITY DEFINER RPCs run as owner.
create function private.guard_training_exercise_lineage_redesign_source_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
begin
  -- Preserve referential account deletion. A direct application DELETE enters
  -- at trigger depth 1 and remains denied below.
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;

  if current_user::pg_catalog.text = 'service_role' then
    raise exception 'training exercise lineage direct service role write denied'
      using errcode = '42501';
  end if;

  if current_user::pg_catalog.text in ('anon', 'authenticated') then
    if v_actor_id is null then
      raise exception 'training exercise lineage ownership denied'
        using errcode = '42501';
    end if;

    if tg_op = 'DELETE' then
      raise exception 'training exercise lineage direct delete denied'
        using errcode = '42501';
    elsif tg_op = 'INSERT' then
      if new.user_id is distinct from v_actor_id then
        raise exception 'training exercise lineage ownership denied'
          using errcode = '42501';
      end if;
      if new.portal_scope is not null
        or pg_catalog.num_nonnulls(new.catalog_exercise_id, new.custom_exercise_id) > 0
      then
        raise exception 'training exercise redesign source is server assigned'
          using errcode = '42501';
      end if;
    elsif old.user_id is distinct from v_actor_id
      or new.user_id is distinct from v_actor_id
    then
      raise exception 'training exercise lineage ownership denied'
        using errcode = '42501';
    elsif new.portal_scope is distinct from old.portal_scope
      or new.catalog_exercise_id is distinct from old.catalog_exercise_id
      or new.custom_exercise_id is distinct from old.custom_exercise_id
    then
      raise exception 'training exercise redesign source is server assigned'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_training_exercise_lineage_redesign_source_write()
  from public, anon, authenticated, service_role;

create trigger training_exercise_lineages_guard_redesign_source_write
  before insert or update or delete on public.training_exercise_lineages
  for each row execute function private.guard_training_exercise_lineage_redesign_source_write();

-- The legacy browser contract only needs portal-neutral lineage rows. Rebuild
-- its three existing policies with the prior relational ownership predicates
-- plus portal_scope IS NULL. This keeps redesign identifiers out of the legacy
-- channel while preserving its exact SELECT/INSERT/UPDATE API.
drop policy if exists "lineages own rows select"
  on public.training_exercise_lineages;
drop policy if exists "lineages own rows insert"
  on public.training_exercise_lineages;
drop policy if exists "lineages own rows update"
  on public.training_exercise_lineages;

create policy "lineages own rows select"
  on public.training_exercise_lineages
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and portal_scope is null
    and (
      (
        origin_kind = 'legacy'
        and source_legacy_exercise_id is not null
        and origin_training_cycle_exercise_id is null
        and exists (
          select 1
          from public.exercises e
          where e.id = source_legacy_exercise_id
            and e.user_id = (select auth.uid())
        )
      )
      or
      (
        origin_kind = 'scoped'
        and source_legacy_exercise_id is null
        and (
          origin_training_cycle_exercise_id is null
          or exists (
            select 1
            from public.training_cycle_exercises tce
            where tce.id = origin_training_cycle_exercise_id
              and tce.user_id = (select auth.uid())
              and tce.exercise_lineage_id = training_exercise_lineages.id
          )
        )
      )
    )
  );

create policy "lineages own rows insert"
  on public.training_exercise_lineages
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and portal_scope is null
    and (
      (
        origin_kind = 'legacy'
        and source_legacy_exercise_id is not null
        and origin_training_cycle_exercise_id is null
        and exists (
          select 1
          from public.exercises e
          where e.id = source_legacy_exercise_id
            and e.user_id = (select auth.uid())
        )
      )
      or
      (
        origin_kind = 'scoped'
        and source_legacy_exercise_id is null
        and (
          origin_training_cycle_exercise_id is null
          or exists (
            select 1
            from public.training_cycle_exercises tce
            where tce.id = origin_training_cycle_exercise_id
              and tce.user_id = (select auth.uid())
              and tce.exercise_lineage_id = training_exercise_lineages.id
          )
        )
      )
    )
  );

create policy "lineages own rows update"
  on public.training_exercise_lineages
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and portal_scope is null
    and (
      (
        origin_kind = 'legacy'
        and source_legacy_exercise_id is not null
        and origin_training_cycle_exercise_id is null
        and exists (
          select 1
          from public.exercises e
          where e.id = source_legacy_exercise_id
            and e.user_id = (select auth.uid())
        )
      )
      or
      (
        origin_kind = 'scoped'
        and source_legacy_exercise_id is null
        and (
          origin_training_cycle_exercise_id is null
          or exists (
            select 1
            from public.training_cycle_exercises tce
            where tce.id = origin_training_cycle_exercise_id
              and tce.user_id = (select auth.uid())
              and tce.exercise_lineage_id = training_exercise_lineages.id
          )
        )
      )
    )
  )
  with check (
    user_id = (select auth.uid())
    and portal_scope is null
    and (
      (
        origin_kind = 'legacy'
        and source_legacy_exercise_id is not null
        and origin_training_cycle_exercise_id is null
        and exists (
          select 1
          from public.exercises e
          where e.id = source_legacy_exercise_id
            and e.user_id = (select auth.uid())
        )
      )
      or
      (
        origin_kind = 'scoped'
        and source_legacy_exercise_id is null
        and (
          origin_training_cycle_exercise_id is null
          or exists (
            select 1
            from public.training_cycle_exercises tce
            where tce.id = origin_training_cycle_exercise_id
              and tce.user_id = (select auth.uid())
              and tce.exercise_lineage_id = training_exercise_lineages.id
          )
        )
      )
    )
  );

revoke insert, update, delete on public.training_exercise_lineages
  from service_role;

-- Custom exercise creation is intentionally two-step because the two rows
-- reference one another. Validate the final transaction state, not the
-- intermediate INSERT, so a scoped lineage can never commit without exactly
-- one catalog/custom source.
create function private.enforce_training_exercise_lineage_portal_source()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_portal_scope text;
  v_source_count integer;
begin
  select
    lineage.portal_scope,
    pg_catalog.num_nonnulls(
      lineage.catalog_exercise_id,
      lineage.custom_exercise_id
    )
  into v_portal_scope, v_source_count
  from public.training_exercise_lineages as lineage
  where lineage.id = new.id;

  if v_portal_scope is not null and v_source_count <> 1 then
    raise exception 'portal lineage requires exactly one scoped source'
      using errcode = '23514';
  end if;
  return null;
end;
$function$;

revoke all on function private.enforce_training_exercise_lineage_portal_source()
  from public, anon, authenticated, service_role;

create constraint trigger training_exercise_lineages_enforce_portal_source
  after insert or update on public.training_exercise_lineages
  deferrable initially deferred
  for each row execute function private.enforce_training_exercise_lineage_portal_source();

create table public.training_cycle_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  portal_scope text not null,
  origin text not null,
  source_cycle_id uuid null,
  state text not null default 'draft',
  current_version integer not null default 1,
  activated_cycle_id uuid null,
  discarded_at timestamptz null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint training_cycle_drafts_id_owner_key unique (id, user_id),
  constraint training_cycle_drafts_id_owner_portal_key
    unique (id, user_id, portal_scope),
  constraint training_cycle_drafts_source_cycle_owner_portal_fk
    foreign key (source_cycle_id, user_id, portal_scope)
    references public.training_cycles(id, user_id, portal_scope)
    on delete no action
    deferrable initially deferred,
  constraint training_cycle_drafts_activated_cycle_owner_portal_fk
    foreign key (activated_cycle_id, user_id, portal_scope)
    references public.training_cycles(id, user_id, portal_scope)
    on delete no action
    deferrable initially deferred,
  constraint training_cycle_drafts_portal_scope_allowed
    check (portal_scope in ('usuario', 'coach')),
  constraint training_cycle_drafts_origin_allowed
    check (origin in ('manual', 'suggested', 'duplicate', 'renewal')),
  constraint training_cycle_drafts_state_allowed
    check (state in ('draft', 'activated', 'discarded')),
  constraint training_cycle_drafts_version_bounded
    check (current_version between 1 and 256),
  constraint training_cycle_drafts_state_shape check (
    (state = 'draft' and activated_cycle_id is null and discarded_at is null)
    or (state = 'activated' and activated_cycle_id is not null and discarded_at is null)
    or (state = 'discarded' and activated_cycle_id is null and discarded_at is not null)
  )
);

create unique index training_cycle_drafts_one_open_per_identity_portal_idx
  on public.training_cycle_drafts(user_id, portal_scope)
  where state = 'draft';
create index training_cycle_drafts_owner_portal_updated_idx
  on public.training_cycle_drafts(user_id, portal_scope, updated_at desc, id);

drop trigger if exists training_cycle_drafts_set_updated_at
  on public.training_cycle_drafts;
create trigger training_cycle_drafts_set_updated_at
  before update on public.training_cycle_drafts
  for each row execute function public.set_updated_at();

create table public.training_cycle_draft_versions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null,
  user_id uuid not null,
  portal_scope text not null,
  version integer not null,
  request_id uuid not null,
  operation_kind text not null,
  goal text not null,
  start_date date not null,
  end_date date not null,
  plan_payload jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint training_cycle_draft_versions_id_owner_key unique (id, user_id),
  constraint training_cycle_draft_versions_draft_owner_portal_fk
    foreign key (draft_id, user_id, portal_scope)
    references public.training_cycle_drafts(id, user_id, portal_scope)
    on delete cascade,
  constraint training_cycle_draft_versions_draft_version_key
    unique (draft_id, version),
  constraint training_cycle_draft_versions_owner_request_key
    unique (user_id, request_id),
  constraint training_cycle_draft_versions_portal_scope_allowed
    check (portal_scope in ('usuario', 'coach')),
  constraint training_cycle_draft_versions_operation_allowed
    check (operation_kind in ('create', 'save', 'duplicate', 'renewal')),
  constraint training_cycle_draft_versions_goal_allowed
    check (goal in ('strength', 'volume', 'definition', 'deload')),
  constraint training_cycle_draft_versions_version_bounded
    check (version between 1 and 256),
  constraint training_cycle_draft_versions_dates_valid check (
    end_date > start_date and end_date - start_date <= 730
  ),
  constraint training_cycle_draft_versions_payload_object check (
    jsonb_typeof(plan_payload) = 'object'
  ),
  constraint training_cycle_draft_versions_payload_size check (
    octet_length(plan_payload::text) <= 262144
  )
);

create index training_cycle_draft_versions_draft_created_idx
  on public.training_cycle_draft_versions(draft_id, version desc, id);

create table public.training_cycle_plan_versions (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null,
  user_id uuid not null,
  portal_scope text not null,
  version integer not null,
  request_id uuid not null,
  change_kind text not null,
  goal text not null,
  start_date date not null,
  end_date date not null,
  source_version_id uuid null,
  plan_payload jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint training_cycle_plan_versions_id_owner_key unique (id, user_id),
  constraint training_cycle_plan_versions_id_cycle_key unique (id, cycle_id),
  constraint training_cycle_plan_versions_id_cycle_owner_key
    unique (id, cycle_id, user_id),
  constraint training_cycle_plan_versions_id_cycle_owner_portal_key
    unique (id, cycle_id, user_id, portal_scope),
  constraint training_cycle_plan_versions_cycle_owner_fk
    foreign key (cycle_id, user_id)
    references public.training_cycles(id, user_id)
    on delete cascade,
  constraint training_cycle_plan_versions_cycle_owner_portal_fk
    foreign key (cycle_id, user_id, portal_scope)
    references public.training_cycles(id, user_id, portal_scope)
    on delete cascade,
  constraint training_cycle_plan_versions_cycle_version_key
    unique (cycle_id, version),
  constraint training_cycle_plan_versions_owner_request_key
    unique (user_id, request_id),
  constraint training_cycle_plan_versions_source_cycle_owner_portal_fk
    foreign key (source_version_id, cycle_id, user_id, portal_scope)
    references public.training_cycle_plan_versions(id, cycle_id, user_id, portal_scope)
    on delete no action
    deferrable initially deferred,
  constraint training_cycle_plan_versions_portal_scope_allowed
    check (portal_scope in ('usuario', 'coach')),
  constraint training_cycle_plan_versions_change_kind_allowed
    check (change_kind in ('activation', 'edit', 'extension')),
  constraint training_cycle_plan_versions_goal_allowed
    check (goal in ('strength', 'volume', 'definition', 'deload')),
  constraint training_cycle_plan_versions_version_bounded
    check (version between 1 and 256),
  constraint training_cycle_plan_versions_dates_valid check (
    end_date > start_date and end_date - start_date <= 730
  ),
  constraint training_cycle_plan_versions_payload_object check (
    jsonb_typeof(plan_payload) = 'object'
  ),
  constraint training_cycle_plan_versions_payload_size check (
    octet_length(plan_payload::text) <= 262144
  )
);

create index training_cycle_plan_versions_cycle_created_idx
  on public.training_cycle_plan_versions(cycle_id, version desc, id);

alter table public.training_cycles
  add constraint training_cycles_current_plan_version_owner_portal_fk
    foreign key (current_plan_version_id, id, user_id, portal_scope)
    references public.training_cycle_plan_versions(id, cycle_id, user_id, portal_scope)
    on delete no action
    deferrable initially deferred,
  add constraint training_cycles_source_draft_owner_portal_fk
    foreign key (source_draft_id, user_id, portal_scope)
    references public.training_cycle_drafts(id, user_id, portal_scope)
    on delete no action
    deferrable initially deferred,
  add constraint training_cycles_current_plan_shape check (
    (current_plan_version = 0 and current_plan_version_id is null)
    or (current_plan_version between 1 and 256 and current_plan_version_id is not null)
  );

alter table public.training_cycle_exercises
  add constraint training_cycle_exercises_id_cycle_id_unique unique (id, cycle_id);

create table public.training_cycle_plan_days (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null,
  cycle_id uuid not null,
  user_id uuid not null,
  day_code text not null,
  routine_name text not null,
  sort_order smallint not null,
  legacy_cycle_day_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint training_cycle_plan_days_id_version_key unique (id, version_id),
  constraint training_cycle_plan_days_id_version_cycle_owner_key
    unique (id, version_id, cycle_id, user_id),
  constraint training_cycle_plan_days_version_owner_fk
    foreign key (version_id, user_id)
    references public.training_cycle_plan_versions(id, user_id)
    on delete cascade,
  constraint training_cycle_plan_days_version_cycle_owner_fk
    foreign key (version_id, cycle_id, user_id)
    references public.training_cycle_plan_versions(id, cycle_id, user_id)
    on delete cascade,
  constraint training_cycle_plan_days_cycle_owner_fk
    foreign key (cycle_id, user_id)
    references public.training_cycles(id, user_id)
    on delete cascade,
  constraint training_cycle_plan_days_legacy_cycle_fk
    foreign key (legacy_cycle_day_id, cycle_id)
    references public.training_cycle_days(id, cycle_id)
    on delete no action
    deferrable initially deferred,
  constraint training_cycle_plan_days_version_day_key unique (version_id, day_code),
  constraint training_cycle_plan_days_day_code_allowed check (
    day_code in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
  ),
  constraint training_cycle_plan_days_name_length check (
    char_length(btrim(routine_name)) between 0 and 120
  ),
  constraint training_cycle_plan_days_sort_order_bounded check (
    sort_order between 0 and 6
  )
);

create index training_cycle_plan_days_version_order_idx
  on public.training_cycle_plan_days(version_id, sort_order, id);

create table public.training_cycle_plan_exercises (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null,
  day_id uuid not null,
  cycle_id uuid not null,
  user_id uuid not null,
  portal_scope text not null,
  catalog_exercise_id uuid null references public.training_exercise_catalog(id) on delete restrict,
  custom_exercise_id uuid null,
  exercise_lineage_id uuid not null,
  name_snapshot text not null,
  muscle_group_snapshot text not null,
  sort_order smallint not null,
  technique text not null,
  video_url_snapshot text null,
  legacy_cycle_exercise_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint training_cycle_plan_exercises_id_version_key unique (id, version_id),
  constraint training_cycle_plan_exercises_execution_reference_key
    unique (id, version_id, cycle_id, user_id, portal_scope),
  constraint training_cycle_plan_exercises_version_owner_fk
    foreign key (version_id, user_id)
    references public.training_cycle_plan_versions(id, user_id)
    on delete cascade,
  constraint training_cycle_plan_exercises_version_cycle_owner_portal_fk
    foreign key (version_id, cycle_id, user_id, portal_scope)
    references public.training_cycle_plan_versions(id, cycle_id, user_id, portal_scope)
    on delete cascade,
  constraint training_cycle_plan_exercises_day_version_fk
    foreign key (day_id, version_id)
    references public.training_cycle_plan_days(id, version_id)
    on delete cascade,
  constraint training_cycle_plan_exercises_day_version_cycle_owner_fk
    foreign key (day_id, version_id, cycle_id, user_id)
    references public.training_cycle_plan_days(id, version_id, cycle_id, user_id)
    on delete cascade,
  constraint training_cycle_plan_exercises_cycle_owner_fk
    foreign key (cycle_id, user_id)
    references public.training_cycles(id, user_id)
    on delete cascade,
  constraint training_cycle_plan_exercises_custom_owner_portal_fk
    foreign key (custom_exercise_id, user_id, portal_scope)
    references public.training_custom_exercises(id, user_id, portal_scope)
    on delete no action
    deferrable initially deferred,
  constraint training_cycle_plan_exercises_lineage_owner_fk
    foreign key (user_id, exercise_lineage_id)
    references public.training_exercise_lineages(user_id, id)
    on delete no action
    deferrable initially deferred,
  constraint training_cycle_plan_exercises_lineage_owner_portal_fk
    foreign key (exercise_lineage_id, user_id, portal_scope)
    references public.training_exercise_lineages(id, user_id, portal_scope)
    on delete no action
    deferrable initially deferred,
  constraint training_cycle_plan_exercises_catalog_lineage_resolution_fk
    foreign key (
      exercise_lineage_id,
      user_id,
      portal_scope,
      catalog_exercise_id
    ) references public.training_exercise_lineages(
      id,
      user_id,
      portal_scope,
      catalog_exercise_id
    )
    on delete no action
    deferrable initially deferred,
  constraint training_cycle_plan_exercises_custom_lineage_resolution_fk
    foreign key (
      exercise_lineage_id,
      user_id,
      portal_scope,
      custom_exercise_id
    ) references public.training_exercise_lineages(
      id,
      user_id,
      portal_scope,
      custom_exercise_id
    )
    on delete no action
    deferrable initially deferred,
  constraint training_cycle_plan_exercises_legacy_cycle_fk
    foreign key (legacy_cycle_exercise_id, cycle_id)
    references public.training_cycle_exercises(id, cycle_id)
    on delete no action
    deferrable initially deferred,
  constraint training_cycle_plan_exercises_source_shape check (
    num_nonnulls(catalog_exercise_id, custom_exercise_id) = 1
  ),
  constraint training_cycle_plan_exercises_portal_scope_allowed
    check (portal_scope in ('usuario', 'coach')),
  constraint training_cycle_plan_exercises_name_length check (
    char_length(btrim(name_snapshot)) between 1 and 120
  ),
  constraint training_cycle_plan_exercises_muscle_group_allowed check (
    muscle_group_snapshot in (
      'pectoral', 'hombros', 'triceps', 'dorsal', 'biceps', 'trapecio',
      'cuadriceps', 'femoral', 'gluteos', 'pantorrillas',
      'pierna_completa', 'abdomen'
    )
  ),
  constraint training_cycle_plan_exercises_sort_order_bounded check (
    sort_order between 0 and 199
  ),
  constraint training_cycle_plan_exercises_technique_allowed check (
    technique in ('linear', 'ascending', 'descending', 'drop_set', 'failure')
  ),
  constraint training_cycle_plan_exercises_video_length check (
    video_url_snapshot is null
    or (
      char_length(video_url_snapshot) between 19 and 500
      and video_url_snapshot !~ '[[:cntrl:][:space:]]'
      and video_url_snapshot ~ '^https://((www\.|m\.)?youtube\.com/(watch\?[^[:space:]]*v=[A-Za-z0-9_-]{6,64}[^[:space:]]*|shorts/[A-Za-z0-9_-]{6,64}[^[:space:]]*|embed/[A-Za-z0-9_-]{6,64}[^[:space:]]*)|youtu\.be/[A-Za-z0-9_-]{6,64}[^[:space:]]*)$'
    )
  ),
  constraint training_cycle_plan_exercises_version_order_key
    unique (day_id, sort_order)
);

create index training_cycle_plan_exercises_version_order_idx
  on public.training_cycle_plan_exercises(version_id, day_id, sort_order, id);
create index training_cycle_plan_exercises_lineage_idx
  on public.training_cycle_plan_exercises(user_id, exercise_lineage_id, created_at desc);

create table public.training_cycle_plan_sets (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null,
  exercise_id uuid not null,
  user_id uuid not null,
  sort_order smallint not null,
  target_reps smallint not null,
  target_kg numeric(8,2) not null,
  to_failure boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  constraint training_cycle_plan_sets_id_version_exercise_owner_key
    unique (id, version_id, exercise_id, user_id),
  constraint training_cycle_plan_sets_version_owner_fk
    foreign key (version_id, user_id)
    references public.training_cycle_plan_versions(id, user_id)
    on delete cascade,
  constraint training_cycle_plan_sets_exercise_version_fk
    foreign key (exercise_id, version_id)
    references public.training_cycle_plan_exercises(id, version_id)
    on delete cascade,
  constraint training_cycle_plan_sets_sort_order_bounded check (
    sort_order between 0 and 19
  ),
  constraint training_cycle_plan_sets_reps_bounded check (
    target_reps between 1 and 1000
  ),
  constraint training_cycle_plan_sets_kg_bounded check (
    target_kg between 0 and 99999.99
  ),
  constraint training_cycle_plan_sets_exercise_order_key
    unique (exercise_id, sort_order)
);

create index training_cycle_plan_sets_version_exercise_order_idx
  on public.training_cycle_plan_sets(version_id, exercise_id, sort_order, id);

create table public.training_cycle_plan_drops (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null,
  exercise_id uuid not null,
  set_id uuid not null references public.training_cycle_plan_sets(id) on delete cascade,
  user_id uuid not null,
  sort_order smallint not null,
  kg numeric(8,2) not null,
  reps smallint not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint training_cycle_plan_drops_execution_reference_key
    unique (id, set_id, exercise_id, version_id, user_id),
  constraint training_cycle_plan_drops_version_owner_fk
    foreign key (version_id, user_id)
    references public.training_cycle_plan_versions(id, user_id)
    on delete cascade,
  constraint training_cycle_plan_drops_exercise_version_fk
    foreign key (exercise_id, version_id)
    references public.training_cycle_plan_exercises(id, version_id)
    on delete cascade,
  constraint training_cycle_plan_drops_set_version_exercise_owner_fk
    foreign key (set_id, version_id, exercise_id, user_id)
    references public.training_cycle_plan_sets(id, version_id, exercise_id, user_id)
    on delete cascade,
  constraint training_cycle_plan_drops_sort_order_bounded check (
    sort_order between 0 and 7
  ),
  constraint training_cycle_plan_drops_kg_bounded check (
    kg between 0 and 99999.99
  ),
  constraint training_cycle_plan_drops_reps_bounded check (
    reps between 1 and 1000
  ),
  constraint training_cycle_plan_drops_set_order_key
    unique (set_id, sort_order)
);

create index training_cycle_plan_drops_version_set_order_idx
  on public.training_cycle_plan_drops(version_id, set_id, sort_order, id);

create table public.training_cycle_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  portal_scope text not null,
  cycle_id uuid not null,
  end_date_snapshot date not null,
  event_kind text not null,
  scheduled_on date not null,
  title text not null,
  body text not null,
  materialized_at timestamptz null,
  read_at timestamptz null,
  superseded_at timestamptz null,
  created_at timestamptz not null default statement_timestamp(),
  constraint training_cycle_notifications_delivery_reference_key
    unique (id, user_id, portal_scope, cycle_id),
  constraint training_cycle_notifications_cycle_owner_fk
    foreign key (cycle_id, user_id)
    references public.training_cycles(id, user_id)
    on delete cascade,
  constraint training_cycle_notifications_cycle_owner_portal_fk
    foreign key (cycle_id, user_id, portal_scope)
    references public.training_cycles(id, user_id, portal_scope)
    on delete cascade,
  constraint training_cycle_notifications_portal_scope_allowed
    check (portal_scope in ('usuario', 'coach')),
  constraint training_cycle_notifications_event_kind_allowed
    check (event_kind in ('expires_t3', 'expires_t2', 'expires_t1', 'expires_t0', 'closed_t1')),
  constraint training_cycle_notifications_title_length
    check (char_length(title) between 1 and 120),
  constraint training_cycle_notifications_body_length
    check (char_length(body) between 1 and 1000),
  constraint training_cycle_notifications_schedule_shape check (
    (event_kind = 'expires_t3' and scheduled_on = end_date_snapshot - 3)
    or (event_kind = 'expires_t2' and scheduled_on = end_date_snapshot - 2)
    or (event_kind = 'expires_t1' and scheduled_on = end_date_snapshot - 1)
    or (event_kind = 'expires_t0' and scheduled_on = end_date_snapshot)
    or (event_kind = 'closed_t1' and scheduled_on = end_date_snapshot + 1)
  ),
  constraint training_cycle_notifications_event_key
    unique (cycle_id, end_date_snapshot, event_kind)
);

create index training_cycle_notifications_owner_portal_inbox_idx
  on public.training_cycle_notifications(user_id, portal_scope, materialized_at desc, id desc)
  where materialized_at is not null and superseded_at is null;
create index training_cycle_notifications_due_idx
  on public.training_cycle_notifications(scheduled_on, cycle_id, id)
  where materialized_at is null and superseded_at is null;

-- Bell materialization lives in the public notification row. Email delivery is
-- a separate private ledger so a provider retry can never duplicate or roll
-- back the bell state.
create table private.training_cycle_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  portal_scope text not null,
  cycle_id uuid not null,
  idempotency_key uuid not null unique,
  status text not null default 'pending',
  attempt_count smallint not null default 0,
  attempt_token uuid null,
  claimed_at timestamptz null,
  provider_message_id text null,
  provider_error_code text null,
  sent_at timestamptz null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint training_cycle_notification_deliveries_notification_unique
    unique (notification_id),
  constraint training_cycle_notification_deliveries_notification_owner_fk
    foreign key (notification_id, user_id, portal_scope, cycle_id)
    references public.training_cycle_notifications(id, user_id, portal_scope, cycle_id)
    on delete cascade,
  constraint training_cycle_notification_deliveries_portal_scope_allowed
    check (portal_scope in ('usuario', 'coach')),
  constraint training_cycle_notification_deliveries_status_allowed check (
    status in ('pending', 'sending', 'sent', 'failed', 'rejected', 'ambiguous')
  ),
  constraint training_cycle_notification_deliveries_attempts_bounded
    check (attempt_count between 0 and 3),
  constraint training_cycle_notification_deliveries_claim_shape check (
    (status = 'sending' and attempt_token is not null and claimed_at is not null)
    or (status <> 'sending' and attempt_token is null)
  ),
  constraint training_cycle_notification_deliveries_provider_id check (
    provider_message_id is null
    or (
      char_length(provider_message_id) between 1 and 512
      and provider_message_id !~ '[\r\n]'
    )
  ),
  constraint training_cycle_notification_deliveries_error_code check (
    provider_error_code is null
    or provider_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  constraint training_cycle_notification_deliveries_terminal_shape check (
    (
      status in ('pending', 'sending')
      and provider_message_id is null
      and provider_error_code is null
      and sent_at is null
    )
    or (
      status = 'sent'
      and provider_message_id is not null
      and provider_error_code is null
      and sent_at is not null
    )
    or (
      status in ('failed', 'rejected', 'ambiguous')
      and provider_message_id is null
      and provider_error_code is not null
      and sent_at is null
    )
  )
);

create index training_cycle_notification_deliveries_claim_idx
  on private.training_cycle_notification_deliveries(status, updated_at, id)
  where status in ('pending', 'failed', 'sending');

create table private.training_cycle_lifecycle_checks (
  cycle_id uuid primary key,
  user_id uuid not null,
  portal_scope text not null,
  end_date_snapshot date not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_check_at timestamptz not null default statement_timestamp(),
  checked_at timestamptz null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint training_cycle_lifecycle_checks_cycle_owner_portal_fk
    foreign key (cycle_id, user_id, portal_scope)
    references public.training_cycles(id, user_id, portal_scope)
    on delete cascade,
  constraint training_cycle_lifecycle_checks_portal_scope_allowed
    check (portal_scope in ('usuario', 'coach')),
  constraint training_cycle_lifecycle_checks_status_allowed
    check (status in ('pending', 'protected', 'closed')),
  constraint training_cycle_lifecycle_checks_attempts_bounded
    check (attempt_count between 0 and 32767)
);

create index training_cycle_lifecycle_checks_due_idx
  on private.training_cycle_lifecycle_checks(next_check_at, cycle_id)
  where status in ('pending', 'protected');

-- Advanced workout execution is parallel to the legacy session/entry model.
-- It stores immutable, server-derived plan snapshots and actual set/drop data
-- for faithful weekly comparisons without changing either legacy table.
create table public.training_cycle_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  portal_scope text not null,
  cycle_id uuid not null,
  plan_version_id uuid not null,
  plan_version integer not null,
  plan_day_id uuid not null,
  request_id uuid not null,
  performed_at timestamptz not null,
  performed_on date not null,
  week_started_on date not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint training_cycle_executions_id_owner_portal_key
    unique (id, user_id, portal_scope),
  constraint training_cycle_executions_snapshot_reference_key
    unique (id, plan_version_id, cycle_id, user_id, portal_scope),
  constraint training_cycle_executions_owner_request_key
    unique (user_id, request_id),
  constraint training_cycle_executions_cycle_owner_portal_fk
    foreign key (cycle_id, user_id, portal_scope)
    references public.training_cycles(id, user_id, portal_scope)
    on delete cascade,
  constraint training_cycle_executions_version_owner_portal_fk
    foreign key (plan_version_id, cycle_id, user_id, portal_scope)
    references public.training_cycle_plan_versions(id, cycle_id, user_id, portal_scope)
    on delete no action
    deferrable initially deferred,
  constraint training_cycle_executions_day_version_cycle_owner_fk
    foreign key (plan_day_id, plan_version_id, cycle_id, user_id)
    references public.training_cycle_plan_days(id, version_id, cycle_id, user_id)
    on delete no action
    deferrable initially deferred,
  constraint training_cycle_executions_portal_scope_allowed
    check (portal_scope in ('usuario', 'coach')),
  constraint training_cycle_executions_version_bounded
    check (plan_version between 1 and 256),
  constraint training_cycle_executions_santiago_day check (
    performed_on = pg_catalog.timezone('America/Santiago', performed_at)::date
  ),
  constraint training_cycle_executions_iso_week check (
    week_started_on = performed_on
      - (extract(isodow from performed_on)::integer - 1)
  )
);

create index training_cycle_executions_owner_portal_week_idx
  on public.training_cycle_executions(
    user_id, portal_scope, week_started_on desc, performed_at desc, id desc
  );
create index training_cycle_executions_cycle_version_idx
  on public.training_cycle_executions(cycle_id, plan_version, performed_at, id);

create table public.training_cycle_execution_exercises (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null,
  plan_exercise_id uuid not null,
  plan_version_id uuid not null,
  cycle_id uuid not null,
  user_id uuid not null,
  portal_scope text not null,
  exercise_lineage_id uuid not null,
  name_snapshot text not null,
  muscle_group_snapshot text not null,
  technique_snapshot text not null,
  sort_order smallint not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint training_cycle_execution_exercises_reference_key
    unique (id, execution_id, plan_exercise_id, plan_version_id, user_id),
  constraint training_cycle_execution_exercises_execution_fk
    foreign key (execution_id, plan_version_id, cycle_id, user_id, portal_scope)
    references public.training_cycle_executions(
      id, plan_version_id, cycle_id, user_id, portal_scope
    )
    on delete cascade,
  constraint training_cycle_execution_exercises_plan_fk
    foreign key (plan_exercise_id, plan_version_id, cycle_id, user_id, portal_scope)
    references public.training_cycle_plan_exercises(
      id, version_id, cycle_id, user_id, portal_scope
    )
    on delete no action
    deferrable initially deferred,
  constraint training_cycle_execution_exercises_lineage_portal_fk
    foreign key (exercise_lineage_id, user_id, portal_scope)
    references public.training_exercise_lineages(id, user_id, portal_scope)
    on delete no action
    deferrable initially deferred,
  constraint training_cycle_execution_exercises_portal_scope_allowed
    check (portal_scope in ('usuario', 'coach')),
  constraint training_cycle_execution_exercises_name_length
    check (char_length(btrim(name_snapshot)) between 1 and 120),
  constraint training_cycle_execution_exercises_muscle_group_allowed check (
    muscle_group_snapshot in (
      'pectoral', 'hombros', 'triceps', 'dorsal', 'biceps', 'trapecio',
      'cuadriceps', 'femoral', 'gluteos', 'pantorrillas',
      'pierna_completa', 'abdomen'
    )
  ),
  constraint training_cycle_execution_exercises_technique_allowed check (
    technique_snapshot in ('linear', 'ascending', 'descending', 'drop_set', 'failure')
  ),
  constraint training_cycle_execution_exercises_order_bounded
    check (sort_order between 0 and 199),
  constraint training_cycle_execution_exercises_execution_order_key
    unique (execution_id, sort_order),
  constraint training_cycle_execution_exercises_plan_unique
    unique (execution_id, plan_exercise_id)
);

create index training_cycle_execution_exercises_lineage_weekly_idx
  on public.training_cycle_execution_exercises(user_id, portal_scope, exercise_lineage_id, execution_id);

create table public.training_cycle_execution_sets (
  id uuid primary key default gen_random_uuid(),
  execution_exercise_id uuid not null,
  execution_id uuid not null,
  plan_exercise_id uuid not null,
  plan_set_id uuid not null,
  plan_version_id uuid not null,
  user_id uuid not null,
  sort_order smallint not null,
  completed boolean not null,
  actual_reps smallint null,
  actual_kg numeric(8,2) null,
  reached_failure boolean not null default false,
  target_reps_snapshot smallint not null,
  target_kg_snapshot numeric(8,2) not null,
  planned_to_failure_snapshot boolean not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint training_cycle_execution_sets_reference_key
    unique (id, execution_exercise_id, execution_id, plan_set_id, user_id),
  constraint training_cycle_execution_sets_exercise_fk
    foreign key (
      execution_exercise_id,
      execution_id,
      plan_exercise_id,
      plan_version_id,
      user_id
    ) references public.training_cycle_execution_exercises(
      id,
      execution_id,
      plan_exercise_id,
      plan_version_id,
      user_id
    )
    on delete cascade,
  constraint training_cycle_execution_sets_plan_fk
    foreign key (plan_set_id, plan_version_id, plan_exercise_id, user_id)
    references public.training_cycle_plan_sets(id, version_id, exercise_id, user_id)
    on delete no action
    deferrable initially deferred,
  constraint training_cycle_execution_sets_order_bounded
    check (sort_order between 0 and 19),
  constraint training_cycle_execution_sets_actual_shape check (
    (
      completed
      and actual_reps is not null
      and actual_kg is not null
      and actual_reps between 1 and 1000
      and actual_kg between 0 and 99999.99
    )
    or (
      not completed
      and actual_reps is null
      and actual_kg is null
      and not reached_failure
    )
  ),
  constraint training_cycle_execution_sets_target_reps_bounded
    check (target_reps_snapshot between 1 and 1000),
  constraint training_cycle_execution_sets_target_kg_bounded
    check (target_kg_snapshot between 0 and 99999.99),
  constraint training_cycle_execution_sets_execution_order_key
    unique (execution_exercise_id, sort_order),
  constraint training_cycle_execution_sets_plan_unique
    unique (execution_exercise_id, plan_set_id)
);

create table public.training_cycle_execution_drops (
  id uuid primary key default gen_random_uuid(),
  execution_set_id uuid not null,
  execution_exercise_id uuid not null,
  execution_id uuid not null,
  plan_exercise_id uuid not null,
  plan_set_id uuid not null,
  plan_drop_id uuid not null,
  plan_version_id uuid not null,
  user_id uuid not null,
  sort_order smallint not null,
  completed boolean not null,
  actual_reps smallint null,
  actual_kg numeric(8,2) null,
  target_reps_snapshot smallint not null,
  target_kg_snapshot numeric(8,2) not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint training_cycle_execution_drops_set_fk
    foreign key (
      execution_set_id,
      execution_exercise_id,
      execution_id,
      plan_set_id,
      user_id
    ) references public.training_cycle_execution_sets(
      id,
      execution_exercise_id,
      execution_id,
      plan_set_id,
      user_id
    )
    on delete cascade,
  constraint training_cycle_execution_drops_plan_fk
    foreign key (plan_drop_id, plan_set_id, plan_exercise_id, plan_version_id, user_id)
    references public.training_cycle_plan_drops(id, set_id, exercise_id, version_id, user_id)
    on delete no action
    deferrable initially deferred,
  constraint training_cycle_execution_drops_order_bounded
    check (sort_order between 0 and 7),
  constraint training_cycle_execution_drops_actual_shape check (
    (
      completed
      and actual_reps is not null
      and actual_kg is not null
      and actual_reps between 1 and 1000
      and actual_kg between 0 and 99999.99
    )
    or (
      not completed
      and actual_reps is null
      and actual_kg is null
    )
  ),
  constraint training_cycle_execution_drops_target_reps_bounded
    check (target_reps_snapshot between 1 and 1000),
  constraint training_cycle_execution_drops_target_kg_bounded
    check (target_kg_snapshot between 0 and 99999.99),
  constraint training_cycle_execution_drops_execution_order_key
    unique (execution_set_id, sort_order),
  constraint training_cycle_execution_drops_plan_unique
    unique (execution_set_id, plan_drop_id)
);

create table private.training_cycle_operation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  portal_scope text not null,
  operation_kind text not null,
  payload_hash bytea not null,
  aggregate_id uuid not null,
  result_version integer null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (user_id, request_id),
  constraint training_cycle_operation_receipts_portal_scope_allowed
    check (portal_scope in ('usuario', 'coach')),
  constraint training_cycle_operation_receipts_operation_allowed check (
    operation_kind in (
      'custom_exercise_create', 'draft_create', 'draft_save', 'draft_duplicate',
      'draft_renewal', 'draft_discard', 'cycle_activate', 'cycle_edit',
      'cycle_extend', 'cycle_execution_record', 'notifications_mark_read'
    )
  ),
  constraint training_cycle_operation_receipts_hash_length
    check (octet_length(payload_hash) = 32),
  constraint training_cycle_operation_receipts_result_version_bounded
    check (result_version is null or result_version between 1 and 256)
);

create index training_cycle_operation_receipts_owner_portal_created_idx
  on private.training_cycle_operation_receipts(user_id, portal_scope, created_at, request_id);

-- Application-facing roles, including service_role, never write redesign
-- source/version/lifecycle/execution tables directly. The only narrow
-- exceptions are referential cascades and the migration owner executing audited
-- SECURITY DEFINER bodies; those functions derive auth.uid() for user mutations
-- or verify a Vault-backed capability for the scheduler boundary.
create function private.guard_cycle_redesign_server_owned_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;

  if current_user::pg_catalog.text in ('anon', 'authenticated', 'service_role') then
    raise exception 'cycle redesign direct write denied' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_cycle_redesign_server_owned_write()
  from public, anon, authenticated, service_role;

create function private.guard_training_cycle_execution_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE'
    or (tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() <= 1)
  then
    raise exception 'training cycle execution rows are append only'
      using errcode = '55000';
  end if;
  return old;
end;
$function$;

revoke all on function private.guard_training_cycle_execution_immutable()
  from public, anon, authenticated, service_role;

create trigger training_exercise_catalog_guard_server_owned_write
  before insert or update or delete on public.training_exercise_catalog
  for each row execute function private.guard_cycle_redesign_server_owned_write();
create trigger training_custom_exercises_guard_server_owned_write
  before insert or update or delete on public.training_custom_exercises
  for each row execute function private.guard_cycle_redesign_server_owned_write();
create trigger training_cycle_drafts_guard_server_owned_write
  before insert or update or delete on public.training_cycle_drafts
  for each row execute function private.guard_cycle_redesign_server_owned_write();
create trigger training_cycle_draft_versions_guard_server_owned_write
  before insert or update or delete on public.training_cycle_draft_versions
  for each row execute function private.guard_cycle_redesign_server_owned_write();
create trigger training_cycle_plan_versions_guard_server_owned_write
  before insert or update or delete on public.training_cycle_plan_versions
  for each row execute function private.guard_cycle_redesign_server_owned_write();
create trigger training_cycle_plan_days_guard_server_owned_write
  before insert or update or delete on public.training_cycle_plan_days
  for each row execute function private.guard_cycle_redesign_server_owned_write();
create trigger training_cycle_plan_exercises_guard_server_owned_write
  before insert or update or delete on public.training_cycle_plan_exercises
  for each row execute function private.guard_cycle_redesign_server_owned_write();
create trigger training_cycle_plan_sets_guard_server_owned_write
  before insert or update or delete on public.training_cycle_plan_sets
  for each row execute function private.guard_cycle_redesign_server_owned_write();
create trigger training_cycle_plan_drops_guard_server_owned_write
  before insert or update or delete on public.training_cycle_plan_drops
  for each row execute function private.guard_cycle_redesign_server_owned_write();
create trigger training_cycle_notifications_guard_server_owned_write
  before insert or update or delete on public.training_cycle_notifications
  for each row execute function private.guard_cycle_redesign_server_owned_write();
create trigger training_cycle_notification_deliveries_guard_server_owned_write
  before insert or update or delete on private.training_cycle_notification_deliveries
  for each row execute function private.guard_cycle_redesign_server_owned_write();
create trigger training_cycle_lifecycle_checks_guard_server_owned_write
  before insert or update or delete on private.training_cycle_lifecycle_checks
  for each row execute function private.guard_cycle_redesign_server_owned_write();
create trigger training_cycle_operation_receipts_guard_server_owned_write
  before insert or update or delete on private.training_cycle_operation_receipts
  for each row execute function private.guard_cycle_redesign_server_owned_write();

create trigger training_cycle_executions_guard_server_owned_write
  before insert or update or delete on public.training_cycle_executions
  for each row execute function private.guard_cycle_redesign_server_owned_write();
create trigger training_cycle_execution_exercises_guard_server_owned_write
  before insert or update or delete on public.training_cycle_execution_exercises
  for each row execute function private.guard_cycle_redesign_server_owned_write();
create trigger training_cycle_execution_sets_guard_server_owned_write
  before insert or update or delete on public.training_cycle_execution_sets
  for each row execute function private.guard_cycle_redesign_server_owned_write();
create trigger training_cycle_execution_drops_guard_server_owned_write
  before insert or update or delete on public.training_cycle_execution_drops
  for each row execute function private.guard_cycle_redesign_server_owned_write();

create trigger training_cycle_executions_guard_immutable
  before update or delete on public.training_cycle_executions
  for each row execute function private.guard_training_cycle_execution_immutable();
create trigger training_cycle_execution_exercises_guard_immutable
  before update or delete on public.training_cycle_execution_exercises
  for each row execute function private.guard_training_cycle_execution_immutable();
create trigger training_cycle_execution_sets_guard_immutable
  before update or delete on public.training_cycle_execution_sets
  for each row execute function private.guard_training_cycle_execution_immutable();
create trigger training_cycle_execution_drops_guard_immutable
  before update or delete on public.training_cycle_execution_drops
  for each row execute function private.guard_training_cycle_execution_immutable();

-- Public-schema defense in depth. All private cycle state remains accessible
-- only through bounded SECURITY DEFINER RPCs added in the following migration.
alter table public.training_exercise_catalog enable row level security;
alter table public.training_exercise_catalog force row level security;
alter table public.training_custom_exercises enable row level security;
alter table public.training_custom_exercises force row level security;
alter table public.training_cycle_drafts enable row level security;
alter table public.training_cycle_drafts force row level security;
alter table public.training_cycle_draft_versions enable row level security;
alter table public.training_cycle_draft_versions force row level security;
alter table public.training_cycle_plan_versions enable row level security;
alter table public.training_cycle_plan_versions force row level security;
alter table public.training_cycle_plan_days enable row level security;
alter table public.training_cycle_plan_days force row level security;
alter table public.training_cycle_plan_exercises enable row level security;
alter table public.training_cycle_plan_exercises force row level security;
alter table public.training_cycle_plan_sets enable row level security;
alter table public.training_cycle_plan_sets force row level security;
alter table public.training_cycle_plan_drops enable row level security;
alter table public.training_cycle_plan_drops force row level security;
alter table public.training_cycle_notifications enable row level security;
alter table public.training_cycle_notifications force row level security;
alter table public.training_cycle_executions enable row level security;
alter table public.training_cycle_executions force row level security;
alter table public.training_cycle_execution_exercises enable row level security;
alter table public.training_cycle_execution_exercises force row level security;
alter table public.training_cycle_execution_sets enable row level security;
alter table public.training_cycle_execution_sets force row level security;
alter table public.training_cycle_execution_drops enable row level security;
alter table public.training_cycle_execution_drops force row level security;
alter table private.training_cycle_notification_deliveries enable row level security;
alter table private.training_cycle_notification_deliveries force row level security;
alter table private.training_cycle_lifecycle_checks enable row level security;
alter table private.training_cycle_lifecycle_checks force row level security;
alter table private.training_cycle_operation_receipts enable row level security;
alter table private.training_cycle_operation_receipts force row level security;

create policy "training exercise catalog authenticated read"
  on public.training_exercise_catalog for select to authenticated
  using (is_active);
create policy "training custom exercises own read"
  on public.training_custom_exercises for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "training cycle drafts own read"
  on public.training_cycle_drafts for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "training cycle draft versions own read"
  on public.training_cycle_draft_versions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "training cycle plan versions own read"
  on public.training_cycle_plan_versions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "training cycle plan days own read"
  on public.training_cycle_plan_days for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "training cycle plan exercises own read"
  on public.training_cycle_plan_exercises for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "training cycle plan sets own read"
  on public.training_cycle_plan_sets for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "training cycle plan drops own read"
  on public.training_cycle_plan_drops for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "training cycle notifications own read"
  on public.training_cycle_notifications for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "training cycle executions own read"
  on public.training_cycle_executions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "training cycle execution exercises own read"
  on public.training_cycle_execution_exercises for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "training cycle execution sets own read"
  on public.training_cycle_execution_sets for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "training cycle execution drops own read"
  on public.training_cycle_execution_drops for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all privileges on table public.training_exercise_catalog
  from public, anon, authenticated, service_role;
revoke all privileges on table public.training_custom_exercises
  from public, anon, authenticated, service_role;
revoke all privileges on table public.training_cycle_drafts
  from public, anon, authenticated, service_role;
revoke all privileges on table public.training_cycle_draft_versions
  from public, anon, authenticated, service_role;
revoke all privileges on table public.training_cycle_plan_versions
  from public, anon, authenticated, service_role;
revoke all privileges on table public.training_cycle_plan_days
  from public, anon, authenticated, service_role;
revoke all privileges on table public.training_cycle_plan_exercises
  from public, anon, authenticated, service_role;
revoke all privileges on table public.training_cycle_plan_sets
  from public, anon, authenticated, service_role;
revoke all privileges on table public.training_cycle_plan_drops
  from public, anon, authenticated, service_role;
revoke all privileges on table public.training_cycle_notifications
  from public, anon, authenticated, service_role;
revoke all privileges on table public.training_cycle_executions
  from public, anon, authenticated, service_role;
revoke all privileges on table public.training_cycle_execution_exercises
  from public, anon, authenticated, service_role;
revoke all privileges on table public.training_cycle_execution_sets
  from public, anon, authenticated, service_role;
revoke all privileges on table public.training_cycle_execution_drops
  from public, anon, authenticated, service_role;
revoke all privileges on table private.training_cycle_notification_deliveries
  from public, anon, authenticated, service_role;
revoke all privileges on table private.training_cycle_lifecycle_checks
  from public, anon, authenticated, service_role;
revoke all privileges on table private.training_cycle_operation_receipts
  from public, anon, authenticated, service_role;

-- Exact prototype catalogue, kept curated and read-only for application roles.
insert into public.training_exercise_catalog (
  id, canonical_name, muscle_group, sort_order
)
values
  ('10000000-0000-4000-8000-000000000001', 'Press plano con barra', 'pectoral', 10),
  ('10000000-0000-4000-8000-000000000002', 'Press inclinado con mancuernas', 'pectoral', 20),
  ('10000000-0000-4000-8000-000000000003', 'Aperturas en polea', 'pectoral', 30),
  ('10000000-0000-4000-8000-000000000004', 'Press militar', 'hombros', 40),
  ('10000000-0000-4000-8000-000000000005', 'Elevaciones laterales', 'hombros', 50),
  ('10000000-0000-4000-8000-000000000006', 'Fondos en paralelas', 'triceps', 60),
  ('10000000-0000-4000-8000-000000000007', 'Extensión de tríceps en polea', 'triceps', 70),
  ('10000000-0000-4000-8000-000000000008', 'Jalón al pecho', 'dorsal', 80),
  ('10000000-0000-4000-8000-000000000009', 'Remo con barra', 'dorsal', 90),
  ('10000000-0000-4000-8000-000000000010', 'Curl bíceps con barra', 'biceps', 100),
  ('10000000-0000-4000-8000-000000000011', 'Sentadilla libre', 'cuadriceps', 110),
  ('10000000-0000-4000-8000-000000000012', 'Estocadas búlgaras', 'pierna_completa', 120),
  ('10000000-0000-4000-8000-000000000013', 'Extensión de cuádriceps', 'cuadriceps', 130),
  ('10000000-0000-4000-8000-000000000014', 'Peso muerto rumano', 'femoral', 140),
  ('10000000-0000-4000-8000-000000000015', 'Hip thrust', 'gluteos', 150),
  ('10000000-0000-4000-8000-000000000016', 'Patada de glúteo en polea', 'gluteos', 160),
  ('10000000-0000-4000-8000-000000000017', 'Elevación de talones sentado', 'pantorrillas', 170),
  ('10000000-0000-4000-8000-000000000018', 'Encogimientos con mancuernas', 'trapecio', 180),
  ('10000000-0000-4000-8000-000000000019', 'Plancha', 'abdomen', 190);

-- Transactional postcheck: abort the migration before COMMIT if a critical
-- isolation, direct-write or append-only boundary was not created exactly.
do $postcheck$
begin
  if pg_catalog.to_regclass('public.training_cycle_executions') is null
    or pg_catalog.to_regclass('private.training_cycle_notification_deliveries') is null
  then
    raise exception 'cycle redesign schema postcheck failed: missing ledger table';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_indexes as index_row
    where index_row.schemaname = 'public'
      and index_row.indexname = 'training_exercise_lineages_owner_portal_catalog_idx'
      and index_row.indexdef ~ '\(user_id, portal_scope, catalog_exercise_id\)'
  ) or not exists (
    select 1
    from pg_catalog.pg_indexes as index_row
    where index_row.schemaname = 'public'
      and index_row.indexname = 'training_exercise_lineages_owner_portal_custom_idx'
      and index_row.indexdef ~ '\(user_id, portal_scope, custom_exercise_id\)'
  ) then
    raise exception 'cycle redesign schema postcheck failed: portal lineage index';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_row
    where trigger_row.tgrelid = 'public.training_cycle_plan_versions'::pg_catalog.regclass
      and trigger_row.tgname = 'training_cycle_plan_versions_guard_server_owned_write'
      and not trigger_row.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_row
    where trigger_row.tgrelid = 'public.training_cycle_executions'::pg_catalog.regclass
      and trigger_row.tgname = 'training_cycle_executions_guard_immutable'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'cycle redesign schema postcheck failed: write guard';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_row
    where trigger_row.tgrelid = 'public.training_exercise_lineages'::pg_catalog.regclass
      and trigger_row.tgname = 'training_exercise_lineages_guard_redesign_source_write'
      and pg_catalog.pg_get_triggerdef(trigger_row.oid) ~ 'DELETE'
      and not trigger_row.tgisinternal
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_policy as policy_row
    where policy_row.polrelid = 'public.training_exercise_lineages'::pg_catalog.regclass
  ) <> 3
  or not exists (
    select 1
    from pg_catalog.pg_policy as policy_row
    where policy_row.polrelid = 'public.training_exercise_lineages'::pg_catalog.regclass
      and policy_row.polname = 'lineages own rows select'
      and policy_row.polcmd = 'r'
      and pg_catalog.pg_get_expr(
        policy_row.polqual,
        policy_row.polrelid
      ) ~* 'portal_scope IS NULL'
  ) or not exists (
    select 1
    from pg_catalog.pg_policy as policy_row
    where policy_row.polrelid = 'public.training_exercise_lineages'::pg_catalog.regclass
      and policy_row.polname = 'lineages own rows insert'
      and policy_row.polcmd = 'a'
      and pg_catalog.pg_get_expr(
        policy_row.polwithcheck,
        policy_row.polrelid
      ) ~* 'portal_scope IS NULL'
  ) or not exists (
    select 1
    from pg_catalog.pg_policy as policy_row
    where policy_row.polrelid = 'public.training_exercise_lineages'::pg_catalog.regclass
      and policy_row.polname = 'lineages own rows update'
      and policy_row.polcmd = 'w'
      and pg_catalog.pg_get_expr(
        policy_row.polqual,
        policy_row.polrelid
      ) ~* 'portal_scope IS NULL'
      and pg_catalog.pg_get_expr(
        policy_row.polwithcheck,
        policy_row.polrelid
      ) ~* 'portal_scope IS NULL'
  ) then
    raise exception 'cycle redesign schema postcheck failed: lineage client isolation';
  end if;

  if pg_catalog.has_table_privilege(
    'service_role',
    'public.training_cycle_plan_versions',
    'INSERT, UPDATE, DELETE'
  ) or pg_catalog.has_table_privilege(
    'service_role',
    'public.training_cycle_executions',
    'INSERT, UPDATE, DELETE'
  ) or pg_catalog.has_table_privilege(
    'service_role',
    'public.training_exercise_lineages',
    'INSERT, UPDATE, DELETE'
  ) then
    raise exception 'cycle redesign schema postcheck failed: service_role write privilege';
  end if;
end;
$postcheck$;

commit;
