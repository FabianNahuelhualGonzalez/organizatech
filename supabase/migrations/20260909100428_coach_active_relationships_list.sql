-- Own active episode identity snapshots only; no activity, payments or acceptance.
-- Requires 20260909044235_coach_invitation_persistence, audited R2.
begin;

-- PostgreSQL 17's built-in Unicode simple mapping; no host-locale fallback.
do $$ begin
  if current_setting('server_version_num')::integer < 170000
    or current_setting('server_encoding') <> 'UTF8'
    or not exists(select 1 from pg_catalog.pg_collation
      where collnamespace = 'pg_catalog'::regnamespace and collname = 'pg_c_utf8') then
    raise exception using errcode = '0A000', message = 'coach_active_relationship_list_requires_postgres17_utf8';
  end if;
end $$;

create function public.list_own_active_coach_relationships(
  p_query text default '',
  p_limit integer default 25,
  p_cursor_linked_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := private.lock_coach_invitation_owner();
  -- Revocation and listing serialize on the same exclusive membership lock.
  v_now timestamptz := clock_timestamp();
  v_query text;
  v_result jsonb;
begin
  if p_query is null or octet_length(p_query) > 254
    or p_limit is null or p_limit not between 1 and 50
    or ((p_cursor_linked_at is null) <> (p_cursor_id is null)) then
    raise exception using errcode = '22023', message = 'coach_active_relationship_list_invalid_input';
  end if;
  if p_cursor_linked_at is not null and (
    not isfinite(p_cursor_linked_at)
    or p_cursor_linked_at < timestamptz '0001-01-01 00:00:00+00'
    or p_cursor_linked_at >= timestamptz '10000-01-01 00:00:00+00'
  ) then
    raise exception using errcode = '22023', message = 'coach_active_relationship_list_invalid_input';
  end if;

  -- Literal substring, ASCII spaces only, NFD and precisely U+0300..U+036F.
  v_query := lower(regexp_replace(pg_catalog.normalize(btrim(p_query, ' '), 'NFD')
    collate pg_catalog."C", U&'[\0300-\036F]', '', 'g') collate pg_catalog.pg_c_utf8);

  -- One statement snapshot. The NOT MATERIALIZED relation is owner scoped;
  -- only limit+1 candidates and at most limit JSON items are materialized.
  -- Existing coach_relationship_owner_page supports this tuple seek/order.
  -- Counts and literal substring search still scan the owner's active episodes.
  with own as not materialized (
    select e.id, e.student_name_snapshot, e.student_email_snapshot, e.linked_at,
      (strpos(lower(regexp_replace(
        pg_catalog.normalize(btrim(e.student_name_snapshot, ' '), 'NFD') collate pg_catalog."C",
        U&'[\0300-\036F]', '', 'g') collate pg_catalog.pg_c_utf8), v_query) > 0
      or strpos(lower(regexp_replace(
        pg_catalog.normalize(btrim(e.student_email_snapshot, ' '), 'NFD') collate pg_catalog."C",
        U&'[\0300-\036F]', '', 'g') collate pg_catalog.pg_c_utf8), v_query) > 0) as matches
    from private.coach_relationship_episodes e
    where e.coach_user_id = v_owner and e.ended_at is null
  ), counts as (
    select count(*) as total_active, count(*) filter (where matches) as matching_count from own
  ), candidates as materialized (
    select id, student_name_snapshot, student_email_snapshot, linked_at from own
    where matches
      -- Position only; a missing, foreign or revoked anchor is never looked up.
      and (p_cursor_linked_at is null or (linked_at, id) < (p_cursor_linked_at, p_cursor_id))
    order by linked_at desc, id desc limit p_limit + 1
  ), page as (
    select * from candidates order by linked_at desc, id desc limit p_limit
  )
  select jsonb_build_object(
    'serverNow', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'totalActive', counts.total_active,
    'matchingCount', counts.matching_count,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'studentName', p.student_name_snapshot, 'studentEmail', p.student_email_snapshot,
      'linkedAt', to_char(p.linked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) order by p.linked_at desc, p.id desc) from page p), '[]'::jsonb),
    'nextCursor', case when (select count(*) from candidates) > p_limit then (
      select jsonb_build_object('linkedAt', to_char(p.linked_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'id', p.id)
      from page p order by p.linked_at, p.id limit 1
    ) else null end
  ) into v_result from counts;
  return v_result;
end;
$$;

revoke all on function public.list_own_active_coach_relationships(text, integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.list_own_active_coach_relationships(text, integer, timestamptz, uuid)
  to authenticated;
commit;
