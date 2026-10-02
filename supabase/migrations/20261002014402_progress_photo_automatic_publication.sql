-- Local proposal: targeted automatic publication. Apply only after separate QA approval.
begin;

alter table private.progress_photo_uploads
  add column automatic_publication boolean not null default false,
  add column automatic_attempt_id uuid,
  add column cancelled_by_student boolean not null default false;

-- Report snapshots keep their foreign keys; a deleted photo becomes invisible
-- atomically, while its exact private Storage object remains cleanup debt.
alter table private.progress_assets
  add column deleted_at timestamptz,
  add column deletion_cleanup_lease_until timestamptz,
  add column deleted_storage_cleaned_at timestamptz,
  add constraint progress_photo_deletion_only_photos
    check (deleted_at is null or kind = 'photo');
create index progress_photo_deleted_cleanup
  on private.progress_assets (deletion_cleanup_lease_until, deleted_at, id)
  where kind = 'photo' and deleted_at is not null
    and deleted_storage_cleaned_at is null;
alter table private.progress_checks add column deleted_at timestamptz;

create table private.progress_photo_automatic_attempts (
  id uuid primary key,
  upload_id uuid not null references private.progress_photo_uploads(id) on delete cascade,
  final_asset_id uuid not null unique,
  final_object_name text not null unique,
  state text not null check (state in ('active', 'abandoned', 'published', 'cleaned')),
  cleanup_lease_until timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create index progress_photo_automatic_attempts_cleanup
  on private.progress_photo_automatic_attempts (state, cleanup_lease_until, created_at)
  where state = 'abandoned';
alter table private.progress_photo_automatic_attempts enable row level security;
alter table private.progress_photo_automatic_attempts force row level security;
revoke all on table private.progress_photo_automatic_attempts from public, anon, authenticated;

-- A cancelled or queued reservation cannot be restaged after cleanup.
create or replace function private.can_stage_own_progress_photo(
  p_bucket_id text, p_object_name text
) returns boolean language plpgsql volatile security definer set search_path = ''
as $can_stage_own_progress_photo$
declare v_student uuid := auth.uid();
begin
  if v_student is null or p_bucket_id <> 'progress-check-staging'
    or p_object_name is null then return false; end if;
  return exists (
    select 1 from private.progress_photo_uploads upload
    join public.user_registrations registration on registration.user_id = upload.student_user_id
    join private.coach_relationship_episodes episode
      on episode.student_user_id = upload.student_user_id and episode.ended_at is null
    where upload.student_user_id = v_student and upload.bucket_id = p_bucket_id
      and upload.object_name = p_object_name and upload.state = 'pending'
      and upload.expires_at > clock_timestamp()
  );
end;
$can_stage_own_progress_photo$;

-- Keep the manual worker for untouched queued rows. Automatic retries retain their final
-- candidate address and must be reclaimed only by the targeted endpoint.
create or replace function public.claim_progress_photo_for_verification()
returns jsonb language plpgsql security definer set search_path = ''
as $claim_progress_photo_for_verification$
declare
  v_upload private.progress_photo_uploads;
  v_now timestamptz := clock_timestamp();
  v_asset_id uuid := gen_random_uuid();
  v_final_name text := gen_random_uuid()::text || '/' || v_asset_id::text || '.jpg';
begin
  if not private.progress_photo_publisher_identity() then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  select * into v_upload from private.progress_photo_uploads upload
    where upload.state = 'queued' and not upload.automatic_publication
      and upload.claimed_at is null
      and upload.expires_at > v_now
      and exists (select 1 from public.user_registrations registration
        where registration.user_id = upload.student_user_id)
      and exists (select 1 from private.coach_relationship_episodes episode
        where episode.student_user_id = upload.student_user_id and episode.ended_at is null)
      and exists (select 1 from storage.objects object
        where object.bucket_id = upload.bucket_id and object.name = upload.object_name)
    order by upload.created_at, upload.id limit 1 for update of upload skip locked;
  if not found then return null; end if;
  update private.progress_photo_uploads
    set state = 'processing', claimed_at = v_now,
      final_asset_id = v_asset_id, final_object_name = v_final_name
    where id = v_upload.id;
  return jsonb_build_object('uploadId', v_upload.id,
    'stagingBucket', v_upload.bucket_id, 'stagingPath', v_upload.object_name,
    'expectedMime', v_upload.mime_type, 'pose', v_upload.pose,
    'finalBucket', 'progress-check-photos', 'finalPath', v_final_name);
end;
$claim_progress_photo_for_verification$;

create function public.claim_progress_photo_for_student(p_student_user_id uuid, p_upload_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $claim_progress_photo_for_student$
declare
  v_upload private.progress_photo_uploads;
  v_now timestamptz;
  v_attempt_id uuid := gen_random_uuid();
  v_asset_id uuid := gen_random_uuid();
  v_final_name text := v_attempt_id::text || '/' || v_asset_id::text || '.jpg';
begin
  if not private.progress_photo_publisher_identity()
    or p_student_user_id is null or p_upload_id is null then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_student_user_id::text, 0));
  v_now := clock_timestamp();
  select * into v_upload from private.progress_photo_uploads upload
    where upload.id = p_upload_id and upload.student_user_id = p_student_user_id
      and (upload.state = 'queued'
        or (upload.state = 'processing' and upload.automatic_publication
          and upload.claimed_at < v_now - interval '2 minutes'))
      and upload.expires_at > v_now
      and (upload.claimed_at is null or upload.claimed_at < v_now - interval '15 seconds')
      and exists (select 1 from public.user_registrations registration
        where registration.user_id = upload.student_user_id)
      and exists (select 1 from private.coach_relationship_episodes episode
        where episode.student_user_id = upload.student_user_id and episode.ended_at is null)
      and exists (select 1 from storage.objects object
        where object.bucket_id = upload.bucket_id and object.name = upload.object_name)
    for update of upload skip locked;
  if not found then return null; end if;
  -- Three conversion attempts per student in a rolling minute, including retries.
  if (select count(*) from private.progress_photo_automatic_attempts attempt
      join private.progress_photo_uploads recent on recent.id = attempt.upload_id
      where recent.student_user_id = p_student_user_id
        and attempt.created_at > v_now - interval '1 minute') >= 3 then
    return null;
  end if;
  if v_upload.automatic_attempt_id is not null then
    update private.progress_photo_automatic_attempts attempt
      set state = 'abandoned', cleanup_lease_until = null
      where attempt.id = v_upload.automatic_attempt_id and attempt.upload_id = v_upload.id
        and attempt.state = 'active';
  end if;
  insert into private.progress_photo_automatic_attempts
    (id, upload_id, final_asset_id, final_object_name, state)
    values (v_attempt_id, v_upload.id, v_asset_id, v_final_name, 'active');
  update private.progress_photo_uploads
    set state = 'processing', automatic_publication = true, claimed_at = v_now,
      automatic_attempt_id = v_attempt_id,
      final_asset_id = v_asset_id, final_object_name = v_final_name
    where id = v_upload.id;
  return jsonb_build_object('uploadId', v_upload.id, 'attemptId', v_attempt_id,
    'stagingBucket', v_upload.bucket_id, 'stagingPath', v_upload.object_name,
    'expectedMime', v_upload.mime_type,
    'finalBucket', 'progress-check-photos', 'finalPath', v_final_name);
