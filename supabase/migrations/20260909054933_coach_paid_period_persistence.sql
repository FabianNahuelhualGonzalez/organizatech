-- Local, explicitly confirmed commercial facts. No payment processor, training
-- access, acceptance, automatic renewal, monthly snapshot or alert delivery.
-- Depends on coach_invitation_persistence's real episode and membership lock.
begin;

create table private.coach_paid_period_registers (
  episode_id uuid primary key,
  coach_user_id uuid not null,
  version uuid not null check (version <> '00000000-0000-0000-0000-000000000000'::uuid),
  unique (episode_id, coach_user_id),
  foreign key (episode_id, coach_user_id)
    references private.coach_relationship_episodes(id, coach_user_id) on delete cascade
);

create table private.coach_paid_periods (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null,
  coach_user_id uuid not null,
  starts_on date not null check (starts_on between date '0001-01-01' and date '9999-12-31'),
  ends_on date not null check (ends_on between date '0001-01-01' and date '9999-12-31' and ends_on > starts_on),
  confirmed_at timestamptz not null,
  corrected_at timestamptz,
  check (corrected_at is null or corrected_at >= confirmed_at),
  unique (id, episode_id, coach_user_id),
  unique (episode_id, starts_on),
  foreign key (episode_id, coach_user_id)
    references private.coach_paid_period_registers(episode_id, coach_user_id) on delete cascade
);

-- Append-only through the API. Each correction retains its previous dates;
-- immutable receipts permit reconciliation without creating another period.
create table private.coach_paid_period_operations (
  coach_user_id uuid not null,
  request_id uuid not null,
  episode_id uuid not null,
  period_id uuid not null,
  action text not null check (action in ('confirm', 'correct')),
  expected_version uuid not null,
  result_version uuid not null,
  previous_start date,
  previous_end date,
  starts_on date not null check (starts_on between date '0001-01-01' and date '9999-12-31'),
  ends_on date not null check (ends_on between date '0001-01-01' and date '9999-12-31' and ends_on > starts_on),
  recorded_at timestamptz not null,
  primary key (coach_user_id, request_id),
  unique (episode_id, result_version),
  check (result_version <> expected_version and result_version <> '00000000-0000-0000-0000-000000000000'::uuid),
  check ((action = 'confirm' and previous_start is null and previous_end is null)
    or (action = 'correct' and previous_start is not null and previous_end is not null and previous_end > previous_start)),
  foreign key (period_id, episode_id, coach_user_id)
    references private.coach_paid_periods(id, episode_id, coach_user_id) on delete cascade
);
create index coach_paid_period_operations_history on private.coach_paid_period_operations(episode_id, recorded_at, request_id);

alter table private.coach_paid_period_registers enable row level security;
alter table private.coach_paid_period_registers force row level security;
alter table private.coach_paid_periods enable row level security;
alter table private.coach_paid_periods force row level security;
alter table private.coach_paid_period_operations enable row level security;
alter table private.coach_paid_period_operations force row level security;
revoke all on table private.coach_paid_period_registers, private.coach_paid_periods,
  private.coach_paid_period_operations from public, anon, authenticated;

create function private.coach_paid_period_date(p_value text)
returns date language plpgsql immutable security invoker set search_path = '' as $$
declare v_date date;
begin
  if p_value is null or octet_length(p_value) <> 10 or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or substring(p_value from 1 for 4) = '0000' then
    raise exception using errcode = '22023', message = 'coach_paid_period_invalid_date';
  end if;
  begin
    v_date := make_date(substring(p_value from 1 for 4)::integer,
      substring(p_value from 6 for 2)::integer, substring(p_value from 9 for 2)::integer);
  exception when datetime_field_overflow then
    raise exception using errcode = '22023', message = 'coach_paid_period_invalid_date';
  end;
  return v_date;
end;
$$;

create function private.coach_paid_period_receipt(p_operation private.coach_paid_period_operations)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('requestId', p_operation.request_id, 'action', p_operation.action,
    'period', jsonb_build_object('id', p_operation.period_id, 'linkEpisodeId', p_operation.episode_id,
      'start', to_char(p_operation.starts_on, 'YYYY-MM-DD'), 'end', to_char(p_operation.ends_on, 'YYYY-MM-DD')),
    'version', p_operation.result_version, 'recordedAt', p_operation.recorded_at);
$$;

