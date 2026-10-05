-- Coach commercial portfolio v1. Local forward-only preparation; apply to QA first.
-- Dates are Santiago civil dates. Billing periods are half-open [start, end).
-- No legacy paid-period rows are imported: they lack amount and frequency.
begin;

create table private.coach_commercial_agreements (
  episode_id uuid primary key,
  coach_user_id uuid not null,
  starts_on date not null,
  ends_on date,
  status text not null check (status in ('active', 'not_continuing')),
  version uuid not null,
  created_at timestamptz not null,
  decided_at timestamptz,
  unique (episode_id, coach_user_id),
  foreign key (episode_id, coach_user_id)
    references private.coach_relationship_episodes(id, coach_user_id) on delete cascade,
  check (ends_on is null or ends_on >= starts_on),
  check ((status = 'not_continuing') = (decided_at is not null))
);

create table private.coach_commercial_periods (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null,
  coach_user_id uuid not null,
  starts_on date not null,
  ends_before date not null,
  amount_clp bigint not null check (amount_clp between 1 and 1000000000000),
  frequency text not null check (frequency in
    ('daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual')),
  confirmed_at timestamptz not null,
  corrected_at timestamptz,
  paid_at timestamptz,
  unique (id, episode_id, coach_user_id),
  unique (episode_id, starts_on),
  foreign key (episode_id, coach_user_id)
    references private.coach_commercial_agreements(episode_id, coach_user_id) on delete cascade,
  check (ends_before > starts_on),
  check (corrected_at is null or corrected_at >= confirmed_at),
  check (paid_at is null or paid_at >= confirmed_at)
);
create index coach_commercial_periods_owner_month
  on private.coach_commercial_periods(coach_user_id, starts_on, episode_id);
create index coach_commercial_periods_owner_paid
  on private.coach_commercial_periods(coach_user_id, paid_at) where paid_at is not null;

create table private.coach_commercial_operations (
  coach_user_id uuid not null,
  request_id uuid not null,
  episode_id uuid not null,
  action text not null check (action in ('start', 'renew', 'correct_future', 'confirm_payment', 'not_continuing')),
  payload jsonb not null,
  result jsonb not null,
  recorded_at timestamptz not null,
  primary key (coach_user_id, request_id),
  foreign key (episode_id, coach_user_id)
    references private.coach_commercial_agreements(episode_id, coach_user_id) on delete cascade
);

alter table private.coach_commercial_agreements enable row level security;
alter table private.coach_commercial_agreements force row level security;
alter table private.coach_commercial_periods enable row level security;
alter table private.coach_commercial_periods force row level security;
alter table private.coach_commercial_operations enable row level security;
alter table private.coach_commercial_operations force row level security;
-- No policies: authenticated clients have only the narrow RPC surface.
revoke all on table private.coach_commercial_agreements,
  private.coach_commercial_periods, private.coach_commercial_operations
  from public, anon, authenticated;

create function private.coach_commercial_date(p_value text)
returns date language plpgsql immutable security invoker set search_path = '' as $$
declare v_date date;
begin
  if p_value is null or p_value !~ '^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = '22023', message = 'coach_commercial_invalid_date';
  end if;
  begin
    v_date := make_date(substr(p_value, 1, 4)::integer,
      substr(p_value, 6, 2)::integer, substr(p_value, 9, 2)::integer);
  exception when datetime_field_overflow then
    raise exception using errcode = '22023', message = 'coach_commercial_invalid_date';
  end;
  return v_date;
end;
$$;

create function private.coach_commercial_period_end(p_start date, p_frequency text)
returns date language plpgsql immutable security invoker set search_path = '' as $$
declare v_end date;
begin
  if p_frequency not in ('daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual') then
    raise exception using errcode = '22023', message = 'coach_commercial_invalid_frequency';
  end if;
  begin
    v_end := case p_frequency
      when 'daily' then p_start + 1
      when 'weekly' then p_start + 7
      when 'monthly' then (p_start + interval '1 month')::date
      when 'quarterly' then (p_start + interval '3 months')::date
      when 'semiannual' then (p_start + interval '6 months')::date
      when 'annual' then (p_start + interval '1 year')::date end;
  exception when datetime_field_overflow then
    raise exception using errcode = '22023', message = 'coach_commercial_invalid_date';
  end;
  if v_end is null or v_end <= p_start or v_end > date '9999-12-31' then
    raise exception using errcode = '22023', message = 'coach_commercial_invalid_date';
  end if;
  return v_end;
end;
$$;

