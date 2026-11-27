begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.training_cycle_notifications
  drop constraint training_cycle_notifications_event_kind_allowed,
  add constraint training_cycle_notifications_event_kind_allowed check (
    event_kind in ('expires_t7', 'expires_t3', 'expires_t2', 'expires_t1',
      'expires_t0', 'closed_t1', 'coach_updated')
  ),
  drop constraint training_cycle_notifications_schedule_shape,
  add constraint training_cycle_notifications_schedule_shape check (
    (event_kind = 'expires_t7' and scheduled_on = end_date_snapshot - 7)
    or (event_kind = 'expires_t3' and scheduled_on = end_date_snapshot - 3)
    or (event_kind = 'expires_t2' and scheduled_on = end_date_snapshot - 2)
    or (event_kind = 'expires_t1' and scheduled_on = end_date_snapshot - 1)
    or (event_kind = 'expires_t0' and scheduled_on = end_date_snapshot)
    or (event_kind = 'closed_t1' and scheduled_on = end_date_snapshot + 1)
    or (event_kind = 'coach_updated' and materialized_at is not null
      and scheduled_on <= end_date_snapshot)
  );

-- The receipt is written after the cycle and its scheduled notifications.
-- An authenticated actor cannot insert a receipt or an action directly.
create function private.notify_student_after_coach_cycle_activation()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_end_date date;
  v_today date := pg_catalog.timezone('America/Santiago', pg_catalog.clock_timestamp())::date;
begin
  if new.portal_scope <> 'usuario' or new.operation_kind <> 'cycle_activate' then
    return new;
  end if;
  select cycle.planned_end_date into v_end_date
  from private.coach_student_training_cycle_actions action
  join public.training_cycles cycle on cycle.id = action.cycle_id
    and cycle.user_id = action.student_user_id and cycle.portal_scope = 'usuario'
  where action.student_user_id = new.user_id
    and action.request_id = new.request_id
    and action.action = 'create_cycle'
    and action.cycle_id = new.aggregate_id
    and cycle.current_plan_version = new.result_version
    and cycle.status = 'active';
  if v_end_date is null then return new; end if;

  insert into public.training_cycle_notifications (
    user_id, portal_scope, cycle_id, end_date_snapshot, event_kind,
    scheduled_on, title, body, materialized_at
  ) values (
    new.user_id, 'usuario', new.aggregate_id, v_end_date, 'coach_updated',
    pg_catalog.least(v_today, v_end_date), 'Tu coach actualizó tu rutina',
    'Tu coach creó un nuevo ciclo de entrenamiento. Revisa la rutina antes de entrenar.',
    pg_catalog.clock_timestamp()
  ) on conflict (cycle_id, end_date_snapshot, event_kind) do nothing;
  return new;
end;
$fn$;

revoke all on function private.notify_student_after_coach_cycle_activation()
  from public, anon, authenticated, service_role;
create trigger notify_student_after_coach_cycle_activation
  after insert on private.training_cycle_operation_receipts
  for each row execute function private.notify_student_after_coach_cycle_activation();

commit;
