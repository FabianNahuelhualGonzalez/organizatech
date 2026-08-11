-- PERF-06R: normalize the executable ACL of the daily readiness RPC.
-- This migration changes privileges only; it does not replace the function.

revoke all on function public.save_daily_training_readiness(jsonb) from public;
revoke all on function public.save_daily_training_readiness(jsonb) from anon;
revoke all on function public.save_daily_training_readiness(jsonb) from service_role;
grant execute on function public.save_daily_training_readiness(jsonb) to authenticated;
grant execute on function public.save_daily_training_readiness(jsonb) to postgres;