end;
$claim_progress_photo_for_student$;

create function public.release_progress_photo_for_retry(p_upload_id uuid, p_attempt_id uuid)
returns void language plpgsql security definer set search_path = ''
as $release_progress_photo_for_retry$
begin
  if not private.progress_photo_publisher_identity()
    or p_upload_id is null or p_attempt_id is null then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  update private.progress_photo_uploads set state = 'queued'
    where id = p_upload_id and automatic_attempt_id = p_attempt_id
      and state = 'processing' and automatic_publication
      and expires_at > clock_timestamp()
      and exists (select 1 from storage.objects object
        where object.bucket_id = private.progress_photo_uploads.bucket_id
          and object.name = private.progress_photo_uploads.object_name);
  if not found then raise exception 'progress_photo_forbidden' using errcode = '42501'; end if;
  update private.progress_photo_automatic_attempts
    set state = 'abandoned', cleanup_lease_until = null
    where id = p_attempt_id and upload_id = p_upload_id and state = 'active';
  if not found then raise exception 'progress_photo_forbidden' using errcode = '42501'; end if;
end;
$release_progress_photo_for_retry$;

-- The automatic path verifies that the private source still exists.
-- The legacy publication function is unchanged.
create function public.publish_verified_progress_photo_automatic(
  p_upload_id uuid, p_attempt_id uuid,
  p_byte_size bigint, p_width integer, p_height integer
) returns uuid language plpgsql security definer set search_path = ''
as $publish_verified_progress_photo_automatic$
declare
  v_upload private.progress_photo_uploads;
  v_now timestamptz := clock_timestamp();
begin
  if not private.progress_photo_publisher_identity()
    or p_upload_id is null or p_attempt_id is null
    or p_byte_size is null or p_byte_size not between 1 and 20971520
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
    or not v_upload.automatic_publication
    or v_upload.automatic_attempt_id <> p_attempt_id
    or not exists (select 1 from private.progress_photo_automatic_attempts attempt
      where attempt.id = p_attempt_id and attempt.upload_id = p_upload_id
        and attempt.state = 'active'
        and attempt.final_asset_id = v_upload.final_asset_id
        and attempt.final_object_name = v_upload.final_object_name)
    or not exists (select 1 from public.user_registrations registration
      where registration.user_id = v_upload.student_user_id)
    or not exists (select 1 from private.coach_relationship_episodes episode
      where episode.student_user_id = v_upload.student_user_id and episode.ended_at is null)
    or not exists (select 1 from storage.objects object
      where object.bucket_id = 'progress-check-photos'
        and object.name = v_upload.final_object_name)
    or not exists (select 1 from storage.objects original
      where original.bucket_id = v_upload.bucket_id
        and original.name = v_upload.object_name)
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
    set state = 'published', published_at = v_now, cleaned_at = null
    where id = p_upload_id;
  update private.progress_photo_automatic_attempts set state = 'published'
    where id = p_attempt_id and upload_id = p_upload_id and state = 'active';
  return v_upload.final_asset_id;
end;
$publish_verified_progress_photo_automatic$;

