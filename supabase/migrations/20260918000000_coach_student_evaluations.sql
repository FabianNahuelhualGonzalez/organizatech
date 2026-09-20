-- EVALUATIONS-01: canonical Coach-Student evaluations, immutable snapshots and delivery ledgers.
-- Local preparation only. Apply to QA first after audit and explicit authorization.
begin;

create table private.evaluation_templates (
  id uuid primary key default gen_random_uuid(),
  coach_user_id uuid not null references public.coach_registrations(user_id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  questions jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  hidden_at timestamptz,
  unique (id, coach_user_id),
  check (updated_at >= created_at),
  check (hidden_at is null or hidden_at >= created_at)
);

create index evaluation_templates_owner_visible
  on private.evaluation_templates (coach_user_id, created_at desc, id desc)
  where hidden_at is null;

create table private.evaluation_assignments (
  id uuid primary key default gen_random_uuid(),
  template_origin_id uuid not null,
  coach_user_id uuid not null references public.coach_registrations(user_id) on delete cascade,
  student_user_id uuid not null references public.user_registrations(user_id) on delete cascade,
  relationship_episode_id uuid not null,
  send_batch_id uuid not null,
  snapshot jsonb not null,
  coach_name_snapshot text not null check (char_length(btrim(coach_name_snapshot)) between 1 and 201),
  coach_email_snapshot text not null check (octet_length(coach_email_snapshot) between 3 and 254),
  student_name_snapshot text not null check (char_length(btrim(student_name_snapshot)) between 1 and 201),
  student_email_snapshot text not null check (octet_length(student_email_snapshot) between 3 and 254),
  sensitive boolean not null,
  sent_at timestamptz not null,
  due_at timestamptz,
  reopened_at timestamptz,
  foreign key (template_origin_id, coach_user_id)
    references private.evaluation_templates(id, coach_user_id) on delete restrict,
  foreign key (relationship_episode_id, coach_user_id)
    references private.coach_relationship_episodes(id, coach_user_id) on delete restrict,
  unique (coach_user_id, send_batch_id, student_user_id),
  unique (id, coach_user_id),
  unique (id, student_user_id),
  check (coach_user_id <> student_user_id),
  check (due_at is null or due_at > sent_at),
  check (reopened_at is null or reopened_at >= sent_at)
);

create index evaluation_assignments_coach_history
  on private.evaluation_assignments (coach_user_id, sent_at desc, id desc);
create index evaluation_assignments_student_history
  on private.evaluation_assignments (student_user_id, sent_at desc, id desc);
create index evaluation_assignments_due
  on private.evaluation_assignments (due_at, id) where due_at is not null;

create table private.evaluation_responses (
  assignment_id uuid primary key,
  student_user_id uuid not null,
  state text not null check (state in ('draft', 'completed')),
  answers jsonb not null,
  consent_confirmed boolean not null default false,
  draft_updated_at timestamptz,
  completed_at timestamptz,
  foreign key (assignment_id, student_user_id)
    references private.evaluation_assignments(id, student_user_id) on delete cascade,
  check (
    (state = 'draft' and draft_updated_at is not null and completed_at is null)
    or (state = 'completed' and completed_at is not null)
  )
);

create table private.evaluation_operations (
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  action text not null check (action in ('template_save', 'send', 'extend', 'manual_reminder', 'draft_save', 'submit')),
  resource_id uuid,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  completed_at timestamptz not null,
  primary key (actor_user_id, request_id)
);

create table private.evaluation_notifications (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references private.evaluation_assignments(id) on delete cascade,
  send_batch_id uuid,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  portal_scope text not null check (portal_scope in ('usuario', 'coach')),
  event_kind text not null check (event_kind in (
    'evaluation_received', 'evaluation_sent', 'evaluation_completed', 'evaluation_due_reminder'
  )),
  reminder_origin text check (reminder_origin is null or reminder_origin in ('manual', 'automatic')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 1100),
  read_at timestamptz,
  created_at timestamptz not null,
  check ((event_kind = 'evaluation_sent') = (send_batch_id is not null)),
  check ((event_kind = 'evaluation_due_reminder') = (reminder_origin is not null))
);

create unique index evaluation_notification_received_once
  on private.evaluation_notifications (assignment_id, recipient_user_id, event_kind)
  where event_kind = 'evaluation_received';
create unique index evaluation_notification_completed_once
  on private.evaluation_notifications (assignment_id, recipient_user_id, event_kind)
  where event_kind = 'evaluation_completed';
create unique index evaluation_notification_sent_once
  on private.evaluation_notifications (send_batch_id, recipient_user_id, event_kind)
  where event_kind = 'evaluation_sent';
create unique index evaluation_notification_auto_reminder_once
  on private.evaluation_notifications (assignment_id, recipient_user_id, reminder_origin)
  where event_kind = 'evaluation_due_reminder' and reminder_origin = 'automatic';
create index evaluation_notifications_owner
  on private.evaluation_notifications (recipient_user_id, portal_scope, created_at desc, id desc);

create table private.evaluation_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique references private.evaluation_notifications(id) on delete cascade,
  initiated_by_user_id uuid references auth.users(id) on delete set null,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email_snapshot text not null check (
    octet_length(recipient_email_snapshot) between 3 and 254
    and recipient_email_snapshot = lower(btrim(recipient_email_snapshot))
    and recipient_email_snapshot ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  event_kind text not null check (event_kind in (
    'evaluation_received', 'evaluation_sent', 'evaluation_completed', 'evaluation_due_reminder'
  )),
  payload jsonb not null check (octet_length(payload::text) <= 32768),
  idempotency_key uuid not null unique,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'ambiguous')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  attempt_token uuid,
  claimed_at timestamptz,
  next_attempt_at timestamptz,
  provider_message_id text check (provider_message_id is null or (
    char_length(provider_message_id) between 1 and 512 and provider_message_id !~ '[\r\n]'
  )),
  provider_error_code text check (provider_error_code is null or provider_error_code ~ '^[a-z0-9_]{1,64}$'),
  sent_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (
    (status = 'sending' and attempt_token is not null and claimed_at is not null)
    or (status <> 'sending' and attempt_token is null)
  ),
  check (
    (status = 'sent' and provider_message_id is not null and sent_at is not null)
    or (status <> 'sent' and sent_at is null)
  )
);

create index evaluation_email_delivery_claim
  on private.evaluation_email_deliveries (status, next_attempt_at, created_at, id)
  where status in ('pending', 'sending', 'failed', 'ambiguous');

alter table private.evaluation_templates enable row level security;
alter table private.evaluation_templates force row level security;
alter table private.evaluation_assignments enable row level security;
alter table private.evaluation_assignments force row level security;
alter table private.evaluation_responses enable row level security;
alter table private.evaluation_responses force row level security;
alter table private.evaluation_operations enable row level security;
alter table private.evaluation_operations force row level security;
alter table private.evaluation_notifications enable row level security;
alter table private.evaluation_notifications force row level security;
alter table private.evaluation_email_deliveries enable row level security;
alter table private.evaluation_email_deliveries force row level security;

