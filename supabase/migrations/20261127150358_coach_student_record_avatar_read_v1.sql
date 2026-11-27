-- A linked Coach may read only the Student's canonical profile avatar.
-- The owner-only avatar write policies and the private bucket remain unchanged.
begin;

create function private.can_coach_read_student_avatar(p_object_name text)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select auth.uid() is not null and exists (
    select 1 from private.coach_relationship_episodes episode
    join public.coach_registrations registration
      on registration.user_id = episode.coach_user_id
    join public.profiles profile on profile.id = episode.student_user_id
    where episode.coach_user_id = auth.uid() and episode.ended_at is null
      and profile.avatar_path = episode.student_user_id::text || '/avatar'
      and p_object_name = profile.avatar_path
  );
$fn$;
revoke all on function private.can_coach_read_student_avatar(text)
  from public, anon, authenticated, service_role;
grant execute on function private.can_coach_read_student_avatar(text) to authenticated;

create policy "profile avatars linked coach read" on storage.objects
  for select to authenticated using (
    bucket_id = 'profile-avatars'
    and private.can_coach_read_student_avatar(name)
  );

create or replace function public.get_own_coach_student_record_subject(p_episode_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_coach uuid := auth.uid(); v_result jsonb;
begin
  if v_coach is null or p_episode_id is null then
    raise exception 'coach_student_record_forbidden' using errcode = '42501'; end if;
  select pg_catalog.jsonb_build_object('episodeId', episode.id,
    'studentUserId', episode.student_user_id,
    'studentName', episode.student_name_snapshot,
    'studentEmail', episode.student_email_snapshot,
    'linkedAt', episode.linked_at,
    'avatarPath', case when profile.avatar_path = episode.student_user_id::text || '/avatar'
      then profile.avatar_path else null end,
    'avatarUpdatedAt', profile.avatar_updated_at) into v_result
  from private.coach_relationship_episodes episode
  join public.coach_registrations registration
    on registration.user_id = episode.coach_user_id
  left join public.profiles profile on profile.id = episode.student_user_id
  where episode.id = p_episode_id and episode.coach_user_id = v_coach
    and episode.ended_at is null;
  if v_result is null then
    raise exception 'coach_student_record_forbidden' using errcode = '42501'; end if;
  return v_result;
end;
$fn$;

commit;