-- Allow deletion of an original after successful publication. Exact object matching
-- and technical-principal validation remain mandatory.
create or replace function private.publisher_stage_object(p_bucket_id text, p_object_name text)
returns boolean language sql stable security definer set search_path = ''
as $publisher_stage_object$
  select private.progress_photo_publisher_identity()
    and p_bucket_id = 'progress-check-staging'
    and exists (
      select 1 from private.progress_photo_uploads upload
      where upload.object_name = p_object_name
        and upload.state in ('processing', 'cleanup_pending', 'published')
    )
$publisher_stage_object$;

-- Old attempts have distinct paths and can be deleted only while abandoned.
-- A published asset never qualifies for candidate cleanup.
create or replace function private.publisher_final_candidate(p_bucket_id text,
  p_object_name text, p_insert boolean default false)
returns boolean language sql stable security definer set search_path = ''
as $publisher_final_candidate$
  select private.progress_photo_publisher_identity()
    and p_bucket_id = 'progress-check-photos'
    and (
      exists (select 1 from private.progress_photo_uploads upload
        where upload.final_object_name = p_object_name
          and upload.state in ('processing', 'cleanup_pending')
          and (not p_insert or (upload.state = 'processing'
            and upload.expires_at > clock_timestamp()
            and exists (select 1 from private.coach_relationship_episodes episode
              where episode.student_user_id = upload.student_user_id
                and episode.ended_at is null)))
          and not exists (select 1 from private.progress_assets asset
            where asset.id = upload.final_asset_id
              or (asset.bucket_id = p_bucket_id and asset.object_name = p_object_name)))
      or (not p_insert and exists (
        select 1 from private.progress_photo_automatic_attempts attempt
        where attempt.final_object_name = p_object_name and attempt.state = 'abandoned'
          and not exists (select 1 from private.progress_assets asset
            where asset.id = attempt.final_asset_id
              or (asset.bucket_id = p_bucket_id and asset.object_name = p_object_name))
      ))
      or (not p_insert and exists (
        select 1 from private.progress_assets asset
        where asset.kind = 'photo' and asset.bucket_id = p_bucket_id
          and asset.object_name = p_object_name and asset.deleted_at is not null
          and asset.deleted_storage_cleaned_at is null
      ))
    )
$publisher_final_candidate$;

-- A timed-out Vercel pass keeps its private original and can be reclaimed safely.
create or replace function public.claim_expired_progress_photo_cleanup(p_limit integer default 3)
returns jsonb language plpgsql security definer set search_path = ''
as $claim_expired_progress_photo_cleanup$
declare v_result jsonb;
begin
  if not private.progress_photo_publisher_identity()
    or p_limit is null or p_limit not between 1 and 3 then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  with candidates as (
    select upload.id from private.progress_photo_uploads upload
    where (upload.state in ('pending', 'queued') and upload.expires_at < clock_timestamp())
      or (upload.state = 'processing' and
        (upload.expires_at < clock_timestamp() or
          (not upload.automatic_publication and
            upload.claimed_at < clock_timestamp() - interval '10 minutes')))
      or (upload.state = 'cleanup_pending' and
        (upload.cleanup_lease_until is null or
          upload.cleanup_lease_until < clock_timestamp()))
    order by upload.expires_at, upload.id limit p_limit for update skip locked
  ), claimed as (
    update private.progress_photo_uploads upload
      set state = 'cleanup_pending',
        cleanup_lease_until = clock_timestamp() + interval '2 minutes'
      from candidates where upload.id = candidates.id
      returning upload.id, upload.object_name, upload.final_object_name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'uploadId', claimed.id, 'stagingPath', claimed.object_name,
    'finalPath', claimed.final_object_name)), '[]'::jsonb)
    into v_result from claimed;
  update private.progress_photo_automatic_attempts attempt
    set state = 'abandoned', cleanup_lease_until = null
    from private.progress_photo_uploads upload
    where attempt.id = upload.automatic_attempt_id
      and upload.id in (select (item->>'uploadId')::uuid
        from jsonb_array_elements(v_result) item)
      and attempt.state = 'active';
  return v_result;
end;
$claim_expired_progress_photo_cleanup$;

-- The list and exact lookup use the same server clock for visible status.
create or replace function public.list_own_progress_photo_uploads(
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $list_own_progress_photo_uploads$
declare v_student uuid := private.require_own_progress_photo_reader(); v_result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset not between 0 and 100000 then
    raise exception 'progress_photo_invalid_input' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'uploadId', upload.id, 'pose', upload.pose,
    'status', case when upload.state in ('pending', 'queued', 'processing')
      and upload.expires_at <= clock_timestamp() then 'fallida'
      when upload.state = 'pending' then 'reservada'
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
      and not upload.cancelled_by_student
      and not exists (select 1 from private.progress_assets asset
        where asset.id = upload.final_asset_id and asset.deleted_at is not null)
    order by upload.created_at desc, upload.id desc limit p_limit offset p_offset) upload;
  return v_result;
end;
$list_own_progress_photo_uploads$;

