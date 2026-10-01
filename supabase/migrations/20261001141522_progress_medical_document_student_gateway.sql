-- Local-only proposal. Apply to QA only after separate authorization.
begin;

create role progress_document_publisher nologin nobypassrls inherit;
grant progress_document_publisher to authenticator;
grant anon to progress_document_publisher;
grant usage on schema public, storage, private to progress_document_publisher;
grant select, insert, delete on storage.objects to progress_document_publisher;

create table private.progress_document_principals (
  auth_user_id uuid primary key references auth.users(id) on delete restrict,
  state text not null check (state in ('active', 'revoked')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  check (updated_at >= created_at),
  check ((state = 'active' and revoked_at is null) or
    (state = 'revoked' and revoked_at is not null and revoked_at >= created_at
      and updated_at >= revoked_at))
);
create unique index progress_document_one_active
  on private.progress_document_principals (state) where state = 'active';
alter table private.progress_document_principals enable row level security;
alter table private.progress_document_principals force row level security;
revoke all on private.progress_document_principals from public, anon, authenticated;
grant select on private.progress_document_principals to supabase_auth_admin;
create policy "auth hook reads document principals" on private.progress_document_principals
  for select to supabase_auth_admin using (true);

-- Keep the single Auth hook used by photos; each publisher has a distinct account and role.
create or replace function private.progress_photo_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $hook$
declare
  v_user_id uuid;
  v_claims jsonb;
  v_issued_at bigint;
  v_expires_at bigint;
  v_photo boolean;
  v_document boolean;
begin
  if current_user <> 'supabase_auth_admin' then
    raise exception 'progress_hook_forbidden' using errcode = '42501';
  end if;
  v_user_id := (event->>'user_id')::uuid;
  v_claims := event->'claims';
  if v_user_id is null or jsonb_typeof(v_claims) <> 'object' then
    raise exception 'progress_hook_invalid_event' using errcode = '22023';
  end if;
  select exists (select 1 from private.progress_photo_principals p
    where p.auth_user_id = v_user_id and p.state = 'active' and p.revoked_at is null)
    into v_photo;
  select exists (select 1 from private.progress_document_principals p
    where p.auth_user_id = v_user_id and p.state = 'active' and p.revoked_at is null)
    into v_document;
  if v_photo and v_document then
    raise exception 'progress_hook_conflicting_principal' using errcode = '42501';
  end if;
  if not v_photo and not v_document then return event; end if;
  v_issued_at := (v_claims->>'iat')::bigint;
  v_expires_at := (v_claims->>'exp')::bigint;
  if v_issued_at is null or v_expires_at is null or v_expires_at <= v_issued_at then
    raise exception 'progress_hook_invalid_claims' using errcode = '22023';
  end if;
  v_claims := jsonb_set(v_claims, '{role}',
    to_jsonb(case when v_photo then 'progress_photo_publisher'
      else 'progress_document_publisher' end));
  v_claims := jsonb_set(v_claims, '{exp}',
    to_jsonb(least(v_expires_at, v_issued_at + 900)));
  return jsonb_set(event, '{claims}', v_claims);
end;
$hook$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-document-staging', 'progress-document-staging', false, 26214400,
  array['application/pdf']::text[]);

create table private.progress_document_uploads (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references public.user_registrations(user_id) on delete cascade,
  bucket_id text not null default 'progress-document-staging'
    check (bucket_id = 'progress-document-staging'),
  object_name text not null unique check (object_name ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]pdf$'),
  state text not null default 'pending'
    check (state in ('pending', 'queued', 'processing', 'cleanup_pending', 'cleaned', 'published')),
  final_asset_id uuid unique,
  final_object_name text unique check (final_object_name is null or final_object_name ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]pdf$'),
  claimed_at timestamptz,
  cleanup_lease_until timestamptz,
  cleaned_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '1 hour'),
  check ((final_asset_id is null and final_object_name is null and claimed_at is null)
    or (final_asset_id is not null and final_object_name is not null and claimed_at is not null)),
  check (published_at is null or state = 'published'),
  check (cleaned_at is null or state in ('cleaned', 'published'))
);
create index progress_document_uploads_student
  on private.progress_document_uploads (student_user_id, created_at desc);
create index progress_document_uploads_cleanup
  on private.progress_document_uploads (cleanup_lease_until, expires_at, id)
  where state in ('pending', 'queued', 'processing', 'cleanup_pending');
