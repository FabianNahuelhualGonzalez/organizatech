-- EMAIL-ONBOARDING-01: qualify the Auth claim conflict target.
--
-- `RETURNS TABLE` exposes `user_id` as a PL/pgSQL variable. PostgreSQL can
-- therefore treat the original `on conflict (user_id, ...)` target as
-- ambiguous before the Auth ledger row is inserted. Targeting the named
-- unique constraint preserves the existing claim/retry behavior without
-- changing tables, data, ownership, or privileges.

begin;

create or replace function public.claim_auth_transactional_email(
  p_payload text,
  p_recipient_slot text,
  p_event_id text,
  p_capability text
)
returns table (
  delivery_id uuid,
  user_id uuid,
  template_key text,
  idempotency_key uuid,
  recipient_email text,
  first_name text,
  last_name text,
  attempt_token uuid
)
language plpgsql
security definer
set search_path = ''
as $claim_auth_transactional_email$
declare
  v_event jsonb;
  v_user_id uuid;
  v_signed_email text;
  v_signed_new_email text;
  v_action_type text;
  v_token_hash text;
  v_recipient_email text;
  v_delivery_kind text := 'auth_fallback';
  v_first_name text := '';
  v_last_name text := '';
  v_portal text;
  v_material text;
  v_event_key text;
  v_idempotency_key uuid;