revoke all on table private.evaluation_templates, private.evaluation_assignments,
  private.evaluation_responses, private.evaluation_operations, private.evaluation_notifications,
  private.evaluation_email_deliveries from public, anon, authenticated;

create function private.evaluation_payload_hash(p_payload jsonb)
returns text language sql immutable strict security invoker set search_path = '' as $$
  select pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex'
  );
$$;
revoke all on function private.evaluation_payload_hash(jsonb) from public, anon, authenticated;

create function private.normalize_evaluation_questions(p_questions jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_question jsonb;
  v_column jsonb;
  v_result jsonb := '[]'::jsonb;
  v_columns jsonb;
  v_id text;
  v_text text;
  v_mode text;
  v_preset text;
  v_guidance text;
  v_required boolean;
begin
  if p_questions is null or jsonb_typeof(p_questions) <> 'array'
    or jsonb_array_length(p_questions) not between 1 and 50
    or octet_length(p_questions::text) > 262144
    or jsonb_array_length(p_questions) <> (
      select count(distinct question.value->>'id') from jsonb_array_elements(p_questions) as question(value)
    ) then
    raise exception 'evaluation_invalid_questions' using errcode = '22023';
  end if;

  for v_question in select value from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(v_question) <> 'object'
      or exists (select 1 from jsonb_object_keys(v_question) as keys(key)
        where keys.key not in ('id', 'text', 'required', 'mode', 'preset', 'columns', 'guidance')) then
      raise exception 'evaluation_invalid_questions' using errcode = '22023';
    end if;
    v_id := v_question->>'id';
    v_text := btrim(v_question->>'text');
    v_mode := v_question->>'mode';
    if v_id is null or v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or v_text is null or char_length(v_text) not between 1 and 100
      or v_question->'required' is null or jsonb_typeof(v_question->'required') <> 'boolean'
      or v_mode is null or v_mode not in ('text', 'table') then
      raise exception 'evaluation_invalid_questions' using errcode = '22023';
    end if;
    v_required := (v_question->>'required')::boolean;

    if v_mode = 'text' then
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'text', v_text, 'required', v_required, 'mode', 'text'
      ));
      continue;
    end if;

    v_preset := v_question->>'preset';
    v_guidance := nullif(btrim(v_question->>'guidance'), '');
    if v_preset is null or v_preset not in ('meals', 'medications', 'custom')
      or (v_guidance is not null and char_length(v_guidance) > 500)
      or jsonb_typeof(v_question->'columns') <> 'array'
      or jsonb_array_length(v_question->'columns') not between 1 and 12
      or jsonb_array_length(v_question->'columns') <> (
        select count(distinct column_value.value->>'id')
        from jsonb_array_elements(v_question->'columns') as column_value(value)
      ) then
      raise exception 'evaluation_invalid_questions' using errcode = '22023';
    end if;
    v_columns := '[]'::jsonb;
    for v_column in select value from jsonb_array_elements(v_question->'columns') loop
      if jsonb_typeof(v_column) <> 'object'
        or exists (select 1 from jsonb_object_keys(v_column) as keys(key) where keys.key not in ('id', 'label'))
        or (v_column->>'id') is null
        or (v_column->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or (v_column->>'label') is null
        or char_length(btrim(v_column->>'label')) not between 1 and 80 then
        raise exception 'evaluation_invalid_questions' using errcode = '22023';
      end if;
      v_columns := v_columns || jsonb_build_array(jsonb_build_object(
        'id', v_column->>'id', 'label', btrim(v_column->>'label')
      ));
    end loop;
    v_result := v_result || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'id', v_id, 'text', v_text, 'required', v_required, 'mode', 'table',
      'preset', v_preset, 'columns', v_columns, 'guidance', v_guidance
    )));
  end loop;
  return v_result;
end;
$$;
revoke all on function private.normalize_evaluation_questions(jsonb) from public, anon, authenticated;

