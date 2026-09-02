-- SEC-TRAIN-01 forward fix: PostgreSQL exposes the integer type as int4 in
-- pg_catalog. The schema-qualified alias pg_catalog.integer parses inside a
-- PL/pgSQL body but fails when the affected statement executes.

begin;

do $migration$
declare
  v_target record;
  v_definition text;
  v_invalid_cast_count integer;
begin
  for v_target in
    select *
    from (
      values
        (
          'private.enforce_training_cycle_exercise_resource_bounds()'::text,
          2
        ),
        (
          'private.enforce_exercise_entry_resource_bounds()'::text,
          1
        ),
        (
          'public.apply_training_cycle_day_exercise_changes(uuid,uuid,uuid[],jsonb,jsonb)'::text,
          8
        )
    ) as target(signature, expected_cast_count)
  loop
    select pg_catalog.pg_get_functiondef(
      pg_catalog.to_regprocedure(v_target.signature)
    )
    into v_definition;

    if v_definition is null then
      raise exception 'SEC-TRAIN cast fix prerequisite missing: %', v_target.signature
        using errcode = '55000';
    end if;

    v_invalid_cast_count := (
      pg_catalog.length(v_definition)
        - pg_catalog.length(
          pg_catalog.replace(v_definition, '::pg_catalog.integer', '')
        )
    ) / pg_catalog.length('::pg_catalog.integer');

    if v_invalid_cast_count <> v_target.expected_cast_count then
      raise exception
        'SEC-TRAIN cast fix expected % invalid casts in %, found %',
        v_target.expected_cast_count,
        v_target.signature,
        v_invalid_cast_count
        using errcode = '55000';
    end if;

    execute pg_catalog.replace(
      v_definition,
      '::pg_catalog.integer',
      '::pg_catalog.int4'
    );
  end loop;
end;
$migration$;

do $postcheck$
declare
  v_signature text;
  v_definition text;
begin
  foreach v_signature in array array[
    'private.enforce_training_cycle_exercise_resource_bounds()',
    'private.enforce_exercise_entry_resource_bounds()',
    'public.apply_training_cycle_day_exercise_changes(uuid,uuid,uuid[],jsonb,jsonb)'
  ]::text[]
  loop
    select pg_catalog.pg_get_functiondef(
      pg_catalog.to_regprocedure(v_signature)
    )
    into v_definition;

    if pg_catalog.strpos(v_definition, '::pg_catalog.integer') > 0
      or pg_catalog.strpos(v_definition, '::pg_catalog.int4') = 0
    then
      raise exception 'SEC-TRAIN cast fix postcheck failed: %', v_signature
        using errcode = '55000';
    end if;
  end loop;
end;
$postcheck$;

commit;