-- A changed selection is detached by its owner. Processing uploads wait until
-- the Vercel invocation is over before Storage cleanup may claim them.
create function public.get_own_progress_photo_upload(p_upload_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $get_own_progress_photo_upload$
declare
  v_student uuid := private.require_own_progress_photo_reader();
  v_result jsonb;
begin
  if p_upload_id is null then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'uploadId', upload.id, 'pose', upload.pose,
    'status', case when exists (select 1 from private.progress_assets asset
        where asset.id = upload.final_asset_id and asset.deleted_at is not null) then 'fallida'
      when upload.state = 'pending' and upload.expires_at <= clock_timestamp() then 'fallida'
      when upload.state = 'pending' then 'reservada'
      when upload.state = 'queued' and upload.expires_at <= clock_timestamp() then 'fallida'
      when upload.state = 'queued' then 'en_cola'
      when upload.state = 'processing' and upload.expires_at <= clock_timestamp() then 'fallida'
      when upload.state = 'processing' then 'procesando'
      when upload.state = 'published' then 'publicada'
      else 'fallida' end,
    'assetId', case when upload.state = 'published' and not exists (
      select 1 from private.progress_assets asset
      where asset.id = upload.final_asset_id and asset.deleted_at is not null)
      then upload.final_asset_id else null end,
    'createdAt', upload.created_at, 'expiresAt', upload.expires_at,
    'publishedAt', upload.published_at
  ) into v_result from private.progress_photo_uploads upload
    where upload.id = p_upload_id and upload.student_user_id = v_student;
  if v_result is null then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  return v_result;
end;
$get_own_progress_photo_upload$;

create function public.abandon_own_progress_photo_upload(p_upload_id uuid)
returns text language plpgsql security definer set search_path = ''
as $abandon_own_progress_photo_upload$
declare
  v_student uuid := private.require_own_progress_photo_reader();
  v_upload private.progress_photo_uploads;
begin
  if p_upload_id is null then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  select * into v_upload from private.progress_photo_uploads upload
    where upload.id = p_upload_id and upload.student_user_id = v_student
    for update of upload;
  if not found then raise exception 'progress_photo_forbidden' using errcode = '42501'; end if;
  if v_upload.state = 'published' then
    if v_upload.final_asset_id is null or exists (
      select 1 from private.progress_check_photos link
      where link.photo_asset_id = v_upload.final_asset_id
        and link.student_user_id = v_student
    ) then return 'published'; end if;
    perform private.delete_own_progress_photo(v_upload.final_asset_id, false);
    return 'cleaning';
  end if;
  if v_upload.state = 'cleaned' then
    update private.progress_photo_uploads set cancelled_by_student = true
      where id = p_upload_id;
    return 'cleaned';
  end if;
  if v_upload.state = 'cleanup_pending' then
    update private.progress_photo_uploads set cancelled_by_student = true
      where id = p_upload_id;
    return 'cleaning';
  end if;
  update private.progress_photo_uploads
    set state = 'cleanup_pending',
      cancelled_by_student = true,
      cleanup_lease_until = case when v_upload.state = 'processing'
        then clock_timestamp() + interval '2 minutes' else null end
    where id = p_upload_id;
  if v_upload.automatic_attempt_id is not null then
    update private.progress_photo_automatic_attempts
      set state = 'abandoned', cleanup_lease_until = null
      where id = v_upload.automatic_attempt_id and upload_id = p_upload_id
        and state = 'active';
  end if;
  return 'cleaning';
end;
$abandon_own_progress_photo_upload$;

create function public.claim_own_progress_photo_cleanup(p_student_user_id uuid, p_limit integer default 3)
returns jsonb language plpgsql security definer set search_path = ''
as $claim_own_progress_photo_cleanup$
declare v_result jsonb;
begin
  if not private.progress_photo_publisher_identity() or p_student_user_id is null
    or p_limit is null or p_limit not between 1 and 3 then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  with candidates as (
    select upload.id from private.progress_photo_uploads upload
    where upload.student_user_id = p_student_user_id and upload.state = 'cleanup_pending'
      and (upload.cleanup_lease_until is null
        or upload.cleanup_lease_until < clock_timestamp())
    order by upload.created_at, upload.id limit p_limit for update of upload skip locked
  ), claimed as (
    update private.progress_photo_uploads upload
      set cleanup_lease_until = clock_timestamp() + interval '2 minutes'
      from candidates where upload.id = candidates.id
      returning upload.id, upload.object_name, upload.final_object_name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'uploadId', claimed.id, 'stagingPath', claimed.object_name,
    'finalPath', claimed.final_object_name)), '[]'::jsonb)
    into v_result from claimed;
  return v_result;
end;
$claim_own_progress_photo_cleanup$;

create function public.claim_own_abandoned_progress_photo_candidates(
  p_student_user_id uuid, p_limit integer default 3
) returns jsonb language plpgsql security definer set search_path = ''
as $claim_own_abandoned_progress_photo_candidates$
declare v_result jsonb;
begin
  if not private.progress_photo_publisher_identity() or p_student_user_id is null
    or p_limit is null or p_limit not between 1 and 3 then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  with candidates as (
    select attempt.id from private.progress_photo_automatic_attempts attempt
      join private.progress_photo_uploads upload on upload.id = attempt.upload_id
    where upload.student_user_id = p_student_user_id and attempt.state = 'abandoned'
      and (attempt.cleanup_lease_until is null
        or attempt.cleanup_lease_until < clock_timestamp())
      and not exists (select 1 from private.progress_assets asset
        where asset.id = attempt.final_asset_id
          or (asset.bucket_id = 'progress-check-photos'
            and asset.object_name = attempt.final_object_name))
    order by attempt.created_at, attempt.id limit p_limit
      for update of attempt skip locked
  ), claimed as (
    update private.progress_photo_automatic_attempts attempt
      set cleanup_lease_until = clock_timestamp() + interval '2 minutes'
      from candidates where attempt.id = candidates.id
      returning attempt.id, attempt.final_object_name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'attemptId', claimed.id, 'finalPath', claimed.final_object_name)), '[]'::jsonb)
    into v_result from claimed;
  return v_result;
