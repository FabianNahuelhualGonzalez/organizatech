-- EVALUATIONS-REMINDERS-STATUS-BULK-01: manual reminders without a cooldown,
-- server-selected batch reminders and reminder metadata for Coach history.
-- Local preparation only. Apply to QA first after audit and explicit authorization.

begin;

alter table private.evaluation_operations
  drop constraint evaluation_operations_action_check;

alter table private.evaluation_operations
  add constraint evaluation_operations_action_check
  check (action in (
    'template_save', 'send', 'extend', 'manual_reminder', 'bulk_reminder',
    'draft_save', 'submit'
  ));

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
      'canMutate', episode.ended_at is null
        and coalesce(response.state, 'pending') <> 'completed',
      'canRemind', episode.ended_at is null
        and coalesce(response.state, 'pending') in ('pending', 'draft')
        and (assignment.due_at is null or assignment.due_at > v_now),
      'reminderCount', coalesce(reminders.reminder_count, 0),
      'lastReminderAt', reminders.last_reminder_at
    ) order by assignment.sent_at desc, assignment.id desc)
    from private.evaluation_assignments assignment
    left join private.evaluation_responses response
      on response.assignment_id = assignment.id
    join private.coach_relationship_episodes episode
      on episode.id = assignment.relationship_episode_id
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

