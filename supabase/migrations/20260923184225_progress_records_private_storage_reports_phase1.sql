-- PROGRESS-RECORDS-01: private progress assets and immutable Coach reports.
-- Local preparation only. Apply to QA first after audit and explicit authorization.
-- Phase 1 deliberately grants no client upload policy: photos cannot become
-- readable/reportable until a trusted future sanitizer records sanitized_at.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'progress-check-photos',
    'progress-check-photos',
    false,
    20971520,
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic']::text[]
  ),
  (
    'progress-medical-documents',
    'progress-medical-documents',
    false,
    26214400,
    array['application/pdf']::text[]
  );

create table private.progress_assets (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references public.user_registrations(user_id) on delete cascade,
  kind text not null check (kind in ('photo', 'medical_document')),
  bucket_id text not null,
  object_name text not null unique,
  display_name text check (
    display_name is null
    or (char_length(btrim(display_name)) between 1 and 160 and display_name !~ '[\r\n]')
  ),
  document_category text check (
    document_category is null
    or document_category in ('examen_medico', 'informe_medico', 'receta', 'nutricion', 'otro')
  ),
  mime_type text not null,
  extension text not null,
  byte_size bigint not null check (byte_size > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  page_count integer check (page_count is null or page_count > 0),
  sanitized_at timestamptz,
  available_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, student_user_id),
  check (available_at is null or available_at >= created_at),
  check (sanitized_at is null or sanitized_at >= created_at),
  check (
    object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|pdf)$'
  ),
  check (
    (
      kind = 'photo'
      and bucket_id = 'progress-check-photos'
      and byte_size <= 20971520
      and display_name is null
      and document_category is null
      and page_count is null
      and (
        (mime_type = 'image/jpeg' and extension in ('jpg', 'jpeg'))
        or (mime_type = 'image/png' and extension = 'png')
        or (mime_type = 'image/webp' and extension = 'webp')
        or (mime_type = 'image/heic' and extension = 'heic')
      )
      and object_name ~ ('\.' || extension || '$')
      and (
        (available_at is null and sanitized_at is null)
        or (available_at is not null and sanitized_at is not null and width is not null and height is not null)
      )
    )
    or (
      kind = 'medical_document'
      and bucket_id = 'progress-medical-documents'
      and mime_type = 'application/pdf'
      and extension = 'pdf'
      and byte_size <= 26214400
      and display_name is not null
      and document_category is not null
      and width is null
      and height is null
      and sanitized_at is null
      and available_at is not null
      and object_name ~ '\.pdf$'
    )
  )
);

create index progress_assets_student_available
  on private.progress_assets (student_user_id, created_at desc, id desc)
  where available_at is not null;
create index progress_assets_storage_lookup
  on private.progress_assets (bucket_id, object_name)
  where available_at is not null;

create table private.progress_checks (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references public.user_registrations(user_id) on delete cascade,
  checked_on date not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, student_user_id),
  check (checked_on <= (created_at at time zone 'America/Santiago')::date)
);

create index progress_checks_student_history
  on private.progress_checks (student_user_id, checked_on desc, created_at desc, id desc);

create table private.progress_check_photos (
  check_id uuid not null,
  photo_asset_id uuid not null unique,
  student_user_id uuid not null,
  pose text not null check (pose in ('frente', 'perfil', 'espalda')),
  position smallint not null check (position between 1 and 3),
  created_at timestamptz not null default clock_timestamp(),
  primary key (check_id, photo_asset_id),
  unique (check_id, pose),
  unique (check_id, position),
  foreign key (check_id, student_user_id)
    references private.progress_checks(id, student_user_id) on delete cascade,
  foreign key (photo_asset_id, student_user_id)
    references private.progress_assets(id, student_user_id) on delete restrict
);

create index progress_check_photos_student
  on private.progress_check_photos (student_user_id, check_id, position);

