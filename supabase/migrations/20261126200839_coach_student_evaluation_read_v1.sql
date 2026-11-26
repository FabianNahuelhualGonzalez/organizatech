-- Local preparation for the Coach student record. QA and PROD require separate authorization.
begin;

-- The episode is the only identifier supplied by the Coach UI. Other resource
-- readers can use the returned Student ID after this active-link check.
create function public.get_own_coach_student_record_subject(p_episode_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_coach uuid := auth.uid(); v_result jsonb;
begin
  if v_coach is null or p_episode_id is null then
    raise exception 'coach_student_record_forbidden' using errcode = '42501'; end if;
  select jsonb_build_object('episodeId', episode.id,
    'studentUserId', episode.student_user_id,
    'studentName', episode.student_name_snapshot,
    'studentEmail', episode.student_email_snapshot,
    'linkedAt', episode.linked_at) into v_result
  from private.coach_relationship_episodes episode
  join public.coach_registrations registration
    on registration.user_id = episode.coach_user_id
  where episode.id = p_episode_id and episode.coach_user_id = v_coach
    and episode.ended_at is null;
  if v_result is null then
    raise exception 'coach_student_record_forbidden' using errcode = '42501'; end if;
  return v_result;
end;
$fn$;
revoke all on function public.get_own_coach_student_record_subject(uuid)
  from public, anon, authenticated;
grant execute on function public.get_own_coach_student_record_subject(uuid)
  to authenticated;

-- The existing Coach evaluation history remains unchanged. This scoped reader
-- prevents a client-side filter from becoming the access boundary for the record.
create function public.list_own_coach_student_evaluations(
  p_episode_id uuid, p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $list_own_coach_student_evaluations$
declare
  v_coach uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if v_coach is null or p_episode_id is null
    or p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset not between 0 and 100000
    or not exists (
      select 1 from public.coach_registrations registration
      join private.coach_relationship_episodes episode
        on episode.coach_user_id = registration.user_id
      where registration.user_id = v_coach and episode.id = p_episode_id
        and episode.ended_at is null
    ) then
    raise exception 'coach_student_evaluations_forbidden' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', row.id, 'sendBatchId', row.send_batch_id,
    'studentName', row.student_name_snapshot, 'snapshot', row.snapshot,
    'status', row.status, 'sentAt', row.sent_at, 'dueAt', row.due_at,
    'completedAt', row.completed_at, 'consentConfirmed', row.consent_confirmed,
    'answers', row.answers, 'canMutate', row.can_mutate,
    'canRemind', row.can_remind, 'reminderCount', row.reminder_count,
    'lastReminderAt', row.last_reminder_at
  ) order by row.sent_at desc, row.id desc), '[]'::jsonb) into v_result
  from (
    select assignment.id, assignment.send_batch_id,
      assignment.student_name_snapshot, assignment.snapshot,
      private.evaluation_status(assignment.due_at, response.state,
        response.draft_updated_at, assignment.reopened_at, v_now) as status,
      assignment.sent_at, assignment.due_at, response.completed_at,
      case when response.state = 'completed' then response.consent_confirmed
        else false end as consent_confirmed,
      case when response.state = 'completed' then response.answers
        else '{}'::jsonb end as answers,
      coalesce(response.state, 'pending') <> 'completed' as can_mutate,
      coalesce(response.state, 'pending') in ('pending', 'draft')
        and (assignment.due_at is null or assignment.due_at > v_now) as can_remind,
      coalesce(reminders.reminder_count, 0) as reminder_count,
      reminders.last_reminder_at
    from private.evaluation_assignments assignment
    left join private.evaluation_responses response
      on response.assignment_id = assignment.id
    left join lateral (
      select count(*)::integer as reminder_count,
        max(reminder.created_at) as last_reminder_at
      from private.evaluation_notifications reminder
      where reminder.assignment_id = assignment.id
        and reminder.event_kind = 'evaluation_due_reminder'
    ) reminders on true
    where assignment.relationship_episode_id = p_episode_id
      and assignment.coach_user_id = v_coach
    order by assignment.sent_at desc, assignment.id desc
    limit p_limit offset p_offset
  ) row;
  return v_result;
end;
$list_own_coach_student_evaluations$;

revoke all on function public.list_own_coach_student_evaluations(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_own_coach_student_evaluations(uuid, integer, integer)
  to authenticated;

commit;
