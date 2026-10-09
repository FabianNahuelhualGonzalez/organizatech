-- Narrow Chat read for current Coach clients. Historical dashboard settings remain untouched.
begin;

create function public.read_own_coach_chat_interest()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $read_own_coach_chat_interest$
declare
  v_owner uuid := private.require_coach_dashboard_owner();
begin
  return pg_catalog.jsonb_build_object(
    'chatInterestRegistered', exists (
      select 1 from private.coach_dashboard_feature_interests as interest
      where interest.coach_user_id = v_owner and interest.feature = 'chat'
    )
  );
end;
$read_own_coach_chat_interest$;

revoke all on function public.read_own_coach_chat_interest() from public, anon, authenticated;
grant execute on function public.read_own_coach_chat_interest() to authenticated;

commit;