create table private.progress_reports (
  id uuid primary key default gen_random_uuid(),
  relationship_episode_id uuid not null,
  student_user_id uuid not null references public.user_registrations(user_id) on delete cascade,
  coach_user_id uuid not null references public.coach_registrations(user_id) on delete cascade,
  request_id uuid not null,
  kind text not null check (kind in ('photos', 'medical_document')),
  message text check (
    message is null
    or char_length(message) between 1 and 2000
  ),
  sent_at timestamptz not null default clock_timestamp(),
  unique (student_user_id, request_id),
  unique (id, student_user_id),
  unique (id, coach_user_id),
  foreign key (relationship_episode_id, coach_user_id)
    references private.coach_relationship_episodes(id, coach_user_id) on delete cascade
);

create index progress_reports_student_history
  on private.progress_reports (student_user_id, sent_at desc, id desc);
create index progress_reports_coach_history
  on private.progress_reports (coach_user_id, sent_at desc, id desc);
create index progress_reports_active_relationship
  on private.progress_reports (relationship_episode_id, sent_at desc, id desc);

create table private.progress_report_items (
  report_id uuid not null,
  position smallint not null check (position between 1 and 30),
  asset_id uuid not null,
  student_user_id uuid not null,
  asset_kind text not null check (asset_kind in ('photo', 'medical_document')),
  bucket_id text not null,
  object_name text not null,
  mime_type text not null,
  extension text not null,
  byte_size bigint not null check (byte_size > 0),
  check_id uuid,
  checked_on date,
  pose text check (pose is null or pose in ('frente', 'perfil', 'espalda')),
  width integer,
  height integer,
  display_name text,
  document_category text,
  created_at timestamptz not null,
  primary key (report_id, position),
  unique (report_id, asset_id),
  foreign key (report_id, student_user_id)
    references private.progress_reports(id, student_user_id) on delete cascade,
  foreign key (asset_id, student_user_id)
    references private.progress_assets(id, student_user_id) on delete restrict,
  check (
    (asset_kind = 'photo' and check_id is not null and checked_on is not null and pose is not null
      and width is not null and height is not null and display_name is null and document_category is null)
    or
    (asset_kind = 'medical_document' and check_id is null and checked_on is null and pose is null
      and width is null and height is null and display_name is not null and document_category is not null)
  )
);

create index progress_report_items_asset
  on private.progress_report_items (asset_id, report_id);
create index progress_report_items_student
  on private.progress_report_items (student_user_id, report_id);

create table private.progress_report_reviews (
  report_id uuid primary key,
  coach_user_id uuid not null,
  reviewed_at timestamptz not null default clock_timestamp(),
  foreign key (report_id, coach_user_id)
    references private.progress_reports(id, coach_user_id) on delete cascade
);

create index progress_report_reviews_coach
  on private.progress_report_reviews (coach_user_id, reviewed_at desc, report_id);