create function private.normalize_evaluation_answers(p_snapshot jsonb, p_answers jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_question jsonb;
  v_answer jsonb;
  v_row jsonb;
  v_column jsonb;
  v_rows jsonb;
  v_values jsonb;
  v_result jsonb := '{}'::jsonb;
  v_question_id text;
  v_row_id text;
  v_value text;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object'
    or octet_length(p_answers::text) > 524288
    or exists (
      select 1 from jsonb_object_keys(p_answers) as answer_keys(answer_key)
      where not exists (
        select 1 from jsonb_array_elements(p_snapshot->'questions') as questions(question)
        where questions.question->>'id' = answer_keys.answer_key
      )
    ) then
    raise exception 'evaluation_invalid_answers' using errcode = '22023';
  end if;

  for v_question in select value from jsonb_array_elements(p_snapshot->'questions') loop
    v_question_id := v_question->>'id';
    if not p_answers ? v_question_id then continue; end if;
    v_answer := p_answers->v_question_id;
    if v_question->>'mode' = 'text' then
      if jsonb_typeof(v_answer) <> 'string' or char_length(v_answer #>> '{}') > 5000 then
        raise exception 'evaluation_invalid_answers' using errcode = '22023';
      end if;
      v_result := v_result || jsonb_build_object(v_question_id, v_answer #>> '{}');
      continue;
    end if;
    if jsonb_typeof(v_answer) <> 'object'
      or exists (select 1 from jsonb_object_keys(v_answer) as keys(key) where keys.key <> 'rows')
      or v_answer->'rows' is null or jsonb_typeof(v_answer->'rows') <> 'array'
      or jsonb_array_length(v_answer->'rows') > 500
      or jsonb_array_length(v_answer->'rows') <> (
        select count(distinct row_value.value->>'id')
        from jsonb_array_elements(v_answer->'rows') as row_value(value)
      ) then
      raise exception 'evaluation_invalid_answers' using errcode = '22023';
    end if;
    v_rows := '[]'::jsonb;
    for v_row in select value from jsonb_array_elements(v_answer->'rows') loop
      v_row_id := v_row->>'id';
      if jsonb_typeof(v_row) <> 'object'
        or exists (select 1 from jsonb_object_keys(v_row) as keys(key) where keys.key not in ('id', 'values'))
        or v_row_id is null
        or v_row_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or v_row->'values' is null or jsonb_typeof(v_row->'values') <> 'object'
        or exists (
          select 1 from jsonb_object_keys(v_row->'values') as value_keys(value_key)
          where not exists (
            select 1 from jsonb_array_elements(v_question->'columns') as column_values(column_value)
            where column_values.column_value->>'id' = value_keys.value_key
          )
        ) then
        raise exception 'evaluation_invalid_answers' using errcode = '22023';
      end if;
      v_values := '{}'::jsonb;
      for v_column in select value from jsonb_array_elements(v_question->'columns') loop
        v_value := coalesce(v_row->'values'->>(v_column->>'id'), '');
        if char_length(v_value) > 1000 then
          raise exception 'evaluation_invalid_answers' using errcode = '22023';
        end if;
        v_values := v_values || jsonb_build_object(v_column->>'id', v_value);
      end loop;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('id', v_row_id, 'values', v_values));
    end loop;
    v_result := v_result || jsonb_build_object(v_question_id, jsonb_build_object('rows', v_rows));
  end loop;
  return v_result;
end;
$$;
revoke all on function private.normalize_evaluation_answers(jsonb, jsonb) from public, anon, authenticated;

create function private.assert_evaluation_required_answers(p_snapshot jsonb, p_answers jsonb, p_consent boolean)
returns void language plpgsql immutable security invoker set search_path = '' as $$
declare v_question jsonb; v_answer jsonb;
begin
  for v_question in select value from jsonb_array_elements(p_snapshot->'questions') loop
    if (v_question->>'required')::boolean then
      v_answer := p_answers->(v_question->>'id');
      if (v_question->>'mode' = 'text' and (
          v_answer is null or jsonb_typeof(v_answer) <> 'string' or btrim(v_answer #>> '{}') = ''
        )) then raise exception 'evaluation_required_answers_missing' using errcode = '22023'; end if;
      if (v_question->>'mode' = 'table' and (
          v_answer is null or jsonb_typeof(v_answer->'rows') <> 'array'
          or jsonb_array_length(v_answer->'rows') = 0
        )) then raise exception 'evaluation_required_answers_missing' using errcode = '22023'; end if;
    end if;
  end loop;
  if (p_snapshot->>'sensitive')::boolean and not coalesce(p_consent, false) then
    raise exception 'evaluation_consent_required' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.assert_evaluation_required_answers(jsonb, jsonb, boolean) from public, anon, authenticated;

create function private.evaluation_due_at(p_due_date date, p_now timestamptz)
returns timestamptz language plpgsql stable security invoker set search_path = '' as $$
declare v_due timestamptz;
begin
  if p_due_date is null then return null; end if;
  -- La fecha elegida vence al terminar ese día civil en Santiago; nunca depende del reloj cliente.
  v_due := (p_due_date::timestamp + interval '1 day' - interval '1 microsecond')
    at time zone 'America/Santiago';
  if v_due <= p_now or p_due_date > (p_now at time zone 'America/Santiago')::date + 3650 then
    raise exception 'evaluation_invalid_due_date' using errcode = '22023';
  end if;
  return v_due;
end;
$$;
revoke all on function private.evaluation_due_at(date, timestamptz) from public, anon, authenticated;

create function private.prevent_evaluation_assignment_snapshot_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if row(old.id, old.template_origin_id, old.coach_user_id, old.student_user_id,
      old.relationship_episode_id, old.send_batch_id, old.snapshot, old.coach_name_snapshot,
      old.coach_email_snapshot, old.student_name_snapshot, old.student_email_snapshot,
      old.sensitive, old.sent_at)
    is distinct from
    row(new.id, new.template_origin_id, new.coach_user_id, new.student_user_id,
      new.relationship_episode_id, new.send_batch_id, new.snapshot, new.coach_name_snapshot,
      new.coach_email_snapshot, new.student_name_snapshot, new.student_email_snapshot,
      new.sensitive, new.sent_at) then
    raise exception 'evaluation_snapshot_immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger evaluation_assignment_snapshot_immutable
  before update on private.evaluation_assignments for each row
  execute function private.prevent_evaluation_assignment_snapshot_mutation();

create function private.prevent_completed_evaluation_response_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.state = 'completed' and old is distinct from new then
    raise exception 'evaluation_response_immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger evaluation_completed_response_immutable
  before update on private.evaluation_responses for each row
  execute function private.prevent_completed_evaluation_response_mutation();

revoke all on function private.prevent_evaluation_assignment_snapshot_mutation(),
  private.prevent_completed_evaluation_response_mutation() from public, anon, authenticated;

create function private.evaluation_status(
  p_due_at timestamptz, p_state text, p_draft_updated_at timestamptz,
  p_reopened_at timestamptz, p_now timestamptz
)
returns text language sql immutable security invoker set search_path = '' as $$
  select case when p_state = 'completed' then 'completed'
    when p_due_at is not null and p_due_at <= p_now then 'expired'
    when p_state = 'draft' and (p_reopened_at is null or p_draft_updated_at > p_reopened_at)
      then 'draft' else 'pending' end;
$$;
revoke all on function private.evaluation_status(timestamptz, text, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;

create function private.enqueue_evaluation_email(
  p_notification_id uuid, p_initiated_by uuid, p_recipient_id uuid, p_recipient_email text,
  p_event_kind text, p_payload jsonb, p_now timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into private.evaluation_email_deliveries (
    notification_id, initiated_by_user_id, recipient_user_id, recipient_email_snapshot,
    event_kind, payload, idempotency_key, status, created_at, updated_at
  ) values (
    p_notification_id, p_initiated_by, p_recipient_id, lower(btrim(p_recipient_email)),
    p_event_kind, p_payload, gen_random_uuid(), 'pending', p_now, p_now
  ) on conflict (notification_id) do nothing;
end;
$$;
revoke all on function private.enqueue_evaluation_email(uuid, uuid, uuid, text, text, jsonb, timestamptz)
  from public, anon, authenticated;

create function public.list_own_evaluation_templates()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := private.lock_coach_invitation_owner();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', template.id, 'name', template.name, 'questions', template.questions,
    'createdAt', template.created_at, 'updatedAt', template.updated_at
  ) order by template.created_at desc, template.id desc)
  from private.evaluation_templates template
  where template.coach_user_id = v_owner and template.hidden_at is null), '[]'::jsonb);
end;
$$;

create function public.save_own_evaluation_template(
  p_template_id uuid, p_name text, p_questions jsonb, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := private.lock_coach_invitation_owner();
  v_now timestamptz := clock_timestamp();
  v_name text := btrim(p_name);
  v_questions jsonb;
  v_payload jsonb;
  v_hash text;
  v_operation private.evaluation_operations;
  v_template private.evaluation_templates;
begin
  if p_request_id is null or char_length(v_name) not between 1 and 120 then
    raise exception 'evaluation_invalid_template' using errcode = '22023';
  end if;
  v_questions := private.normalize_evaluation_questions(p_questions);
  v_payload := jsonb_build_object('templateId', p_template_id, 'name', v_name, 'questions', v_questions);
  v_hash := private.evaluation_payload_hash(v_payload);
  select * into v_operation from private.evaluation_operations operation
    where operation.actor_user_id = v_owner and operation.request_id = p_request_id;
  if found then
    if v_operation.action <> 'template_save' or v_operation.payload_hash <> v_hash then
      raise exception 'evaluation_request_conflict' using errcode = '55000';
    end if;
    return v_operation.result;
  end if;
  if p_template_id is null then
    insert into private.evaluation_templates (coach_user_id, name, questions, created_at, updated_at)
      values (v_owner, v_name, v_questions, v_now, v_now) returning * into v_template;
  else
    update private.evaluation_templates template set name = v_name, questions = v_questions, updated_at = v_now
      where template.id = p_template_id and template.coach_user_id = v_owner and template.hidden_at is null
      returning * into v_template;
    if not found then raise exception 'evaluation_template_not_found' using errcode = '42501'; end if;
  end if;
  v_payload := jsonb_build_object('id', v_template.id, 'name', v_template.name,
    'questions', v_template.questions, 'createdAt', v_template.created_at, 'updatedAt', v_template.updated_at);
  insert into private.evaluation_operations (actor_user_id, request_id, action, resource_id, payload_hash, result, completed_at)
    values (v_owner, p_request_id, 'template_save', v_template.id, v_hash, v_payload, v_now);
  return v_payload;
end;
$$;

create function public.hide_own_evaluation_templates(p_template_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := private.lock_coach_invitation_owner(); v_count integer;
begin
  if p_template_ids is null or cardinality(p_template_ids) not between 1 and 50
    or cardinality(p_template_ids) <> (select count(distinct item.id) from unnest(p_template_ids) as item(id)) then
    raise exception 'evaluation_invalid_template_ids' using errcode = '22023';
  end if;
  update private.evaluation_templates template set hidden_at = clock_timestamp(), updated_at = clock_timestamp()
    where template.coach_user_id = v_owner and template.id = any(p_template_ids) and template.hidden_at is null;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(p_template_ids) then raise exception 'evaluation_template_not_found' using errcode = '42501'; end if;
  return v_count;
end;
$$;

create function public.list_own_evaluation_students()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := private.lock_coach_invitation_owner();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
    'episodeId', episode.id, 'name', episode.student_name_snapshot, 'email', episode.student_email_snapshot
  ) order by episode.student_name_snapshot, episode.id)
  from private.coach_relationship_episodes episode
  where episode.coach_user_id = v_owner and episode.ended_at is null), '[]'::jsonb);
