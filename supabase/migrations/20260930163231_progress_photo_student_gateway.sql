-- Local proposal only. QA requires separate authorization and audit.
begin;

-- Phase 1 already enforces one check per asset and one pose per check.
-- Publication makes the sanitized asset available; the student creates its first check.
create or replace function public.publish_verified_progress_photo(
  p_upload_id uuid, p_byte_size bigint, p_width integer, p_height integer
) returns uuid language plpgsql security definer set search_path = ''
as $publish_verified_progress_photo$
declare
  v_upload private.progress_photo_uploads;
  v_now timestamptz := clock_timestamp();
begin
  if not private.progress_photo_publisher_identity()
    or p_upload_id is null or p_byte_size is null or p_byte_size not between 1 and 20971520
    or p_width is null or p_width not between 1 and 50000
    or p_height is null or p_height not between 1 and 50000 then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  select * into v_upload from private.progress_photo_uploads upload
    where upload.id = p_upload_id for update;
  perform 1 from private.coach_relationship_episodes episode
    where episode.student_user_id = v_upload.student_user_id and episode.ended_at is null
    for update of episode;
  if not found or v_upload.state <> 'processing' or v_upload.expires_at <= v_now
    or v_upload.final_asset_id is null or v_upload.final_object_name is null
    or not exists (select 1 from public.user_registrations registration
      where registration.user_id = v_upload.student_user_id)
    or not exists (select 1 from private.coach_relationship_episodes episode
      where episode.student_user_id = v_upload.student_user_id and episode.ended_at is null)
    or not exists (select 1 from storage.objects object
      where object.bucket_id = 'progress-check-photos'
        and object.name = v_upload.final_object_name)
    or exists (select 1 from storage.objects object
      where object.bucket_id = v_upload.bucket_id and object.name = v_upload.object_name)
  then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  insert into private.progress_assets (
    id, student_user_id, kind, bucket_id, object_name, mime_type, extension,
    byte_size, width, height, sanitized_at, available_at, created_at
  ) values (
    v_upload.final_asset_id, v_upload.student_user_id, 'photo',
    'progress-check-photos', v_upload.final_object_name, 'image/jpeg', 'jpg',
    p_byte_size, p_width, p_height, v_now, v_now, v_now
  );
  update private.progress_photo_uploads
    set state = 'published', published_at = v_now, cleaned_at = v_now
    where id = p_upload_id;
  return v_upload.final_asset_id;
end;
$publish_verified_progress_photo$;

create function private.require_own_progress_photo_reader()
returns uuid language plpgsql stable security definer set search_path = ''
as $require_own_progress_photo_reader$
declare v_student uuid := auth.uid();
begin
  if v_student is null or not exists (
    select 1 from public.user_registrations registration
    where registration.user_id = v_student
  ) then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  return v_student;
end;
$require_own_progress_photo_reader$;
revoke all on function private.require_own_progress_photo_reader() from public, anon, authenticated;

create function public.list_own_progress_photo_uploads(p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $list_own_progress_photo_uploads$
declare v_student uuid := private.require_own_progress_photo_reader(); v_result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 then
    raise exception 'progress_photo_invalid_input' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'uploadId', upload.id, 'pose', upload.pose,
    'status', case when upload.state = 'pending' and upload.expires_at <= clock_timestamp() then 'fallida'
      when upload.state = 'pending' then 'reservada'
      when upload.state = 'queued' and upload.expires_at <= clock_timestamp() then 'fallida'
      when upload.state = 'queued' then 'en_cola'
      when upload.state = 'processing' then 'procesando'
      when upload.state = 'published' then 'publicada'
      else 'fallida' end,
    'assetId', case when upload.state = 'published' then upload.final_asset_id else null end,
    'createdAt', upload.created_at, 'expiresAt', upload.expires_at,
    'publishedAt', upload.published_at
  ) order by upload.created_at desc, upload.id desc), '[]'::jsonb) into v_result
  from (select * from private.progress_photo_uploads upload
    where upload.student_user_id = v_student
    order by upload.created_at desc, upload.id desc limit p_limit offset p_offset) upload;
  return v_result;
