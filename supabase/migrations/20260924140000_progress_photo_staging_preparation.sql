-- Local proposal only. QA requires audit, technical account provisioning and
-- separate explicit authorization. Phase 1 remains unchanged.
begin;

-- Supabase Auth issues short-lived tokens only for an active technical principal.
create role progress_photo_publisher nologin nobypassrls inherit;
grant progress_photo_publisher to authenticator;
grant anon to progress_photo_publisher;
grant usage on schema public, storage to progress_photo_publisher;
grant select, insert, delete on storage.objects to progress_photo_publisher;

create table private.progress_photo_principals (
  auth_user_id uuid primary key references auth.users(id) on delete restrict,
  state text not null check (state in ('active', 'revoked')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  check (updated_at >= created_at),
  check ((state = 'active' and revoked_at is null)
    or (state = 'revoked' and revoked_at is not null and revoked_at >= created_at
      and updated_at >= revoked_at))
);
create unique index progress_photo_principals_one_active
  on private.progress_photo_principals (state) where state = 'active';
alter table private.progress_photo_principals enable row level security;
alter table private.progress_photo_principals force row level security;
revoke all on table private.progress_photo_principals from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant select on table private.progress_photo_principals to supabase_auth_admin;
create policy "auth hook reads technical principals" on private.progress_photo_principals
  for select to supabase_auth_admin using (true);

-- Invoker-only Auth Hook. Normal user claims are returned byte-for-byte unchanged.
create function private.progress_photo_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $progress_photo_access_token_hook$
declare
  v_user_id uuid;
  v_claims jsonb;
  v_issued_at bigint;
  v_expires_at bigint;
begin
  if current_user <> 'supabase_auth_admin' then
    raise exception 'progress_photo_hook_forbidden' using errcode = '42501';
  end if;
  v_user_id := (event->>'user_id')::uuid;
  v_claims := event->'claims';
  if v_user_id is null or jsonb_typeof(v_claims) <> 'object' then
    raise exception 'progress_photo_hook_invalid_event' using errcode = '22023';
  end if;
  if not exists (select 1 from private.progress_photo_principals principal
    where principal.auth_user_id = v_user_id and principal.state = 'active'
      and principal.revoked_at is null) then
    return event;
  end if;
  v_issued_at := (v_claims->>'iat')::bigint;
  v_expires_at := (v_claims->>'exp')::bigint;
  if v_issued_at is null or v_expires_at is null or v_expires_at <= v_issued_at then
    raise exception 'progress_photo_hook_invalid_claims' using errcode = '22023';
  end if;
  v_claims := jsonb_set(v_claims, '{role}', '"progress_photo_publisher"'::jsonb);
  v_claims := jsonb_set(v_claims, '{exp}',
    to_jsonb(least(v_expires_at, v_issued_at + 900)));
  return jsonb_set(event, '{claims}', v_claims);
end;
$progress_photo_access_token_hook$;
revoke all on function private.progress_photo_access_token_hook(jsonb)
  from public, anon, authenticated;
grant execute on function private.progress_photo_access_token_hook(jsonb)
  to supabase_auth_admin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-check-staging', 'progress-check-staging', false, 20971520,
  array['image/jpeg', 'image/webp']::text[]);

create table private.progress_photo_uploads (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references public.user_registrations(user_id) on delete cascade,
  bucket_id text not null default 'progress-check-staging'
    check (bucket_id = 'progress-check-staging'),
  object_name text not null unique
    check (object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|webp)$'),
  pose text not null check (pose in ('frente', 'perfil', 'espalda')),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/webp')),
  extension text not null check (extension in ('jpg', 'webp')),
  state text not null default 'pending'
    check (state in ('pending', 'queued', 'processing', 'cleanup_pending', 'cleaned', 'published')),
  final_asset_id uuid unique,
  final_object_name text unique
    check (final_object_name is null or final_object_name ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]jpg$'),
  claimed_at timestamptz,
  cleanup_lease_until timestamptz,
  cleaned_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '1 hour'),
  check ((mime_type = 'image/jpeg' and extension = 'jpg') or
    (mime_type = 'image/webp' and extension = 'webp')),
  check (object_name ~ ('[.]' || extension || '$')),
  check ((final_asset_id is null and final_object_name is null and claimed_at is null)
    or (final_asset_id is not null and final_object_name is not null and claimed_at is not null)),
  check (published_at is null or state = 'published'),
  check (cleaned_at is null or state in ('cleaned', 'published'))
);

