-- QA rollback for PROGRESS-RECORDS-01.
-- Execute only in QA, after explicit authorization and after removing bucket
-- objects through the Storage API. Never delete storage.objects directly.

begin;

-- Restore exactly the Student evaluation read contracts that existed
-- immediately before Phase 1, including completed historical records. Keep the
-- Phase 1 Coach and notification active-episode restrictions: rollback must not
-- restore access to a Coach after unlinking.
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
  join private.coach_relationship_episodes episode on episode.id = assignment.relationship_episode_id
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
    join private.coach_relationship_episodes episode on episode.id = assignment.relationship_episode_id
    left join private.evaluation_responses response on response.assignment_id = assignment.id
    where assignment.student_user_id = v_student
      and (episode.ended_at is null or response.state = 'completed')
  ), '[]'::jsonb);
end;
$list_own_student_evaluations$;

revoke all on function private.student_evaluation_identity(),
  private.student_evaluation_view(uuid, uuid, timestamptz)
  from public, anon, authenticated;

revoke all on function public.list_own_student_evaluations()
  from public, anon, authenticated;
grant execute on function public.list_own_student_evaluations()
  to authenticated;

drop policy if exists "progress records authorized read" on storage.objects;
drop policy if exists "progress records active participant read" on storage.objects;

drop function if exists public.get_own_student_progress_access();
drop function if exists public.create_own_progress_report(text, uuid[], text, uuid);
drop function if exists public.get_own_student_progress_report(uuid);
drop function if exists public.get_own_coach_progress_report(uuid);
drop function if exists public.review_own_coach_progress_report(uuid);

drop table if exists private.progress_report_delivery_intents;
drop table if exists private.progress_report_reviews;
drop table if exists private.progress_report_operations;
drop table if exists private.progress_report_items;
drop table if exists private.progress_reports;
drop table if exists private.progress_check_photos;
drop table if exists private.progress_checks;
drop table if exists private.progress_assets;

drop function if exists private.enforce_progress_delivery_intent_immutable();
drop function if exists private.enforce_progress_report_item_immutable();
drop function if exists private.enforce_progress_report_immutable();
drop function if exists private.progress_report_view(uuid);
drop function if exists private.progress_payload_hash(jsonb);
drop function if exists private.can_read_progress_object(text, text);
drop function if exists private.require_own_active_student_relationship();

do $rollback_storage$
begin
  if exists (
    select 1 from storage.objects object
    where object.bucket_id in ('progress-check-photos', 'progress-medical-documents')
  ) then
    raise exception 'progress_records_rollback_requires_empty_buckets' using errcode = '55000';
  end if;
end;
$rollback_storage$;

delete from storage.buckets
where id in ('progress-check-photos', 'progress-medical-documents');

commit;
