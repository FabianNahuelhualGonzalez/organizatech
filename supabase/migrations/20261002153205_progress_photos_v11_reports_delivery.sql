begin;

-- All newly finalized photos are sanitized JPEGs. The original phase-one
-- bucket/asset definitions allowed HEIC before the publication path existed;
-- the product publication path emits JPEG final objects only.
do $progress_photo_bucket_policy$
begin
  if not exists (select 1 from storage.buckets bucket
    where bucket.id = 'progress-check-photos'
      and bucket.public = false and bucket.file_size_limit = 20971520) then
    raise exception 'progress_photo_bucket_policy_mismatch' using errcode = '55000';
  end if;
  update storage.buckets
    set allowed_mime_types = array['image/jpeg']::text[]
    where id = 'progress-check-photos';
end;
$progress_photo_bucket_policy$;

alter table private.progress_assets
  add constraint progress_assets_no_new_heic_v11 check (
    kind <> 'photo' or (
      mime_type <> 'image/heic' and extension <> 'heic'
      and object_name !~ '[.]heic$'
    )
  );

-- A selected pose is attached to an existing owned check only after its
-- original has passed the existing private publication pipeline.
create function public.attach_own_progress_check_photo(p_check_id uuid, p_asset_id uuid)
returns text language plpgsql security definer set search_path = ''
as $attach_own_progress_check_photo$
declare
  v_relationship record;
  v_check private.progress_checks;
  v_asset private.progress_assets;
  v_pose text;
  v_existing private.progress_check_photos;
  v_position smallint;
begin
  if p_check_id is null or p_asset_id is null then
    raise exception 'progress_check_invalid_input' using errcode = '22023';
  end if;
  select * into v_relationship from private.require_own_active_student_relationship();
  select * into v_check from private.progress_checks progress_check
    where progress_check.id = p_check_id
      and progress_check.student_user_id = v_relationship.student_user_id
      and progress_check.deleted_at is null for update;
  if not found then raise exception 'progress_check_forbidden' using errcode = '42501'; end if;
  select * into v_asset from private.progress_assets asset
    where asset.id = p_asset_id and asset.student_user_id = v_relationship.student_user_id
      and asset.kind = 'photo' and asset.bucket_id = 'progress-check-photos'
      and asset.available_at is not null and asset.sanitized_at is not null
      and asset.deleted_at is null for update;
  if not found then raise exception 'progress_check_asset_forbidden' using errcode = '42501'; end if;
  select upload.pose into v_pose from private.progress_photo_uploads upload
    where upload.final_asset_id = p_asset_id
      and upload.student_user_id = v_relationship.student_user_id
      and upload.state = 'published';
  if v_pose is null or exists (select 1 from private.progress_check_photos link
    where link.photo_asset_id = p_asset_id) then
    raise exception 'progress_check_asset_forbidden' using errcode = '42501';
  end if;
  select * into v_existing from private.progress_check_photos link
    where link.check_id = p_check_id and link.student_user_id = v_relationship.student_user_id
      and link.pose = v_pose for update;
  if found then
    if exists (select 1 from private.progress_assets old_asset
      where old_asset.id = v_existing.photo_asset_id and old_asset.deleted_at is null) then
      raise exception 'progress_check_pose_occupied' using errcode = 'P4090';
    end if;
    update private.progress_check_photos link set photo_asset_id = p_asset_id
      where link.check_id = p_check_id and link.pose = v_pose
        and link.student_user_id = v_relationship.student_user_id;
  else
    select coalesce(max(link.position), 0) + 1 into v_position
      from private.progress_check_photos link where link.check_id = p_check_id;
    if v_position > 3 then raise exception 'progress_check_full' using errcode = 'P4090'; end if;
    insert into private.progress_check_photos
      (check_id, photo_asset_id, student_user_id, pose, position)
      values (p_check_id, p_asset_id, v_relationship.student_user_id, v_pose, v_position);
  end if;
  return v_pose;
end;
$attach_own_progress_check_photo$;
revoke all on function public.attach_own_progress_check_photo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.attach_own_progress_check_photo(uuid, uuid) to authenticated;