create index progress_photo_uploads_student
  on private.progress_photo_uploads (student_user_id, created_at desc);
create index progress_photo_uploads_cleanup
  on private.progress_photo_uploads (cleanup_lease_until, expires_at, id)
  where state in ('pending', 'queued', 'processing', 'cleanup_pending');
alter table private.progress_photo_uploads enable row level security;
alter table private.progress_photo_uploads force row level security;
revoke all on table private.progress_photo_uploads from public, anon, authenticated;

create function private.can_stage_own_progress_photo(p_bucket_id text, p_object_name text)
returns boolean language plpgsql stable security definer set search_path = ''
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
      and upload.object_name = p_object_name and upload.expires_at > clock_timestamp()
  );
end;
$can_stage_own_progress_photo$;
revoke all on function private.can_stage_own_progress_photo(text, text)
  from public, anon, authenticated;
grant execute on function private.can_stage_own_progress_photo(text, text)
  to authenticated, progress_photo_publisher;

create function private.progress_photo_publisher_identity()
returns boolean language sql stable security definer set search_path = ''
as $progress_photo_publisher_identity$
  select auth.uid() is not null
    and current_setting('request.jwt.claim.role', true) = 'progress_photo_publisher'
    and exists (select 1 from private.progress_photo_principals principal
      where principal.auth_user_id = auth.uid() and principal.state = 'active'
        and principal.revoked_at is null)
$progress_photo_publisher_identity$;
revoke all on function private.progress_photo_publisher_identity()
  from public, anon, authenticated;
grant execute on function private.progress_photo_publisher_identity()
  to progress_photo_publisher;

create function private.publisher_stage_object(p_bucket_id text, p_object_name text)
returns boolean language sql stable security definer set search_path = ''
as $publisher_stage_object$
  select private.progress_photo_publisher_identity()
    and p_bucket_id = 'progress-check-staging'
    and exists (
      select 1 from private.progress_photo_uploads upload
      where upload.object_name = p_object_name
        and upload.state in ('processing', 'cleanup_pending')
    )
$publisher_stage_object$;

create function private.publisher_final_candidate(p_bucket_id text, p_object_name text,
  p_insert boolean default false)
returns boolean language sql stable security definer set search_path = ''
as $publisher_final_candidate$
  select private.progress_photo_publisher_identity()
    and p_bucket_id = 'progress-check-photos'
    and exists (
      select 1 from private.progress_photo_uploads upload
      where upload.final_object_name = p_object_name
        and upload.state in ('processing', 'cleanup_pending')
        and (not p_insert or (upload.state = 'processing'
          and upload.expires_at > clock_timestamp()
          and exists (select 1 from private.coach_relationship_episodes episode
            where episode.student_user_id = upload.student_user_id
              and episode.ended_at is null)))
        and not exists (select 1 from private.progress_assets asset
          where asset.id = upload.final_asset_id or
            (asset.bucket_id = p_bucket_id and asset.object_name = p_object_name))
    )
$publisher_final_candidate$;

create function private.can_select_progress_photo_object(p_bucket_id text, p_object_name text)
returns boolean language plpgsql stable security definer set search_path = ''
as $can_select_progress_photo_object$
begin
  if p_bucket_id = 'progress-check-staging' then
    return private.can_stage_own_progress_photo(p_bucket_id, p_object_name)
      or private.publisher_stage_object(p_bucket_id, p_object_name);
  elsif p_bucket_id = 'progress-check-photos' then
    return private.can_read_progress_object(p_bucket_id, p_object_name)
      or private.publisher_final_candidate(p_bucket_id, p_object_name);
  end if;
  return false;
end;
$can_select_progress_photo_object$;

revoke all on function private.publisher_stage_object(text, text),
  private.publisher_final_candidate(text, text, boolean),
  private.can_select_progress_photo_object(text, text)
  from public, anon, authenticated;
grant execute on function private.publisher_stage_object(text, text),
  private.publisher_final_candidate(text, text, boolean),
  private.can_select_progress_photo_object(text, text)
  to authenticated, progress_photo_publisher;
grant usage on schema private to progress_photo_publisher;

create policy "progress photo staging insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'progress-check-staging'
    and (select private.can_stage_own_progress_photo(bucket_id, name))
  );