-- Contract only. No dispatcher or Edge Function is introduced in Phase 1.
-- A future worker must re-check that the report relationship remains active.
create table private.progress_report_delivery_intents (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references private.progress_reports(id) on delete cascade,
  recipient_user_id uuid not null references public.coach_registrations(user_id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email')),
  event_kind text not null default 'progress_report_received'
    check (event_kind = 'progress_report_received'),
  state text not null default 'pending_implementation'
    check (state = 'pending_implementation'),
  created_at timestamptz not null default clock_timestamp(),
  unique (report_id, channel)
);

create index progress_report_delivery_intents_recipient
  on private.progress_report_delivery_intents (recipient_user_id, created_at, id);

create table private.progress_report_operations (
  student_user_id uuid not null references public.user_registrations(user_id) on delete cascade,
  request_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  report_id uuid not null,
  completed_at timestamptz not null,
  primary key (student_user_id, request_id),
  foreign key (report_id, student_user_id)
    references private.progress_reports(id, student_user_id) on delete cascade
);

create index progress_report_operations_report
  on private.progress_report_operations (report_id);

alter table private.progress_assets enable row level security;
alter table private.progress_assets force row level security;
alter table private.progress_checks enable row level security;
alter table private.progress_checks force row level security;
alter table private.progress_check_photos enable row level security;
alter table private.progress_check_photos force row level security;
alter table private.progress_reports enable row level security;
alter table private.progress_reports force row level security;
alter table private.progress_report_items enable row level security;
alter table private.progress_report_items force row level security;
alter table private.progress_report_reviews enable row level security;
alter table private.progress_report_reviews force row level security;
alter table private.progress_report_delivery_intents enable row level security;
alter table private.progress_report_delivery_intents force row level security;
alter table private.progress_report_operations enable row level security;
alter table private.progress_report_operations force row level security;

revoke all on table private.progress_assets,
  private.progress_checks,
  private.progress_check_photos,
  private.progress_reports,
  private.progress_report_items,
  private.progress_report_reviews,
  private.progress_report_delivery_intents,
  private.progress_report_operations
  from public, anon, authenticated;

create function private.require_own_active_student_relationship()
returns table (
  episode_id uuid,
  student_user_id uuid,
  coach_user_id uuid,
  coach_name text,
  coach_email text
)
language plpgsql
security definer
set search_path = ''
as $require_own_active_student_relationship$
declare
  v_student uuid := auth.uid();
begin
  if v_student is null
    or not exists (
      select 1 from public.user_registrations registration
      where registration.user_id = v_student
    )
  then
    raise exception 'progress_access_forbidden' using errcode = '42501';
  end if;

  return query
  select
    episode.id,
    episode.student_user_id,
    episode.coach_user_id,
    private.coach_public_name(episode.coach_user_id),
    lower(btrim(auth_user.email))
  from private.coach_relationship_episodes episode
  join auth.users auth_user on auth_user.id = episode.coach_user_id
  where episode.student_user_id = v_student
    and episode.ended_at is null
    and auth_user.email is not null
    and btrim(auth_user.email) <> ''
    and private.coach_public_name(episode.coach_user_id) is not null
  for update of episode;

  if not found then
    raise exception 'progress_active_relationship_required' using errcode = '42501';
  end if;
end;
$require_own_active_student_relationship$;

revoke all on function private.require_own_active_student_relationship()
  from public, anon, authenticated;

create function private.progress_payload_hash(p_payload jsonb)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $progress_payload_hash$
  select pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );
$progress_payload_hash$;

revoke all on function private.progress_payload_hash(jsonb)
  from public, anon, authenticated;

create function private.enforce_progress_report_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $enforce_progress_report_immutable$
begin
  if tg_op <> 'INSERT' then
    raise exception 'progress_report_immutable' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from private.coach_relationship_episodes episode
    where episode.id = new.relationship_episode_id
      and episode.student_user_id = new.student_user_id
      and episode.coach_user_id = new.coach_user_id
      and episode.ended_at is null
  ) then
    raise exception 'progress_active_relationship_required' using errcode = '42501';
  end if;

  return new;
end;
$enforce_progress_report_immutable$;

create trigger progress_reports_immutable
  before insert or update or delete on private.progress_reports
  for each row execute function private.enforce_progress_report_immutable();

revoke all on function private.enforce_progress_report_immutable()
  from public, anon, authenticated;

create function private.enforce_progress_report_item_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $enforce_progress_report_item_immutable$
begin
  if tg_op <> 'INSERT' then
    raise exception 'progress_report_item_immutable' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from private.progress_reports report
    join private.progress_assets asset
      on asset.id = new.asset_id
     and asset.student_user_id = report.student_user_id
     and asset.available_at is not null
    where report.id = new.report_id
      and report.student_user_id = new.student_user_id
      and (
        (report.kind = 'photos' and asset.kind = 'photo' and asset.sanitized_at is not null)
        or (report.kind = 'medical_document' and asset.kind = 'medical_document')
      )
  ) then
    raise exception 'progress_report_asset_forbidden' using errcode = '42501';
  end if;

  return new;
end;
$enforce_progress_report_item_immutable$;

create trigger progress_report_items_immutable
  before insert or update or delete on private.progress_report_items
  for each row execute function private.enforce_progress_report_item_immutable();

revoke all on function private.enforce_progress_report_item_immutable()
  from public, anon, authenticated;