alter table private.progress_document_uploads enable row level security;
alter table private.progress_document_uploads force row level security;
revoke all on private.progress_document_uploads from public, anon, authenticated;

create function private.document_publisher_identity()
returns boolean language sql stable security definer set search_path = '' as $identity$
  select auth.uid() is not null
    and current_setting('request.jwt.claim.role', true) = 'progress_document_publisher'
    and exists (select 1 from private.progress_document_principals p
      where p.auth_user_id = auth.uid() and p.state = 'active' and p.revoked_at is null)
    and not exists (select 1 from private.progress_photo_principals p
      where p.auth_user_id = auth.uid() and p.state = 'active' and p.revoked_at is null)
$identity$;
revoke all on function private.document_publisher_identity() from public, anon, authenticated;
grant execute on function private.document_publisher_identity() to progress_document_publisher;

create function private.can_stage_own_progress_document(p_bucket text, p_name text)
returns boolean language sql volatile security definer set search_path = '' as $stage$
  select auth.uid() is not null and p_bucket = 'progress-document-staging'
    and exists (select 1 from private.progress_document_uploads upload
      join public.user_registrations registration on registration.user_id = upload.student_user_id
      join private.coach_relationship_episodes episode
        on episode.student_user_id = upload.student_user_id and episode.ended_at is null
      where upload.student_user_id = auth.uid() and upload.bucket_id = p_bucket
        and upload.object_name = p_name and upload.state = 'pending'
        and upload.expires_at > clock_timestamp())
$stage$;

create function private.publisher_document_stage(p_bucket text, p_name text)
returns boolean language sql volatile security definer set search_path = '' as $stage$
  select private.document_publisher_identity() and p_bucket = 'progress-document-staging'
    and exists (select 1 from private.progress_document_uploads upload
      where upload.object_name = p_name and upload.state in ('processing', 'cleanup_pending'))
$stage$;

create function private.publisher_document_final(p_bucket text, p_name text, p_insert boolean default false)
returns boolean language sql volatile security definer set search_path = '' as $final$
  select private.document_publisher_identity() and p_bucket = 'progress-medical-documents'
    and exists (select 1 from private.progress_document_uploads upload
      where upload.final_object_name = p_name and upload.state in ('processing', 'cleanup_pending')
        and (not p_insert or (upload.state = 'processing'
          and upload.expires_at > clock_timestamp()
          and exists (select 1 from private.coach_relationship_episodes episode
            where episode.student_user_id = upload.student_user_id and episode.ended_at is null)))
        and not exists (select 1 from private.progress_assets asset
          where asset.id = upload.final_asset_id or
            (asset.bucket_id = p_bucket and asset.object_name = p_name)))
$final$;

create function private.can_select_progress_document_object(p_bucket text, p_name text)
returns boolean language sql volatile security definer set search_path = '' as $read$
  select case when p_bucket = 'progress-document-staging' then
    private.can_stage_own_progress_document(p_bucket, p_name)
      or private.publisher_document_stage(p_bucket, p_name)
    when p_bucket = 'progress-medical-documents' then
    private.can_read_progress_object(p_bucket, p_name)
      or private.publisher_document_final(p_bucket, p_name)
    else false end
$read$;
revoke all on function private.can_stage_own_progress_document(text, text),
  private.publisher_document_stage(text, text),
  private.publisher_document_final(text, text, boolean),
  private.can_select_progress_document_object(text, text)
  from public, anon, authenticated;
grant execute on function private.can_stage_own_progress_document(text, text),
  private.publisher_document_stage(text, text),
  private.publisher_document_final(text, text, boolean),
  private.can_select_progress_document_object(text, text)
  to authenticated, progress_document_publisher, progress_photo_publisher;
-- Both public restrictive policy sets evaluate their predicates for either custom role.
-- These helpers return false for the other principal and grant no write by themselves.
grant execute on function private.can_stage_own_progress_photo(text, text),
  private.publisher_stage_object(text, text),
  private.publisher_final_candidate(text, text, boolean),
  private.can_select_progress_photo_object(text, text)
  to progress_document_publisher;

create policy "progress document staging insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'progress-document-staging'
    and private.can_stage_own_progress_document(bucket_id, name));
create policy "progress document staging owner read" on storage.objects
  for select to authenticated using (bucket_id = 'progress-document-staging'
    and private.can_stage_own_progress_document(bucket_id, name));
create policy "progress document publisher stage read" on storage.objects
  for select to progress_document_publisher using (bucket_id = 'progress-document-staging'
    and private.publisher_document_stage(bucket_id, name));
