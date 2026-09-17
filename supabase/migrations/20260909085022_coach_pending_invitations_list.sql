-- Own pending invitation listing only. No linking, dispatch or training access.
-- Requires 20260909044235_coach_invitation_persistence, audited R2.
begin;

-- Fail closed instead of silently changing search semantics with an OS locale.
-- pg_c_utf8 is a built-in PostgreSQL 17+ UTF8 collation, not an extension.
do $$ begin
  if current_setting('server_version_num')::integer < 170000
    or current_setting('server_encoding') <> 'UTF8'
    or not exists(select 1 from pg_catalog.pg_collation
      where collnamespace = 'pg_catalog'::regnamespace and collname = 'pg_c_utf8') then
    raise exception using errcode = '0A000', message = 'coach_invitation_list_requires_postgres17_utf8';
  end if;
end $$;

create function public.list_own_pending_coach_invitations(
  p_query text default '',
  p_limit integer default 25,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := private.lock_coach_invitation_owner();
  -- The exclusive membership lock precedes the clock and the listing snapshot.
  v_now timestamptz := clock_timestamp();
  v_query text;
  v_result jsonb;
begin
  if p_query is null or octet_length(p_query) > 254
    or p_limit is null or p_limit not between 1 and 50
    or ((p_cursor_created_at is null) <> (p_cursor_id is null)) then
    raise exception using errcode = '22023', message = 'coach_invitation_list_invalid_input';
  end if;
  if p_cursor_created_at is not null and (
    not isfinite(p_cursor_created_at)
    or p_cursor_created_at < timestamptz '0001-01-01 00:00:00+00'
    or p_cursor_created_at >= timestamptz '10000-01-01 00:00:00+00'
  ) then
    raise exception using errcode = '22023', message = 'coach_invitation_list_invalid_input';
  end if;

  -- Literal substring, not LIKE/ILIKE. ASCII spaces only; canonical decomposition
  -- and precisely U+0300..U+036F removal. Never change the stored recipient email.
  v_query := lower(regexp_replace(pg_catalog.normalize(btrim(p_query, ' '), 'NFD')
    collate pg_catalog."C", U&'[\0300-\036F]', '', 'g') collate pg_catalog.pg_c_utf8);

  -- One SELECT snapshot for counts and page. No unbounded array/JSON aggregation.
  -- Existing owner_page supports the tuple seek/order; pending-recipient covers
  -- owner + pending counts. Literal substring search still scans own candidates.
  with counts as (
    select count(*) as total_pending,
      count(*) filter (where strpos(lower(regexp_replace(
        pg_catalog.normalize(btrim(i.recipient_email, ' '), 'NFD') collate pg_catalog."C",
        U&'[\0300-\036F]', '', 'g') collate pg_catalog.pg_c_utf8), v_query) > 0) as matching_count
    from private.coach_invitations i
    where i.coach_user_id = v_owner and i.state = 'pending'
  ), candidates as materialized (
    select i.id, i.recipient_email, i.created_at, i.issued_at, i.expires_at
    from private.coach_invitations i
    where i.coach_user_id = v_owner and i.state = 'pending'
      and strpos(lower(regexp_replace(
        pg_catalog.normalize(btrim(i.recipient_email, ' '), 'NFD') collate pg_catalog."C",
        U&'[\0300-\036F]', '', 'g') collate pg_catalog.pg_c_utf8), v_query) > 0
      -- A cursor is only a position, not a row/ownership lookup. It survives cancel.
      and (p_cursor_created_at is null or (i.created_at, i.id) < (p_cursor_created_at, p_cursor_id))
    order by i.created_at desc, i.id desc limit p_limit + 1
  ), page as (
    select * from candidates order by created_at desc, id desc limit p_limit
  )
  select jsonb_build_object(
    'serverNow', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'totalPending', counts.total_pending,
    'matchingCount', counts.matching_count,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'recipientEmail', p.recipient_email,
      'createdAt', to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'issuedAt', to_char(p.issued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'expiresAt', to_char(p.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'state', case when p.expires_at <= v_now then 'expired' else 'pending' end
    ) order by p.created_at desc, p.id desc) from page p), '[]'::jsonb),
    'nextCursor', case when (select count(*) from candidates) > p_limit then (
      select jsonb_build_object('createdAt', to_char(p.created_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'id', p.id)
      from page p order by p.created_at, p.id limit 1
    ) else null end
  ) into v_result from counts;
  return v_result;
end;
$$;

revoke all on function public.list_own_pending_coach_invitations(text, integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.list_own_pending_coach_invitations(text, integer, timestamptz, uuid)
  to authenticated;
commit;