end;
$claim_own_abandoned_progress_photo_candidates$;

create function public.complete_abandoned_progress_photo_candidate(p_attempt_id uuid)
returns void language plpgsql security definer set search_path = ''
as $complete_abandoned_progress_photo_candidate$
declare v_attempt private.progress_photo_automatic_attempts;
begin
  if not private.progress_photo_publisher_identity() or p_attempt_id is null then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  select * into v_attempt from private.progress_photo_automatic_attempts attempt
    where attempt.id = p_attempt_id for update;
  if not found or v_attempt.state <> 'abandoned'
    or exists (select 1 from storage.objects object
      where object.bucket_id = 'progress-check-photos'
        and object.name = v_attempt.final_object_name)
    or exists (select 1 from private.progress_assets asset
      where asset.id = v_attempt.final_asset_id
        or (asset.bucket_id = 'progress-check-photos'
          and asset.object_name = v_attempt.final_object_name)) then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  update private.progress_photo_automatic_attempts
    set state = 'cleaned', cleanup_lease_until = null where id = p_attempt_id;
end;
$complete_abandoned_progress_photo_candidate$;

-- Publication records cleanup debt before returning success. A later bounded
-- pass retries without touching the published final asset.
create function public.claim_own_published_progress_photo_staging_cleanup(
  p_student_user_id uuid, p_limit integer default 3
) returns jsonb language plpgsql security definer set search_path = ''
as $claim_own_published_progress_photo_staging_cleanup$
declare v_result jsonb;
begin
  if not private.progress_photo_publisher_identity() or p_student_user_id is null
    or p_limit is null or p_limit not between 1 and 3 then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  with candidates as (
    select upload.id from private.progress_photo_uploads upload
    where upload.student_user_id = p_student_user_id and upload.state = 'published'
      and upload.automatic_publication and upload.cleaned_at is null
      and (upload.cleanup_lease_until is null
        or upload.cleanup_lease_until < clock_timestamp())
    order by upload.published_at, upload.id limit p_limit for update of upload skip locked
  ), claimed as (
    update private.progress_photo_uploads upload
      set cleanup_lease_until = clock_timestamp() + interval '30 seconds'
      from candidates where upload.id = candidates.id
      returning upload.id, upload.object_name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'uploadId', claimed.id, 'stagingPath', claimed.object_name)), '[]'::jsonb)
    into v_result from claimed;
  return v_result;
end;
$claim_own_published_progress_photo_staging_cleanup$;

create function public.complete_published_progress_photo_staging_cleanup(p_upload_id uuid)
returns void language plpgsql security definer set search_path = ''
as $complete_published_progress_photo_staging_cleanup$
declare v_upload private.progress_photo_uploads;
begin
  if not private.progress_photo_publisher_identity() or p_upload_id is null then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  select * into v_upload from private.progress_photo_uploads upload
    where upload.id = p_upload_id for update;
  if not found or v_upload.state <> 'published' or not v_upload.automatic_publication
    or exists (select 1 from storage.objects object
      where object.bucket_id = v_upload.bucket_id and object.name = v_upload.object_name) then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  update private.progress_photo_uploads
    set cleaned_at = clock_timestamp(), cleanup_lease_until = null
    where id = p_upload_id;
end;
$complete_published_progress_photo_staging_cleanup$;

