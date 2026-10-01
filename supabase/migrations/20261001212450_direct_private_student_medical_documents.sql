-- Forward-only direct path. Legacy staging, publisher and reports remain intact.
begin;

create table private.direct_medical_document_uploads (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references public.user_registrations(user_id) on delete cascade,
  asset_id uuid not null unique default gen_random_uuid(),
  object_name text not null unique check (object_name ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]pdf$'),
  state text not null default 'pending' check (state in ('pending', 'published')),
  shared_episode_id uuid references private.coach_relationship_episodes(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  published_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '1 hour'),
  check ((state = 'pending' and published_at is null and shared_episode_id is null)
    or (state = 'published' and published_at is not null))
);
create index direct_medical_document_owner on private.direct_medical_document_uploads (student_user_id, created_at desc);
alter table private.direct_medical_document_uploads enable row level security;
alter table private.direct_medical_document_uploads force row level security;
revoke all on private.direct_medical_document_uploads from public, anon, authenticated;

-- An explicit choice can supersede an immutable legacy report without changing it.
create table private.legacy_medical_document_shares (
  asset_id uuid primary key,
  student_user_id uuid not null,
  shared_episode_id uuid references private.coach_relationship_episodes(id) on delete set null,
  foreign key (asset_id, student_user_id)
    references private.progress_assets(id, student_user_id) on delete cascade
);
alter table private.legacy_medical_document_shares enable row level security;
alter table private.legacy_medical_document_shares force row level security;
revoke all on private.legacy_medical_document_shares from public, anon, authenticated;

create function private.can_coach_read_medical_document_asset(p_asset_id uuid, p_coach uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from private.direct_medical_document_uploads direct
    join private.coach_relationship_episodes episode on episode.id = direct.shared_episode_id
      and episode.student_user_id = direct.student_user_id
      and episode.coach_user_id = p_coach and episode.ended_at is null
    where direct.asset_id = p_asset_id and direct.state = 'published')
    or exists (
      select 1 from private.legacy_medical_document_shares share
      join private.coach_relationship_episodes episode on episode.id = share.shared_episode_id
        and episode.student_user_id = share.student_user_id
        and episode.coach_user_id = p_coach and episode.ended_at is null
      where share.asset_id = p_asset_id)
    or (not exists (select 1 from private.direct_medical_document_uploads direct
          where direct.asset_id = p_asset_id)
      and not exists (select 1 from private.legacy_medical_document_shares share
          where share.asset_id = p_asset_id)
      and exists (
        select 1 from private.progress_report_items item
        join private.progress_reports report on report.id = item.report_id
        join private.coach_relationship_episodes episode on episode.id = report.relationship_episode_id
          and episode.student_user_id = report.student_user_id
          and episode.coach_user_id = report.coach_user_id and episode.ended_at is null
        where item.asset_id = p_asset_id and report.coach_user_id = p_coach))
