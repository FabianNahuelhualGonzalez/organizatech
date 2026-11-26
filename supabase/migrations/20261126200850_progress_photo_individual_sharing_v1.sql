-- Local preparation only. No QA/PROD execution without separate authorization.
begin;

create table private.progress_photo_shares (
  asset_id uuid not null,
  student_user_id uuid not null,
  relationship_episode_id uuid not null references private.coach_relationship_episodes(id),
  shared_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  primary key (asset_id, relationship_episode_id),
  foreign key (asset_id, student_user_id)
    references private.progress_assets(id, student_user_id) on delete cascade
);
create index progress_photo_shares_episode_visible
  on private.progress_photo_shares (relationship_episode_id, asset_id)
  where revoked_at is null;
alter table private.progress_photo_shares enable row level security;
alter table private.progress_photo_shares force row level security;
revoke all on private.progress_photo_shares from public, anon, authenticated;

-- A past explicit report send counts as the prior student's authorization.
-- Deleted photos are excluded: their check no longer offers a revoke control.
insert into private.progress_photo_shares (asset_id, student_user_id, relationship_episode_id)
select distinct item.asset_id, report.student_user_id, report.relationship_episode_id
from private.progress_report_items item
join private.progress_reports report on report.id = item.report_id
join private.progress_assets asset on asset.id = item.asset_id
  and asset.student_user_id = report.student_user_id
where item.asset_kind = 'photo' and report.kind = 'photos'
  and asset.kind = 'photo' and asset.deleted_at is null
on conflict (asset_id, relationship_episode_id) do nothing;

create function private.can_coach_read_shared_photo(p_asset_id uuid, p_coach uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from private.progress_photo_shares share
    join private.coach_relationship_episodes episode
      on episode.id = share.relationship_episode_id
      and episode.student_user_id = share.student_user_id
    join private.progress_assets asset on asset.id = share.asset_id
      and asset.student_user_id = share.student_user_id
    where share.asset_id = p_asset_id and share.revoked_at is null
      and episode.coach_user_id = p_coach and episode.ended_at is null
      and asset.kind = 'photo' and asset.deleted_at is null
      and asset.available_at is not null and asset.sanitized_at is not null
  )
$fn$;
revoke all on function private.can_coach_read_shared_photo(uuid, uuid)
  from public, anon, authenticated;

create function public.set_own_progress_photo_shared(p_asset_id uuid, p_shared boolean)
returns boolean language plpgsql security definer set search_path = '' as $fn$
declare v_student uuid := private.require_own_progress_photo_reader(); v_episode uuid;
begin
  if p_asset_id is null or p_shared is null then
    raise exception 'progress_photo_invalid_input' using errcode = '22023'; end if;
  select episode.id into v_episode from private.coach_relationship_episodes episode
    where episode.student_user_id = v_student and episode.ended_at is null
    for update of episode;
  if v_episode is null then
    raise exception 'progress_photo_forbidden' using errcode = '42501'; end if;
  perform 1 from private.progress_assets asset
    join private.progress_check_photos photo on photo.photo_asset_id = asset.id
      and photo.student_user_id = asset.student_user_id
    where asset.id = p_asset_id and asset.student_user_id = v_student
      and asset.kind = 'photo' and asset.deleted_at is null
      and asset.available_at is not null and asset.sanitized_at is not null
    for update of asset;
  if not found then
    raise exception 'progress_photo_forbidden' using errcode = '42501'; end if;
  insert into private.progress_photo_shares
    (asset_id, student_user_id, relationship_episode_id, revoked_at)
    values (p_asset_id, v_student, v_episode,
      case when p_shared then null else clock_timestamp() end)
    on conflict (asset_id, relationship_episode_id) do update
      set revoked_at = excluded.revoked_at;
  return p_shared;
end;
$fn$;

create function public.list_own_progress_photo_shares(p_asset_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_student uuid := private.require_own_progress_photo_reader(); v_result jsonb;
begin
  if p_asset_ids is null or cardinality(p_asset_ids) > 150
    or array_position(p_asset_ids, null) is not null then
    raise exception 'progress_photo_invalid_input' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('assetId', share.asset_id)
    order by share.asset_id), '[]'::jsonb) into v_result
  from private.progress_photo_shares share
  join private.coach_relationship_episodes episode
    on episode.id = share.relationship_episode_id
      and episode.student_user_id = share.student_user_id and episode.ended_at is null
  where share.student_user_id = v_student and share.revoked_at is null
    and share.asset_id = any(p_asset_ids);
  return v_result;
