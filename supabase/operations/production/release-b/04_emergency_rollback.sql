-- Release B - Production emergency rollback template for workout readiness v2.
-- Project ref: lzycxltqbrtsnwfdotqw.
-- Do not execute if any frontend path is using save_training_workout_readiness_v2 or link_training_workout_readiness_session_v2.
-- Execute only with explicit Architecture authorization after a failed backend-only rollout.
-- Scope: remove only Release B v2 backend objects. Legacy readiness remains untouched.

begin;

revoke all on function public.link_training_workout_readiness_session_v2(uuid, uuid) from anon, authenticated;
revoke all on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) from anon, authenticated;

drop function if exists public.link_training_workout_readiness_session_v2(uuid, uuid);
drop function if exists public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb);
drop table if exists public.training_workout_readiness;

commit;