$fn$;
revoke all on function private.can_coach_read_medical_document_asset(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.can_coach_read_medical_document_asset(uuid, uuid)
  to authenticated, progress_document_publisher, progress_photo_publisher;

create function private.can_insert_direct_medical_document(p_bucket text, p_name text)
returns boolean language sql volatile security definer set search_path = '' as $fn$
  select auth.uid() is not null and p_bucket = 'progress-medical-documents'
    and exists (select 1 from private.direct_medical_document_uploads upload
      where upload.student_user_id = auth.uid() and upload.object_name = p_name
        and upload.state = 'pending' and upload.expires_at > clock_timestamp())
$fn$;
create function private.can_select_pending_direct_medical_document(p_bucket text, p_name text)
returns boolean language sql volatile security definer set search_path = '' as $fn$
  select private.can_insert_direct_medical_document(p_bucket, p_name)
$fn$;
revoke all on function private.can_insert_direct_medical_document(text, text),
  private.can_select_pending_direct_medical_document(text, text) from public, anon, authenticated;
grant execute on function private.can_insert_direct_medical_document(text, text),
  private.can_select_pending_direct_medical_document(text, text)
  to authenticated, progress_document_publisher, progress_photo_publisher;

create policy "direct medical document reserved insert" on storage.objects
  for insert to authenticated with check
    (private.can_insert_direct_medical_document(bucket_id, name));
create policy "direct medical document pending owner read" on storage.objects
  for select to authenticated using
    (private.can_select_pending_direct_medical_document(bucket_id, name));

drop policy "progress document restricted insert" on storage.objects;
create policy "progress document restricted insert" on storage.objects
  as restrictive for insert to public with check (
    bucket_id not in ('progress-document-staging', 'progress-medical-documents')
    or (bucket_id = 'progress-document-staging'
      and private.can_stage_own_progress_document(bucket_id, name))
    or (bucket_id = 'progress-medical-documents'
      and (private.publisher_document_final(bucket_id, name, true)
        or private.can_insert_direct_medical_document(bucket_id, name))));

-- The shared episode is checked at read time. Legacy reports retain their prior path.
create or replace function private.can_read_progress_object(p_bucket_id text, p_object_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $fn$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or p_bucket_id not in ('progress-check-photos', 'progress-medical-documents')
    or p_object_name is null then return false; end if;
  return exists (
    select 1 from private.progress_assets asset
    where asset.bucket_id = p_bucket_id and asset.object_name = p_object_name
      and asset.available_at is not null
      and (asset.kind <> 'photo' or asset.sanitized_at is not null)
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
$fn$;

create or replace function private.can_select_progress_document_object(p_bucket text, p_name text)
returns boolean language sql volatile security definer set search_path = '' as $fn$
  select case when p_bucket = 'progress-document-staging' then
    private.can_stage_own_progress_document(p_bucket, p_name)
      or private.publisher_document_stage(p_bucket, p_name)
    when p_bucket = 'progress-medical-documents' then
    private.can_read_progress_object(p_bucket, p_name)
      or private.can_select_pending_direct_medical_document(p_bucket, p_name)
      or private.publisher_document_final(p_bucket, p_name)
    else false end
$fn$;

create function public.begin_direct_medical_document_upload()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_student uuid := private.require_own_medical_document_reader();
  v_id uuid := gen_random_uuid();
  v_asset uuid := gen_random_uuid();
  v_name text := gen_random_uuid()::text || '/' || v_asset::text || '.pdf';
  v_now timestamptz := clock_timestamp();
begin
  if (select count(*) from private.direct_medical_document_uploads upload
    where upload.student_user_id = v_student and upload.state = 'pending'
      and upload.expires_at > v_now) >= 3 then
    raise exception 'progress_document_too_many_uploads' using errcode = '22023'; end if;
  insert into private.direct_medical_document_uploads
    (id, student_user_id, asset_id, object_name, created_at, expires_at)
  values (v_id, v_student, v_asset, v_name, v_now, v_now + interval '1 hour');
  return jsonb_build_object('uploadId', v_id, 'bucketId', 'progress-medical-documents',
    'objectName', v_name, 'mimeType', 'application/pdf', 'expiresAt', v_now + interval '1 hour');
end;
$fn$;

create function public.finalize_direct_medical_document_upload(p_upload_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_student uuid := private.require_own_medical_document_reader();
  v_upload private.direct_medical_document_uploads;
  v_object storage.objects;
  v_bytes bigint;
  v_now timestamptz := clock_timestamp();
begin
  if p_upload_id is null then raise exception 'progress_document_invalid_input' using errcode = '22023'; end if;
  select * into v_upload from private.direct_medical_document_uploads upload
    where upload.id = p_upload_id and upload.student_user_id = v_student for update;
  if not found or v_upload.state <> 'pending' or v_upload.expires_at <= v_now then
    raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  select * into v_object from storage.objects object
    where object.bucket_id = 'progress-medical-documents'
      and object.name = v_upload.object_name;
  if not found or v_object.metadata->>'mimetype' is distinct from 'application/pdf'
    or coalesce(v_object.metadata->>'size', '') !~ '^[0-9]{1,8}$' then
    raise exception 'progress_document_invalid_object' using errcode = '42501'; end if;
  v_bytes := (v_object.metadata->>'size')::bigint;
  if v_bytes not between 1 and 26214400 then
    raise exception 'progress_document_invalid_size' using errcode = '42501'; end if;
  insert into private.progress_assets (id, student_user_id, kind, bucket_id,
    object_name, display_name, document_category, mime_type, extension,
    byte_size, available_at, created_at)
  values (v_upload.asset_id, v_student, 'medical_document', 'progress-medical-documents',
    v_upload.object_name, 'Documento médico', 'otro', 'application/pdf', 'pdf',
    v_bytes, v_now, v_now);
  update private.direct_medical_document_uploads set state = 'published', published_at = v_now
    where id = v_upload.id;
  return public.get_own_medical_document(v_upload.asset_id);
end;
$fn$;

create function public.set_own_medical_document_shared(p_asset_id uuid, p_shared boolean)
returns boolean language plpgsql security definer set search_path = '' as $fn$
declare
  v_student uuid := private.require_own_medical_document_reader();
  v_episode uuid;
begin
  if p_asset_id is null or p_shared is null then
    raise exception 'progress_document_invalid_input' using errcode = '22023'; end if;
  if p_shared then
    select episode.id into v_episode from private.coach_relationship_episodes episode
      where episode.student_user_id = v_student and episode.ended_at is null
      for update of episode;
    if not found then raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  end if;
  update private.direct_medical_document_uploads direct
    set shared_episode_id = v_episode
    where direct.asset_id = p_asset_id and direct.student_user_id = v_student
      and direct.state = 'published';
  if not found then
    if not exists (select 1 from private.progress_assets asset
      where asset.id = p_asset_id and asset.student_user_id = v_student
        and asset.kind = 'medical_document' and asset.available_at is not null) then
      raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
    insert into private.legacy_medical_document_shares
      (asset_id, student_user_id, shared_episode_id)
    values (p_asset_id, v_student, v_episode)
    on conflict (asset_id) do update set shared_episode_id = excluded.shared_episode_id
      where private.legacy_medical_document_shares.student_user_id = v_student;
    if not found then raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  end if;
  return p_shared;
end;
$fn$;

create or replace function public.list_own_medical_documents(p_limit integer default 50, p_offset integer default 0)
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
    'createdAt', asset.created_at, 'availableAt', asset.available_at,
    'sharedWithCoach', exists (select 1 from private.coach_relationship_episodes episode
      where episode.student_user_id = v_student and episode.ended_at is null
        and private.can_coach_read_medical_document_asset(asset.id, episode.coach_user_id)))
    order by asset.created_at desc, asset.id desc), '[]'::jsonb) into v_result
  from (select * from private.progress_assets asset
    where asset.student_user_id = v_student and asset.kind = 'medical_document'
      and asset.available_at is not null
    order by asset.created_at desc, asset.id desc limit p_limit offset p_offset) asset;
  return v_result;
end;
$list$;

create or replace function public.get_own_medical_document(p_asset_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $get$
declare v_student uuid := private.require_own_medical_document_reader(); v_result jsonb;
begin
  if p_asset_id is null then raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  select jsonb_build_object('assetId', asset.id, 'bucketId', asset.bucket_id,
    'objectName', asset.object_name, 'mimeType', asset.mime_type,
    'bytes', asset.byte_size, 'pageCount', asset.page_count,
    'displayName', asset.display_name, 'documentCategory', asset.document_category,
    'createdAt', asset.created_at, 'availableAt', asset.available_at,
    'sharedWithCoach', exists (select 1 from private.coach_relationship_episodes episode
      where episode.student_user_id = v_student and episode.ended_at is null
        and private.can_coach_read_medical_document_asset(asset.id, episode.coach_user_id))) into v_result
  from private.progress_assets asset where asset.id = p_asset_id
    and asset.student_user_id = v_student and asset.kind = 'medical_document'
    and asset.available_at is not null;
  if v_result is null then raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  return v_result;
end;
$get$;

create function public.list_shared_student_medical_documents(p_student_user_id uuid,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset not between 0 and 100000 then
    raise exception 'progress_document_invalid_input' using errcode = '22023'; end if;
  if auth.uid() is null or p_student_user_id is null or not exists (
    select 1 from private.coach_relationship_episodes episode
    where episode.coach_user_id = auth.uid() and episode.student_user_id = p_student_user_id
      and episode.ended_at is null) then
    raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('assetId', asset.id,
    'bucketId', asset.bucket_id, 'objectName', asset.object_name,
    'mimeType', asset.mime_type, 'bytes', asset.byte_size,
    'displayName', asset.display_name, 'availableAt', asset.available_at)
    order by asset.created_at desc, asset.id desc), '[]'::jsonb) into v_result
  from (select * from private.progress_assets asset
    where asset.student_user_id = p_student_user_id and asset.kind = 'medical_document'
      and asset.available_at is not null
      and private.can_coach_read_medical_document_asset(asset.id, auth.uid())
    order by asset.created_at desc, asset.id desc limit p_limit offset p_offset) asset;
  return v_result;
end;
$fn$;

revoke all on function public.begin_direct_medical_document_upload(),
  public.finalize_direct_medical_document_upload(uuid),
  public.set_own_medical_document_shared(uuid, boolean),
  public.list_shared_student_medical_documents(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.begin_direct_medical_document_upload(),
  public.finalize_direct_medical_document_upload(uuid),
  public.set_own_medical_document_shared(uuid, boolean),
  public.list_shared_student_medical_documents(uuid, integer, integer) to authenticated;

commit;
