-- EMAIL/CALENDAR runtime compatibility hotfix.
--
-- COALESCE is SQL syntax, not a callable pg_catalog routine. The affected
-- PL/pgSQL statements were accepted at creation time but fail when first
-- executed with SQLSTATE 42883. Rewrite only that qualified token in the
-- three already-audited function definitions and preserve their complete
-- signatures, bodies, ownership, SECURITY DEFINER settings, search_path and
-- ACLs. Exact occurrence counts make unexpected schema drift fail closed.

begin;

do $email_calendar_coalesce_runtime_fix$
declare
  v_target record;
  v_oid oid;
  v_definition text;
  v_updated_definition text;
  v_security_definer boolean;
  v_configuration text[];
  v_occurrence_count integer;
begin
  for v_target in
    select *
    from (
      values
        (
          'public.claim_auth_transactional_email(text,text,text,text)'::text,
          8::integer
        ),
        (
          'public.claim_own_transactional_welcome_emails(text)'::text,
          4::integer
        ),
        (
          'public.create_own_calendar_reminder(uuid,text,text,text,date,time without time zone,text,boolean,text,text[],text,smallint,text,text,text,date,smallint)'::text,
          1::integer
        )
    ) as target(signature, expected_occurrence_count)
  loop
    v_oid := pg_catalog.to_regprocedure(v_target.signature)::oid;
    if v_oid is null then
      raise exception 'required runtime hotfix function is missing: %', v_target.signature
        using errcode = '55000';
    end if;

    select
      pg_catalog.pg_get_functiondef(procedure.oid),
      procedure.prosecdef,
      procedure.proconfig
    into strict
      v_definition,
      v_security_definer,
      v_configuration
    from pg_catalog.pg_proc as procedure
    where procedure.oid = v_oid;

    if not v_security_definer
      or v_configuration is null
      or not ('search_path=""' = any(v_configuration)) then
      raise exception 'runtime hotfix function security contract drifted: %', v_target.signature
        using errcode = '55000';
    end if;

    v_occurrence_count := (
      pg_catalog.char_length(v_definition)
      - pg_catalog.char_length(
        pg_catalog.replace(v_definition, 'pg_catalog.coalesce', '')
      )
    ) / pg_catalog.char_length('pg_catalog.coalesce');

    if v_occurrence_count <> v_target.expected_occurrence_count then
      raise exception 'runtime hotfix occurrence contract drifted for %: expected %, found %',
        v_target.signature,
        v_target.expected_occurrence_count,
        v_occurrence_count
        using errcode = '55000';
    end if;

    v_updated_definition := pg_catalog.replace(
      v_definition,
      'pg_catalog.coalesce',
      'coalesce'
    );

    if pg_catalog.strpos(v_updated_definition, 'pg_catalog.coalesce') <> 0 then
      raise exception 'runtime hotfix replacement was incomplete: %', v_target.signature
        using errcode = '55000';
    end if;

    execute v_updated_definition;
  end loop;
end;
$email_calendar_coalesce_runtime_fix$;

revoke all on function public.claim_auth_transactional_email(text, text, text, text) from public;
revoke all on function public.claim_auth_transactional_email(text, text, text, text) from anon;
revoke all on function public.claim_auth_transactional_email(text, text, text, text) from authenticated;
grant execute on function public.claim_auth_transactional_email(text, text, text, text) to anon;

revoke all on function public.claim_own_transactional_welcome_emails(text) from public;
revoke all on function public.claim_own_transactional_welcome_emails(text) from anon;
revoke all on function public.claim_own_transactional_welcome_emails(text) from authenticated;
grant execute on function public.claim_own_transactional_welcome_emails(text) to authenticated;

revoke all on function public.create_own_calendar_reminder(
  uuid, text, text, text, date, time without time zone, text, boolean, text,
  text[], text, smallint, text, text, text, date, smallint
) from public;
revoke all on function public.create_own_calendar_reminder(
  uuid, text, text, text, date, time without time zone, text, boolean, text,
  text[], text, smallint, text, text, text, date, smallint
) from anon;
revoke all on function public.create_own_calendar_reminder(
  uuid, text, text, text, date, time without time zone, text, boolean, text,
  text[], text, smallint, text, text, text, date, smallint
) from authenticated;
grant execute on function public.create_own_calendar_reminder(
  uuid, text, text, text, date, time without time zone, text, boolean, text,
  text[], text, smallint, text, text, text, date, smallint
) to authenticated;

-- Ensure PostgREST exposes the replaced definitions immediately.
notify pgrst, 'reload schema';

commit;