end;
$list_own_progress_photo_uploads$;

create function public.list_own_progress_photos(p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = ''
as $list_own_progress_photos$
declare v_student uuid := private.require_own_progress_photo_reader(); v_result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 then
    raise exception 'progress_photo_invalid_input' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'assetId', asset.id, 'bucketId', asset.bucket_id, 'objectName', asset.object_name,
    'mimeType', asset.mime_type, 'bytes', asset.byte_size,
    'width', asset.width, 'height', asset.height,
    'pose', coalesce((select upload.pose from private.progress_photo_uploads upload
      where upload.final_asset_id = asset.id and upload.student_user_id = v_student
        and upload.state = 'published'),
      (select check_photo.pose from private.progress_check_photos check_photo
        where check_photo.photo_asset_id = asset.id)),
    'checkId', (select check_photo.check_id from private.progress_check_photos check_photo
      where check_photo.photo_asset_id = asset.id),
    'createdAt', asset.created_at, 'availableAt', asset.available_at
  ) order by asset.created_at desc, asset.id desc), '[]'::jsonb) into v_result
  from (select * from private.progress_assets asset
    where asset.student_user_id = v_student and asset.kind = 'photo'
      and asset.available_at is not null and asset.sanitized_at is not null
    order by asset.created_at desc, asset.id desc limit p_limit offset p_offset) asset;
  return v_result;
end;
$list_own_progress_photos$;

create function public.get_own_progress_photo(p_asset_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $get_own_progress_photo$
declare v_student uuid := private.require_own_progress_photo_reader(); v_result jsonb;
begin
  if p_asset_id is null then raise exception 'progress_photo_forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'assetId', asset.id, 'bucketId', asset.bucket_id, 'objectName', asset.object_name,
    'mimeType', asset.mime_type, 'bytes', asset.byte_size,
    'width', asset.width, 'height', asset.height,
    'pose', coalesce((select upload.pose from private.progress_photo_uploads upload
      where upload.final_asset_id = asset.id and upload.student_user_id = v_student
        and upload.state = 'published'),
      (select check_photo.pose from private.progress_check_photos check_photo
        where check_photo.photo_asset_id = asset.id)),
    'checkId', (select check_photo.check_id from private.progress_check_photos check_photo
      where check_photo.photo_asset_id = asset.id),
    'createdAt', asset.created_at, 'availableAt', asset.available_at
  ) into v_result from private.progress_assets asset
  where asset.id = p_asset_id and asset.student_user_id = v_student
    and asset.kind = 'photo' and asset.available_at is not null and asset.sanitized_at is not null;
  if v_result is null then raise exception 'progress_photo_forbidden' using errcode = '42501'; end if;
  return v_result;
end;
$get_own_progress_photo$;

create function public.list_own_progress_checks(p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = ''
as $list_own_progress_checks$
declare v_student uuid := private.require_own_progress_photo_reader(); v_result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 then
    raise exception 'progress_photo_invalid_input' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', progress_check.id, 'checkedOn', progress_check.checked_on,
    'createdAt', progress_check.created_at,
    'photos', coalesce((select jsonb_agg(jsonb_build_object(
      'assetId', asset.id, 'pose', check_photo.pose, 'position', check_photo.position,
      'bucketId', asset.bucket_id, 'objectName', asset.object_name,
      'mimeType', asset.mime_type, 'bytes', asset.byte_size,
      'width', asset.width, 'height', asset.height
    ) order by check_photo.position)
      from private.progress_check_photos check_photo
      join private.progress_assets asset on asset.id = check_photo.photo_asset_id
      where check_photo.check_id = progress_check.id and asset.student_user_id = v_student
        and asset.kind = 'photo' and asset.available_at is not null
        and asset.sanitized_at is not null), '[]'::jsonb)
  ) order by progress_check.checked_on desc, progress_check.created_at desc, progress_check.id desc), '[]'::jsonb)
    into v_result from (select * from private.progress_checks progress_check
      where progress_check.student_user_id = v_student
      order by progress_check.checked_on desc, progress_check.created_at desc, progress_check.id desc
      limit p_limit offset p_offset) progress_check;
  return v_result;
