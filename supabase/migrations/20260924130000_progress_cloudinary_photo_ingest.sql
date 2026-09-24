-- Local proposal only. Apply to QA after audit and explicit authorization.
-- The secret named progress_photo_attestation_key must be provisioned in Vault
-- separately and match the server-only PROGRESS_PHOTO_ATTESTATION_KEY.
begin;

create table private.progress_cloudinary_photos (
  asset_id uuid primary key references private.progress_assets(id) on delete cascade,
  cloudinary_asset_id text not null unique
    check (cloudinary_asset_id ~ '^[A-Za-z0-9_-]{16,64}$')
);
alter table private.progress_cloudinary_photos enable row level security;
alter table private.progress_cloudinary_photos force row level security;
revoke all on table private.progress_cloudinary_photos from public, anon, authenticated;

create function public.register_own_cloudinary_progress_photo(
  p_asset_id uuid, p_cloudinary_asset_id text, p_mime text, p_extension text,
  p_bytes bigint, p_width integer, p_height integer, p_pose text,
  p_issued_at bigint, p_attestation text
) returns uuid language plpgsql security definer set search_path = '' as $register_own_cloudinary_progress_photo$
declare
  v_student uuid := auth.uid();
  v_secret text;
  v_expected text;
  v_now timestamptz := clock_timestamp();
  v_check_id uuid := gen_random_uuid();
begin
  if v_student is null or p_asset_id is null
    or p_asset_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_cloudinary_asset_id is null or p_cloudinary_asset_id !~ '^[A-Za-z0-9_-]{16,64}$'
    or p_bytes is null or p_bytes not between 1 and 20971520
    or p_width is null or p_width not between 1 and 50000
    or p_height is null or p_height not between 1 and 50000
    or p_pose is null or p_pose not in ('frente', 'perfil', 'espalda')
    or p_mime is null or p_extension is null
    or not (
      (p_mime = 'image/jpeg' and p_extension in ('jpg', 'jpeg'))
      or (p_mime = 'image/png' and p_extension = 'png')
      or (p_mime = 'image/webp' and p_extension = 'webp')
      or (p_mime = 'image/heic' and p_extension = 'heic')
    )
    or p_issued_at is null or p_issued_at not between
      extract(epoch from v_now)::bigint - 300 and extract(epoch from v_now)::bigint + 30
    or p_attestation is null or p_attestation !~ '^[0-9a-f]{64}$'
  then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;

  select secret.decrypted_secret into v_secret
  from vault.decrypted_secrets secret
  where secret.name = 'progress_photo_attestation_key' limit 1;
  if v_secret is null or char_length(v_secret) < 32 then
    raise exception 'progress_photo_unconfigured' using errcode = '55000';
  end if;
  v_expected := pg_catalog.encode(extensions.hmac(
    pg_catalog.convert_to(
      v_student::text || '|' || p_asset_id::text || '|' || p_cloudinary_asset_id || '|' ||
      p_mime || '|' || p_extension || '|' || p_bytes::text || '|' || p_width::text || '|' ||
      p_height::text || '|' || p_issued_at::text, 'UTF8'),
    pg_catalog.convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  if v_expected <> p_attestation then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;

  -- Locks the active relationship again after the external upload. A stale
  -- upload cannot become a reportable asset after unlinking.
  perform 1 from private.require_own_active_student_relationship();

  insert into private.progress_assets (
    id, student_user_id, kind, bucket_id, object_name, mime_type, extension,
    byte_size, width, height, sanitized_at, available_at, created_at
  ) values (
    p_asset_id, v_student, 'photo', 'progress-check-photos',
    gen_random_uuid()::text || '/' || p_asset_id::text || '.' || p_extension,
    p_mime, p_extension, p_bytes, p_width, p_height, v_now, v_now, v_now
  );
  insert into private.progress_cloudinary_photos (asset_id, cloudinary_asset_id)
  values (p_asset_id, p_cloudinary_asset_id);
  insert into private.progress_checks (id, student_user_id, checked_on, created_at)
  values (v_check_id, v_student, (v_now at time zone 'America/Santiago')::date, v_now);
  insert into private.progress_check_photos (check_id, photo_asset_id, student_user_id, pose, position)
  values (v_check_id, p_asset_id, v_student, p_pose, 1);
  return p_asset_id;
end;
$register_own_cloudinary_progress_photo$;

create function public.get_own_cloudinary_progress_photo(
  p_asset_id uuid, p_report_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $get_own_cloudinary_progress_photo$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  if v_actor is null or p_asset_id is null then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'cloudinaryAssetId', cloudinary.cloudinary_asset_id,
    'mimeType', asset.mime_type
  ) into v_result
  from private.progress_cloudinary_photos cloudinary
  join private.progress_assets asset on asset.id = cloudinary.asset_id
  where asset.id = p_asset_id and asset.kind = 'photo'
    and asset.sanitized_at is not null and asset.available_at is not null
    and (
      (p_report_id is null and asset.student_user_id = v_actor
        and exists (select 1 from public.user_registrations registration
          where registration.user_id = v_actor))
      or (p_report_id is not null and exists (
        select 1 from private.progress_report_items item
        join private.progress_reports report on report.id = item.report_id
        join private.coach_relationship_episodes episode
          on episode.id = report.relationship_episode_id
          and episode.student_user_id = report.student_user_id
          and episode.coach_user_id = report.coach_user_id
          and episode.ended_at is null
        where item.report_id = p_report_id and item.asset_id = asset.id
          and item.student_user_id = asset.student_user_id
          and report.coach_user_id = v_actor
          and exists (select 1 from public.coach_registrations registration
            where registration.user_id = v_actor)
      ))
    );
  if v_result is null then
    raise exception 'progress_photo_forbidden' using errcode = '42501';
  end if;
  return v_result;
end;
$get_own_cloudinary_progress_photo$;

revoke all on function public.register_own_cloudinary_progress_photo(
  uuid, text, text, text, bigint, integer, integer, text, bigint, text
), public.get_own_cloudinary_progress_photo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.register_own_cloudinary_progress_photo(
  uuid, text, text, text, bigint, integer, integer, text, bigint, text
), public.get_own_cloudinary_progress_photo(uuid, uuid) to authenticated;
commit;