create function private.write_coach_paid_period(
  p_action text, p_episode_id uuid, p_period_id uuid, p_start text, p_end text,
  p_expected_version uuid, p_request_id uuid
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_owner uuid;
  v_episode private.coach_relationship_episodes;
  v_period private.coach_paid_periods;
  v_operation private.coach_paid_period_operations;
  v_start date;
  v_end date;
  v_previous_start date;
  v_previous_end date;
  v_neighbor date;
  v_version uuid;
  v_new_version uuid;
  v_now timestamptz;
begin
  -- Uniform order: exclusive real Coach membership -> own episode -> register /
  -- periods -> receipt. No KEY SHARE upgrades; revoke uses the same first locks.
  v_owner := private.lock_coach_invitation_owner();
  if p_episode_id is null or p_expected_version is null or p_request_id is null
    or p_action is null or p_action not in ('confirm', 'correct')
    or (p_action = 'confirm' and p_period_id is not null)
    or (p_action = 'correct' and p_period_id is null) then
    raise exception using errcode = '22023', message = 'coach_paid_period_invalid_input';
  end if;
  select e.* into v_episode from private.coach_relationship_episodes e
    where e.id = p_episode_id and e.coach_user_id = v_owner for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'coach_paid_period_not_found';
  end if;
  -- Even a write retry after unlink is denied. Use the read-only receipt RPC.
  if v_episode.ended_at is not null then
    raise exception using errcode = '55000', message = 'coach_paid_period_inactive_relationship';
  end if;
  v_start := private.coach_paid_period_date(p_start);
  v_end := private.coach_paid_period_date(p_end);
  if v_end <= v_start then
    raise exception using errcode = '22023', message = 'coach_paid_period_invalid_dates';
  end if;
  select o.* into v_operation from private.coach_paid_period_operations o
    where o.coach_user_id = v_owner and o.request_id = p_request_id;
  if found then
    if v_operation.action <> p_action or v_operation.episode_id <> p_episode_id
      or (p_action = 'correct' and v_operation.period_id <> p_period_id)
      or v_operation.starts_on <> v_start or v_operation.ends_on <> v_end
      or v_operation.expected_version <> p_expected_version then
      raise exception using errcode = '22023', message = 'coach_paid_period_request_conflict';
    end if;
    return jsonb_build_object('status', 'recorded', 'operation', private.coach_paid_period_receipt(v_operation));
  end if;
  select r.version into v_version from private.coach_paid_period_registers r
    where r.episode_id = p_episode_id and r.coach_user_id = v_owner for update;
  v_version := coalesce(v_version, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_version <> p_expected_version then
    raise exception using errcode = '40001', message = 'coach_paid_period_version_conflict';
  end if;
  if p_action = 'confirm' then
    select max(p.ends_on) into v_neighbor from private.coach_paid_periods p
      where p.episode_id = p_episode_id and p.coach_user_id = v_owner;
    if v_neighbor is not null and v_start <= v_neighbor then
      raise exception using errcode = '22023', message = 'coach_paid_period_invalid_dates';
    end if;
  else
    select p.* into v_period from private.coach_paid_periods p
      where p.id = p_period_id and p.episode_id = p_episode_id and p.coach_user_id = v_owner for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'coach_paid_period_not_found';
    end if;
    v_previous_start := v_period.starts_on;
    v_previous_end := v_period.ends_on;
    select max(p.ends_on) into v_neighbor from private.coach_paid_periods p
      where p.episode_id = p_episode_id and p.coach_user_id = v_owner and p.starts_on < v_period.starts_on;
    if v_neighbor is not null and v_start <= v_neighbor then
      raise exception using errcode = '22023', message = 'coach_paid_period_invalid_dates';
    end if;
    select min(p.starts_on) into v_neighbor from private.coach_paid_periods p
      where p.episode_id = p_episode_id and p.coach_user_id = v_owner and p.starts_on > v_period.starts_on;
    if v_neighbor is not null and v_end >= v_neighbor then
      raise exception using errcode = '22023', message = 'coach_paid_period_invalid_dates';
    end if;
  end if;
  v_now := clock_timestamp();
  v_new_version := gen_random_uuid();
  insert into private.coach_paid_period_registers(episode_id, coach_user_id, version)
    values(p_episode_id, v_owner, v_new_version)
    on conflict (episode_id) do update set version = excluded.version;
  if p_action = 'confirm' then
    insert into private.coach_paid_periods(episode_id, coach_user_id, starts_on, ends_on, confirmed_at)
      values(p_episode_id, v_owner, v_start, v_end, v_now) returning * into v_period;
  else
    update private.coach_paid_periods set starts_on = v_start, ends_on = v_end, corrected_at = v_now
      where id = p_period_id and episode_id = p_episode_id and coach_user_id = v_owner returning * into v_period;
  end if;
  insert into private.coach_paid_period_operations(coach_user_id, request_id, episode_id, period_id,
    action, expected_version, result_version, previous_start, previous_end, starts_on, ends_on, recorded_at)
    values(v_owner, p_request_id, p_episode_id, v_period.id, p_action, p_expected_version,
      v_new_version, v_previous_start, v_previous_end, v_start, v_end, v_now) returning * into v_operation;
  return jsonb_build_object('status', 'recorded', 'operation', private.coach_paid_period_receipt(v_operation));
exception when unique_violation then
  raise exception using errcode = '40001', message = 'coach_paid_period_conflict';
when check_violation or foreign_key_violation or not_null_violation then
  raise exception using errcode = '22023', message = 'coach_paid_period_invalid_input';
end;
$$;

create function public.confirm_own_coach_paid_period(
  p_episode_id uuid, p_start text, p_end text, p_expected_version uuid, p_request_id uuid
)
returns jsonb language sql security definer set search_path = '' as $$
  select private.write_coach_paid_period('confirm', p_episode_id, null, p_start, p_end, p_expected_version, p_request_id);
$$;

create function public.correct_own_coach_paid_period(
  p_episode_id uuid, p_period_id uuid, p_start text, p_end text, p_expected_version uuid, p_request_id uuid
)
returns jsonb language sql security definer set search_path = '' as $$
  select private.write_coach_paid_period('correct', p_episode_id, p_period_id, p_start, p_end, p_expected_version, p_request_id);
$$;

create function public.read_own_coach_paid_period(p_episode_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_version uuid; v_period private.coach_paid_periods; v_found boolean;
begin
  v_owner := private.lock_coach_invitation_owner();
  if p_episode_id is null then
    raise exception using errcode = '22023', message = 'coach_paid_period_invalid_input';
  end if;
  perform 1 from private.coach_relationship_episodes e
    where e.id = p_episode_id and e.coach_user_id = v_owner for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'coach_paid_period_not_found';
  end if;
  select r.version into v_version from private.coach_paid_period_registers r
    where r.episode_id = p_episode_id and r.coach_user_id = v_owner;
  select p.* into v_period from private.coach_paid_periods p
    where p.episode_id = p_episode_id and p.coach_user_id = v_owner order by p.starts_on desc limit 1;
  v_found := found;
  return jsonb_build_object('linkEpisodeId', p_episode_id,
    'version', coalesce(v_version, '00000000-0000-0000-0000-000000000000'::uuid),
    'period', case when not v_found then null else jsonb_build_object('id', v_period.id,
      'linkEpisodeId', v_period.episode_id, 'start', to_char(v_period.starts_on, 'YYYY-MM-DD'),
      'end', to_char(v_period.ends_on, 'YYYY-MM-DD')) end);
end;
$$;

create function public.read_own_coach_paid_period_operation(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_operation private.coach_paid_period_operations;
begin
  v_owner := private.lock_coach_invitation_owner();
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'coach_paid_period_invalid_input';
  end if;
  select o.* into v_operation from private.coach_paid_period_operations o
    where o.coach_user_id = v_owner and o.request_id = p_request_id;
  if not found then return null; end if;
  return private.coach_paid_period_receipt(v_operation);
end;
$$;

revoke all on function private.coach_paid_period_date(text),
  private.coach_paid_period_receipt(private.coach_paid_period_operations),
  private.write_coach_paid_period(text, uuid, uuid, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.confirm_own_coach_paid_period(uuid, text, text, uuid, uuid),
  public.correct_own_coach_paid_period(uuid, uuid, text, text, uuid, uuid),
  public.read_own_coach_paid_period(uuid), public.read_own_coach_paid_period_operation(uuid) from public, anon, authenticated;
grant execute on function public.confirm_own_coach_paid_period(uuid, text, text, uuid, uuid),
  public.correct_own_coach_paid_period(uuid, uuid, text, text, uuid, uuid),
  public.read_own_coach_paid_period(uuid), public.read_own_coach_paid_period_operation(uuid) to authenticated;

commit;