create function public.write_own_coach_commercial(
  p_action text, p_episode_id uuid, p_request_id uuid, p_expected_version uuid,
  p_period_id uuid default null, p_amount_clp bigint default null,
  p_frequency text default null, p_starts_on text default null,
  p_agreement_ends_on text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_episode private.coach_relationship_episodes;
  v_agreement private.coach_commercial_agreements;
  v_period private.coach_commercial_periods;
  v_last private.coach_commercial_periods;
  v_operation private.coach_commercial_operations;
  v_start date;
  v_agreement_end date;
  v_end date;
  v_today date := (clock_timestamp() at time zone 'America/Santiago')::date;
  v_now timestamptz := clock_timestamp();
  v_zero uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_new_version uuid := gen_random_uuid();
  v_payload jsonb;
  v_result jsonb;
begin
  -- Same lock order as relationship revocation: Coach membership, episode,
  -- agreement, then periods. It also serializes two concurrent first writes.
  v_owner := private.lock_coach_invitation_owner();
  if p_episode_id is null or p_request_id is null or p_expected_version is null or p_action is null
    or p_action not in ('start', 'renew', 'correct_future', 'confirm_payment', 'not_continuing') then
    raise exception using errcode = '22023', message = 'coach_commercial_invalid_input';
  end if;
  select * into v_episode from private.coach_relationship_episodes
    where id = p_episode_id and coach_user_id = v_owner for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'coach_commercial_not_found';
  end if;
  if v_episode.ended_at is not null then
    raise exception using errcode = '55000', message = 'coach_commercial_inactive_relationship';
  end if;
  -- Reject irrelevant parameters so distinct payloads cannot be silently ignored.
  if (p_action in ('start', 'renew') and (p_period_id is not null or p_amount_clp is null
      or p_frequency is null or p_starts_on is null))
    or (p_action = 'correct_future' and (p_period_id is null or p_amount_clp is null
      or p_frequency is null or p_starts_on is null))
    or (p_action in ('confirm_payment', 'not_continuing') and (
      (p_action = 'confirm_payment' and p_period_id is null)
      or (p_action = 'not_continuing' and p_period_id is not null)
      or p_amount_clp is not null or p_frequency is not null or p_starts_on is not null
      or p_agreement_ends_on is not null)) then
    raise exception using errcode = '22023', message = 'coach_commercial_invalid_input';
  end if;
  v_payload := jsonb_build_object('action', p_action, 'episodeId', p_episode_id,
    'periodId', p_period_id, 'amountClp', p_amount_clp, 'frequency', p_frequency,
    'startsOn', p_starts_on, 'agreementEndsOn', p_agreement_ends_on,
    'expectedVersion', p_expected_version);
  select * into v_operation from private.coach_commercial_operations
    where coach_user_id = v_owner and request_id = p_request_id;
  if found then
    if v_operation.payload <> v_payload then
      raise exception using errcode = '22023', message = 'coach_commercial_request_conflict';
    end if;
    return v_operation.result;
  end if;
  if p_action in ('start', 'renew', 'correct_future') then
    if p_amount_clp not between 1 and 1000000000000 then
      raise exception using errcode = '22023', message = 'coach_commercial_invalid_amount';
    end if;
    v_start := private.coach_commercial_date(p_starts_on);
    v_agreement_end := case when p_agreement_ends_on is null then null
      else private.coach_commercial_date(p_agreement_ends_on) end;
    if v_start < v_today or (v_agreement_end is not null and v_agreement_end < v_start) then
      raise exception using errcode = '22023', message = 'coach_commercial_past_or_invalid_date';
    end if;
    v_end := private.coach_commercial_period_end(v_start, p_frequency);
    if v_agreement_end is not null then
      v_end := least(v_end, v_agreement_end + 1);
    end if;
  end if;
  select * into v_agreement from private.coach_commercial_agreements
    where episode_id = p_episode_id and coach_user_id = v_owner for update;
  if p_action = 'start' then
    if found or p_expected_version <> v_zero then
      raise exception using errcode = '40001', message = 'coach_commercial_version_conflict';
    end if;
    insert into private.coach_commercial_agreements
      (episode_id, coach_user_id, starts_on, ends_on, status, version, created_at)
      values (p_episode_id, v_owner, v_start, v_agreement_end, 'active', v_new_version, v_now);
  else
    if not found then
      raise exception using errcode = 'P0002', message = 'coach_commercial_not_found';
    end if;
    if v_agreement.version <> p_expected_version then
      raise exception using errcode = '40001', message = 'coach_commercial_version_conflict';
    end if;
    if v_agreement.status <> 'active' then
      raise exception using errcode = '55000', message = 'coach_commercial_not_continuing';
    end if;
  end if;

  if p_action = 'renew' then
    select * into v_last from private.coach_commercial_periods
      where episode_id = p_episode_id and coach_user_id = v_owner
      order by starts_on desc limit 1 for update;
    if not found or v_last.ends_before > v_today or v_start < v_last.ends_before then
      raise exception using errcode = '22023', message = 'coach_commercial_invalid_renewal';
    end if;
    update private.coach_commercial_agreements set ends_on = v_agreement_end,
      version = v_new_version where episode_id = p_episode_id;
  elsif p_action = 'correct_future' then
    select * into v_period from private.coach_commercial_periods
      where id = p_period_id and episode_id = p_episode_id and coach_user_id = v_owner for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'coach_commercial_not_found';
    end if;
    if v_period.starts_on <= v_today or v_period.paid_at is not null
      or v_start <> v_period.starts_on then
      raise exception using errcode = '55000', message = 'coach_commercial_historical_period';
    end if;
    perform 1 from private.coach_commercial_periods
      where episode_id = p_episode_id and starts_on > v_period.starts_on;
    if found then
      raise exception using errcode = '55000', message = 'coach_commercial_only_latest_future_period';
    end if;
    update private.coach_commercial_periods set amount_clp = p_amount_clp,
      frequency = p_frequency, ends_before = v_end, corrected_at = v_now
      where id = p_period_id returning * into v_period;
    update private.coach_commercial_agreements set ends_on = v_agreement_end,
      version = v_new_version where episode_id = p_episode_id;
  elsif p_action = 'confirm_payment' then
    select * into v_period from private.coach_commercial_periods
      where id = p_period_id and episode_id = p_episode_id and coach_user_id = v_owner for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'coach_commercial_not_found';
    end if;
    if v_period.paid_at is not null or v_period.starts_on > v_today then
      raise exception using errcode = '55000', message = 'coach_commercial_payment_conflict';
    end if;
    update private.coach_commercial_periods set paid_at = v_now where id = p_period_id
      returning * into v_period;
    update private.coach_commercial_agreements set version = v_new_version
      where episode_id = p_episode_id;
  elsif p_action = 'not_continuing' then
    select * into v_last from private.coach_commercial_periods
      where episode_id = p_episode_id and coach_user_id = v_owner
      order by starts_on desc limit 1 for update;
    if not found or v_last.ends_before > v_today then
      raise exception using errcode = '55000', message = 'coach_commercial_renewal_not_due';
    end if;
    update private.coach_commercial_agreements set status = 'not_continuing',
      decided_at = v_now, version = v_new_version where episode_id = p_episode_id;
  end if;
  if p_action in ('start', 'renew') then
    insert into private.coach_commercial_periods
      (episode_id, coach_user_id, starts_on, ends_before, amount_clp, frequency, confirmed_at)
      values (p_episode_id, v_owner, v_start, v_end, p_amount_clp, p_frequency, v_now)
      returning * into v_period;
  end if;
  v_result := jsonb_build_object('status', 'recorded', 'action', p_action,
    'requestId', p_request_id,
    'episodeId', p_episode_id, 'periodId', case when p_action in
      ('start', 'renew', 'correct_future', 'confirm_payment') then v_period.id else null end,
    'version', v_new_version, 'recordedAt', v_now);
  insert into private.coach_commercial_operations
    (coach_user_id, request_id, episode_id, action, payload, result, recorded_at)
    values (v_owner, p_request_id, p_episode_id, p_action, v_payload, v_result, v_now);
  return v_result;
exception when unique_violation then
  raise exception using errcode = '40001', message = 'coach_commercial_conflict';
when check_violation or foreign_key_violation or not_null_violation then
  raise exception using errcode = '22023', message = 'coach_commercial_invalid_input';
end;
$$;

create function public.read_own_coach_commercial()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := private.lock_coach_invitation_owner();
  v_today date := (clock_timestamp() at time zone 'America/Santiago')::date;
  v_month date := date_trunc('month', clock_timestamp() at time zone 'America/Santiago')::date;
  v_result jsonb;
begin
  -- Complete own portfolio, including ended episodes. No student account lookup.
  -- Historical months are recomputed from immutable past periods/payment timestamps.
  with own as materialized (
    select e.id, e.student_name_snapshot, e.linked_at, e.ended_at,
      a.starts_on agreement_start, a.ends_on agreement_end, a.status, a.version,
      a.decided_at
    from private.coach_relationship_episodes e
    left join private.coach_commercial_agreements a on a.episode_id = e.id
    where e.coach_user_id = v_owner
  ), periods as materialized (
    select p.* from private.coach_commercial_periods p where p.coach_user_id = v_owner
  ), latest as (
    select distinct on (episode_id) * from periods order by episode_id, starts_on desc
  ), monthly as (
    select date_trunc('month', starts_on)::date as month_key,
      sum(amount_clp) estimated_clp, count(*) period_count
    from periods where starts_on <= v_today group by 1
  ), paid as (
    select date_trunc('month', paid_at at time zone 'America/Santiago')::date as month_key,
      sum(amount_clp) paid_clp from periods where paid_at is not null group by 1
  ), calendar as (
    select g::date as month_key from generate_series(
      (select min(first_month) from (
        select date_trunc('month', linked_at at time zone 'America/Santiago')::date first_month from own
        union all select month_key from monthly
        union all select month_key from paid
      ) firsts)::timestamp, v_month::timestamp, interval '1 month') g
  ), months as (
    select c.month_key,
      coalesce(m.estimated_clp, 0) estimated_clp,
      coalesce(p.paid_clp, 0) paid_clp,
      coalesce(m.period_count, 0) period_count,
      (select count(*) from own o where o.linked_at at time zone 'America/Santiago'
        < c.month_key + interval '1 month' and (o.ended_at is null
        or o.ended_at at time zone 'America/Santiago' >= c.month_key + interval '1 month')) students,
      (select count(*) from own o where date_trunc('month', o.linked_at at time zone 'America/Santiago')::date
        = c.month_key) joined,
      (select count(*) from own o where o.ended_at is not null and
        date_trunc('month', o.ended_at at time zone 'America/Santiago')::date = c.month_key) left_count
    from calendar c left join monthly m on m.month_key = c.month_key
      left join paid p on p.month_key = c.month_key
  )
  select jsonb_build_object(
    'serverToday', to_char(v_today, 'YYYY-MM-DD'),
    'currentMonth', to_char(v_month, 'YYYY-MM'),
    'activeCount', (select count(*) from own where ended_at is null),
    'unlinkedCount', (select count(*) from own where ended_at is not null),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'episodeId', o.id, 'studentName', o.student_name_snapshot,
      'linkedAt', o.linked_at, 'unlinkedAt', o.ended_at,
      'agreementStart', o.agreement_start, 'agreementEnd', o.agreement_end,
      'status', case when o.status is null then 'needs_agreement'
        when o.status = 'not_continuing' then 'not_continuing'
        when l.ends_before <= v_today then 'pending_renewal'
        else 'active' end,
      'version', o.version,
      'latestPeriod', case when l.id is null then null else jsonb_build_object(
        'id', l.id, 'episodeId', l.episode_id, 'startsOn', l.starts_on, 'endsBefore', l.ends_before,
        'amountClp', l.amount_clp, 'frequency', l.frequency, 'paidAt', l.paid_at) end)
      order by o.linked_at desc, o.id desc) from own o
      left join latest l on l.episode_id = o.id), '[]'::jsonb),
    'periods', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'episodeId', p.episode_id, 'startsOn', p.starts_on,
      'endsBefore', p.ends_before, 'amountClp', p.amount_clp,
      'frequency', p.frequency, 'paidAt', p.paid_at)
      order by p.starts_on desc, p.id desc) from periods p), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(jsonb_build_object(
      'month', to_char(month_key, 'YYYY-MM'), 'estimatedClp', estimated_clp,
      'confirmedPaymentsClp', paid_clp, 'periodCount', period_count,
      'students', students, 'joined', joined, 'left', left_count)
      order by month_key desc) from months), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create function public.read_own_coach_commercial_operation(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := private.lock_coach_invitation_owner(); v_result jsonb;
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'coach_commercial_invalid_input';
  end if;
  select result into v_result from private.coach_commercial_operations
    where coach_user_id = v_owner and request_id = p_request_id;
  return v_result;
end;
$$;

revoke all on function private.coach_commercial_date(text),
  private.coach_commercial_period_end(date, text) from public, anon, authenticated;
revoke all on function public.write_own_coach_commercial(text, uuid, uuid, uuid, uuid, bigint, text, text, text),
  public.read_own_coach_commercial(), public.read_own_coach_commercial_operation(uuid)
  from public, anon, authenticated;
grant execute on function public.write_own_coach_commercial(text, uuid, uuid, uuid, uuid, bigint, text, text, text),
  public.read_own_coach_commercial(), public.read_own_coach_commercial_operation(uuid)
  to authenticated;
commit;