create policy "progress document publisher stage delete" on storage.objects
  for delete to progress_document_publisher using (bucket_id = 'progress-document-staging'
    and private.publisher_document_stage(bucket_id, name));
create policy "progress document publisher final insert" on storage.objects
  for insert to progress_document_publisher with check (bucket_id = 'progress-medical-documents'
    and private.publisher_document_final(bucket_id, name, true));
create policy "progress document publisher final read" on storage.objects
  for select to progress_document_publisher using (bucket_id = 'progress-medical-documents'
    and private.publisher_document_final(bucket_id, name));
create policy "progress document publisher final delete" on storage.objects
  for delete to progress_document_publisher using (bucket_id = 'progress-medical-documents'
    and private.publisher_document_final(bucket_id, name));

-- Restrictive policies protect these buckets even if other permissive policies exist.
create policy "progress document restricted insert" on storage.objects
  as restrictive for insert to public with check (
    bucket_id not in ('progress-document-staging', 'progress-medical-documents')
    or (bucket_id = 'progress-document-staging'
      and private.can_stage_own_progress_document(bucket_id, name))
    or (bucket_id = 'progress-medical-documents'
      and private.publisher_document_final(bucket_id, name, true)));
create policy "progress document restricted select" on storage.objects
  as restrictive for select to public using (
    bucket_id not in ('progress-document-staging', 'progress-medical-documents')
    or private.can_select_progress_document_object(bucket_id, name));
create policy "progress document restricted update" on storage.objects
  as restrictive for update to public using (
    bucket_id not in ('progress-document-staging', 'progress-medical-documents'))
  with check (bucket_id not in ('progress-document-staging', 'progress-medical-documents'));
create policy "progress document restricted delete" on storage.objects
  as restrictive for delete to public using (
    bucket_id not in ('progress-document-staging', 'progress-medical-documents')
    or private.publisher_document_stage(bucket_id, name)
    or private.publisher_document_final(bucket_id, name));

create function public.begin_own_medical_document_upload()
returns jsonb language plpgsql security definer set search_path = '' as $begin_upload$
declare
  v_relationship record;
  v_id uuid := gen_random_uuid();
  v_name text := gen_random_uuid()::text || '/' || gen_random_uuid()::text || '.pdf';
  v_now timestamptz := clock_timestamp();
begin
  select * into v_relationship from private.require_own_active_student_relationship();
  if (select count(*) from private.progress_document_uploads upload
    where upload.student_user_id = v_relationship.student_user_id
      and upload.state in ('pending', 'queued', 'processing')
      and upload.expires_at > v_now) >= 3 then
    raise exception 'progress_document_too_many_uploads' using errcode = '22023';
  end if;
  insert into private.progress_document_uploads
    (id, student_user_id, object_name, created_at, expires_at)
  values (v_id, v_relationship.student_user_id, v_name, v_now, v_now + interval '1 hour');
  return jsonb_build_object('uploadId', v_id, 'bucketId', 'progress-document-staging',
    'objectName', v_name, 'mimeType', 'application/pdf', 'expiresAt', v_now + interval '1 hour');
end;
$begin_upload$;