create function private.enforce_progress_delivery_intent_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $enforce_progress_delivery_intent_immutable$
begin
  if tg_op <> 'INSERT' then
    raise exception 'progress_delivery_intent_immutable' using errcode = '55000';
  end if;

  if not exists (
    select 1 from private.progress_reports report
    where report.id = new.report_id
      and report.coach_user_id = new.recipient_user_id
  ) then
    raise exception 'progress_delivery_recipient_mismatch' using errcode = '42501';
  end if;

  return new;
end;
$enforce_progress_delivery_intent_immutable$;

create trigger progress_report_delivery_intents_immutable
  before insert or update or delete on private.progress_report_delivery_intents
  for each row execute function private.enforce_progress_delivery_intent_immutable();

revoke all on function private.enforce_progress_delivery_intent_immutable()
  from public, anon, authenticated;

create function private.progress_report_view(p_report_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $progress_report_view$
  select jsonb_build_object(
    'id', report.id,
    'kind', report.kind,
    'message', report.message,
    'sentAt', report.sent_at,
    'studentUserId', report.student_user_id,
    'coachUserId', report.coach_user_id,
    'reviewedAt', review.reviewed_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', item.position,
        'assetId', item.asset_id,
        'assetKind', item.asset_kind,
        'bucketId', item.bucket_id,
        'objectName', item.object_name,
        'mimeType', item.mime_type,
        'extension', item.extension,
        'bytes', item.byte_size,
        'checkId', item.check_id,
        'checkedOn', item.checked_on,
        'pose', item.pose,
        'width', item.width,
        'height', item.height,
        'displayName', item.display_name,
        'documentCategory', item.document_category
      ) order by item.position)
      from private.progress_report_items item
      where item.report_id = report.id
    ), '[]'::jsonb)
  )
  from private.progress_reports report
  left join private.progress_report_reviews review on review.report_id = report.id
  where report.id = p_report_id;
$progress_report_view$;

revoke all on function private.progress_report_view(uuid)
  from public, anon, authenticated;

create function private.can_read_progress_object(p_bucket_id text, p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $can_read_progress_object$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null
    or p_bucket_id not in ('progress-check-photos', 'progress-medical-documents')
    or p_object_name is null
  then
    return false;
  end if;

  return exists (
    select 1
    from private.progress_assets asset
    where asset.bucket_id = p_bucket_id
      and asset.object_name = p_object_name
      and asset.available_at is not null
      and (asset.kind <> 'photo' or asset.sanitized_at is not null)
      and (
        asset.student_user_id = v_actor
        or exists (
          select 1
          from private.progress_report_items item
          join private.progress_reports report on report.id = item.report_id
          join private.coach_relationship_episodes episode
            on episode.id = report.relationship_episode_id
           and episode.student_user_id = report.student_user_id
           and episode.coach_user_id = report.coach_user_id
           and episode.ended_at is null
          where item.asset_id = asset.id
            and report.coach_user_id = v_actor
        )
      )
  );
end;
$can_read_progress_object$;

revoke all on function private.can_read_progress_object(text, text)
  from public, anon, authenticated;
grant execute on function private.can_read_progress_object(text, text)
  to authenticated;

drop policy if exists "progress records active participant read" on storage.objects;
drop policy if exists "progress records authorized read" on storage.objects;
create policy "progress records authorized read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id in ('progress-check-photos', 'progress-medical-documents')
    and (select private.can_read_progress_object(bucket_id, name))
  );

create function public.get_own_student_progress_access()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $get_own_student_progress_access$
declare
  v_relationship record;
begin
  select * into v_relationship
  from private.require_own_active_student_relationship();

  return jsonb_build_object(
    'relationshipEpisodeId', v_relationship.episode_id,
    'coachUserId', v_relationship.coach_user_id,
    'coachName', v_relationship.coach_name,
    'coachEmail', v_relationship.coach_email
  );
end;
$get_own_student_progress_access$;