end;
$$;

create function public.send_own_evaluation_template(
  p_template_id uuid, p_episode_ids uuid[], p_due_date date, p_sensitive boolean, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := private.lock_coach_invitation_owner();
  v_now timestamptz := clock_timestamp();
  v_due_at timestamptz;
  v_template private.evaluation_templates;
  v_episode private.coach_relationship_episodes;
  v_episode_id uuid;
  v_coach_name text;
  v_coach_email text;
  v_snapshot jsonb;
  v_assignment private.evaluation_assignments;
  v_notification_id uuid;
  v_count integer := 0;
  v_names text := '';
  v_payload jsonb;
  v_hash text;
  v_operation private.evaluation_operations;
begin
  if p_template_id is null or p_request_id is null or p_sensitive is null
    or p_episode_ids is null or cardinality(p_episode_ids) not between 1 and 50
    or cardinality(p_episode_ids) <> (select count(distinct item.id) from unnest(p_episode_ids) as item(id)) then
    raise exception 'evaluation_invalid_send' using errcode = '22023';
  end if;
  v_due_at := private.evaluation_due_at(p_due_date, v_now);
  select * into v_template from private.evaluation_templates template
    where template.id = p_template_id and template.coach_user_id = v_owner and template.hidden_at is null for update;
  if not found then raise exception 'evaluation_template_not_found' using errcode = '42501'; end if;
  select private.coach_public_name(v_owner), lower(btrim(auth_user.email)) into v_coach_name, v_coach_email
    from auth.users auth_user where auth_user.id = v_owner;
  if v_coach_name is null or v_coach_email is null then raise exception 'evaluation_forbidden' using errcode = '42501'; end if;
  v_payload := jsonb_build_object('templateId', p_template_id, 'episodeIds', to_jsonb(p_episode_ids),
    'dueDate', p_due_date, 'sensitive', p_sensitive);
  v_hash := private.evaluation_payload_hash(v_payload);
  select * into v_operation from private.evaluation_operations operation
    where operation.actor_user_id = v_owner and operation.request_id = p_request_id;
  if found then
    if v_operation.action <> 'send' or v_operation.payload_hash <> v_hash then
      raise exception 'evaluation_request_conflict' using errcode = '55000';
    end if;
    return v_operation.result;
  end if;
  v_snapshot := jsonb_build_object('templateOriginId', v_template.id, 'name', v_template.name,
    'questions', v_template.questions, 'sensitive', p_sensitive);
  foreach v_episode_id in array p_episode_ids loop
    select * into v_episode from private.coach_relationship_episodes episode
      where episode.id = v_episode_id and episode.coach_user_id = v_owner and episode.ended_at is null for update;
    if not found then raise exception 'evaluation_recipient_not_linked' using errcode = '42501'; end if;
    insert into private.evaluation_assignments (
      template_origin_id, coach_user_id, student_user_id, relationship_episode_id, send_batch_id,
      snapshot, coach_name_snapshot, coach_email_snapshot, student_name_snapshot, student_email_snapshot,
      sensitive, sent_at, due_at
    ) values (
      v_template.id, v_owner, v_episode.student_user_id, v_episode.id, p_request_id,
      v_snapshot, v_coach_name, v_coach_email, v_episode.student_name_snapshot,
      lower(btrim(v_episode.student_email_snapshot)), p_sensitive, v_now, v_due_at
    ) returning * into v_assignment;
    insert into private.evaluation_notifications (
      assignment_id, recipient_user_id, portal_scope, event_kind, title, body, created_at
    ) values (
      v_assignment.id, v_assignment.student_user_id, 'usuario', 'evaluation_received',
      'Nueva evaluación', 'Coach ' || v_coach_name || ' te envió «' || v_template.name || '» para responder.', v_now
    ) returning id into v_notification_id;
    perform private.enqueue_evaluation_email(v_notification_id, v_owner, v_assignment.student_user_id,
      v_assignment.student_email_snapshot, 'evaluation_received', jsonb_build_object(
        'templateName', v_template.name, 'coachName', 'Coach ' || v_coach_name,
        'dueAt', v_due_at, 'assignmentId', v_assignment.id
      ), v_now);
    v_count := v_count + 1;
    v_names := v_names || case when v_names = '' then '' else ', ' end || v_episode.student_name_snapshot;
  end loop;
  insert into private.evaluation_notifications (
    send_batch_id, recipient_user_id, portal_scope, event_kind, title, body, created_at
  ) values (
    p_request_id, v_owner, 'coach', 'evaluation_sent', 'Evaluación enviada',
    'Enviaste «' || v_template.name || '» a ' || v_count || ' alumno(s).', v_now
  ) returning id into v_notification_id;
  perform private.enqueue_evaluation_email(v_notification_id, v_owner, v_owner, v_coach_email,
    'evaluation_sent', jsonb_build_object('templateName', v_template.name, 'studentNames', v_names), v_now);
  v_payload := jsonb_build_object('created', v_count, 'sendBatchId', p_request_id);
  insert into private.evaluation_operations (actor_user_id, request_id, action, resource_id, payload_hash, result, completed_at)
    values (v_owner, p_request_id, 'send', p_template_id, v_hash, v_payload, v_now);
  return v_payload;
end;
$$;

create function public.list_own_coach_evaluation_assignments()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := private.lock_coach_invitation_owner(); v_now timestamptz := clock_timestamp();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', assignment.id, 'sendBatchId', assignment.send_batch_id,
    'studentName', assignment.student_name_snapshot,
    'snapshot', assignment.snapshot,
    'status', private.evaluation_status(
      assignment.due_at, response.state, response.draft_updated_at, assignment.reopened_at, v_now
    ),
    'sentAt', assignment.sent_at, 'dueAt', assignment.due_at, 'completedAt', response.completed_at,
    'consentConfirmed', case when response.state = 'completed' then response.consent_confirmed else false end,
    'answers', case when response.state = 'completed' then response.answers else '{}'::jsonb end,
    'canMutate', episode.ended_at is null and coalesce(response.state, 'pending') <> 'completed',
    'canRemind', episode.ended_at is null
      and coalesce(response.state, 'pending') in ('pending', 'draft')
      and assignment.due_at > v_now and assignment.due_at <= v_now + interval '48 hours'
      and not exists (select 1 from private.evaluation_notifications recent_reminder
        where recent_reminder.assignment_id = assignment.id
          and recent_reminder.event_kind = 'evaluation_due_reminder'
          and recent_reminder.reminder_origin = 'manual'
          and recent_reminder.created_at > v_now - interval '48 hours')
  ) order by assignment.sent_at desc, assignment.id desc)
  from private.evaluation_assignments assignment
  left join private.evaluation_responses response on response.assignment_id = assignment.id
  join private.coach_relationship_episodes episode on episode.id = assignment.relationship_episode_id
  where assignment.coach_user_id = v_owner), '[]'::jsonb);