create or replace function private.create_evaluation_reminder(
  p_assignment_id uuid,
  p_initiated_by uuid,
  p_origin text,
  p_now timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $create_evaluation_reminder$
declare
  v_assignment private.evaluation_assignments;
  v_notification_id uuid;
  v_due_label text;
  v_notification_body text;
begin
  select assignment.*
    into v_assignment
    from private.evaluation_assignments assignment
    where assignment.id = p_assignment_id;

  if v_assignment.id is null then
    raise exception 'evaluation_assignment_forbidden' using errcode = '42501';
  end if;

  v_due_label := case
    when v_assignment.due_at is null then null
    else to_char(v_assignment.due_at at time zone 'America/Santiago', 'DD/MM/YYYY')
  end;
  v_notification_body := '«' || (v_assignment.snapshot->>'name') || '» sigue pendiente de responder.'
    || case
      when v_due_label is null then ''
      else ' Fecha límite: ' || v_due_label || '.'
    end;

  insert into private.evaluation_notifications (
    assignment_id,
    recipient_user_id,
    portal_scope,
    event_kind,
    reminder_origin,
    title,
    body,
    created_at
  ) values (
    v_assignment.id,
    v_assignment.student_user_id,
    'usuario',
    'evaluation_due_reminder',
    p_origin,
    'Evaluación pendiente',
    v_notification_body,
    p_now
  ) returning id into v_notification_id;

  perform private.enqueue_evaluation_email(
    v_notification_id,
    p_initiated_by,
    v_assignment.student_user_id,
    v_assignment.student_email_snapshot,
    'evaluation_due_reminder',
    jsonb_build_object(
      'templateName', v_assignment.snapshot->>'name',
      'coachName', 'Coach ' || v_assignment.coach_name_snapshot,
      'dueLabel', v_due_label,
      'assignmentId', v_assignment.id
    ),
    p_now
  );

  return v_notification_id;
end;
$create_evaluation_reminder$;

revoke all on function private.create_evaluation_reminder(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;

create or replace function public.remind_own_evaluation_assignment(
  p_assignment_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $remind_own_evaluation_assignment$
declare
  v_owner uuid := private.lock_coach_invitation_owner();
  v_now timestamptz := clock_timestamp();
  v_assignment private.evaluation_assignments;
  v_hash text;
  v_payload jsonb;
  v_notification_id uuid;
  v_operation private.evaluation_operations;
begin
  if p_assignment_id is null or p_request_id is null then
    raise exception 'evaluation_invalid_reminder' using errcode = '22023';
  end if;

  v_payload := jsonb_build_object('assignmentId', p_assignment_id);
  v_hash := private.evaluation_payload_hash(v_payload);

  select operation.*
    into v_operation
    from private.evaluation_operations operation
    where operation.actor_user_id = v_owner
      and operation.request_id = p_request_id;

  if found then
    if v_operation.action <> 'manual_reminder' or v_operation.payload_hash <> v_hash then
      raise exception 'evaluation_request_conflict' using errcode = '55000';
    end if;
    return v_operation.result;
  end if;

  select assignment.*
    into v_assignment
    from private.evaluation_assignments assignment
    join private.coach_relationship_episodes episode
      on episode.id = assignment.relationship_episode_id
    left join private.evaluation_responses response
      on response.assignment_id = assignment.id
    where assignment.id = p_assignment_id
      and assignment.coach_user_id = v_owner
      and episode.ended_at is null
      and coalesce(response.state, 'pending') in ('pending', 'draft')
      and (assignment.due_at is null or assignment.due_at > v_now)
    for update of assignment;

  if not found then
    raise exception 'evaluation_assignment_forbidden' using errcode = '42501';
  end if;

  v_notification_id := private.create_evaluation_reminder(
    p_assignment_id,
    v_owner,
    'manual',
    v_now
  );
  v_payload := jsonb_build_object('notificationId', v_notification_id);

  insert into private.evaluation_operations (
    actor_user_id,
    request_id,
    action,
    resource_id,
    payload_hash,
    result,
    completed_at
  ) values (
    v_owner,
    p_request_id,
    'manual_reminder',
    p_assignment_id,
    v_hash,
    v_payload,
    v_now
  );

  return v_payload;
end;
$remind_own_evaluation_assignment$;

create function public.remind_own_evaluation_batch(
  p_send_batch_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $remind_own_evaluation_batch$
declare
  v_owner uuid := private.lock_coach_invitation_owner();
  v_now timestamptz := clock_timestamp();
  v_assignment private.evaluation_assignments;
  v_hash text;
  v_payload jsonb;
  v_operation private.evaluation_operations;
  v_count integer := 0;
begin
  if p_send_batch_id is null or p_request_id is null then
    raise exception 'evaluation_invalid_bulk_reminder' using errcode = '22023';
  end if;

  v_payload := jsonb_build_object('sendBatchId', p_send_batch_id);
  v_hash := private.evaluation_payload_hash(v_payload);

  select operation.*
    into v_operation
    from private.evaluation_operations operation
    where operation.actor_user_id = v_owner
      and operation.request_id = p_request_id;

  if found then
    if v_operation.action <> 'bulk_reminder' or v_operation.payload_hash <> v_hash then
      raise exception 'evaluation_request_conflict' using errcode = '55000';
    end if;
    return v_operation.result;
  end if;

  perform assignment.id
    from private.evaluation_assignments assignment
    where assignment.send_batch_id = p_send_batch_id
      and assignment.coach_user_id = v_owner
    limit 1;

  if not found then
    raise exception 'evaluation_assignment_forbidden' using errcode = '42501';
  end if;

  for v_assignment in
    select assignment.*
      from private.evaluation_assignments assignment
      join private.coach_relationship_episodes episode
        on episode.id = assignment.relationship_episode_id
      left join private.evaluation_responses response
        on response.assignment_id = assignment.id
      where assignment.send_batch_id = p_send_batch_id
        and assignment.coach_user_id = v_owner
        and episode.ended_at is null
        and coalesce(response.state, 'pending') in ('pending', 'draft')
        and (assignment.due_at is null or assignment.due_at > v_now)
      order by assignment.id
      for update of assignment
  loop
    perform private.create_evaluation_reminder(
      v_assignment.id,
      v_owner,
      'manual',
      v_now
    );
    v_count := v_count + 1;
  end loop;

  v_payload := jsonb_build_object(
    'created', v_count,
    'sendBatchId', p_send_batch_id
  );

  insert into private.evaluation_operations (
    actor_user_id,
    request_id,
    action,
    resource_id,
    payload_hash,
    result,
    completed_at
  ) values (
    v_owner,
    p_request_id,
    'bulk_reminder',
    p_send_batch_id,
    v_hash,
    v_payload,
    v_now
  );

  return v_payload;
end;
$remind_own_evaluation_batch$;

revoke all on function public.list_own_coach_evaluation_assignments(),
  public.remind_own_evaluation_assignment(uuid, uuid),
  public.remind_own_evaluation_batch(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.list_own_coach_evaluation_assignments(),
  public.remind_own_evaluation_assignment(uuid, uuid),
  public.remind_own_evaluation_batch(uuid, uuid)
  to authenticated;

commit;