create function public.finalize_own_medical_document_upload(p_upload_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $finalize_upload$
declare v_relationship record;
begin
  if p_upload_id is null then raise exception 'progress_document_invalid_input' using errcode = '22023'; end if;
  select * into v_relationship from private.require_own_active_student_relationship();
  update private.progress_document_uploads upload set state = 'queued'
    where upload.id = p_upload_id and upload.student_user_id = v_relationship.student_user_id
      and upload.state = 'pending' and upload.expires_at > clock_timestamp()
      and exists (select 1 from storage.objects object
        where object.bucket_id = upload.bucket_id and object.name = upload.object_name);
  if not found then raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  return p_upload_id;
end;
$finalize_upload$;

create function public.claim_medical_document_for_verification()
returns jsonb language plpgsql security definer set search_path = '' as $claim$
declare
  v_upload private.progress_document_uploads;
  v_now timestamptz := clock_timestamp();
  v_asset_id uuid := gen_random_uuid();
  v_final_name text := gen_random_uuid()::text || '/' || v_asset_id::text || '.pdf';
begin
  if not private.document_publisher_identity() then
    raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  select * into v_upload from private.progress_document_uploads upload
    where upload.state = 'queued' and upload.expires_at > v_now
      and exists (select 1 from public.user_registrations registration
        where registration.user_id = upload.student_user_id)
      and exists (select 1 from private.coach_relationship_episodes episode
        where episode.student_user_id = upload.student_user_id and episode.ended_at is null)
      and exists (select 1 from storage.objects object
        where object.bucket_id = upload.bucket_id and object.name = upload.object_name)
    order by upload.created_at, upload.id limit 1 for update of upload skip locked;
  if not found then return null; end if;
  update private.progress_document_uploads set state = 'processing', claimed_at = v_now,
    final_asset_id = v_asset_id, final_object_name = v_final_name where id = v_upload.id;
  return jsonb_build_object('uploadId', v_upload.id,
    'stagingBucket', v_upload.bucket_id, 'stagingPath', v_upload.object_name,
    'finalBucket', 'progress-medical-documents', 'finalPath', v_final_name);
end;
$claim$;

create function public.publish_verified_medical_document(p_upload_id uuid, p_byte_size bigint,
  p_page_count integer)
returns uuid language plpgsql security definer set search_path = '' as $publish$
declare
  v_upload private.progress_document_uploads;
  v_now timestamptz := clock_timestamp();
  v_object storage.objects;
begin
  if not private.document_publisher_identity() or p_upload_id is null
    or p_byte_size is null or p_byte_size not between 1 and 26214400
    or p_page_count is null or p_page_count not between 1 and 10000 then
    raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  select * into v_upload from private.progress_document_uploads upload
    where upload.id = p_upload_id for update;
  if not found or v_upload.state <> 'processing' or v_upload.expires_at <= v_now
    or v_upload.final_asset_id is null or v_upload.final_object_name is null then
    raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  perform 1 from private.coach_relationship_episodes episode
    where episode.student_user_id = v_upload.student_user_id and episode.ended_at is null
    for update of episode;
  if not found or not exists (select 1 from public.user_registrations registration
    where registration.user_id = v_upload.student_user_id)
    or exists (select 1 from storage.objects object
      where object.bucket_id = v_upload.bucket_id and object.name = v_upload.object_name) then
    raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  select * into v_object from storage.objects object
    where object.bucket_id = 'progress-medical-documents'
      and object.name = v_upload.final_object_name;
  if not found or v_object.metadata->>'mimetype' is distinct from 'application/pdf'
    or coalesce(v_object.metadata->>'size', '') !~ '^[0-9]{1,8}$'
    or (v_object.metadata->>'size')::bigint <> p_byte_size then
    raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  insert into private.progress_assets (id, student_user_id, kind, bucket_id, object_name,
    display_name, document_category, mime_type, extension, byte_size, page_count,
    available_at, created_at)
  values (v_upload.final_asset_id, v_upload.student_user_id, 'medical_document',
    'progress-medical-documents', v_upload.final_object_name, 'Documento médico', 'otro',
    'application/pdf', 'pdf', p_byte_size, p_page_count, v_now, v_now);
  update private.progress_document_uploads set state = 'published',
    published_at = v_now, cleaned_at = v_now where id = p_upload_id;
  return v_upload.final_asset_id;
end;
$publish$;

create function public.fail_medical_document_verification(p_upload_id uuid)
returns void language plpgsql security definer set search_path = '' as $fail$
begin
  if not private.document_publisher_identity() or p_upload_id is null then
    raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  update private.progress_document_uploads set state = 'cleanup_pending', cleanup_lease_until = null
    where id = p_upload_id and state = 'processing';
  if not found then raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
end;
$fail$;

create function public.claim_expired_medical_document_cleanup(p_limit integer default 3)
returns jsonb language plpgsql security definer set search_path = '' as $cleanup$
declare v_result jsonb;
begin
  if not private.document_publisher_identity() or p_limit is null or p_limit not between 1 and 3 then
    raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  with candidates as (
    select upload.id from private.progress_document_uploads upload
    where (upload.state in ('pending', 'queued') and upload.expires_at < clock_timestamp())
      or (upload.state = 'processing' and
        (upload.expires_at < clock_timestamp() or
          upload.claimed_at < clock_timestamp() - interval '10 minutes'))
      or (upload.state = 'cleanup_pending' and
        (upload.cleanup_lease_until is null or
          upload.cleanup_lease_until < clock_timestamp()))
    order by upload.expires_at, upload.id limit p_limit for update skip locked
  ), claimed as (
    update private.progress_document_uploads upload set state = 'cleanup_pending',
      cleanup_lease_until = clock_timestamp() + interval '2 minutes'
      from candidates where upload.id = candidates.id
      returning upload.id, upload.object_name, upload.final_object_name
  )
  select coalesce(jsonb_agg(jsonb_build_object('uploadId', claimed.id,
    'stagingPath', claimed.object_name, 'finalPath', claimed.final_object_name)), '[]'::jsonb)
    into v_result from claimed;
  return v_result;
end;
$cleanup$;

create function public.complete_medical_document_cleanup(p_upload_id uuid)
returns void language plpgsql security definer set search_path = '' as $complete$
declare v_upload private.progress_document_uploads;
begin
  if not private.document_publisher_identity() or p_upload_id is null then
    raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  select * into v_upload from private.progress_document_uploads upload
    where upload.id = p_upload_id for update;
  if not found or v_upload.state <> 'cleanup_pending'
    or exists (select 1 from storage.objects object
      where object.bucket_id = v_upload.bucket_id and object.name = v_upload.object_name)
    or exists (select 1 from storage.objects object
      where object.bucket_id = 'progress-medical-documents'
        and object.name = v_upload.final_object_name) then
    raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  update private.progress_document_uploads set state = 'cleaned',
    cleaned_at = clock_timestamp(), cleanup_lease_until = null where id = p_upload_id;
end;
$complete$;

create function private.require_own_medical_document_reader()
returns uuid language plpgsql stable security definer set search_path = '' as $reader$
declare v_student uuid := auth.uid();
begin
  if v_student is null or not exists (select 1 from public.user_registrations registration
    where registration.user_id = v_student) then
    raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  return v_student;
end;
$reader$;
revoke all on function private.require_own_medical_document_reader() from public, anon, authenticated;

create function public.list_own_medical_documents(p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $list$
declare v_student uuid := private.require_own_medical_document_reader(); v_result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset not between 0 and 100000 then
    raise exception 'progress_document_invalid_input' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('assetId', asset.id,
    'bucketId', asset.bucket_id, 'objectName', asset.object_name,
    'mimeType', asset.mime_type, 'bytes', asset.byte_size,
    'pageCount', asset.page_count, 'displayName', asset.display_name,
    'documentCategory', asset.document_category,
    'createdAt', asset.created_at, 'availableAt', asset.available_at)
    order by asset.created_at desc, asset.id desc), '[]'::jsonb) into v_result
  from (select * from private.progress_assets asset
    where asset.student_user_id = v_student and asset.kind = 'medical_document'
      and asset.available_at is not null
    order by asset.created_at desc, asset.id desc limit p_limit offset p_offset) asset;
  return v_result;