end;
$$;

create function public.extend_own_evaluation_assignment(p_assignment_id uuid, p_due_date date, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := private.lock_coach_invitation_owner(); v_now timestamptz := clock_timestamp();
  v_due_at timestamptz; v_assignment private.evaluation_assignments; v_hash text; v_payload jsonb;
  v_operation private.evaluation_operations;
begin
  if p_assignment_id is null or p_due_date is null or p_request_id is null then
    raise exception 'evaluation_invalid_extend' using errcode = '22023';
  end if;
  v_due_at := private.evaluation_due_at(p_due_date, v_now);
  v_payload := jsonb_build_object('assignmentId', p_assignment_id, 'dueDate', p_due_date);
  v_hash := private.evaluation_payload_hash(v_payload);
  select * into v_operation from private.evaluation_operations operation
    where operation.actor_user_id = v_owner and operation.request_id = p_request_id;
  if found then
    if v_operation.action <> 'extend' or v_operation.payload_hash <> v_hash then raise exception 'evaluation_request_conflict' using errcode = '55000'; end if;
    return v_operation.result;
  end if;
  select assignment.* into v_assignment from private.evaluation_assignments assignment
  join private.coach_relationship_episodes episode on episode.id = assignment.relationship_episode_id
  left join private.evaluation_responses response on response.assignment_id = assignment.id
  where assignment.id = p_assignment_id and assignment.coach_user_id = v_owner
    and episode.ended_at is null and coalesce(response.state, 'pending') <> 'completed' for update of assignment;
  if not found then raise exception 'evaluation_assignment_forbidden' using errcode = '42501'; end if;
  update private.evaluation_assignments assignment
    set due_at = v_due_at, reopened_at = v_now where assignment.id = p_assignment_id;
  v_payload := jsonb_build_object('assignmentId', p_assignment_id, 'dueAt', v_due_at);
  insert into private.evaluation_operations (
    actor_user_id, request_id, action, resource_id, payload_hash, result, completed_at
  ) values (v_owner, p_request_id, 'extend', p_assignment_id, v_hash, v_payload, v_now);
  return v_payload;
end;
$$;

create function private.create_evaluation_reminder(
  p_assignment_id uuid, p_initiated_by uuid, p_origin text, p_now timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_assignment private.evaluation_assignments; v_notification_id uuid; v_due_label text;
begin
  select * into v_assignment from private.evaluation_assignments assignment where assignment.id = p_assignment_id;
  v_due_label := case when v_assignment.due_at is null then null
    else to_char(v_assignment.due_at at time zone 'America/Santiago', 'DD/MM/YYYY') end;
  insert into private.evaluation_notifications (
    assignment_id, recipient_user_id, portal_scope, event_kind, reminder_origin, title, body, created_at
  ) values (
    v_assignment.id, v_assignment.student_user_id, 'usuario', 'evaluation_due_reminder', p_origin,
    'Evaluación pendiente', '«' || (v_assignment.snapshot->>'name') || '» vence en 2 días — aún no la has enviado.', p_now
  ) returning id into v_notification_id;
  perform private.enqueue_evaluation_email(v_notification_id, p_initiated_by, v_assignment.student_user_id,
    v_assignment.student_email_snapshot, 'evaluation_due_reminder', jsonb_build_object(
      'templateName', v_assignment.snapshot->>'name', 'coachName', 'Coach ' || v_assignment.coach_name_snapshot,
      'dueLabel', v_due_label, 'assignmentId', v_assignment.id
    ), p_now);
  return v_notification_id;
end;
$$;
revoke all on function private.create_evaluation_reminder(uuid, uuid, text, timestamptz) from public, anon, authenticated;

create function public.remind_own_evaluation_assignment(p_assignment_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := private.lock_coach_invitation_owner(); v_now timestamptz := clock_timestamp();
  v_assignment private.evaluation_assignments; v_hash text; v_payload jsonb; v_notification_id uuid;
  v_operation private.evaluation_operations;
begin
  if p_assignment_id is null or p_request_id is null then raise exception 'evaluation_invalid_reminder' using errcode = '22023'; end if;
  v_payload := jsonb_build_object('assignmentId', p_assignment_id);
  v_hash := private.evaluation_payload_hash(v_payload);
  select * into v_operation from private.evaluation_operations operation
    where operation.actor_user_id = v_owner and operation.request_id = p_request_id;
  if found then
    if v_operation.action <> 'manual_reminder' or v_operation.payload_hash <> v_hash then raise exception 'evaluation_request_conflict' using errcode = '55000'; end if;
    return v_operation.result;
  end if;
  select assignment.* into v_assignment from private.evaluation_assignments assignment
  join private.coach_relationship_episodes episode on episode.id = assignment.relationship_episode_id
  left join private.evaluation_responses response on response.assignment_id = assignment.id
  where assignment.id = p_assignment_id and assignment.coach_user_id = v_owner
    and episode.ended_at is null and coalesce(response.state, 'pending') in ('pending', 'draft')
    and assignment.due_at > v_now and assignment.due_at <= v_now + interval '48 hours'
    for update of assignment;
  if not found then raise exception 'evaluation_assignment_forbidden' using errcode = '42501'; end if;
  if exists (select 1 from private.evaluation_notifications notification
    where notification.assignment_id = p_assignment_id and notification.event_kind = 'evaluation_due_reminder'
      and notification.reminder_origin = 'manual' and notification.created_at > v_now - interval '48 hours') then
    raise exception 'evaluation_reminder_rate_limited' using errcode = 'P0001';
  end if;
  v_notification_id := private.create_evaluation_reminder(p_assignment_id, v_owner, 'manual', v_now);
  v_payload := jsonb_build_object('notificationId', v_notification_id);
  insert into private.evaluation_operations (
    actor_user_id, request_id, action, resource_id, payload_hash, result, completed_at
  ) values (v_owner, p_request_id, 'manual_reminder', p_assignment_id, v_hash, v_payload, v_now);
  return v_payload;
end;
$$;

create function private.student_evaluation_identity()
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from public.user_registrations registration where registration.user_id = v_user) then
    raise exception 'evaluation_forbidden' using errcode = '42501';
  end if;
  return v_user;
end;
$$;
revoke all on function private.student_evaluation_identity() from public, anon, authenticated;

create function private.student_evaluation_view(p_assignment_id uuid, p_student_id uuid, p_now timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', assignment.id, 'coachName', 'Coach ' || assignment.coach_name_snapshot,
    'snapshot', assignment.snapshot,
    'status', private.evaluation_status(
      assignment.due_at, response.state, response.draft_updated_at, assignment.reopened_at, p_now
    ),
    'sentAt', assignment.sent_at, 'dueAt', assignment.due_at, 'completedAt', response.completed_at,
    'consentConfirmed', coalesce(response.consent_confirmed, false),
    'answers', coalesce(response.answers, '{}'::jsonb)
  ) from private.evaluation_assignments assignment
  left join private.evaluation_responses response on response.assignment_id = assignment.id
  join private.coach_relationship_episodes episode on episode.id = assignment.relationship_episode_id
  where assignment.id = p_assignment_id and assignment.student_user_id = p_student_id
    and (episode.ended_at is null or response.state = 'completed');
$$;
revoke all on function private.student_evaluation_view(uuid, uuid, timestamptz) from public, anon, authenticated;

create function public.list_own_student_evaluations()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_student uuid := private.student_evaluation_identity(); v_now timestamptz := clock_timestamp();
begin
  return coalesce((select jsonb_agg(private.student_evaluation_view(assignment.id, v_student, v_now)
    order by assignment.sent_at desc, assignment.id desc)
    from private.evaluation_assignments assignment
    join private.coach_relationship_episodes episode on episode.id = assignment.relationship_episode_id
    left join private.evaluation_responses response on response.assignment_id = assignment.id
    where assignment.student_user_id = v_student
      and (episode.ended_at is null or response.state = 'completed')), '[]'::jsonb);
end;
$$;

create function public.get_own_student_evaluation(p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_student uuid := private.student_evaluation_identity(); v_result jsonb;
begin
  if p_assignment_id is null then raise exception 'evaluation_invalid_assignment' using errcode = '22023'; end if;
  v_result := private.student_evaluation_view(p_assignment_id, v_student, clock_timestamp());
  if v_result is null then raise exception 'evaluation_assignment_forbidden' using errcode = '42501'; end if;
  return v_result;
end;
$$;

create function public.save_own_evaluation_draft(
  p_assignment_id uuid, p_answers jsonb, p_consent_confirmed boolean, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_student uuid := private.student_evaluation_identity(); v_now timestamptz := clock_timestamp();
  v_assignment private.evaluation_assignments; v_answers jsonb; v_payload jsonb; v_hash text;
  v_operation private.evaluation_operations; v_response private.evaluation_responses;
begin
  if p_assignment_id is null or p_request_id is null or p_consent_confirmed is null then
    raise exception 'evaluation_invalid_draft' using errcode = '22023';
  end if;
  select assignment.* into v_assignment from private.evaluation_assignments assignment
    join private.coach_relationship_episodes episode on episode.id = assignment.relationship_episode_id
    where assignment.id = p_assignment_id and assignment.student_user_id = v_student
      and episode.ended_at is null for update of assignment;
  if not found then raise exception 'evaluation_assignment_forbidden' using errcode = '42501'; end if;
  if v_assignment.due_at is not null and v_assignment.due_at <= v_now then
    raise exception 'evaluation_expired' using errcode = 'P0001';
  end if;
  select * into v_response from private.evaluation_responses response where response.assignment_id = p_assignment_id for update;
  if found and v_response.state = 'completed' then raise exception 'evaluation_already_completed' using errcode = '55000'; end if;
  v_answers := private.normalize_evaluation_answers(v_assignment.snapshot, p_answers);
  v_payload := jsonb_build_object('assignmentId', p_assignment_id, 'answers', v_answers, 'consent', p_consent_confirmed);
  v_hash := private.evaluation_payload_hash(v_payload);
  select * into v_operation from private.evaluation_operations operation
    where operation.actor_user_id = v_student and operation.request_id = p_request_id;
  if found then
    if v_operation.action <> 'draft_save' or v_operation.payload_hash <> v_hash then raise exception 'evaluation_request_conflict' using errcode = '55000'; end if;
    return v_operation.result;
  end if;
  insert into private.evaluation_responses (assignment_id, student_user_id, state, answers, consent_confirmed, draft_updated_at)
    values (p_assignment_id, v_student, 'draft', v_answers, p_consent_confirmed, v_now)
    on conflict (assignment_id) do update set answers = excluded.answers,
      consent_confirmed = excluded.consent_confirmed, draft_updated_at = excluded.draft_updated_at;
  v_payload := jsonb_build_object('status', 'draft', 'updatedAt', v_now);
  insert into private.evaluation_operations (
    actor_user_id, request_id, action, resource_id, payload_hash, result, completed_at
  ) values (v_student, p_request_id, 'draft_save', p_assignment_id, v_hash, v_payload, v_now);
  return v_payload;
end;
$$;

create function public.submit_own_evaluation(
  p_assignment_id uuid, p_answers jsonb, p_consent_confirmed boolean, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_student uuid := private.student_evaluation_identity(); v_now timestamptz := clock_timestamp();
  v_assignment private.evaluation_assignments; v_answers jsonb; v_payload jsonb; v_hash text;
  v_operation private.evaluation_operations; v_response private.evaluation_responses;
  v_notification_id uuid;
begin
  if p_assignment_id is null or p_request_id is null or p_consent_confirmed is null then
    raise exception 'evaluation_invalid_submit' using errcode = '22023';
  end if;
  select assignment.* into v_assignment from private.evaluation_assignments assignment
    join private.coach_relationship_episodes episode on episode.id = assignment.relationship_episode_id
    where assignment.id = p_assignment_id and assignment.student_user_id = v_student
      and episode.ended_at is null for update of assignment;
  if not found then raise exception 'evaluation_assignment_forbidden' using errcode = '42501'; end if;
  v_answers := private.normalize_evaluation_answers(v_assignment.snapshot, p_answers);
  v_payload := jsonb_build_object('assignmentId', p_assignment_id, 'answers', v_answers, 'consent', p_consent_confirmed);
  v_hash := private.evaluation_payload_hash(v_payload);
  select * into v_operation from private.evaluation_operations operation
    where operation.actor_user_id = v_student and operation.request_id = p_request_id;
  if found then
    if v_operation.action <> 'submit' or v_operation.payload_hash <> v_hash then raise exception 'evaluation_request_conflict' using errcode = '55000'; end if;
    return v_operation.result;
  end if;
  select * into v_response from private.evaluation_responses response where response.assignment_id = p_assignment_id for update;
  if found and v_response.state = 'completed' then raise exception 'evaluation_already_completed' using errcode = '55000'; end if;
  if v_assignment.due_at is not null and v_assignment.due_at <= v_now then
    raise exception 'evaluation_expired' using errcode = 'P0001';
  end if;
  perform private.assert_evaluation_required_answers(v_assignment.snapshot, v_answers, p_consent_confirmed);
  insert into private.evaluation_responses (
    assignment_id, student_user_id, state, answers, consent_confirmed, draft_updated_at, completed_at
  ) values (
    p_assignment_id, v_student, 'completed', v_answers, p_consent_confirmed, v_now, v_now
  ) on conflict (assignment_id) do update set state = 'completed', answers = excluded.answers,
    consent_confirmed = excluded.consent_confirmed, draft_updated_at = excluded.draft_updated_at,
    completed_at = excluded.completed_at;
  insert into private.evaluation_notifications (
    assignment_id, recipient_user_id, portal_scope, event_kind, title, body, created_at
  ) values (
    p_assignment_id, v_assignment.coach_user_id, 'coach', 'evaluation_completed',
    'Evaluación completada', v_assignment.student_name_snapshot || ' completó «' ||
      (v_assignment.snapshot->>'name') || '».', v_now
  ) returning id into v_notification_id;
  perform private.enqueue_evaluation_email(v_notification_id, v_student, v_assignment.coach_user_id,
    v_assignment.coach_email_snapshot, 'evaluation_completed', jsonb_build_object(
      'templateName', v_assignment.snapshot->>'name', 'studentName', v_assignment.student_name_snapshot,
      'assignmentId', p_assignment_id
    ), v_now);
  v_payload := jsonb_build_object('status', 'completed', 'completedAt', v_now);
  insert into private.evaluation_operations (
    actor_user_id, request_id, action, resource_id, payload_hash, result, completed_at
  ) values (v_student, p_request_id, 'submit', p_assignment_id, v_hash, v_payload, v_now);
  return v_payload;
end;
$$;

create function public.list_own_evaluation_notifications(p_portal_scope text, p_limit integer default 50)
returns table (id uuid, assignment_id uuid, event_kind text, title text, body text, read_at timestamptz, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or p_portal_scope not in ('usuario', 'coach') or p_limit not between 1 and 100 then
    raise exception 'evaluation_notifications_forbidden' using errcode = '42501';
  end if;
  if (p_portal_scope = 'usuario' and not exists (select 1 from public.user_registrations r where r.user_id = v_user))
    or (p_portal_scope = 'coach' and not exists (select 1 from public.coach_registrations r where r.user_id = v_user)) then
    raise exception 'evaluation_notifications_forbidden' using errcode = '42501';
  end if;
  return query select notification.id, notification.assignment_id, notification.event_kind,
    notification.title, notification.body, notification.read_at, notification.created_at
    from private.evaluation_notifications notification
    where notification.recipient_user_id = v_user and notification.portal_scope = p_portal_scope
    order by notification.created_at desc, notification.id desc limit p_limit;
end;
$$;

create function public.mark_own_evaluation_notifications_read(p_portal_scope text, p_notification_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_count integer;
begin
  if v_user is null or p_portal_scope not in ('usuario', 'coach') or p_notification_ids is null
    or cardinality(p_notification_ids) not between 1 and 100 then
    raise exception 'evaluation_notifications_forbidden' using errcode = '42501';
  end if;
  update private.evaluation_notifications notification set read_at = coalesce(notification.read_at, clock_timestamp())
    where notification.recipient_user_id = v_user and notification.portal_scope = p_portal_scope
      and notification.id = any(p_notification_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function private.verify_evaluation_email_capability(p_capability text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_expected text;
begin
  select secret.decrypted_secret into v_expected from vault.decrypted_secrets secret
    where secret.name = 'evaluation_email_rpc_secret' limit 1;
  if p_capability is null or v_expected is null
    or char_length(p_capability) not between 32 and 512 or char_length(v_expected) not between 32 and 512
    or p_capability ~ '[[:cntrl:][:space:]]' or v_expected ~ '[[:cntrl:][:space:]]' then return false; end if;
  return extensions.digest(convert_to(p_capability, 'UTF8'), 'sha256') =
    extensions.digest(convert_to(v_expected, 'UTF8'), 'sha256');
end;
$$;
revoke all on function private.verify_evaluation_email_capability(text) from public, anon, authenticated;

create function public.claim_evaluation_email_deliveries(p_capability text default null, p_limit integer default 25)
returns table (
  delivery_id uuid, notification_id uuid, event_kind text, payload jsonb, idempotency_key uuid,
  recipient_email text, attempt_token uuid
) language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_scheduler boolean := false; v_now timestamptz := clock_timestamp();
begin
  if p_limit not between 1 and 25 then raise exception 'evaluation_email_invalid_claim' using errcode = '22023'; end if;
  if not private.verify_evaluation_email_capability(p_capability) then
    raise exception 'evaluation_email_forbidden' using errcode = '42501';
  end if;
  if v_actor is null then
    v_scheduler := true;
    insert into private.evaluation_notifications (
      assignment_id, recipient_user_id, portal_scope, event_kind, reminder_origin, title, body, created_at
    ) select assignment.id, assignment.student_user_id, 'usuario', 'evaluation_due_reminder', 'automatic',
      'Evaluación pendiente', '«' || (assignment.snapshot->>'name') || '» vence en 2 días — aún no la has enviado.', v_now
      from private.evaluation_assignments assignment
      join private.coach_relationship_episodes episode
        on episode.id = assignment.relationship_episode_id and episode.ended_at is null
      left join private.evaluation_responses response on response.assignment_id = assignment.id
      where assignment.due_at > v_now and assignment.due_at <= v_now + interval '48 hours'
        and coalesce(response.state, 'pending') in ('pending', 'draft')
        and not exists (select 1 from private.evaluation_notifications existing
          where existing.assignment_id = assignment.id and existing.reminder_origin = 'automatic')
      on conflict do nothing;
    perform private.enqueue_evaluation_email(notification.id, null, assignment.student_user_id,
      assignment.student_email_snapshot, 'evaluation_due_reminder', jsonb_build_object(
        'templateName', assignment.snapshot->>'name', 'coachName', 'Coach ' || assignment.coach_name_snapshot,
        'dueLabel', to_char(assignment.due_at at time zone 'America/Santiago', 'DD/MM/YYYY'),
        'assignmentId', assignment.id
      ), notification.created_at)
      from private.evaluation_notifications notification
      join private.evaluation_assignments assignment on assignment.id = notification.assignment_id
      where notification.reminder_origin = 'automatic'
        and not exists (select 1 from private.evaluation_email_deliveries delivery
          where delivery.notification_id = notification.id);
  end if;

  return query with candidates as (
    select delivery.id from private.evaluation_email_deliveries delivery
    where (v_scheduler or delivery.initiated_by_user_id = v_actor)
      and delivery.attempt_count < 5
      and (
        delivery.status = 'pending'
        or (delivery.status in ('failed', 'ambiguous') and delivery.next_attempt_at <= v_now)
        or (delivery.status = 'sending' and delivery.claimed_at <= v_now - interval '10 minutes')
      )
    order by delivery.created_at, delivery.id for update skip locked limit p_limit
  ), claimed as (
    update private.evaluation_email_deliveries delivery set status = 'sending',
      attempt_count = delivery.attempt_count + 1, attempt_token = gen_random_uuid(),
      claimed_at = v_now, next_attempt_at = null, provider_error_code = null, updated_at = v_now
      from candidates where delivery.id = candidates.id returning delivery.*
  ) select claimed.id, claimed.notification_id, claimed.event_kind, claimed.payload,
    claimed.idempotency_key, claimed.recipient_email_snapshot, claimed.attempt_token from claimed;
end;
$$;

create function public.complete_evaluation_email_delivery(
  p_capability text, p_delivery_id uuid, p_attempt_token uuid, p_outcome text,
  p_provider_message_id text default null, p_provider_error_code text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_scheduler boolean := false;
begin
  if not private.verify_evaluation_email_capability(p_capability) then
    raise exception 'evaluation_email_forbidden' using errcode = '42501';
  end if;
  if v_actor is null then v_scheduler := true; end if;
  if p_delivery_id is null or p_attempt_token is null or p_outcome not in ('sent', 'failed', 'ambiguous')
    or (p_outcome = 'sent' and (p_provider_message_id is null or p_provider_error_code is not null))
    or (p_outcome <> 'sent' and (p_provider_message_id is not null or p_provider_error_code !~ '^[a-z0-9_]{1,64}$')) then
    raise exception 'evaluation_email_invalid_completion' using errcode = '22023';
  end if;
  update private.evaluation_email_deliveries delivery set status = p_outcome, attempt_token = null,
    provider_message_id = case when p_outcome = 'sent' then p_provider_message_id else null end,
    provider_error_code = case when p_outcome <> 'sent' then p_provider_error_code else null end,
    sent_at = case when p_outcome = 'sent' then clock_timestamp() else null end,
    next_attempt_at = case when p_outcome = 'sent' or delivery.attempt_count >= 5 then null
      when p_outcome = 'ambiguous' then clock_timestamp() + interval '10 minutes'
      when delivery.attempt_count = 1 then clock_timestamp() + interval '1 minute'
      when delivery.attempt_count = 2 then clock_timestamp() + interval '5 minutes'
      else clock_timestamp() + interval '30 minutes' end,
    claimed_at = null, updated_at = clock_timestamp()
    where delivery.id = p_delivery_id and delivery.status = 'sending'
      and delivery.attempt_token = p_attempt_token
      and (v_scheduler or delivery.initiated_by_user_id = v_actor);
  return found;
end;
$$;

revoke all on function public.list_own_evaluation_templates(),
  public.save_own_evaluation_template(uuid, text, jsonb, uuid),
  public.hide_own_evaluation_templates(uuid[]), public.list_own_evaluation_students(),
  public.send_own_evaluation_template(uuid, uuid[], date, boolean, uuid),
  public.list_own_coach_evaluation_assignments(),
  public.extend_own_evaluation_assignment(uuid, date, uuid),
  public.remind_own_evaluation_assignment(uuid, uuid), public.list_own_student_evaluations(),
  public.get_own_student_evaluation(uuid),
  public.save_own_evaluation_draft(uuid, jsonb, boolean, uuid),
  public.submit_own_evaluation(uuid, jsonb, boolean, uuid),
  public.list_own_evaluation_notifications(text, integer),
  public.mark_own_evaluation_notifications_read(text, uuid[]),
  public.claim_evaluation_email_deliveries(text, integer),
  public.complete_evaluation_email_delivery(text, uuid, uuid, text, text, text)
  from public, anon, authenticated;

grant execute on function public.list_own_evaluation_templates(),
  public.save_own_evaluation_template(uuid, text, jsonb, uuid),
  public.hide_own_evaluation_templates(uuid[]), public.list_own_evaluation_students(),
  public.send_own_evaluation_template(uuid, uuid[], date, boolean, uuid),
  public.list_own_coach_evaluation_assignments(),
  public.extend_own_evaluation_assignment(uuid, date, uuid),
  public.remind_own_evaluation_assignment(uuid, uuid), public.list_own_student_evaluations(),
  public.get_own_student_evaluation(uuid),
  public.save_own_evaluation_draft(uuid, jsonb, boolean, uuid),
  public.submit_own_evaluation(uuid, jsonb, boolean, uuid),
  public.list_own_evaluation_notifications(text, integer),
  public.mark_own_evaluation_notifications_read(text, uuid[]),
  public.claim_evaluation_email_deliveries(text, integer),
  public.complete_evaluation_email_delivery(text, uuid, uuid, text, text, text)
  to authenticated;

grant execute on function public.claim_evaluation_email_deliveries(text, integer),
  public.complete_evaluation_email_delivery(text, uuid, uuid, text, text, text) to anon;

commit;