create policy "progress photo staging owner read" on storage.objects
  for select to authenticated using (
    bucket_id = 'progress-check-staging'
    and (select private.can_stage_own_progress_photo(bucket_id, name))
  );
create policy "progress photo publisher stage read" on storage.objects
  for select to progress_photo_publisher using (
    bucket_id = 'progress-check-staging'
    and private.publisher_stage_object(bucket_id, name)
  );
create policy "progress photo publisher stage delete" on storage.objects
  for delete to progress_photo_publisher using (
    bucket_id = 'progress-check-staging'
    and private.publisher_stage_object(bucket_id, name)
  );
create policy "progress photo publisher final insert" on storage.objects
  for insert to progress_photo_publisher with check (
    bucket_id = 'progress-check-photos'
    and private.publisher_final_candidate(bucket_id, name, true)
  );
create policy "progress photo publisher final read" on storage.objects
  for select to progress_photo_publisher using (
    bucket_id = 'progress-check-photos'
    and private.publisher_final_candidate(bucket_id, name)
  );
create policy "progress photo publisher final delete" on storage.objects
  for delete to progress_photo_publisher using (
    bucket_id = 'progress-check-photos'
    and private.publisher_final_candidate(bucket_id, name)
  );
-- Restrictive guards also close access if another permissive Storage policy
-- happens to include these buckets. They do not affect other buckets.
create policy "progress photo restricted insert" on storage.objects
  as restrictive for insert to public with check (
    bucket_id not in ('progress-check-staging', 'progress-check-photos')
    or (bucket_id = 'progress-check-staging'
      and private.can_stage_own_progress_photo(bucket_id, name))
    or (bucket_id = 'progress-check-photos'
      and private.publisher_final_candidate(bucket_id, name, true))
  );
create policy "progress photo restricted select" on storage.objects
  as restrictive for select to public using (
    bucket_id not in ('progress-check-staging', 'progress-check-photos')
    or private.can_select_progress_photo_object(bucket_id, name)
  );
create policy "progress photo restricted update" on storage.objects
  as restrictive for update to public using (
    bucket_id not in ('progress-check-staging', 'progress-check-photos')
  ) with check (
    bucket_id not in ('progress-check-staging', 'progress-check-photos')
  );
create policy "progress photo restricted delete" on storage.objects
  as restrictive for delete to public using (
    bucket_id not in ('progress-check-staging', 'progress-check-photos')
    or private.publisher_stage_object(bucket_id, name)
    or private.publisher_final_candidate(bucket_id, name)
  );

create function public.begin_own_progress_photo_upload(p_pose text, p_format text)
returns jsonb language plpgsql security definer set search_path = ''
as $begin_own_progress_photo_upload$
declare
  v_relationship record;
  v_id uuid := gen_random_uuid();
  v_name text;
  v_mime text;
  v_extension text;
  v_now timestamptz := clock_timestamp();
begin
  if p_pose is null or p_pose not in ('frente', 'perfil', 'espalda')
    or p_format is null or p_format not in ('jpeg', 'webp') then
    raise exception 'progress_photo_invalid_input' using errcode = '22023';
  end if;
  select * into v_relationship from private.require_own_active_student_relationship();
  if (select count(*) from private.progress_photo_uploads upload
      where upload.student_user_id = v_relationship.student_user_id
        and upload.state in ('pending', 'queued', 'processing')
        and upload.expires_at > v_now) >= 3 then
    raise exception 'progress_photo_too_many_uploads' using errcode = '22023';
  end if;
  v_extension := case when p_format = 'jpeg' then 'jpg' else 'webp' end;
  v_mime := case when p_format = 'jpeg' then 'image/jpeg' else 'image/webp' end;
  v_name := gen_random_uuid()::text || '/' || gen_random_uuid()::text || '.' || v_extension;
  insert into private.progress_photo_uploads
    (id, student_user_id, object_name, pose, mime_type, extension, created_at, expires_at)
  values (v_id, v_relationship.student_user_id, v_name, p_pose, v_mime, v_extension,
    v_now, v_now + interval '1 hour');
  return jsonb_build_object('uploadId', v_id, 'bucketId', 'progress-check-staging',
    'objectName', v_name, 'mimeType', v_mime, 'expiresAt', v_now + interval '1 hour');
end;
$begin_own_progress_photo_upload$;