-- A retry of an existing request returns its immutable snapshot. A new report
-- validates and locks every requested photo before inserting any report row.
-- The medical-document branch preserves the previous contract unchanged.
create or replace function public.create_own_progress_report(
  p_kind text, p_asset_ids uuid[], p_message text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = ''
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
  if p_kind is null or p_kind not in ('photos', 'medical_document')
    or p_asset_ids is null or cardinality(p_asset_ids) not between 1 and 30
    or cardinality(p_asset_ids) <> (
      select count(distinct selected.asset_id) from unnest(p_asset_ids) selected(asset_id))
    or p_request_id is null
    or (p_kind = 'medical_document' and cardinality(p_asset_ids) <> 1)
    or (p_message is not null and octet_length(p_message) > 8000)
  then raise exception 'progress_report_invalid_input' using errcode = '22023'; end if;

  -- This locks the active episode until transaction commit. Unlink must wait.
  select * into v_relationship from private.require_own_active_student_relationship();
  v_message := nullif(btrim(p_message), '');
  if v_message is not null and char_length(v_message) > 2000 then
    raise exception 'progress_report_invalid_input' using errcode = '22023'; end if;

  v_payload := jsonb_build_object('kind', p_kind, 'assetIds', to_jsonb(p_asset_ids),
    'message', v_message, 'relationshipEpisodeId', v_relationship.episode_id);
  v_payload_hash := private.progress_payload_hash(v_payload);
  select operation.* into v_operation from private.progress_report_operations operation
    where operation.student_user_id = v_relationship.student_user_id
      and operation.request_id = p_request_id;
  if found then
    if v_operation.payload_hash <> v_payload_hash or not exists (
      select 1 from private.progress_reports report
        where report.id = v_operation.report_id
          and report.relationship_episode_id = v_relationship.episode_id
    ) then raise exception 'progress_report_request_conflict' using errcode = '55000'; end if;
    return private.progress_report_view(v_operation.report_id);
  end if;

  perform asset.id from unnest(p_asset_ids) selected(asset_id)
    join private.progress_assets asset on asset.id = selected.asset_id
    order by asset.id for update of asset;
  if p_kind = 'photos' then
    perform progress_check.id from unnest(p_asset_ids) selected(asset_id)
      join private.progress_check_photos link on link.photo_asset_id = selected.asset_id
      join private.progress_checks progress_check on progress_check.id = link.check_id
      order by progress_check.id for share of progress_check;
  end if;

  select count(*) into v_valid_count
    from unnest(p_asset_ids) with ordinality selected(asset_id, position)
    join private.progress_assets asset
      on asset.id = selected.asset_id
        and asset.student_user_id = v_relationship.student_user_id
        and asset.available_at is not null
    where (p_kind = 'photos'
      and asset.kind = 'photo' and asset.bucket_id = 'progress-check-photos'
      and asset.mime_type = 'image/jpeg' and asset.extension = 'jpg'
      and asset.object_name ~ '[.]jpg$'
      and asset.sanitized_at is not null and asset.deleted_at is null
      and exists (select 1 from private.progress_photo_uploads upload
        where upload.final_asset_id = asset.id
          and upload.student_user_id = v_relationship.student_user_id
          and upload.final_object_name = asset.object_name
          and upload.state = 'published')
      and exists (select 1 from private.progress_check_photos link
        join private.progress_checks progress_check on progress_check.id = link.check_id
        where link.photo_asset_id = asset.id
          and link.student_user_id = v_relationship.student_user_id
          and progress_check.student_user_id = v_relationship.student_user_id
          and progress_check.deleted_at is null)
      and exists (select 1 from storage.objects stored
        where stored.bucket_id = asset.bucket_id and stored.name = asset.object_name))
    or (p_kind = 'medical_document' and asset.kind = 'medical_document');
  if v_valid_count <> cardinality(p_asset_ids) then
    raise exception 'progress_report_asset_forbidden' using errcode = '42501'; end if;

  insert into private.progress_reports
    (relationship_episode_id, student_user_id, coach_user_id, request_id, kind, message)
    values (v_relationship.episode_id, v_relationship.student_user_id,
      v_relationship.coach_user_id, p_request_id, p_kind, v_message)
    returning id into v_report_id;

  insert into private.progress_report_items
    (report_id, position, asset_id, student_user_id, asset_kind, bucket_id,
      object_name, mime_type, extension, byte_size, check_id, checked_on, pose,
      width, height, display_name, document_category, created_at)
  select v_report_id, selected.position::smallint, asset.id, asset.student_user_id,
    asset.kind, asset.bucket_id, asset.object_name, asset.mime_type,
    asset.extension, asset.byte_size, link.check_id, progress_check.checked_on,
    link.pose, asset.width, asset.height, asset.display_name,
    asset.document_category, clock_timestamp()
    from unnest(p_asset_ids) with ordinality selected(asset_id, position)
    join private.progress_assets asset on asset.id = selected.asset_id
    left join private.progress_check_photos link on link.photo_asset_id = asset.id
    left join private.progress_checks progress_check on progress_check.id = link.check_id
    order by selected.position;

  insert into private.progress_report_delivery_intents (report_id, recipient_user_id, channel)
    values (v_report_id, v_relationship.coach_user_id, 'in_app'),
      (v_report_id, v_relationship.coach_user_id, 'email');
  insert into private.progress_report_operations
    (student_user_id, request_id, payload_hash, report_id, completed_at)
    values (v_relationship.student_user_id, p_request_id, v_payload_hash,
      v_report_id, clock_timestamp());
  return private.progress_report_view(v_report_id);
end;
$create_own_progress_report$;

-- The confirmed recipient must still be the active relationship at commit.
create function public.create_own_progress_photo_report(
  p_expected_episode_id uuid, p_asset_ids uuid[], p_message text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = ''
as $create_own_progress_photo_report$
declare v_relationship record;
begin
  if p_expected_episode_id is null then
    raise exception 'progress_report_forbidden' using errcode = '42501'; end if;
  select * into v_relationship from private.require_own_active_student_relationship();
  if v_relationship.episode_id <> p_expected_episode_id then
    raise exception 'progress_report_recipient_changed' using errcode = 'P4090'; end if;
  return public.create_own_progress_report('photos', p_asset_ids, p_message, p_request_id);
end;
$create_own_progress_photo_report$;
revoke all on function public.create_own_progress_photo_report(uuid, uuid[], text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_own_progress_photo_report(uuid, uuid[], text, uuid)
  to authenticated;

-- Deleting a photo hides it from the student's check history. A report item is
-- an immutable access snapshot, so its exact final object remains available
-- to the linked recipient even after the source asset is soft-deleted.
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
      where item.report_id = report.id
    ), '[]'::jsonb)
  ) from private.progress_reports report
  left join private.progress_report_reviews review on review.report_id = report.id
  where report.id = p_report_id;