end;
$list_own_progress_checks$;

create function public.create_own_progress_check(p_checked_on text, p_asset_ids uuid[])
returns jsonb language plpgsql security definer set search_path = ''
as $create_own_progress_check$
declare
  v_relationship record;
  v_checked_on date;
  v_check_id uuid;
  v_valid_count integer;
  v_pose_count integer;
begin
  if p_checked_on is null or p_checked_on !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or p_asset_ids is null or cardinality(p_asset_ids) not between 1 and 3
    or cardinality(p_asset_ids) <> (select count(distinct selected.asset_id)
      from unnest(p_asset_ids) selected(asset_id)) then
    raise exception 'progress_check_invalid_input' using errcode = '22023';
  end if;
  begin
    v_checked_on := pg_catalog.to_date(p_checked_on, 'YYYY-MM-DD');
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception 'progress_check_invalid_input' using errcode = '22023';
  end;
  if pg_catalog.to_char(v_checked_on, 'YYYY-MM-DD') <> p_checked_on
    or v_checked_on > (clock_timestamp() at time zone 'America/Santiago')::date then
    raise exception 'progress_check_invalid_input' using errcode = '22023';
  end if;
  select * into v_relationship from private.require_own_active_student_relationship();
  perform asset.id from unnest(p_asset_ids) selected(asset_id)
    join private.progress_assets asset on asset.id = selected.asset_id
    where asset.student_user_id = v_relationship.student_user_id
    order by asset.id for update of asset;
  select count(*), count(distinct upload.pose) into v_valid_count, v_pose_count
    from unnest(p_asset_ids) selected(asset_id)
    join private.progress_assets asset on asset.id = selected.asset_id
    join private.progress_photo_uploads upload on upload.final_asset_id = asset.id
    where asset.student_user_id = v_relationship.student_user_id
      and asset.kind = 'photo' and asset.bucket_id = 'progress-check-photos'
      and asset.available_at is not null and asset.sanitized_at is not null
      and upload.student_user_id = v_relationship.student_user_id
      and upload.state = 'published'
      and not exists (select 1 from private.progress_check_photos check_photo
        where check_photo.photo_asset_id = asset.id);
  if v_valid_count <> cardinality(p_asset_ids) then
    raise exception 'progress_check_asset_forbidden' using errcode = '42501';
  end if;
  if v_pose_count <> cardinality(p_asset_ids) then
    raise exception 'progress_check_duplicate_pose' using errcode = '22023';
  end if;
  insert into private.progress_checks (student_user_id, checked_on)
    values (v_relationship.student_user_id, v_checked_on) returning id into v_check_id;
  insert into private.progress_check_photos
    (check_id, photo_asset_id, student_user_id, pose, position)
  select v_check_id, asset.id, v_relationship.student_user_id, upload.pose, selected.position::smallint
  from unnest(p_asset_ids) with ordinality selected(asset_id, position)
  join private.progress_assets asset on asset.id = selected.asset_id
  join private.progress_photo_uploads upload on upload.final_asset_id = asset.id
    and upload.student_user_id = v_relationship.student_user_id and upload.state = 'published'
  order by selected.position;
  return jsonb_build_object('id', v_check_id, 'checkedOn', v_checked_on);
end;
$create_own_progress_check$;

revoke all on function public.list_own_progress_photo_uploads(integer, integer),
  public.list_own_progress_photos(integer, integer), public.get_own_progress_photo(uuid),
  public.list_own_progress_checks(integer, integer), public.create_own_progress_check(text, uuid[])
  from public, anon, authenticated;
grant execute on function public.list_own_progress_photo_uploads(integer, integer),
  public.list_own_progress_photos(integer, integer), public.get_own_progress_photo(uuid),
  public.list_own_progress_checks(integer, integer), public.create_own_progress_check(text, uuid[])
  to authenticated;

commit;