-- The browser may queue only its own current reservation. It cannot publish.
create function public.finalize_own_progress_photo_upload(p_upload_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $finalize_own_progress_photo_upload$
declare v_relationship record;
begin
  if p_upload_id is null then
    raise exception 'progress_photo_invalid_input' using errcode = '22023';
  end if;
  select * into v_relationship from private.require_own_active_student_relationship();
  update private.progress_photo_uploads upload set state = 'queued'
    where upload.id = p_upload_id and upload.student_user_id = v_relationship.student_user_id
      and upload.state = 'pending' and upload.expires_at > clock_timestamp()
      and exists (select 1 from storage.objects object
        where object.bucket_id = upload.bucket_id and object.name = upload.object_name);
  if not found then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  return p_upload_id;
end;
$finalize_own_progress_photo_upload$;

create function public.claim_progress_photo_for_verification()
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
    where upload.state = 'queued' and upload.expires_at > v_now
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

create function public.publish_verified_progress_photo(
  p_upload_id uuid, p_byte_size bigint, p_width integer, p_height integer
) returns uuid language plpgsql security definer set search_path = ''
as $publish_verified_progress_photo$
declare
  v_upload private.progress_photo_uploads;
  v_now timestamptz := clock_timestamp();
  v_check_id uuid := gen_random_uuid();
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
  insert into private.progress_checks (id, student_user_id, checked_on, created_at)
    values (v_check_id, v_upload.student_user_id,
      (v_now at time zone 'America/Santiago')::date, v_now);
  insert into private.progress_check_photos
    (check_id, photo_asset_id, student_user_id, pose, position)
    values (v_check_id, v_upload.final_asset_id, v_upload.student_user_id, v_upload.pose, 1);
  update private.progress_photo_uploads
    set state = 'published', published_at = v_now, cleaned_at = v_now
    where id = p_upload_id;
  return v_upload.final_asset_id;
end;
$publish_verified_progress_photo$;

create function public.fail_progress_photo_verification(p_upload_id uuid)
returns void language plpgsql security definer set search_path = ''
as $fail_progress_photo_verification$
begin
  if not private.progress_photo_publisher_identity() or p_upload_id is null then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  update private.progress_photo_uploads
    set state = 'cleanup_pending', cleanup_lease_until = null
    where id = p_upload_id and state = 'processing';
  if not found then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
end;
$fail_progress_photo_verification$;

create function public.claim_expired_progress_photo_cleanup(p_limit integer default 3)
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
          upload.claimed_at < clock_timestamp() - interval '10 minutes'))
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
  return v_result;
end;
$claim_expired_progress_photo_cleanup$;

create function public.complete_progress_photo_cleanup(p_upload_id uuid)
returns void language plpgsql security definer set search_path = ''
as $complete_progress_photo_cleanup$
declare v_upload private.progress_photo_uploads;
begin
  if not private.progress_photo_publisher_identity() or p_upload_id is null then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  select * into v_upload from private.progress_photo_uploads upload
    where upload.id = p_upload_id for update;
  if not found or v_upload.state <> 'cleanup_pending'
    or exists (select 1 from storage.objects object
      where object.bucket_id = v_upload.bucket_id and object.name = v_upload.object_name)
    or exists (select 1 from storage.objects object
      where object.bucket_id = 'progress-check-photos'
        and object.name = v_upload.final_object_name) then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  update private.progress_photo_uploads
    set state = 'cleaned', cleaned_at = clock_timestamp(), cleanup_lease_until = null
    where id = p_upload_id;
end;
$complete_progress_photo_cleanup$;

revoke all on function public.begin_own_progress_photo_upload(text, text),
  public.finalize_own_progress_photo_upload(uuid) from public, anon, authenticated;
grant execute on function public.begin_own_progress_photo_upload(text, text),
  public.finalize_own_progress_photo_upload(uuid) to authenticated;
revoke all on function public.claim_progress_photo_for_verification(),
  public.publish_verified_progress_photo(uuid, bigint, integer, integer),
  public.fail_progress_photo_verification(uuid),
  public.claim_expired_progress_photo_cleanup(integer),
  public.complete_progress_photo_cleanup(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_progress_photo_for_verification(),
  public.publish_verified_progress_photo(uuid, bigint, integer, integer),
  public.fail_progress_photo_verification(uuid),
  public.claim_expired_progress_photo_cleanup(integer),
  public.complete_progress_photo_cleanup(uuid)
  to progress_photo_publisher;
commit;
