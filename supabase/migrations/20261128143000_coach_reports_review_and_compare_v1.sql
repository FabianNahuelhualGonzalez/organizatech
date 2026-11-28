begin;

create or replace function public.get_own_coach_progress_report(p_report_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_coach uuid := auth.uid(); v_report private.progress_reports; v_episode private.coach_relationship_episodes;
begin
  if v_coach is null or p_report_id is null then
    raise exception 'progress_report_forbidden' using errcode = '42501'; end if;
  select * into v_report from private.progress_reports report
    where report.id = p_report_id and report.coach_user_id = v_coach;
  select * into v_episode from private.coach_relationship_episodes episode
    where episode.id = v_report.relationship_episode_id and episode.coach_user_id = v_coach
      and episode.student_user_id = v_report.student_user_id and episode.ended_at is null;
  if v_episode.id is null or exists (
    select 1 from private.progress_report_items item where item.report_id = p_report_id
      and item.asset_kind = 'medical_document'
      and not private.can_coach_read_medical_document_asset(item.asset_id, v_coach))
  then raise exception 'progress_report_forbidden' using errcode = '42501'; end if;
  return private.progress_report_view(p_report_id) || jsonb_build_object(
    'studentName', v_episode.student_name_snapshot, 'episodeId', v_episode.id);
end;
$fn$;

create or replace function public.set_own_coach_progress_report_reviewed(p_report_id uuid, p_reviewed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_coach uuid := auth.uid(); v_reviewed_at timestamptz;
begin
  if v_coach is null or p_report_id is null or p_reviewed is null then
    raise exception 'progress_report_forbidden' using errcode = '42501'; end if;
  perform 1 from private.progress_reports report
    join private.coach_relationship_episodes episode
      on episode.id = report.relationship_episode_id and episode.coach_user_id = v_coach
      and episode.student_user_id = report.student_user_id and episode.ended_at is null
    where report.id = p_report_id and report.coach_user_id = v_coach
      and not exists (select 1 from private.progress_report_items item
        where item.report_id = report.id and item.asset_kind = 'medical_document'
          and not private.can_coach_read_medical_document_asset(item.asset_id, v_coach))
    for update of episode;
  if not found then raise exception 'progress_report_forbidden' using errcode = '42501'; end if;
  if p_reviewed then
    insert into private.progress_report_reviews (report_id, coach_user_id)
      values (p_report_id, v_coach) on conflict (report_id) do nothing;
    select reviewed_at into v_reviewed_at from private.progress_report_reviews
      where report_id = p_report_id and coach_user_id = v_coach;
    update private.progress_report_notifications notification
      set read_at = coalesce(notification.read_at, clock_timestamp())
      where notification.report_id = p_report_id and notification.recipient_user_id = v_coach;
  else
    delete from private.progress_report_reviews
      where report_id = p_report_id and coach_user_id = v_coach;
  end if;
  return public.get_own_coach_progress_report(p_report_id)
    || jsonb_build_object('reviewedAt', v_reviewed_at);
end;
$fn$;

create or replace function public.get_previous_own_coach_photo_report(p_report_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_current jsonb; v_coach uuid := auth.uid(); v_previous uuid;
begin
  v_current := public.get_own_coach_progress_report(p_report_id);
  if v_current->>'kind' <> 'photos' then return null; end if;
  select prior_report.id into v_previous from private.progress_reports prior_report
    join private.coach_relationship_episodes episode
      on episode.id = prior_report.relationship_episode_id
      and episode.student_user_id = prior_report.student_user_id
      and episode.coach_user_id = v_coach and episode.ended_at is null
    join private.progress_reports current_report on current_report.id = p_report_id
    where prior_report.coach_user_id = v_coach
      and prior_report.student_user_id = current_report.student_user_id
      and prior_report.kind = 'photos'
      and (prior_report.sent_at, prior_report.id) < (current_report.sent_at, current_report.id)
      and exists (select 1 from private.progress_report_items item
        where item.report_id = prior_report.id and item.asset_kind = 'photo'
          and private.can_coach_read_shared_photo(item.asset_id, v_coach))
    order by prior_report.sent_at desc, prior_report.id desc limit 1;
  if v_previous is null then return null; end if;
  return public.get_own_coach_progress_report(v_previous);
end;
$fn$;

-- Server-side filters and pagination keep counts correct beyond the first page.
create or replace function public.page_own_coach_progress_reports(
  p_status text, p_kind text, p_query text, p_limit integer, p_offset integer
) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_coach uuid := auth.uid(); v_result jsonb;
begin
  if v_coach is null or p_status is null or p_status not in ('pending', 'reviewed', 'all')
    or (p_kind is not null and p_kind not in ('photos', 'medical_document'))
    or p_query is null or length(p_query) > 100
    or p_limit is null or p_limit not between 1 and 50
    or p_offset is null or p_offset not between 0 and 10000
    or not exists (select 1 from public.coach_registrations where user_id = v_coach)
  then raise exception 'progress_report_forbidden' using errcode = '42501'; end if;

  with visible as materialized (
    select report.id, report.student_user_id, report.relationship_episode_id,
      episode.student_name_snapshot, report.kind, report.sent_at, review.reviewed_at,
      count(item.report_id) filter (where
        (item.asset_kind = 'photo' and private.can_coach_read_shared_photo(item.asset_id, v_coach))
        or (item.asset_kind = 'medical_document'
          and private.can_coach_read_medical_document_asset(item.asset_id, v_coach)))::integer as item_count
    from private.progress_reports report
    join private.coach_relationship_episodes episode
      on episode.id = report.relationship_episode_id and episode.coach_user_id = v_coach
      and episode.student_user_id = report.student_user_id and episode.ended_at is null
    left join private.progress_report_reviews review
      on review.report_id = report.id and review.coach_user_id = v_coach
    left join private.progress_report_items item on item.report_id = report.id
    where report.coach_user_id = v_coach and not exists (
      select 1 from private.progress_report_items restricted
      where restricted.report_id = report.id and restricted.asset_kind = 'medical_document'
        and not private.can_coach_read_medical_document_asset(restricted.asset_id, v_coach))
    group by report.id, episode.student_name_snapshot, review.reviewed_at
  ), filtered as (
    select * from visible where (p_status = 'all'
      or (p_status = 'pending' and reviewed_at is null)
      or (p_status = 'reviewed' and reviewed_at is not null))
      and (p_kind is null or kind = p_kind)
      and (p_query = '' or position(lower(p_query) in lower(student_name_snapshot)) > 0)
  ), page as (
    select * from filtered order by sent_at desc, id desc limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', row.id, 'studentName', row.student_name_snapshot,
      'studentUserId', row.student_user_id, 'episodeId', row.relationship_episode_id,
      'kind', row.kind, 'sentAt', row.sent_at, 'reviewedAt', row.reviewed_at,
      'itemCount', row.item_count
    ) order by row.sent_at desc, row.id desc) from page row), '[]'::jsonb),
    'pending', (select count(*) from visible where reviewed_at is null),
    'reviewed', (select count(*) from visible where reviewed_at is not null),
    'hasMore', (select count(*) > p_offset + p_limit from filtered)
  ) into v_result;
  return v_result;
end;
$fn$;

revoke all on function public.get_own_coach_progress_report(uuid),
  public.set_own_coach_progress_report_reviewed(uuid, boolean),
  public.get_previous_own_coach_photo_report(uuid),
  public.page_own_coach_progress_reports(text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_own_coach_progress_report(uuid),
  public.set_own_coach_progress_report_reviewed(uuid, boolean),
  public.get_previous_own_coach_photo_report(uuid),
  public.page_own_coach_progress_reports(text, text, text, integer, integer)
  to authenticated;

commit;