-- Deletion is a logical, transactionally visible change. Both public calls
-- accept only an asset ID; ownership, check size and Storage address are SQL data.
create function public.get_own_progress_photo_deletion_target(p_asset_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $get_own_progress_photo_deletion_target$
declare
  v_student uuid := private.require_own_progress_photo_reader();
  v_check_id uuid;
  v_count integer;
begin
  if p_asset_id is null or not exists (
    select 1 from private.progress_assets asset
    where asset.id = p_asset_id and asset.student_user_id = v_student
      and asset.kind = 'photo' and asset.deleted_at is null
  ) then raise exception 'progress_photo_forbidden' using errcode = '42501'; end if;
  select link.check_id into v_check_id from private.progress_check_photos link
    where link.photo_asset_id = p_asset_id and link.student_user_id = v_student;
  if v_check_id is null then return jsonb_build_object('kind', 'photo'); end if;
  if not exists (select 1 from private.progress_checks progress_check
    where progress_check.id = v_check_id
      and progress_check.student_user_id = v_student
      and progress_check.deleted_at is null) then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  select count(*) into v_count from private.progress_check_photos link
    join private.progress_assets asset on asset.id = link.photo_asset_id
    where link.check_id = v_check_id and link.student_user_id = v_student
      and asset.student_user_id = v_student and asset.deleted_at is null;
  return jsonb_build_object('kind', case when v_count = 1 then 'check' else 'photo' end);
end;
$get_own_progress_photo_deletion_target$;
revoke all on function public.get_own_progress_photo_deletion_target(uuid)
  from public, anon, authenticated;
grant execute on function public.get_own_progress_photo_deletion_target(uuid)
  to authenticated;

create function private.delete_own_progress_photo(
  p_asset_id uuid, p_delete_last_check boolean
) returns text language plpgsql security definer set search_path = ''
as $delete_own_progress_photo$
declare
  v_student uuid := private.require_own_progress_photo_reader();
  v_asset private.progress_assets;
  v_check private.progress_checks;
  v_check_id uuid;
  v_remaining integer;
begin
  if p_asset_id is null or p_delete_last_check is null then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  select * into v_asset from private.progress_assets asset
    where asset.id = p_asset_id and asset.student_user_id = v_student
      and asset.kind = 'photo' and asset.bucket_id = 'progress-check-photos'
    for update of asset;
  if not found then raise exception 'progress_photo_forbidden' using errcode = '42501'; end if;
  if v_asset.deleted_at is not null then return 'already_deleted'; end if;
  select link.check_id into v_check_id from private.progress_check_photos link
    where link.photo_asset_id = p_asset_id and link.student_user_id = v_student;
  if v_check_id is not null then
    select * into v_check from private.progress_checks progress_check
      where progress_check.id = v_check_id
        and progress_check.student_user_id = v_student
      for update of progress_check;
    if not found or v_check.deleted_at is not null then
      raise exception 'progress_photo_changed' using errcode = 'P4090';
    end if;
    select count(*) into v_remaining from private.progress_check_photos link
      join private.progress_assets asset on asset.id = link.photo_asset_id
      where link.check_id = v_check_id and link.student_user_id = v_student
        and asset.student_user_id = v_student and asset.deleted_at is null;
    if (v_remaining = 1) <> p_delete_last_check then
      raise exception 'progress_photo_changed' using errcode = 'P4090';
    end if;
  elsif p_delete_last_check then
    raise exception 'progress_photo_changed' using errcode = 'P4090';
  end if;
  update private.progress_assets set deleted_at = clock_timestamp()
    where id = p_asset_id and student_user_id = v_student and deleted_at is null;
  if v_check_id is not null and v_remaining = 1 then
    update private.progress_checks set deleted_at = clock_timestamp()
      where id = v_check_id and student_user_id = v_student and deleted_at is null;
    return 'check_deleted';
  end if;
  return 'photo_deleted';
end;
$delete_own_progress_photo$;
revoke all on function private.delete_own_progress_photo(uuid, boolean)
  from public, anon, authenticated;

create function public.delete_own_progress_photo(p_asset_id uuid)
returns text language sql security definer set search_path = ''
as $delete_own_progress_photo$
  select private.delete_own_progress_photo(p_asset_id, false)
$delete_own_progress_photo$;
create function public.delete_own_progress_check(p_asset_id uuid)
returns text language sql security definer set search_path = ''
as $delete_own_progress_check$
  select private.delete_own_progress_photo(p_asset_id, true)
$delete_own_progress_check$;
revoke all on function public.delete_own_progress_photo(uuid),
  public.delete_own_progress_check(uuid) from public, anon, authenticated;
grant execute on function public.delete_own_progress_photo(uuid),
  public.delete_own_progress_check(uuid) to authenticated;

-- Only the technical publisher can claim and remove an exact deleted final.
-- The object stays hidden from Student and Coach even when Storage is down.
create function public.claim_own_deleted_progress_photo_cleanup(
  p_student_user_id uuid, p_limit integer default 3
) returns jsonb language plpgsql security definer set search_path = ''
as $claim_own_deleted_progress_photo_cleanup$
declare v_result jsonb;
begin
  if not private.progress_photo_publisher_identity() or p_student_user_id is null
    or p_limit is null or p_limit not between 1 and 3 then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  with candidates as (
    select asset.id from private.progress_assets asset
    where asset.student_user_id = p_student_user_id and asset.kind = 'photo'
      and asset.bucket_id = 'progress-check-photos'
      and asset.deleted_at is not null and asset.deleted_storage_cleaned_at is null
      and (asset.deletion_cleanup_lease_until is null
        or asset.deletion_cleanup_lease_until < clock_timestamp())
    order by asset.deleted_at, asset.id limit p_limit
      for update of asset skip locked
  ), claimed as (
    update private.progress_assets asset
      set deletion_cleanup_lease_until = clock_timestamp() + interval '2 minutes'
      from candidates where asset.id = candidates.id
      returning asset.id, asset.object_name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'assetId', claimed.id, 'finalPath', claimed.object_name)), '[]'::jsonb)
    into v_result from claimed;
  return v_result;
end;
$claim_own_deleted_progress_photo_cleanup$;

create function public.complete_deleted_progress_photo_cleanup(p_asset_id uuid)
returns void language plpgsql security definer set search_path = ''
as $complete_deleted_progress_photo_cleanup$
declare v_asset private.progress_assets;
begin
  if not private.progress_photo_publisher_identity() or p_asset_id is null then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  select * into v_asset from private.progress_assets asset
    where asset.id = p_asset_id for update of asset;
  if not found or v_asset.kind <> 'photo' or v_asset.deleted_at is null
    or exists (select 1 from storage.objects object
      where object.bucket_id = v_asset.bucket_id
        and object.name = v_asset.object_name) then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  update private.progress_assets
    set deleted_storage_cleaned_at = clock_timestamp(),
      deletion_cleanup_lease_until = null
    where id = p_asset_id;
