-- Coach dashboard, private preferences only. No linking, training, email or payments.
-- New RPCs derive ownership from auth.uid(); no caller-supplied ownership fields.
-- CLP/version bounds are JavaScript's exact-integer boundary, not commercial limits.
begin;

create schema if not exists private;

create table private.coach_dashboard_settings (
  coach_user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_fee_clp bigint not null check (monthly_fee_clp between 0 and 9007199254740991),
  version bigint not null check (version between 1 and 9007199254740991),
  updated_at timestamptz not null default statement_timestamp()
);

create table private.coach_dashboard_feature_interests (
  coach_user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature = 'chat'),
  created_at timestamptz not null default statement_timestamp(),
  primary key (coach_user_id, feature)
);

alter table private.coach_dashboard_settings enable row level security;
alter table private.coach_dashboard_settings force row level security;
alter table private.coach_dashboard_feature_interests enable row level security;
alter table private.coach_dashboard_feature_interests force row level security;
-- Default-deny RLS is deliberate: only narrow, authenticated RPCs below access rows.
revoke all on table private.coach_dashboard_settings from public, anon, authenticated;
revoke all on table private.coach_dashboard_feature_interests from public, anon, authenticated;

create function private.require_coach_dashboard_owner()
returns uuid
language plpgsql
security invoker
set search_path = ''
as $require_coach_dashboard_owner$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then
    raise exception 'coach_dashboard_forbidden' using errcode = '42501';
  end if;
  -- Prevent membership removal from interleaving between authorization and the write.
  perform registration.user_id
  from public.coach_registrations as registration
  where registration.user_id = v_owner
  for key share;
  if not found then
    raise exception 'coach_dashboard_forbidden' using errcode = '42501';
  end if;
  return v_owner;
end;
$require_coach_dashboard_owner$;
revoke all on function private.require_coach_dashboard_owner() from public, anon, authenticated;

-- SECURITY DEFINER is narrowly needed to access default-deny private tables. Each
-- entry point authorizes a current Coach and never accepts another account's id.
create function public.read_own_coach_dashboard_preferences()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $read_own_coach_dashboard_preferences$
declare
  v_owner uuid := private.require_coach_dashboard_owner();
  v_fee bigint;
  v_version bigint := 0;
begin
  select settings.monthly_fee_clp, settings.version into v_fee, v_version
  from private.coach_dashboard_settings as settings
  where settings.coach_user_id = v_owner;

  return pg_catalog.jsonb_build_object(
    'monthlyFeeClp', v_fee,
    'version', coalesce(v_version, 0),
    'chatInterestRegistered', exists (
      select 1 from private.coach_dashboard_feature_interests as interest
      where interest.coach_user_id = v_owner and interest.feature = 'chat'
    )
  );
end;
$read_own_coach_dashboard_preferences$;
revoke all on function public.read_own_coach_dashboard_preferences() from public, anon, authenticated;
grant execute on function public.read_own_coach_dashboard_preferences() to authenticated;

create function public.save_own_coach_dashboard_fee(
  p_monthly_fee_clp numeric,
  p_expected_version numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $save_own_coach_dashboard_fee$
declare
  v_owner uuid := private.require_coach_dashboard_owner();
  v_fee bigint;
  v_version bigint;
begin
  -- Validate before casting: bigint/numeric(precision,0) casts would round fractions.
  if p_monthly_fee_clp is null
    or not (p_monthly_fee_clp between 0 and 9007199254740991)
    or pg_catalog.trunc(p_monthly_fee_clp) <> p_monthly_fee_clp
    or p_expected_version is null
    or not (p_expected_version between 0 and 9007199254740990)
    or pg_catalog.trunc(p_expected_version) <> p_expected_version then
    raise exception 'coach_dashboard_invalid_input' using errcode = '22023';
  end if;

  if p_expected_version = 0 then
    insert into private.coach_dashboard_settings (coach_user_id, monthly_fee_clp, version)
    values (v_owner, p_monthly_fee_clp::bigint, 1)
    on conflict (coach_user_id) do nothing
    returning monthly_fee_clp, version into v_fee, v_version;
  else
    update private.coach_dashboard_settings as settings
    set monthly_fee_clp = p_monthly_fee_clp::bigint,
        version = settings.version + 1,
        updated_at = statement_timestamp()
    where settings.coach_user_id = v_owner and settings.version = p_expected_version
    returning settings.monthly_fee_clp, settings.version into v_fee, v_version;
  end if;

  if not found then
    raise exception 'coach_dashboard_version_conflict' using errcode = '40001';
  end if;
  return pg_catalog.jsonb_build_object('monthlyFeeClp', v_fee, 'version', v_version);
end;
$save_own_coach_dashboard_fee$;
revoke all on function public.save_own_coach_dashboard_fee(numeric, numeric) from public, anon, authenticated;
grant execute on function public.save_own_coach_dashboard_fee(numeric, numeric) to authenticated;

create function public.register_own_coach_chat_interest()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $register_own_coach_chat_interest$
declare
  v_owner uuid := private.require_coach_dashboard_owner();
begin
  insert into private.coach_dashboard_feature_interests (coach_user_id, feature)
  values (v_owner, 'chat')
  on conflict (coach_user_id, feature) do nothing;
  return pg_catalog.jsonb_build_object('chatInterestRegistered', true);
end;
$register_own_coach_chat_interest$;
revoke all on function public.register_own_coach_chat_interest() from public, anon, authenticated;
grant execute on function public.register_own_coach_chat_interest() to authenticated;

commit;
