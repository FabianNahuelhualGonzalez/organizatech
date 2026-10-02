begin;

-- The staging bucket remains private and bounded. HEIC is intentionally excluded:
-- the deployed Sharp runtime must prove actual HEVC decoding before enabling it.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
where id = 'progress-check-staging' and public = false and file_size_limit = 20971520;

alter table private.progress_photo_uploads
  drop constraint progress_photo_uploads_object_name_check,
  drop constraint progress_photo_uploads_mime_type_check,
  drop constraint progress_photo_uploads_extension_check,
  drop constraint progress_photo_uploads_check1;

alter table private.progress_photo_uploads
  add constraint progress_photo_uploads_object_name_check check (object_name ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'),
  add constraint progress_photo_uploads_mime_type_check check (mime_type in
    ('image/jpeg', 'image/png', 'image/webp')),
  add constraint progress_photo_uploads_extension_check check (extension in ('jpg', 'png', 'webp')),
  add constraint progress_photo_uploads_format_check check (
    (mime_type = 'image/jpeg' and extension = 'jpg') or
    (mime_type = 'image/png' and extension = 'png') or
    (mime_type = 'image/webp' and extension = 'webp'));

create or replace function public.begin_own_progress_photo_upload(p_pose text, p_format text)
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
    or p_format is null or p_format not in ('jpeg', 'png', 'webp') then
    raise exception 'progress_photo_invalid_input' using errcode = '22023';
  end if;
  select * into v_relationship from private.require_own_active_student_relationship();
  if (select count(*) from private.progress_photo_uploads upload
      where upload.student_user_id = v_relationship.student_user_id
        and upload.state in ('pending', 'queued', 'processing')
        and upload.expires_at > v_now) >= 3 then
    raise exception 'progress_photo_too_many_uploads' using errcode = '22023';
  end if;
  v_extension := case p_format when 'jpeg' then 'jpg' else p_format end;
  v_mime := case p_format when 'jpeg' then 'image/jpeg' when 'png' then 'image/png'
    else 'image/webp' end;
  v_name := gen_random_uuid()::text || '/' || gen_random_uuid()::text || '.' || v_extension;
  insert into private.progress_photo_uploads
    (id, student_user_id, object_name, pose, mime_type, extension, created_at, expires_at)
  values (v_id, v_relationship.student_user_id, v_name, p_pose, v_mime, v_extension,
    v_now, v_now + interval '1 hour');
  return jsonb_build_object('uploadId', v_id, 'bucketId', 'progress-check-staging',
    'objectName', v_name, 'mimeType', v_mime, 'expiresAt', v_now + interval '1 hour');
end;
$begin_own_progress_photo_upload$;

revoke all on function public.begin_own_progress_photo_upload(text, text)
  from public, anon, authenticated;
grant execute on function public.begin_own_progress_photo_upload(text, text)
  to authenticated;

commit;