end;
$complete_deleted_progress_photo_cleanup$;
revoke all on function public.claim_own_deleted_progress_photo_cleanup(uuid, integer),
  public.complete_deleted_progress_photo_cleanup(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_own_deleted_progress_photo_cleanup(uuid, integer),
  public.complete_deleted_progress_photo_cleanup(uuid)
  to progress_photo_publisher;

-- Storage reads must use the live asset state; immutable report snapshots do
-- not authorize a deleted photo. Medical documents retain their existing path.
create or replace function private.can_read_progress_object(
  p_bucket_id text, p_object_name text
) returns boolean language plpgsql stable security definer set search_path = ''
as $can_read_progress_object$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or p_bucket_id not in
    ('progress-check-photos', 'progress-medical-documents')
    or p_object_name is null then return false; end if;
  return exists (
    select 1 from private.progress_assets asset
    where asset.bucket_id = p_bucket_id and asset.object_name = p_object_name
      and asset.available_at is not null
      and (asset.kind <> 'photo' or
        (asset.sanitized_at is not null and asset.deleted_at is null))
      and (asset.student_user_id = v_actor
        or (asset.kind = 'medical_document'
          and private.can_coach_read_medical_document_asset(asset.id, v_actor))
        or (asset.kind = 'photo' and exists (
          select 1 from private.progress_report_items item
          join private.progress_reports report on report.id = item.report_id
          join private.coach_relationship_episodes episode
            on episode.id = report.relationship_episode_id
              and episode.student_user_id = report.student_user_id
              and episode.coach_user_id = report.coach_user_id
              and episode.ended_at is null
          where item.asset_id = asset.id and report.coach_user_id = v_actor))));
end;
$can_read_progress_object$;

create or replace function private.progress_report_view(p_report_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $progress_report_view$
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
      join private.progress_assets asset on asset.id = item.asset_id
      where item.report_id = report.id
        and (asset.kind <> 'photo' or asset.deleted_at is null)
    ), '[]'::jsonb)
  ) from private.progress_reports report
  left join private.progress_report_reviews review on review.report_id = report.id
  where report.id = p_report_id and (report.kind <> 'photos' or exists (
    select 1 from private.progress_report_items item
    join private.progress_assets asset on asset.id = item.asset_id
    where item.report_id = report.id and asset.kind = 'photo'
      and asset.deleted_at is null
  ));
$progress_report_view$;

-- A concurrent send cannot create a fresh immutable snapshot of a photo that
-- was just deleted. The original trigger remains attached to this function.
create or replace function private.enforce_progress_report_item_immutable()
returns trigger language plpgsql security definer set search_path = ''
as $enforce_progress_report_item_immutable$
begin
  if tg_op <> 'INSERT' then
    raise exception 'progress_report_item_immutable' using errcode = '55000';
  end if;
  if not exists (
    select 1 from private.progress_reports report
    join private.progress_assets asset
      on asset.id = new.asset_id and asset.student_user_id = report.student_user_id
      and asset.available_at is not null
    where report.id = new.report_id and report.student_user_id = new.student_user_id
      and ((report.kind = 'photos' and asset.kind = 'photo'
        and asset.sanitized_at is not null and asset.deleted_at is null
        and exists (select 1 from private.progress_checks progress_check
          where progress_check.id = new.check_id
            and progress_check.student_user_id = report.student_user_id
            and progress_check.deleted_at is null))
        or (report.kind = 'medical_document' and asset.kind = 'medical_document'))
  ) then
    raise exception 'progress_report_asset_forbidden' using errcode = '42501';
  end if;
  return new;
end;
$enforce_progress_report_item_immutable$;

create or replace function public.list_own_progress_photos(
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = ''
as $list_own_progress_photos$
declare v_student uuid := private.require_own_progress_photo_reader(); v_result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset not between 0 and 100000 then
    raise exception 'progress_photo_invalid_input' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'assetId', asset.id, 'bucketId', asset.bucket_id,
    'objectName', asset.object_name, 'mimeType', asset.mime_type,
    'bytes', asset.byte_size, 'width', asset.width, 'height', asset.height,
    'pose', coalesce((select upload.pose from private.progress_photo_uploads upload
      where upload.final_asset_id = asset.id and upload.student_user_id = v_student
        and upload.state = 'published'),
      (select link.pose from private.progress_check_photos link
        where link.photo_asset_id = asset.id)),
    'checkId', (select link.check_id from private.progress_check_photos link
      join private.progress_checks progress_check on progress_check.id = link.check_id
      where link.photo_asset_id = asset.id and progress_check.deleted_at is null),
    'createdAt', asset.created_at, 'availableAt', asset.available_at
  ) order by asset.created_at desc, asset.id desc), '[]'::jsonb) into v_result
  from (select * from private.progress_assets asset
    where asset.student_user_id = v_student and asset.kind = 'photo'
      and asset.available_at is not null and asset.sanitized_at is not null
      and asset.deleted_at is null
    order by asset.created_at desc, asset.id desc limit p_limit offset p_offset) asset;
  return v_result;
end;
$list_own_progress_photos$;