create function public.create_own_progress_report(
  p_kind text,
  p_asset_ids uuid[],
  p_message text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $create_own_progress_report$
declare
  v_relationship record;
  v_payload jsonb;
  v_payload_hash text;
  v_operation private.progress_report_operations;
  v_report_id uuid;
  v_message text;
  v_valid_count integer;
begin
  if p_kind is null
    or p_kind not in ('photos', 'medical_document')
    or p_asset_ids is null
    or cardinality(p_asset_ids) not between 1 and 30
    or cardinality(p_asset_ids) <> (
      select count(distinct asset_id) from unnest(p_asset_ids) as selected(asset_id)
    )
    or p_request_id is null
    or (p_kind = 'medical_document' and cardinality(p_asset_ids) <> 1)
    or (p_message is not null and octet_length(p_message) > 8000)
  then
    raise exception 'progress_report_invalid_input' using errcode = '22023';
  end if;

  select * into v_relationship
  from private.require_own_active_student_relationship();

  v_message := nullif(btrim(p_message), '');
  if v_message is not null and char_length(v_message) > 2000 then
    raise exception 'progress_report_invalid_input' using errcode = '22023';
  end if;

  v_payload := jsonb_build_object(
    'kind', p_kind,
    'assetIds', to_jsonb(p_asset_ids),
    'message', v_message,
    'relationshipEpisodeId', v_relationship.episode_id
  );
  v_payload_hash := private.progress_payload_hash(v_payload);

  select operation.* into v_operation
  from private.progress_report_operations operation
  where operation.student_user_id = v_relationship.student_user_id
    and operation.request_id = p_request_id;

  if found then
    if v_operation.payload_hash <> v_payload_hash
      or not exists (
        select 1 from private.progress_reports report
        where report.id = v_operation.report_id
          and report.relationship_episode_id = v_relationship.episode_id
      )
    then
      raise exception 'progress_report_request_conflict' using errcode = '55000';
    end if;
    return private.progress_report_view(v_operation.report_id);
  end if;

  perform asset.id
  from unnest(p_asset_ids) as selected(asset_id)
  join private.progress_assets asset on asset.id = selected.asset_id
  order by asset.id
  for update of asset;

  select count(*) into v_valid_count
  from unnest(p_asset_ids) with ordinality as selected(asset_id, position)
  join private.progress_assets asset
    on asset.id = selected.asset_id
   and asset.student_user_id = v_relationship.student_user_id
   and asset.available_at is not null
  where (
    p_kind = 'photos'
    and asset.kind = 'photo'
    and asset.sanitized_at is not null
    and exists (
      select 1
      from private.progress_check_photos check_photo
      join private.progress_checks progress_check on progress_check.id = check_photo.check_id
      where check_photo.photo_asset_id = asset.id
        and progress_check.student_user_id = v_relationship.student_user_id
    )
  ) or (
    p_kind = 'medical_document'
    and asset.kind = 'medical_document'
  );

  if v_valid_count <> cardinality(p_asset_ids) then
    raise exception 'progress_report_asset_forbidden' using errcode = '42501';
  end if;

  insert into private.progress_reports (
    relationship_episode_id,
    student_user_id,
    coach_user_id,
    request_id,
    kind,
    message
  ) values (
    v_relationship.episode_id,
    v_relationship.student_user_id,
    v_relationship.coach_user_id,
    p_request_id,
    p_kind,
    v_message
  ) returning id into v_report_id;

  insert into private.progress_report_items (
    report_id,
    position,
    asset_id,
    student_user_id,
    asset_kind,
    bucket_id,
    object_name,
    mime_type,
    extension,
    byte_size,
    check_id,
    checked_on,
    pose,
    width,
    height,
    display_name,
    document_category,
    created_at
  )
  select
    v_report_id,
    selected.position::smallint,
    asset.id,
    asset.student_user_id,
    asset.kind,
    asset.bucket_id,
    asset.object_name,
    asset.mime_type,
    asset.extension,
    asset.byte_size,
    check_photo.check_id,
    progress_check.checked_on,
    check_photo.pose,
    asset.width,
    asset.height,
    asset.display_name,
    asset.document_category,
    clock_timestamp()
  from unnest(p_asset_ids) with ordinality as selected(asset_id, position)
  join private.progress_assets asset on asset.id = selected.asset_id
  left join private.progress_check_photos check_photo on check_photo.photo_asset_id = asset.id
  left join private.progress_checks progress_check on progress_check.id = check_photo.check_id
  order by selected.position;

  insert into private.progress_report_delivery_intents (
    report_id,
    recipient_user_id,
    channel
  ) values
    (v_report_id, v_relationship.coach_user_id, 'in_app'),
    (v_report_id, v_relationship.coach_user_id, 'email');

  insert into private.progress_report_operations (
    student_user_id,
    request_id,
    payload_hash,
    report_id,
    completed_at
  ) values (
    v_relationship.student_user_id,
    p_request_id,
    v_payload_hash,
    v_report_id,
    clock_timestamp()
  );

  return private.progress_report_view(v_report_id);
end;
$create_own_progress_report$;

create function public.get_own_student_progress_report(p_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $get_own_student_progress_report$
declare
  v_student uuid := auth.uid();
  v_result jsonb;
begin
  if v_student is null
    or p_report_id is null
    or not exists (
      select 1 from public.user_registrations registration
      where registration.user_id = v_student
    )
  then
    raise exception 'progress_report_forbidden' using errcode = '42501';
  end if;

  select private.progress_report_view(report.id) into v_result
  from private.progress_reports report
  where report.id = p_report_id
    and report.student_user_id = v_student;

  if v_result is null then
    raise exception 'progress_report_forbidden' using errcode = '42501';
  end if;
  return v_result;
end;
$get_own_student_progress_report$;

create function public.get_own_coach_progress_report(p_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $get_own_coach_progress_report$
declare
  v_coach uuid := auth.uid();
  v_result jsonb;
begin
  if v_coach is null
    or p_report_id is null
    or not exists (
      select 1 from public.coach_registrations registration
      where registration.user_id = v_coach
    )
  then
    raise exception 'progress_report_forbidden' using errcode = '42501';
  end if;

  select private.progress_report_view(report.id) into v_result
  from private.progress_reports report
  join private.coach_relationship_episodes episode
    on episode.id = report.relationship_episode_id
   and episode.student_user_id = report.student_user_id
   and episode.coach_user_id = report.coach_user_id
   and episode.ended_at is null
  where report.id = p_report_id
    and report.coach_user_id = v_coach;

  if v_result is null then
    raise exception 'progress_report_forbidden' using errcode = '42501';
  end if;
  return v_result;
end;
$get_own_coach_progress_report$;

create function public.review_own_coach_progress_report(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $review_own_coach_progress_report$
declare
  v_coach uuid := auth.uid();
begin
  if v_coach is null or p_report_id is null then
    raise exception 'progress_report_forbidden' using errcode = '42501';
  end if;

  perform episode.id
  from private.progress_reports report
  join private.coach_relationship_episodes episode
    on episode.id = report.relationship_episode_id
   and episode.student_user_id = report.student_user_id
   and episode.coach_user_id = report.coach_user_id
   and episode.ended_at is null
  where report.id = p_report_id
    and report.coach_user_id = v_coach
  for update of episode;

  if not found then
    raise exception 'progress_report_forbidden' using errcode = '42501';
  end if;

  insert into private.progress_report_reviews (report_id, coach_user_id)
  values (p_report_id, v_coach)
  on conflict (report_id) do nothing;

  return private.progress_report_view(p_report_id);
end;
$review_own_coach_progress_report$;

-- Data retention and navigation visibility are separate contracts. A Student
-- keeps completed evaluations after unlinking, while every write still checks
-- an active episode. Phase 2 must hide the complete "Mis evaluaciones" section
-- without an active relationship; do not apply this migration to QA before
-- that UI gate is integrated.
create or replace function private.student_evaluation_identity()
returns uuid
language plpgsql
security definer
set search_path = ''
as $student_evaluation_identity$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not exists (
    select 1 from public.user_registrations registration
    where registration.user_id = v_user
  ) then
    raise exception 'evaluation_forbidden' using errcode = '42501';
  end if;
  return v_user;
end;
$student_evaluation_identity$;

create or replace function private.student_evaluation_view(
  p_assignment_id uuid,
  p_student_id uuid,
  p_now timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $student_evaluation_view$
  select jsonb_build_object(
    'id', assignment.id,
    'coachName', 'Coach ' || assignment.coach_name_snapshot,
    'snapshot', assignment.snapshot,
    'status', private.evaluation_status(
      assignment.due_at,
      response.state,
      response.draft_updated_at,
      assignment.reopened_at,
      p_now
    ),
    'sentAt', assignment.sent_at,
    'dueAt', assignment.due_at,
    'completedAt', response.completed_at,
    'consentConfirmed', coalesce(response.consent_confirmed, false),
    'answers', coalesce(response.answers, '{}'::jsonb)
  )
  from private.evaluation_assignments assignment
  left join private.evaluation_responses response on response.assignment_id = assignment.id
  join private.coach_relationship_episodes episode
   on episode.id = assignment.relationship_episode_id
   and episode.student_user_id = assignment.student_user_id
   and episode.coach_user_id = assignment.coach_user_id
  where assignment.id = p_assignment_id
    and assignment.student_user_id = p_student_id
    and (episode.ended_at is null or response.state = 'completed');
$student_evaluation_view$;

create or replace function public.list_own_student_evaluations()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $list_own_student_evaluations$
declare
  v_student uuid := private.student_evaluation_identity();
  v_now timestamptz := clock_timestamp();
begin
  return coalesce((
    select jsonb_agg(
      private.student_evaluation_view(assignment.id, v_student, v_now)
      order by assignment.sent_at desc, assignment.id desc
    )
    from private.evaluation_assignments assignment
    join private.coach_relationship_episodes episode
      on episode.id = assignment.relationship_episode_id
     and episode.student_user_id = assignment.student_user_id
     and episode.coach_user_id = assignment.coach_user_id
    left join private.evaluation_responses response on response.assignment_id = assignment.id
    where assignment.student_user_id = v_student
      and (episode.ended_at is null or response.state = 'completed')
  ), '[]'::jsonb);
end;
$list_own_student_evaluations$;

create or replace function public.list_own_coach_evaluation_assignments()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $list_own_coach_evaluation_assignments$
declare
  v_owner uuid := private.lock_coach_invitation_owner();
  v_now timestamptz := clock_timestamp();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', assignment.id,
      'sendBatchId', assignment.send_batch_id,
      'studentName', assignment.student_name_snapshot,
      'snapshot', assignment.snapshot,
      'status', private.evaluation_status(
        assignment.due_at,
        response.state,
        response.draft_updated_at,
        assignment.reopened_at,
        v_now
      ),
      'sentAt', assignment.sent_at,
      'dueAt', assignment.due_at,
      'completedAt', response.completed_at,
      'consentConfirmed', case
        when response.state = 'completed' then response.consent_confirmed
        else false
      end,
      'answers', case
        when response.state = 'completed' then response.answers
        else '{}'::jsonb
      end,
      'canMutate', coalesce(response.state, 'pending') <> 'completed',
      'canRemind', coalesce(response.state, 'pending') in ('pending', 'draft')
        and (assignment.due_at is null or assignment.due_at > v_now),
      'reminderCount', coalesce(reminders.reminder_count, 0),
      'lastReminderAt', reminders.last_reminder_at
    ) order by assignment.sent_at desc, assignment.id desc)
    from private.evaluation_assignments assignment
    left join private.evaluation_responses response
      on response.assignment_id = assignment.id
    join private.coach_relationship_episodes episode
      on episode.id = assignment.relationship_episode_id
     and episode.student_user_id = assignment.student_user_id
     and episode.coach_user_id = assignment.coach_user_id
     and episode.ended_at is null
    left join lateral (
      select count(*)::integer as reminder_count,
        max(reminder.created_at) as last_reminder_at
      from private.evaluation_notifications reminder
      where reminder.assignment_id = assignment.id
        and reminder.event_kind = 'evaluation_due_reminder'
    ) reminders on true
    where assignment.coach_user_id = v_owner
  ), '[]'::jsonb);
end;
$list_own_coach_evaluation_assignments$;

create or replace function public.list_own_evaluation_notifications(
  p_portal_scope text,
  p_limit integer default 50
)
returns table (
  id uuid,
  assignment_id uuid,
  event_kind text,
  title text,
  body text,
  read_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $list_own_evaluation_notifications$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null
    or p_portal_scope not in ('usuario', 'coach')
    or p_limit not between 1 and 100
    or (p_portal_scope = 'usuario' and not exists (
      select 1 from public.user_registrations registration where registration.user_id = v_user
    ))
    or (p_portal_scope = 'coach' and not exists (
      select 1 from public.coach_registrations registration where registration.user_id = v_user
    ))
  then
    raise exception 'evaluation_notifications_forbidden' using errcode = '42501';
  end if;

  return query
  select notification.id,
    notification.assignment_id,
    notification.event_kind,
    notification.title,
    notification.body,
    notification.read_at,
    notification.created_at
  from private.evaluation_notifications notification
  where notification.recipient_user_id = v_user
    and notification.portal_scope = p_portal_scope
    and (
      exists (
        select 1
        from private.evaluation_assignments assignment
        join private.coach_relationship_episodes episode
          on episode.id = assignment.relationship_episode_id
         and episode.student_user_id = assignment.student_user_id
         and episode.coach_user_id = assignment.coach_user_id
         and episode.ended_at is null
        where assignment.id = notification.assignment_id
          and (
            (p_portal_scope = 'usuario' and assignment.student_user_id = v_user)
            or (p_portal_scope = 'coach' and assignment.coach_user_id = v_user)
          )
      )
      or (
        p_portal_scope = 'coach'
        and notification.send_batch_id is not null
        and exists (
          select 1
          from private.evaluation_assignments assignment
          join private.coach_relationship_episodes episode
            on episode.id = assignment.relationship_episode_id
           and episode.ended_at is null
          where assignment.send_batch_id = notification.send_batch_id
            and assignment.coach_user_id = v_user
        )
      )
    )
  order by notification.created_at desc, notification.id desc
  limit p_limit;
end;
$list_own_evaluation_notifications$;

create or replace function public.mark_own_evaluation_notifications_read(
  p_portal_scope text,
  p_notification_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $mark_own_evaluation_notifications_read$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null
    or p_portal_scope not in ('usuario', 'coach')
    or p_notification_ids is null
    or cardinality(p_notification_ids) not between 1 and 100
  then
    raise exception 'evaluation_notifications_forbidden' using errcode = '42501';
  end if;

  update private.evaluation_notifications notification
  set read_at = coalesce(notification.read_at, clock_timestamp())
  where notification.recipient_user_id = v_user
    and notification.portal_scope = p_portal_scope
    and notification.id = any(p_notification_ids)
    and exists (
      select 1
      from private.evaluation_assignments assignment
      join private.coach_relationship_episodes episode
        on episode.id = assignment.relationship_episode_id
       and episode.student_user_id = assignment.student_user_id
       and episode.coach_user_id = assignment.coach_user_id
       and episode.ended_at is null
      where (
        assignment.id = notification.assignment_id
        or (notification.send_batch_id is not null and assignment.send_batch_id = notification.send_batch_id)
      )
        and (
          (p_portal_scope = 'usuario' and assignment.student_user_id = v_user)
          or (p_portal_scope = 'coach' and assignment.coach_user_id = v_user)
        )
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$mark_own_evaluation_notifications_read$;

revoke all on function public.get_own_student_progress_access(),
  public.create_own_progress_report(text, uuid[], text, uuid),
  public.get_own_student_progress_report(uuid),
  public.get_own_coach_progress_report(uuid),
  public.review_own_coach_progress_report(uuid),
  public.list_own_student_evaluations(),
  public.list_own_coach_evaluation_assignments(),
  public.list_own_evaluation_notifications(text, integer),
  public.mark_own_evaluation_notifications_read(text, uuid[])
  from public, anon, authenticated;

grant execute on function public.get_own_student_progress_access(),
  public.create_own_progress_report(text, uuid[], text, uuid),
  public.get_own_student_progress_report(uuid),
  public.get_own_coach_progress_report(uuid),
  public.review_own_coach_progress_report(uuid),
  public.list_own_student_evaluations(),
  public.list_own_coach_evaluation_assignments(),
  public.list_own_evaluation_notifications(text, integer),
  public.mark_own_evaluation_notifications_read(text, uuid[])
  to authenticated;

commit;
