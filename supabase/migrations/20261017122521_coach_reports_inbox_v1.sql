begin;

-- Medical documents remain private until the Student explicitly shares one.
-- A share transition becomes an immutable report, so the Coach inbox, review
-- state and delivery process use the same audited model as progress photos.
create or replace function public.set_own_medical_document_shared(p_asset_id uuid, p_shared boolean)
returns boolean language plpgsql security definer set search_path = '' as $fn$
declare
  v_student uuid := private.require_own_medical_document_reader();
  v_episode uuid;
  v_changed boolean := false;
  v_direct_episode uuid;
begin
  if p_asset_id is null or p_shared is null then
    raise exception 'progress_document_invalid_input' using errcode = '22023';
  end if;

  if p_shared then
    select episode.id into v_episode
      from private.coach_relationship_episodes episode
      where episode.student_user_id = v_student and episode.ended_at is null
      for update of episode;
    if not found then raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  end if;

  select direct.shared_episode_id into v_direct_episode
    from private.direct_medical_document_uploads direct
    where direct.asset_id = p_asset_id and direct.student_user_id = v_student
      and direct.state = 'published'
    for update of direct;

  if found then
    v_changed := v_direct_episode is distinct from v_episode;
    update private.direct_medical_document_uploads direct
      set shared_episode_id = v_episode
      where direct.asset_id = p_asset_id and direct.student_user_id = v_student
        and direct.state = 'published';
  else
    if not exists (
      select 1 from private.progress_assets asset
      where asset.id = p_asset_id and asset.student_user_id = v_student
        and asset.kind = 'medical_document' and asset.available_at is not null
    ) then raise exception 'progress_document_forbidden' using errcode = '42501'; end if;

    v_changed := true;
    select share.shared_episode_id is distinct from v_episode into v_changed
      from private.legacy_medical_document_shares share
      where share.asset_id = p_asset_id and share.student_user_id = v_student
      for update;

    insert into private.legacy_medical_document_shares
      (asset_id, student_user_id, shared_episode_id)
    values (p_asset_id, v_student, v_episode)
    on conflict (asset_id) do update set shared_episode_id = excluded.shared_episode_id
      where private.legacy_medical_document_shares.student_user_id = v_student;
    if not found then raise exception 'progress_document_forbidden' using errcode = '42501'; end if;
  end if;

  if p_shared and v_changed then
    perform public.create_own_progress_report(
      'medical_document', array[p_asset_id], null, gen_random_uuid()
    );
  end if;
  return p_shared;
end;
$fn$;

-- Every report kind uses the same durable in-app and email delivery records.
create or replace function private.materialize_progress_report_delivery()
returns trigger language plpgsql security definer set search_path = ''
as $materialize_progress_report_delivery$
declare
  v_report private.progress_reports;
  v_episode private.coach_relationship_episodes;
  v_email text;
  v_title text;
  v_body text;
begin
  select * into v_report from private.progress_reports report
    where report.id = new.report_id and report.coach_user_id = new.recipient_user_id;
  if not found then raise exception 'progress_delivery_recipient_mismatch' using errcode = '42501'; end if;

  select * into v_episode from private.coach_relationship_episodes episode
    where episode.id = v_report.relationship_episode_id
      and episode.student_user_id = v_report.student_user_id
      and episode.coach_user_id = v_report.coach_user_id and episode.ended_at is null
    for share of episode;
  if not found then raise exception 'progress_delivery_relationship_ended' using errcode = '42501'; end if;

  if v_report.kind = 'photos' then
    v_title := left(v_episode.student_name_snapshot || ' te envió fotos de progreso', 120);
    v_body := 'Tienes un nuevo reporte privado de fotos de progreso.';
  else
    v_title := left(v_episode.student_name_snapshot || ' compartió un documento médico', 120);
    v_body := 'Tienes un documento médico privado para revisar.';
  end if;

  if new.channel = 'in_app' then
    insert into private.progress_report_notifications
      (report_id, recipient_user_id, title, body)
      values (v_report.id, v_report.coach_user_id, v_title, v_body);
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

create or replace function public.claim_progress_report_email_deliveries(p_capability text, p_limit integer default 25)
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
      claimed.student_name_snapshot, claimed.coach_name_snapshot, report.message,
      coalesce((select array_agg(distinct to_char(item.checked_on, 'DD/MM/YYYY'))
        filter (where item.checked_on is not null)
        from private.progress_report_items item where item.report_id = claimed.report_id), array[]::text[]),
      (select count(*)::integer from private.progress_report_items item
        where item.report_id = claimed.report_id and item.asset_kind = 'photo'),
      claimed.idempotency_key, claimed.attempt_token from claimed
      join private.progress_reports report on report.id = claimed.report_id;
end;
$claim_progress_report_email_deliveries$;

create or replace function public.list_own_coach_progress_reports(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = ''
as $list_own_coach_progress_reports$
declare v_coach uuid := auth.uid(); v_result jsonb;
begin
  if v_coach is null or p_limit is null or p_limit not between 1 and 100
    or not exists (select 1 from public.coach_registrations registration where registration.user_id = v_coach)
  then raise exception 'progress_report_forbidden' using errcode = '42501'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', row.id, 'studentName', row.student_name_snapshot, 'kind', row.kind,
    'sentAt', row.sent_at, 'reviewedAt', row.reviewed_at, 'itemCount', row.item_count
  ) order by row.sent_at desc, row.id desc), '[]'::jsonb) into v_result
  from (
    select report.id, episode.student_name_snapshot, report.kind, report.sent_at,
      review.reviewed_at, count(item.report_id)::integer as item_count
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
          and not private.can_coach_read_medical_document_asset(restricted.asset_id, v_coach)
      )
    group by report.id, episode.student_name_snapshot, report.kind, report.sent_at, review.reviewed_at
    order by report.sent_at desc, report.id desc
    limit p_limit
  ) row;
  return v_result;
end;
$list_own_coach_progress_reports$;

create or replace function public.review_own_coach_progress_report(p_report_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $review_own_coach_progress_report$
declare v_coach uuid := auth.uid();
begin
  if v_coach is null or p_report_id is null then
    raise exception 'progress_report_forbidden' using errcode = '42501'; end if;
  perform episode.id
    from private.progress_reports report
    join private.coach_relationship_episodes episode
      on episode.id = report.relationship_episode_id
        and episode.student_user_id = report.student_user_id
        and episode.coach_user_id = report.coach_user_id and episode.ended_at is null
    where report.id = p_report_id and report.coach_user_id = v_coach
      and not exists (
        select 1 from private.progress_report_items restricted
        where restricted.report_id = report.id
          and restricted.asset_kind = 'medical_document'
          and not private.can_coach_read_medical_document_asset(restricted.asset_id, v_coach)
      )
    for update of episode;
  if not found then raise exception 'progress_report_forbidden' using errcode = '42501'; end if;
  insert into private.progress_report_reviews (report_id, coach_user_id)
    values (p_report_id, v_coach) on conflict (report_id) do nothing;
  update private.progress_report_notifications notification
    set read_at = coalesce(notification.read_at, clock_timestamp())
    where notification.report_id = p_report_id and notification.recipient_user_id = v_coach;
  return private.progress_report_view(p_report_id);
end;
$review_own_coach_progress_report$;

revoke all on function public.list_own_coach_progress_reports(integer) from public, anon, authenticated;
grant execute on function public.list_own_coach_progress_reports(integer) to authenticated;

commit;