end;
$fn$;

create function public.list_shared_student_progress_photos(
  p_episode_id uuid, p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_coach uuid := auth.uid(); v_student uuid; v_result jsonb;
begin
  if v_coach is null or p_episode_id is null
    or p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset not between 0 and 100000 then
    raise exception 'progress_photo_forbidden' using errcode = '42501'; end if;
  select episode.student_user_id into v_student from private.coach_relationship_episodes episode
    join public.coach_registrations registration
      on registration.user_id = episode.coach_user_id
    where episode.coach_user_id = v_coach
      and episode.id = p_episode_id and episode.ended_at is null;
  if v_student is null then
    raise exception 'progress_photo_forbidden' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'assetId', row.asset_id, 'bucketId', row.bucket_id,
    'objectName', row.object_name, 'mimeType', row.mime_type,
    'bytes', row.byte_size, 'checkId', row.check_id,
    'checkedOn', row.checked_on, 'pose', row.pose
  ) order by row.checked_on desc, row.asset_id desc), '[]'::jsonb) into v_result
  from (
    select asset.id as asset_id, asset.bucket_id, asset.object_name,
      asset.mime_type, asset.byte_size, photo.check_id, check_record.checked_on,
      photo.pose
    from private.progress_photo_shares share
    join private.progress_assets asset on asset.id = share.asset_id
      and asset.student_user_id = share.student_user_id
    join private.progress_check_photos photo on photo.photo_asset_id = asset.id
    join private.progress_checks check_record on check_record.id = photo.check_id
    where share.relationship_episode_id = p_episode_id
      and share.student_user_id = v_student and share.revoked_at is null
      and asset.kind = 'photo' and asset.deleted_at is null
      and check_record.deleted_at is null
      and asset.available_at is not null and asset.sanitized_at is not null
    order by check_record.checked_on desc, asset.id desc
    limit p_limit offset p_offset
  ) row;
  return v_result;
end;
$fn$;

-- This policy helper is also used by the existing private storage SELECT policy.
create or replace function private.can_read_progress_object(
  p_bucket_id text, p_object_name text
) returns boolean language plpgsql stable security definer set search_path = '' as $fn$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or p_bucket_id not in
    ('progress-check-photos', 'progress-medical-documents')
    or p_object_name is null then return false; end if;
  return exists (
    select 1 from private.progress_assets asset
    where asset.bucket_id = p_bucket_id and asset.object_name = p_object_name
      and asset.available_at is not null
      and (asset.kind <> 'photo' or asset.sanitized_at is not null)
      and ((asset.student_user_id = v_actor
          and (asset.kind <> 'photo' or asset.deleted_at is null))
        or (asset.kind = 'medical_document'
          and private.can_coach_read_medical_document_asset(asset.id, v_actor))
        or (asset.kind = 'photo'
          and private.can_coach_read_shared_photo(asset.id, v_actor)))
  );
end;
$fn$;

-- The existing report is kept, but a revoked photo's metadata is no longer
-- disclosed to its Coach. The Student still sees their own report snapshot.
create or replace function private.progress_report_view(p_report_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
    'id', report.id, 'kind', report.kind, 'message', report.message,
    'sentAt', report.sent_at, 'studentUserId', report.student_user_id,
    'coachUserId', report.coach_user_id, 'reviewedAt', review.reviewed_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', item.position, 'assetId', item.asset_id,
        'assetKind', item.asset_kind, 'bucketId', item.bucket_id,
        'objectName', item.object_name, 'mimeType', item.mime_type,
        'extension', item.extension, 'bytes', item.byte_size,
        'checkId', item.check_id, 'checkedOn', item.checked_on,
        'pose', item.pose, 'width', item.width, 'height', item.height,
        'displayName', item.display_name, 'documentCategory', item.document_category
      ) order by item.position)
      from private.progress_report_items item
      where item.report_id = report.id
        and (report.student_user_id = auth.uid()
          or (item.asset_kind = 'photo'
            and private.can_coach_read_shared_photo(item.asset_id, auth.uid()))
          or (item.asset_kind = 'medical_document'
            and private.can_coach_read_medical_document_asset(item.asset_id, auth.uid())))
    ), '[]'::jsonb)
  ) from private.progress_reports report
  left join private.progress_report_reviews review on review.report_id = report.id
  where report.id = p_report_id;
