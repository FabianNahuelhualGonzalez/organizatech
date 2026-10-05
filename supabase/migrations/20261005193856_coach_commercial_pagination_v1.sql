-- Bounded, owner-scoped commercial reads. The v1 RPC remains available for
-- older clients; new clients use this surface after this migration is applied.
begin;

create function public.read_own_coach_commercial_page(
  p_kind text, p_episode_id uuid default null, p_cursor text default null, p_limit integer default 20
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := private.lock_coach_invitation_owner();
  v_today date := (clock_timestamp() at time zone 'America/Santiago')::date;
  v_month date := date_trunc('month', clock_timestamp() at time zone 'America/Santiago')::date;
  v_cursor_date date;
  v_cursor_id uuid;
  v_cursor_time timestamptz;
  v_first date;
  v_rows jsonb;
  v_count integer;
  v_last jsonb;
begin
  if p_kind is null or p_kind not in ('items', 'student', 'periods', 'months')
    or p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception using errcode = '22023', message = 'coach_commercial_invalid_page';
  end if;
  if (p_kind in ('periods', 'student')) <> (p_episode_id is not null)
    or (p_kind = 'student' and (p_cursor is not null or p_limit <> 1)) then
    raise exception using errcode = '22023', message = 'coach_commercial_invalid_page';
  end if;
  if p_cursor is not null then
    if p_kind = 'months' then
      if p_cursor !~ '^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$' then
        raise exception using errcode = '22023', message = 'coach_commercial_invalid_cursor';
      end if;
      v_cursor_date := private.coach_commercial_date(p_cursor || '-01');
      if v_cursor_date > v_month then
        raise exception using errcode = '22023', message = 'coach_commercial_invalid_cursor';
      end if;
    elsif p_kind = 'periods' then
      if p_cursor !~ '^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using errcode = '22023', message = 'coach_commercial_invalid_cursor';
      end if;
      v_cursor_date := private.coach_commercial_date(split_part(p_cursor, '|', 1));
      v_cursor_id := split_part(p_cursor, '|', 2)::uuid;
    else
      if p_cursor !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?\+00:00\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using errcode = '22023', message = 'coach_commercial_invalid_cursor';
      end if;
      begin
        v_cursor_time := split_part(p_cursor, '|', 1)::timestamptz;
      exception when datetime_field_overflow or invalid_datetime_format then
        raise exception using errcode = '22023', message = 'coach_commercial_invalid_cursor';
      end;
      v_cursor_id := split_part(p_cursor, '|', 2)::uuid;
      if v_cursor_time > clock_timestamp() then
        raise exception using errcode = '22023', message = 'coach_commercial_invalid_cursor';
      end if;
    end if;
  end if;

  if p_kind = 'periods' then
    -- A foreign episode is indistinguishable from an absent one.
    perform 1 from private.coach_relationship_episodes e
      where e.id = p_episode_id and e.coach_user_id = v_owner;
    if not found then
      raise exception using errcode = 'P0002', message = 'coach_commercial_not_found';
    end if;
    with page as (
      select p.* from private.coach_commercial_periods p
      where p.coach_user_id = v_owner and p.episode_id = p_episode_id
        and (v_cursor_date is null or (p.starts_on, p.id) < (v_cursor_date, v_cursor_id))
      order by p.starts_on desc, p.id desc limit p_limit + 1
    ), numbered as (
      select *, row_number() over (order by starts_on desc, id desc) n from page
    ) select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'episodeId', episode_id, 'startsOn', starts_on,
        'endsBefore', ends_before, 'amountClp', amount_clp,
        'frequency', frequency, 'paidAt', paid_at) order by starts_on desc, id desc)
        filter (where n <= p_limit), '[]'::jsonb), count(*)::integer
      into v_rows, v_count from numbered;
    if v_count > p_limit then
      v_last := v_rows -> (jsonb_array_length(v_rows) - 1);
      return jsonb_build_object('rows', v_rows,
        'nextCursor', (v_last->>'startsOn') || '|' || (v_last->>'id'));
    end if;
  elsif p_kind in ('items', 'student') then
    with page as (
      select e.id, e.student_name_snapshot, e.linked_at, e.ended_at,
        a.starts_on agreement_start, a.ends_on agreement_end, a.status, a.version,
        l.id period_id, l.starts_on period_start, l.ends_before period_end,
        l.amount_clp, l.frequency, l.paid_at,
        (select count(*) from private.coach_commercial_periods p
          where p.coach_user_id = v_owner and p.episode_id = e.id) period_count
      from private.coach_relationship_episodes e
      left join private.coach_commercial_agreements a
        on a.episode_id = e.id and a.coach_user_id = v_owner
      left join lateral (select p.* from private.coach_commercial_periods p
        where p.episode_id = e.id and p.coach_user_id = v_owner
        order by p.starts_on desc, p.id desc limit 1) l on true
      where e.coach_user_id = v_owner
        and (p_kind <> 'student' or e.id = p_episode_id)
        and (v_cursor_time is null or (e.linked_at, e.id) < (v_cursor_time, v_cursor_id))
      order by e.linked_at desc, e.id desc limit p_limit + 1
    ), numbered as (
      select *, row_number() over (order by linked_at desc, id desc) n from page
    ) select coalesce(jsonb_agg(jsonb_build_object(
        'episodeId', id, 'studentName', student_name_snapshot,
        'linkedAt', linked_at, 'unlinkedAt', ended_at,
        'agreementStart', agreement_start, 'agreementEnd', agreement_end,
        'status', case when status is null then 'needs_agreement'
          when status = 'not_continuing' then 'not_continuing'
          when period_end <= v_today then 'pending_renewal' else 'active' end,
        'version', version, 'periodCount', period_count,
        'latestPeriod', case when period_id is null then null else jsonb_build_object(
          'id', period_id, 'episodeId', id, 'startsOn', period_start,
          'endsBefore', period_end, 'amountClp', amount_clp,
          'frequency', frequency, 'paidAt', paid_at) end)
        order by linked_at desc, id desc) filter (where n <= p_limit), '[]'::jsonb),
        count(*)::integer into v_rows, v_count from numbered;
    if p_kind = 'student' and v_count = 0 then
      raise exception using errcode = 'P0002', message = 'coach_commercial_not_found';
    end if;
    if v_count > p_limit then
      v_last := v_rows -> (jsonb_array_length(v_rows) - 1);
      return jsonb_build_object('rows', v_rows,
        'nextCursor', to_char((v_last->>'linkedAt')::timestamptz at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00|' || (v_last->>'episodeId'));
    end if;
  else
    select min(first_month) into v_first from (
      select date_trunc('month', min(e.linked_at at time zone 'America/Santiago'))::date first_month
        from private.coach_relationship_episodes e where e.coach_user_id = v_owner
      union all select date_trunc('month', min(p.starts_on))::date
        from private.coach_commercial_periods p where p.coach_user_id = v_owner and p.starts_on <= v_today
      union all select date_trunc('month', min(p.paid_at at time zone 'America/Santiago'))::date
        from private.coach_commercial_periods p where p.coach_user_id = v_owner and p.paid_at is not null
    ) firsts;
    with calendar as (
      select g::date month_key from generate_series(
        least(v_month, coalesce(v_cursor_date - interval '1 month', v_month))::timestamp,
        v_first::timestamp, interval '-1 month') g limit p_limit + 1
    ), monthly as (
      select date_trunc('month', p.starts_on)::date month_key,
        sum(p.amount_clp) estimated_clp, count(*) period_count
      from private.coach_commercial_periods p
      where p.coach_user_id = v_owner and p.starts_on <= v_today
        and p.starts_on >= (select min(month_key) from calendar)
        and p.starts_on < (select max(month_key) + interval '1 month' from calendar)
        and date_trunc('month', p.starts_on)::date in (select month_key from calendar)
      group by 1
    ), paid as (
      select date_trunc('month', p.paid_at at time zone 'America/Santiago')::date month_key,
        sum(p.amount_clp) paid_clp from private.coach_commercial_periods p
      where p.coach_user_id = v_owner and p.paid_at is not null
        and p.paid_at >= ((select min(month_key) from calendar)::timestamp at time zone 'America/Santiago')
        and p.paid_at < ((select max(month_key) + interval '1 month' from calendar) at time zone 'America/Santiago')
        and date_trunc('month', p.paid_at at time zone 'America/Santiago')::date in (select month_key from calendar)
      group by 1
    ), numbered as (
      select c.month_key, coalesce(m.estimated_clp, 0) estimated_clp,
        coalesce(m.period_count, 0) period_count, coalesce(p.paid_clp, 0) paid_clp,
        (select count(*) from private.coach_relationship_episodes e
          where e.coach_user_id = v_owner and e.linked_at at time zone 'America/Santiago'
            < c.month_key + interval '1 month' and (e.ended_at is null
            or e.ended_at at time zone 'America/Santiago' >= c.month_key + interval '1 month')) students,
        (select count(*) from private.coach_relationship_episodes e
          where e.coach_user_id = v_owner and date_trunc('month', e.linked_at at time zone 'America/Santiago')::date
            = c.month_key) joined,
        (select count(*) from private.coach_relationship_episodes e
          where e.coach_user_id = v_owner and e.ended_at is not null
            and date_trunc('month', e.ended_at at time zone 'America/Santiago')::date = c.month_key) left_count,
        row_number() over (order by c.month_key desc) n
      from calendar c left join monthly m on m.month_key = c.month_key
        left join paid p on p.month_key = c.month_key
    ) select coalesce(jsonb_agg(jsonb_build_object(
        'month', to_char(month_key, 'YYYY-MM'), 'estimatedClp', estimated_clp,
        'confirmedPaymentsClp', paid_clp, 'periodCount', period_count,
        'students', students, 'joined', joined, 'left', left_count)
        order by month_key desc) filter (where n <= p_limit), '[]'::jsonb),
        count(*)::integer into v_rows, v_count from numbered;
    if v_count > p_limit then
      v_last := v_rows -> (jsonb_array_length(v_rows) - 1);
      return jsonb_build_object('rows', v_rows, 'nextCursor', v_last->>'month');
    end if;
  end if;
  return jsonb_build_object('rows', v_rows, 'nextCursor', null);
end;
$$;

create function public.read_own_coach_commercial_overview()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := private.lock_coach_invitation_owner();
  v_today date := (clock_timestamp() at time zone 'America/Santiago')::date;
  v_month date := date_trunc('month', clock_timestamp() at time zone 'America/Santiago')::date;
  v_items jsonb;
  v_months jsonb;
  v_stats jsonb;
begin
  v_items := public.read_own_coach_commercial_page('items', null, null, 30);
  v_months := public.read_own_coach_commercial_page('months', null, null, 12);
  with own as materialized (
    select e.id, e.linked_at, e.ended_at, a.status,
      l.ends_before, l.amount_clp,
      (select count(*) from private.coach_commercial_periods p
        where p.coach_user_id = v_owner and p.episode_id = e.id) period_count
    from private.coach_relationship_episodes e
    left join private.coach_commercial_agreements a
      on a.episode_id = e.id and a.coach_user_id = v_owner
    left join lateral (select p.ends_before, p.amount_clp
      from private.coach_commercial_periods p
      where p.coach_user_id = v_owner and p.episode_id = e.id
      order by p.starts_on desc, p.id desc limit 1) l on true
    where e.coach_user_id = v_owner
  ), status_totals as (
    select count(*) filter (where ended_at is null) active_count,
      count(*) filter (where ended_at is not null) unlinked_count,
      count(*) filter (where ended_at is null and (status is null
        or (status = 'active' and ends_before <= v_today)
        or (status = 'active' and ends_before > v_today
          and ends_before <= v_today + 7))) alert_count,
      count(*) filter (where ended_at is null and status = 'active'
        and ends_before <= v_today) pending_count,
      count(*) filter (where period_count > 1 and not (ended_at is null
        and status = 'active' and ends_before <= v_today)
        and status is distinct from 'not_continuing') renewed_count,
      count(*) filter (where status = 'not_continuing') declined_count,
      coalesce(sum(amount_clp) filter (where ended_at is null and status = 'active'
        and ends_before <= v_today), 0) pending_amount,
      count(*) filter (where ended_at is null and status = 'active'
        and ends_before <= v_today and date_trunc('month', ends_before)::date = v_month) monthly_risk_count,
      coalesce(sum(amount_clp) filter (where ended_at is null and status = 'active'
        and ends_before <= v_today and date_trunc('month', ends_before)::date = v_month), 0) monthly_risk_amount
    from own
  ), breakdown as (
    select p.frequency, p.amount_clp, count(distinct p.episode_id) students,
      count(*) periods, sum(p.amount_clp) estimated_clp
    from private.coach_commercial_periods p
    where p.coach_user_id = v_owner and p.starts_on >= v_month
      and p.starts_on <= v_today
    group by p.frequency, p.amount_clp
  ), annual_facts as (
    select year_key, sum(estimated_clp) estimated_clp, sum(paid_clp) paid_clp
    from (
      select extract(year from starts_on)::integer as year_key, sum(amount_clp) estimated_clp,
        0::numeric paid_clp from private.coach_commercial_periods
        where coach_user_id = v_owner and starts_on <= v_today group by 1
      union all
      select extract(year from paid_at at time zone 'America/Santiago')::integer as year_key,
        0::numeric, sum(amount_clp) from private.coach_commercial_periods
        where coach_user_id = v_owner and paid_at is not null group by 1
    ) facts group by year_key
  ), first_year as (
    select min(year_key) year_key from (
      select extract(year from min(linked_at at time zone 'America/Santiago'))::integer year_key from own
      union all select min(year_key) from annual_facts
    ) starts
  ), annual as (
    select g.year_key, coalesce(f.estimated_clp, 0) estimated_clp,
      coalesce(f.paid_clp, 0) paid_clp
    from first_year firsts,
      lateral generate_series(firsts.year_key, extract(year from v_month)::integer) g(year_key)
      left join annual_facts f on f.year_key = g.year_key
  ), peak as (
    select coalesce(max(active_students), 0) value from (
      select month_key, sum(sum(delta)) over (order by month_key) active_students
      from (
        select date_trunc('month', linked_at at time zone 'America/Santiago')::date month_key,
          1 delta from own
        union all
        select date_trunc('month', ended_at at time zone 'America/Santiago')::date,
          -1 from own where ended_at is not null
      ) events group by month_key
    ) counts where month_key <= v_month
  )
  select jsonb_build_object(
    'activeCount', s.active_count, 'unlinkedCount', s.unlinked_count,
    'alertCount', s.alert_count, 'pendingCount', s.pending_count,
    'renewedCount', s.renewed_count, 'declinedCount', s.declined_count,
    'pendingAmount', s.pending_amount, 'monthlyRiskCount', s.monthly_risk_count,
    'monthlyRiskAmount', s.monthly_risk_amount,
    'maxStudents', (select value from peak),
    'currentBreakdown', coalesce((select jsonb_agg(jsonb_build_object(
      'frequency', frequency, 'amountClp', amount_clp, 'students', students,
      'periods', periods, 'estimatedClp', estimated_clp)
      order by frequency, amount_clp) from breakdown), '[]'::jsonb),
    'years', coalesce((select jsonb_agg(jsonb_build_object(
      'year', year_key, 'estimatedClp', estimated_clp,
      'confirmedPaymentsClp', paid_clp) order by year_key desc) from annual), '[]'::jsonb)
  ) into v_stats from status_totals s;
  return jsonb_build_object('serverToday', to_char(v_today, 'YYYY-MM-DD'),
    'currentMonth', to_char(v_month, 'YYYY-MM'), 'items', v_items->'rows',
    'itemCursor', v_items->'nextCursor', 'months', v_months->'rows',
    'monthCursor', v_months->'nextCursor', 'stats', v_stats);
end;
$$;

revoke all on function public.read_own_coach_commercial_overview()
  from public, anon, authenticated;
grant execute on function public.read_own_coach_commercial_overview()
  to authenticated;
revoke all on function public.read_own_coach_commercial_page(text, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.read_own_coach_commercial_page(text, uuid, text, integer)
  to authenticated;
commit;