$progress_report_view$;

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
      and (asset.kind <> 'photo' or asset.sanitized_at is not null)
      and ((asset.student_user_id = v_actor
          and (asset.kind <> 'photo' or asset.deleted_at is null))
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
          where item.asset_id = asset.id and item.asset_kind = 'photo'
            and item.bucket_id = asset.bucket_id and item.object_name = asset.object_name
            and report.kind = 'photos' and report.coach_user_id = v_actor))));
end;
$can_read_progress_object$;

create or replace function public.claim_own_deleted_progress_photo_cleanup(
  p_student_user_id uuid, p_limit integer default 3
) returns jsonb language plpgsql security definer set search_path = ''
as $claim_own_deleted_progress_photo_cleanup$
declare v_result jsonb;
begin
  if not private.progress_photo_publisher_identity() or p_student_user_id is null
    or p_limit is null or p_limit not between 1 and 3 then
    raise exception 'progress_photo_forbidden' using errcode = '42501'; end if;
  with candidates as (
    select asset.id from private.progress_assets asset
    where asset.student_user_id = p_student_user_id and asset.kind = 'photo'
      and asset.bucket_id = 'progress-check-photos'
      and asset.deleted_at is not null and asset.deleted_storage_cleaned_at is null
      and not exists (select 1 from private.progress_report_items item
        where item.asset_id = asset.id and item.asset_kind = 'photo')
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

-- Notifications and provider delivery are separate durable records. The
-- original immutable intents remain the transaction's audit trail.
create table private.progress_report_notifications (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references private.progress_reports(id) on delete cascade,
  recipient_user_id uuid not null references public.coach_registrations(user_id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 1100),
  read_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create index progress_report_notifications_recipient
  on private.progress_report_notifications (recipient_user_id, created_at desc, id desc);
alter table private.progress_report_notifications enable row level security;
alter table private.progress_report_notifications force row level security;
revoke all on private.progress_report_notifications from public, anon, authenticated;

create table private.progress_report_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references private.progress_reports(id) on delete cascade,
  student_user_id uuid not null references public.user_registrations(user_id) on delete cascade,
  recipient_user_id uuid not null references public.coach_registrations(user_id) on delete cascade,
  recipient_email_snapshot text not null check (
    octet_length(recipient_email_snapshot) between 3 and 254
    and recipient_email_snapshot = lower(btrim(recipient_email_snapshot))
    and recipient_email_snapshot ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  coach_name_snapshot text not null check (char_length(btrim(coach_name_snapshot)) between 1 and 201),
  student_name_snapshot text not null check (char_length(btrim(student_name_snapshot)) between 1 and 201),
  idempotency_key uuid not null unique default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'ambiguous')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  attempt_token uuid,
  claimed_at timestamptz,
  next_attempt_at timestamptz,
  provider_message_id text check (provider_message_id is null or
    (char_length(provider_message_id) between 1 and 512 and provider_message_id !~ '[\r\n]')),
  provider_error_code text check (provider_error_code is null or provider_error_code ~ '^[a-z0-9_]{1,64}$'),
  sent_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((status = 'sending' and attempt_token is not null and claimed_at is not null)
    or (status <> 'sending' and attempt_token is null)),
  check ((status = 'sent' and provider_message_id is not null and sent_at is not null)
    or (status <> 'sent' and sent_at is null))
);
create index progress_report_email_delivery_claim
  on private.progress_report_email_deliveries (student_user_id, status, next_attempt_at, created_at, id);
alter table private.progress_report_email_deliveries enable row level security;
alter table private.progress_report_email_deliveries force row level security;
revoke all on private.progress_report_email_deliveries from public, anon, authenticated;

create function private.materialize_progress_report_delivery()
returns trigger language plpgsql security definer set search_path = ''
as $materialize_progress_report_delivery$
declare
  v_report private.progress_reports;
  v_episode private.coach_relationship_episodes;
  v_email text;
begin
  select * into v_report from private.progress_reports report
    where report.id = new.report_id and report.coach_user_id = new.recipient_user_id;
  if not found then raise exception 'progress_delivery_recipient_mismatch' using errcode = '42501'; end if;
  if v_report.kind <> 'photos' then return new; end if;
  select * into v_episode from private.coach_relationship_episodes episode
    where episode.id = v_report.relationship_episode_id
      and episode.student_user_id = v_report.student_user_id
      and episode.coach_user_id = v_report.coach_user_id and episode.ended_at is null
    for share of episode;
  if not found then raise exception 'progress_delivery_relationship_ended' using errcode = '42501'; end if;
  if new.channel = 'in_app' then
    insert into private.progress_report_notifications
      (report_id, recipient_user_id, title, body)
      values (v_report.id, v_report.coach_user_id,
        left(v_episode.student_name_snapshot || ' te envió fotos de progreso', 120),
        'Tienes un nuevo reporte privado de fotos de progreso.');
  elsif new.channel = 'email' then
    select lower(btrim(auth_user.email)) into v_email from auth.users auth_user
      where auth_user.id = v_report.coach_user_id;
    if v_email is null then raise exception 'progress_delivery_missing_email' using errcode = '42501'; end if;
    insert into private.progress_report_email_deliveries
      (report_id, student_user_id, recipient_user_id, recipient_email_snapshot,
        coach_name_snapshot, student_name_snapshot)
      values (v_report.id, v_report.student_user_id, v_report.coach_user_id,
        v_email, private.coach_public_name(v_report.coach_user_id), v_episode.student_name_snapshot);
  end if;
  return new;
end;
$materialize_progress_report_delivery$;
revoke all on function private.materialize_progress_report_delivery() from public, anon, authenticated;
create trigger progress_report_delivery_materialized
  after insert on private.progress_report_delivery_intents
  for each row execute function private.materialize_progress_report_delivery();

create function public.list_own_progress_report_notifications(p_limit integer default 50)
returns table (id uuid, report_id uuid, title text, body text, read_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $list_own_progress_report_notifications$
declare v_coach uuid := auth.uid();
begin
  if v_coach is null or p_limit is null or p_limit not between 1 and 100
    or not exists (select 1 from public.coach_registrations registration where registration.user_id = v_coach)
  then raise exception 'progress_notification_forbidden' using errcode = '42501'; end if;
  return query select notification.id, notification.report_id, notification.title,
    notification.body, notification.read_at, notification.created_at
    from private.progress_report_notifications notification
    join private.progress_reports report on report.id = notification.report_id
    join private.coach_relationship_episodes episode
      on episode.id = report.relationship_episode_id
        and episode.coach_user_id = v_coach and episode.student_user_id = report.student_user_id
        and episode.ended_at is null
    where notification.recipient_user_id = v_coach and report.coach_user_id = v_coach
    order by notification.created_at desc, notification.id desc limit p_limit;
end;
$list_own_progress_report_notifications$;

create function public.mark_own_progress_report_notifications_read(p_notification_ids uuid[])
returns integer language plpgsql security definer set search_path = ''
as $mark_own_progress_report_notifications_read$
declare v_coach uuid := auth.uid(); v_count integer;
begin
  if v_coach is null or p_notification_ids is null or cardinality(p_notification_ids) not between 1 and 100
    or not exists (select 1 from public.coach_registrations registration where registration.user_id = v_coach)
  then raise exception 'progress_notification_forbidden' using errcode = '42501'; end if;
  update private.progress_report_notifications notification
    set read_at = coalesce(notification.read_at, clock_timestamp())
    from private.progress_reports report, private.coach_relationship_episodes episode
    where notification.id = any(p_notification_ids)
      and notification.recipient_user_id = v_coach
      and report.id = notification.report_id and report.coach_user_id = v_coach
      and episode.id = report.relationship_episode_id and episode.coach_user_id = v_coach
      and episode.student_user_id = report.student_user_id and episode.ended_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$mark_own_progress_report_notifications_read$;

create function public.claim_progress_report_email_deliveries(p_capability text, p_limit integer default 25)
returns table (delivery_id uuid, report_id uuid, recipient_email text, student_name text,
  coach_name text, student_message text, check_dates text[], photo_count integer,
  idempotency_key uuid, attempt_token uuid)
language plpgsql security definer set search_path = ''
as $claim_progress_report_email_deliveries$
declare v_student uuid := auth.uid(); v_now timestamptz := clock_timestamp();
begin
  if v_student is null or p_limit is null or p_limit not between 1 and 25
    or not private.verify_evaluation_email_capability(p_capability)
  then raise exception 'progress_email_forbidden' using errcode = '42501'; end if;
  return query with candidates as (
    select delivery.id from private.progress_report_email_deliveries delivery
      join private.progress_reports report on report.id = delivery.report_id
      join private.coach_relationship_episodes episode
        on episode.id = report.relationship_episode_id
          and episode.coach_user_id = report.coach_user_id
          and episode.student_user_id = report.student_user_id
          and episode.ended_at is null
      where delivery.student_user_id = v_student and report.student_user_id = v_student
        and delivery.attempt_count < 5
        and (delivery.status = 'pending'
          or (delivery.status in ('failed', 'ambiguous') and delivery.next_attempt_at <= v_now)
          or (delivery.status = 'sending' and delivery.claimed_at <= v_now - interval '10 minutes'))
      order by delivery.created_at, delivery.id for update of delivery skip locked limit p_limit
  ), claimed as (
    update private.progress_report_email_deliveries delivery
      set status = 'sending', attempt_count = delivery.attempt_count + 1,
        attempt_token = gen_random_uuid(), claimed_at = v_now, next_attempt_at = null,
        provider_error_code = null, updated_at = v_now
      from candidates where delivery.id = candidates.id returning delivery.*
  ) select claimed.id, claimed.report_id, claimed.recipient_email_snapshot,
      claimed.student_name_snapshot, claimed.coach_name_snapshot,
      report.message,
      (select array_agg(distinct to_char(item.checked_on, 'DD/MM/YYYY'))
        from private.progress_report_items item where item.report_id = claimed.report_id),
      (select count(*)::integer from private.progress_report_items item
        where item.report_id = claimed.report_id and item.asset_kind = 'photo'),
      claimed.idempotency_key, claimed.attempt_token from claimed
      join private.progress_reports report on report.id = claimed.report_id;
end;
$claim_progress_report_email_deliveries$;

create function public.complete_progress_report_email_delivery(
  p_capability text, p_delivery_id uuid, p_attempt_token uuid, p_outcome text,
  p_provider_message_id text default null, p_provider_error_code text default null
) returns boolean language plpgsql security definer set search_path = ''
as $complete_progress_report_email_delivery$
declare v_student uuid := auth.uid();
begin
  if v_student is null or not private.verify_evaluation_email_capability(p_capability)
  then raise exception 'progress_email_forbidden' using errcode = '42501'; end if;
  if p_delivery_id is null or p_attempt_token is null or p_outcome not in ('sent', 'failed', 'ambiguous')
    or (p_outcome = 'sent' and (p_provider_message_id is null or p_provider_error_code is not null))
    or (p_outcome <> 'sent' and (p_provider_message_id is not null
      or p_provider_error_code is null or p_provider_error_code !~ '^[a-z0-9_]{1,64}$'))
  then raise exception 'progress_email_invalid_completion' using errcode = '22023'; end if;
  update private.progress_report_email_deliveries delivery
    set status = p_outcome, attempt_token = null,
      provider_message_id = case when p_outcome = 'sent' then p_provider_message_id else null end,
      provider_error_code = case when p_outcome <> 'sent' then p_provider_error_code else null end,
      sent_at = case when p_outcome = 'sent' then clock_timestamp() else null end,
      next_attempt_at = case when p_outcome = 'sent' or delivery.attempt_count >= 5 then null
        when p_outcome = 'ambiguous' then clock_timestamp() + interval '10 minutes'
        when delivery.attempt_count = 1 then clock_timestamp() + interval '1 minute'
        when delivery.attempt_count = 2 then clock_timestamp() + interval '5 minutes'
        else clock_timestamp() + interval '30 minutes' end,
      claimed_at = null, updated_at = clock_timestamp()
    where delivery.id = p_delivery_id and delivery.student_user_id = v_student
      and delivery.status = 'sending' and delivery.attempt_token = p_attempt_token;
  return found;
end;
$complete_progress_report_email_delivery$;

create function public.get_own_progress_report_delivery_status(p_report_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $get_own_progress_report_delivery_status$
declare v_student uuid := auth.uid(); v_result jsonb;
begin
  if v_student is null or p_report_id is null then
    raise exception 'progress_report_forbidden' using errcode = '42501'; end if;
  select jsonb_build_object('emailStatus', delivery.status,
    'notificationAccepted', notification.id is not null,
    'sentAt', delivery.sent_at,
    'coachName', delivery.coach_name_snapshot,
    'coachEmail', delivery.recipient_email_snapshot)
    into v_result from private.progress_reports report
    left join private.progress_report_email_deliveries delivery on delivery.report_id = report.id
    left join private.progress_report_notifications notification on notification.report_id = report.id
    where report.id = p_report_id and report.student_user_id = v_student and report.kind = 'photos';
  if v_result is null then raise exception 'progress_report_forbidden' using errcode = '42501'; end if;
  return v_result;
end;
$get_own_progress_report_delivery_status$;

create function public.list_own_progress_photo_report_statuses(p_asset_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = ''
as $list_own_progress_photo_report_statuses$
declare v_student uuid := auth.uid(); v_result jsonb;
begin
  if v_student is null or p_asset_ids is null or cardinality(p_asset_ids) not between 1 and 150
    or cardinality(p_asset_ids) <> (select count(distinct selected.id) from unnest(p_asset_ids) selected(id))
    or not exists (
    select 1 from public.user_registrations registration where registration.user_id = v_student
  ) then raise exception 'progress_report_forbidden' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('assetId', latest.asset_id,
    'sentAt', latest.sent_at, 'coachName', latest.coach_name)), '[]'::jsonb)
    into v_result from (select distinct on (item.asset_id) item.asset_id,
      delivery.sent_at, delivery.coach_name_snapshot as coach_name
      from private.progress_report_items item
      join private.progress_reports report on report.id = item.report_id
      join private.progress_report_email_deliveries delivery
        on delivery.report_id = report.id and delivery.status = 'sent'
      join private.progress_report_notifications notification on notification.report_id = report.id
      where report.student_user_id = v_student and report.kind = 'photos'
        and item.asset_id = any(p_asset_ids)
      order by item.asset_id, delivery.sent_at desc, report.id desc) latest;
  return v_result;
end;
$list_own_progress_photo_report_statuses$;

revoke all on function public.list_own_progress_report_notifications(integer),
  public.mark_own_progress_report_notifications_read(uuid[]),
  public.claim_progress_report_email_deliveries(text, integer),
  public.complete_progress_report_email_delivery(text, uuid, uuid, text, text, text),
  public.get_own_progress_report_delivery_status(uuid),
  public.list_own_progress_photo_report_statuses(uuid[])
  from public, anon, authenticated;
grant execute on function public.list_own_progress_report_notifications(integer),
  public.mark_own_progress_report_notifications_read(uuid[]),
  public.claim_progress_report_email_deliveries(text, integer),
  public.complete_progress_report_email_delivery(text, uuid, uuid, text, text, text),
  public.get_own_progress_report_delivery_status(uuid),
  public.list_own_progress_photo_report_statuses(uuid[])
  to authenticated;

commit;