$fn$;

-- Existing sends still express the Student's intent to share selected photos.
-- A retry cannot restore a revoked grant: an explicit checkbox action is needed.
create or replace function public.create_own_progress_photo_report(
  p_expected_episode_id uuid, p_asset_ids uuid[], p_message text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_relationship record; v_result jsonb;
begin
  if p_expected_episode_id is null then
    raise exception 'progress_report_forbidden' using errcode = '42501'; end if;
  select * into v_relationship from private.require_own_active_student_relationship();
  if v_relationship.episode_id <> p_expected_episode_id then
    raise exception 'progress_report_recipient_changed' using errcode = 'P4090'; end if;
  perform 1 from private.coach_relationship_episodes episode
    where episode.id = p_expected_episode_id and episode.ended_at is null
    for update of episode;
  if not found then
    raise exception 'progress_report_forbidden' using errcode = '42501'; end if;
  v_result := public.create_own_progress_report('photos', p_asset_ids, p_message, p_request_id);
  insert into private.progress_photo_shares
    (asset_id, student_user_id, relationship_episode_id)
  select item.asset_id, v_relationship.student_user_id, p_expected_episode_id
  from private.progress_report_items item
  where item.report_id = (v_result->>'id')::uuid and item.asset_kind = 'photo'
  on conflict (asset_id, relationship_episode_id) do nothing;
  return v_result;
end;
$fn$;

create or replace function public.list_own_coach_progress_reports(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_coach uuid := auth.uid(); v_result jsonb;
begin
  if v_coach is null or p_limit is null or p_limit not between 1 and 100
    or not exists (select 1 from public.coach_registrations registration
      where registration.user_id = v_coach) then
    raise exception 'progress_report_forbidden' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', row.id, 'studentName', row.student_name_snapshot, 'kind', row.kind,
    'sentAt', row.sent_at, 'reviewedAt', row.reviewed_at, 'itemCount', row.item_count
  ) order by row.sent_at desc, row.id desc), '[]'::jsonb) into v_result
  from (
    select report.id, episode.student_name_snapshot, report.kind, report.sent_at,
      review.reviewed_at,
      count(item.report_id) filter (where
        (item.asset_kind = 'photo'
          and private.can_coach_read_shared_photo(item.asset_id, v_coach))
        or (item.asset_kind = 'medical_document'
          and private.can_coach_read_medical_document_asset(item.asset_id, v_coach)))::integer
        as item_count
    from private.progress_reports report
    join private.coach_relationship_episodes episode
      on episode.id = report.relationship_episode_id
        and episode.coach_user_id = v_coach
        and episode.student_user_id = report.student_user_id
        and episode.ended_at is null
    left join private.progress_report_reviews review
      on review.report_id = report.id and review.coach_user_id = v_coach
    left join private.progress_report_items item on item.report_id = report.id
    where report.coach_user_id = v_coach
      and not exists (
        select 1 from private.progress_report_items restricted
        where restricted.report_id = report.id
          and restricted.asset_kind = 'medical_document'
          and not private.can_coach_read_medical_document_asset(restricted.asset_id, v_coach))
    group by report.id, episode.student_name_snapshot, report.kind,
      report.sent_at, review.reviewed_at
    order by report.sent_at desc, report.id desc
    limit p_limit
  ) row;
  return v_result;
end;
$fn$;

revoke all on function public.set_own_progress_photo_shared(uuid, boolean),
  public.list_own_progress_photo_shares(uuid[]),
  public.list_shared_student_progress_photos(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.set_own_progress_photo_shared(uuid, boolean),
  public.list_own_progress_photo_shares(uuid[]),
  public.list_shared_student_progress_photos(uuid, integer, integer)
  to authenticated;

commit;