create or replace function public.get_own_progress_photo(p_asset_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $get_own_progress_photo$
declare v_student uuid := private.require_own_progress_photo_reader(); v_result jsonb;
begin
  if p_asset_id is null then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'assetId', asset.id, 'bucketId', asset.bucket_id,
    'objectName', asset.object_name, 'mimeType', asset.mime_type,
    'bytes', asset.byte_size, 'width', asset.width, 'height', asset.height,
    'pose', coalesce((select upload.pose from private.progress_photo_uploads upload
      where upload.final_asset_id = asset.id and upload.student_user_id = v_student
        and upload.state = 'published'),
      (select link.pose from private.progress_check_photos link
        where link.photo_asset_id = asset.id)),
    'checkId', (select link.check_id from private.progress_check_photos link
      join private.progress_checks progress_check on progress_check.id = link.check_id
      where link.photo_asset_id = asset.id and progress_check.deleted_at is null),
    'createdAt', asset.created_at, 'availableAt', asset.available_at
  ) into v_result from private.progress_assets asset
  where asset.id = p_asset_id and asset.student_user_id = v_student
    and asset.kind = 'photo' and asset.available_at is not null
    and asset.sanitized_at is not null and asset.deleted_at is null;
  if v_result is null then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  return v_result;
end;
$get_own_progress_photo$;

create or replace function public.list_own_progress_checks(
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = ''
as $list_own_progress_checks$
declare v_student uuid := private.require_own_progress_photo_reader(); v_result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset not between 0 and 100000 then
    raise exception 'progress_photo_invalid_input' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', progress_check.id, 'checkedOn', progress_check.checked_on,
    'createdAt', progress_check.created_at,
    'photos', coalesce((select jsonb_agg(jsonb_build_object(
      'assetId', asset.id, 'pose', link.pose, 'position', link.position,
      'bucketId', asset.bucket_id, 'objectName', asset.object_name,
      'mimeType', asset.mime_type, 'bytes', asset.byte_size,
      'width', asset.width, 'height', asset.height
    ) order by link.position)
      from private.progress_check_photos link
      join private.progress_assets asset on asset.id = link.photo_asset_id
      where link.check_id = progress_check.id and asset.student_user_id = v_student
        and asset.kind = 'photo' and asset.available_at is not null
        and asset.sanitized_at is not null and asset.deleted_at is null), '[]'::jsonb)
  ) order by progress_check.checked_on desc, progress_check.created_at desc,
    progress_check.id desc), '[]'::jsonb) into v_result
  from (select * from private.progress_checks progress_check
    where progress_check.student_user_id = v_student
      and progress_check.deleted_at is null
      and exists (select 1 from private.progress_check_photos link
        join private.progress_assets asset on asset.id = link.photo_asset_id
        where link.check_id = progress_check.id and asset.deleted_at is null)
    order by progress_check.checked_on desc, progress_check.created_at desc,
      progress_check.id desc limit p_limit offset p_offset) progress_check;
  return v_result;
end;
$list_own_progress_checks$;

create function private.require_live_progress_check_photo()
returns trigger language plpgsql security definer set search_path = ''
as $require_live_progress_check_photo$
begin
  if not exists (select 1 from private.progress_assets asset
      where asset.id = new.photo_asset_id
        and asset.student_user_id = new.student_user_id
        and asset.kind = 'photo' and asset.deleted_at is null)
    or not exists (select 1 from private.progress_checks progress_check
      where progress_check.id = new.check_id
        and progress_check.student_user_id = new.student_user_id
        and progress_check.deleted_at is null) then
    raise exception 'progress_check_asset_forbidden' using errcode = '42501';
  end if;
  return new;
end;
$require_live_progress_check_photo$;
revoke all on function private.require_live_progress_check_photo()
  from public, anon, authenticated;
create trigger progress_check_photo_live_insert
  before insert on private.progress_check_photos
  for each row execute function private.require_live_progress_check_photo();

revoke all on function public.get_own_progress_photo_upload(uuid),
  public.abandon_own_progress_photo_upload(uuid)
  from public, anon, authenticated;
grant execute on function public.get_own_progress_photo_upload(uuid),
  public.abandon_own_progress_photo_upload(uuid) to authenticated;
revoke all on function public.claim_progress_photo_for_student(uuid, uuid),
  public.release_progress_photo_for_retry(uuid, uuid),
  public.publish_verified_progress_photo_automatic(uuid, uuid, bigint, integer, integer),
  public.claim_own_progress_photo_cleanup(uuid, integer),
  public.claim_own_abandoned_progress_photo_candidates(uuid, integer),
  public.complete_abandoned_progress_photo_candidate(uuid),
  public.claim_own_published_progress_photo_staging_cleanup(uuid, integer),
  public.complete_published_progress_photo_staging_cleanup(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_progress_photo_for_student(uuid, uuid),
  public.release_progress_photo_for_retry(uuid, uuid),
  public.publish_verified_progress_photo_automatic(uuid, uuid, bigint, integer, integer),
  public.claim_own_progress_photo_cleanup(uuid, integer),
  public.claim_own_abandoned_progress_photo_candidates(uuid, integer),
  public.complete_abandoned_progress_photo_candidate(uuid),
  public.claim_own_published_progress_photo_staging_cleanup(uuid, integer),
  public.complete_published_progress_photo_staging_cleanup(uuid)
  to progress_photo_publisher;
commit;