end;
$list$;

create function public.get_own_medical_document(p_asset_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $get$
declare v_student uuid := private.require_own_medical_document_reader(); v_result jsonb;
begin
  if p_asset_id is null then raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  select jsonb_build_object('assetId', asset.id, 'bucketId', asset.bucket_id,
    'objectName', asset.object_name, 'mimeType', asset.mime_type,
    'bytes', asset.byte_size, 'pageCount', asset.page_count,
    'displayName', asset.display_name, 'documentCategory', asset.document_category,
    'createdAt', asset.created_at, 'availableAt', asset.available_at)
    into v_result from private.progress_assets asset
    where asset.id = p_asset_id and asset.student_user_id = v_student
      and asset.kind = 'medical_document' and asset.available_at is not null;
  if v_result is null then raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  return v_result;
end;
$get$;

revoke all on function public.begin_own_medical_document_upload(),
  public.finalize_own_medical_document_upload(uuid),
  public.list_own_medical_documents(integer, integer), public.get_own_medical_document(uuid)
  from public, anon, authenticated;
grant execute on function public.begin_own_medical_document_upload(),
  public.finalize_own_medical_document_upload(uuid),
  public.list_own_medical_documents(integer, integer), public.get_own_medical_document(uuid)
  to authenticated;
revoke all on function public.claim_medical_document_for_verification(),
  public.publish_verified_medical_document(uuid, bigint, integer),
  public.fail_medical_document_verification(uuid),
  public.claim_expired_medical_document_cleanup(integer),
  public.complete_medical_document_cleanup(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_medical_document_for_verification(),
  public.publish_verified_medical_document(uuid, bigint, integer),
  public.fail_medical_document_verification(uuid),
  public.claim_expired_medical_document_cleanup(integer),
  public.complete_medical_document_cleanup(uuid)
  to progress_document_publisher;

commit;
