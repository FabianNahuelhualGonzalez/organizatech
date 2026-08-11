-- PERF-06A: least-privilege hardening for the legacy client-facing tables.
--
-- Static frontend write audit (2026-08-10):
-- - profiles: fallback INSERT; UPDATE email, personal fields and avatar metadata.
-- - routines: INSERT user_id/name only.
-- - exercises: INSERT/UPSERT the explicit exercise payload, UPDATE notes and DELETE.
--   Identity columns (id, user_id) are guarded by trigger, not by column ACL.
--
-- RLS policies are intentionally left unchanged. Table privileges are reset before
-- granting only the operations and columns used by those flows.

revoke all privileges on table public.profiles from anon;
revoke all privileges on table public.routines from anon;
revoke all privileges on table public.exercises from anon;

revoke all privileges on table public.profiles from authenticated;
revoke all privileges on table public.routines from authenticated;
revoke all privileges on table public.exercises from authenticated;

grant select on table public.profiles to authenticated;
grant insert (id, display_name, email, gender)
  on table public.profiles to authenticated;
grant update (
  display_name,
  email,
  first_name,
  last_name,
  birth_date,
  gender,
  phone_number,
  avatar_path,
  avatar_updated_at
) on table public.profiles to authenticated;

grant select on table public.routines to authenticated;
grant insert (user_id, name)
  on table public.routines to authenticated;

grant select on table public.exercises to authenticated;
grant insert (
  id,
  user_id,
  routine_id,
  name,
  target_sets,
  target_reps,
  base_weight,
  side_weight,
  day,
  notes
) on table public.exercises to authenticated;
grant update (
  id,
  user_id,
  routine_id,
  name,
  target_sets,
  target_reps,
  base_weight,
  side_weight,
  day,
  notes
) on table public.exercises to authenticated;
grant delete on table public.exercises to authenticated;

-- The legacy exercises upsert sends the full payload, including id and user_id,
-- and PostgREST may replay any of those columns in the ON CONFLICT DO UPDATE SET
-- list. Rather than depending on which columns PostgREST emits, both identity
-- columns stay writable at the ACL level and the invariant is enforced
-- fail-closed by the trigger below: repeating the same value is allowed, any
-- real change to id or user_id aborts the statement. This is the single
-- canonical identity-protection mechanism for public.exercises.
create function public.prevent_exercise_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  if new.id is distinct from old.id then
    raise exception using
      errcode = '42501',
      message = 'exercise identity cannot be changed';
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception using
      errcode = '42501',
      message = 'exercise ownership cannot be changed';
  end if;

  return new;
end;
$function$;

revoke execute on function public.prevent_exercise_identity_change() from public;
revoke execute on function public.prevent_exercise_identity_change() from anon;
revoke execute on function public.prevent_exercise_identity_change() from authenticated;

-- Unconditional BEFORE UPDATE: the guard never depends on which columns a
-- client happens to list in the SET clause.
create trigger exercises_prevent_identity_change
  before update on public.exercises
  for each row execute function public.prevent_exercise_identity_change();

-- Trigger functions do not need to remain callable through the Data API. Revoking
-- direct execution does not remove or replace the existing auth.users trigger.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;

-- Existing definition only assigns NEW.updated_at = now() and references no
-- application relation. pg_catalog is therefore the minimal fixed search path.
alter function public.set_updated_at() set search_path = pg_catalog;