begin
  if not private.verify_transactional_email_capability(p_capability)
    or p_payload is null
    or pg_catalog.octet_length(p_payload) not between 2 and 65536
    or p_event_id is null
    or pg_catalog.char_length(p_event_id) not between 1 and 200
    or p_event_id ~ '[[:cntrl:][:space:]]' then
    raise exception 'invalid send email hook proof' using errcode = '42501';
  end if;

  begin
    v_event := p_payload::jsonb;
    v_user_id := (v_event #>> '{user,id}')::uuid;
  exception
    when others then
      raise exception 'invalid send email hook payload' using errcode = '22023';
  end;

  v_action_type := pg_catalog.btrim(pg_catalog.coalesce(
    v_event #>> '{email_data,email_action_type}',
    ''
  ));
  if v_action_type not in (
    'signup',
    'recovery',
    'invite',
    'magiclink',
    'email_change',
    'email',
    'reauthentication',
    'password_changed_notification',
    'email_changed_notification',
    'phone_changed_notification',
    'identity_linked_notification',
    'identity_unlinked_notification',
    'mfa_factor_enrolled_notification',
    'mfa_factor_unenrolled_notification'
  ) then
    raise exception 'unsupported auth email action' using errcode = '22023';
  end if;

  v_signed_email := pg_catalog.lower(pg_catalog.btrim(pg_catalog.coalesce(
    v_event #>> '{user,email}',
    ''
  )));
  v_signed_new_email := pg_catalog.lower(pg_catalog.btrim(pg_catalog.coalesce(
    v_event #>> '{user,new_email}',
    ''
  )));

  if v_action_type = 'email_change' then
    if p_recipient_slot = 'current'
      and pg_catalog.coalesce(v_event #>> '{email_data,token_hash_new}', '') <> '' then
      v_recipient_email := v_signed_email;
      v_token_hash := v_event #>> '{email_data,token_hash_new}';
    elsif p_recipient_slot = 'new'
      and v_signed_new_email <> ''
      and pg_catalog.coalesce(v_event #>> '{email_data,token_hash}', '') <> '' then
      v_recipient_email := v_signed_new_email;
      v_token_hash := v_event #>> '{email_data,token_hash}';
    else
      raise exception 'invalid email change recipient slot' using errcode = '22023';
    end if;
  elsif v_action_type in (
    'password_changed_notification',
    'email_changed_notification',
    'phone_changed_notification',
    'identity_linked_notification',
    'identity_unlinked_notification',
    'mfa_factor_enrolled_notification',
    'mfa_factor_unenrolled_notification'
  ) then
    if p_recipient_slot <> 'primary' then
      raise exception 'invalid notification recipient slot' using errcode = '22023';
    end if;
    v_recipient_email := case
      when v_action_type = 'email_changed_notification' then
        pg_catalog.lower(pg_catalog.btrim(pg_catalog.coalesce(
          v_event #>> '{email_data,old_email}',
          ''
        )))
      else v_signed_email
    end;
    v_token_hash := '';
  else
    if p_recipient_slot <> 'primary' then
      raise exception 'invalid auth email recipient slot' using errcode = '22023';
    end if;
    v_recipient_email := v_signed_email;
    v_token_hash := v_event #>> '{email_data,token_hash}';
  end if;

  if v_recipient_email is null
    or pg_catalog.char_length(v_recipient_email) not between 6 and 254
    or v_recipient_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or v_token_hash is null
    or pg_catalog.char_length(v_token_hash) > 2048
    or (
      v_action_type not in (
        'password_changed_notification',
        'email_changed_notification',
        'phone_changed_notification',
        'identity_linked_notification',
        'identity_unlinked_notification',
        'mfa_factor_enrolled_notification',
        'mfa_factor_unenrolled_notification'
      )
      and pg_catalog.char_length(v_token_hash) < 1
    ) then
    raise exception 'invalid auth email delivery data' using errcode = '22023';
  end if;

  v_portal := pg_catalog.btrim(pg_catalog.coalesce(
    v_event #>> '{user,user_metadata,organizatech_email_presentation,portal}',
    ''
  ));
  v_first_name := pg_catalog.btrim(pg_catalog.coalesce(
    v_event #>> '{user,user_metadata,display_name}',
    ''
  ));
  v_last_name := '';

  if pg_catalog.char_length(v_first_name) not between 1 and 201 then
    v_portal := '';
    v_first_name := '';
  end if;

  if v_action_type = 'signup' and v_portal = 'usuario' then
    v_delivery_kind := 'auth_confirmation_user';
  elsif v_action_type = 'signup' and v_portal = 'coach' then
    v_delivery_kind := 'auth_confirmation_coach';
  else
    if pg_catalog.char_length(v_first_name) > 201 then
      v_first_name := '';
    end if;
  end if;

  v_material := 'organizatech:email-onboarding:v1:' || v_user_id::text || ':' ||
    v_action_type || ':' || p_recipient_slot || ':' ||
    case when v_token_hash = '' then p_event_id else v_token_hash end;
  v_event_key := private.transactional_email_sha256(v_material);
  v_idempotency_key := private.transactional_email_idempotency_uuid(v_material);

  return query
  with claimed as (
    insert into private.transactional_email_deliveries (
      user_id,
      delivery_kind,
      template_version,
      event_key,
      idempotency_key,
      status,
      recipient_fingerprint,
      attempt_count,
      attempt_token,
      last_attempt_at
    )
    values (
      v_user_id,
      v_delivery_kind,
      1,
      v_event_key,
      v_idempotency_key,
      'pending',
      private.transactional_email_sha256(
        'recipient:' || v_user_id::text || ':' || v_recipient_email
      ),
      1,
      gen_random_uuid(),
      pg_catalog.clock_timestamp()
    )
    on conflict on constraint transactional_email_deliveries_event_unique do update
    set
      status = 'pending',
      recipient_fingerprint = excluded.recipient_fingerprint,
      attempt_count = private.transactional_email_deliveries.attempt_count + 1,
      attempt_token = gen_random_uuid(),
      last_attempt_at = pg_catalog.clock_timestamp(),
      provider_error_code = null,
      updated_at = pg_catalog.clock_timestamp()
    where private.transactional_email_deliveries.status = 'failed'
    returning private.transactional_email_deliveries.*
  )
  select
    claimed.id,
    claimed.user_id,
    claimed.delivery_kind,
    claimed.idempotency_key,
    v_recipient_email,
    v_first_name,
    v_last_name,
    claimed.attempt_token
  from claimed;
end;
$claim_auth_transactional_email$;

revoke all on function public.claim_auth_transactional_email(text, text, text, text) from public;
revoke all on function public.claim_auth_transactional_email(text, text, text, text) from anon;
revoke all on function public.claim_auth_transactional_email(text, text, text, text) from authenticated;
grant execute on function public.claim_auth_transactional_email(text, text, text, text) to anon;

commit;
