# Release B D2 - QA postcheck catalog reconciliation

Estos artefactos documentan la reconciliacion local posterior a la ejecucion controlada de D2 en Supabase QA.

## Alcance

- D2 fue ejecutada exclusivamente en QA (`organizatech-qa`, project ref `fjjebhaqtrdbpxzxztmh`).
- Production permanece intacta.
- Estos scripts no deben ejecutarse automaticamente.
- No usar `supabase db push`.
- No ejecutar en Production sin fase separada y autorizacion explicita.

## Hallazgos y reconciliacion

El postcheck textual inicial produjo falsos negativos en constraints FK y trigger porque dependia de representaciones de texto que PostgreSQL puede renderizar con o sin esquema segun `search_path`.

Un diagnostico por catalogos confirmo que estaban correctos:

- FK `(cycle_id, user_id)` hacia `training_cycles(id, user_id)` con `ON DELETE RESTRICT`.
- FK `(cycle_day_id, cycle_id)` hacia `training_cycle_days(id, cycle_id)` con `ON DELETE RESTRICT`.
- FK `training_session_id` hacia `training_sessions(id)` con `ON DELETE RESTRICT`.
- Trigger `training_workout_readiness_set_updated_at` sobre `public.set_updated_at()`.

El diagnostico tambien detecto privilegios explicitos automaticos de `service_role` sobre `public.training_workout_readiness`. En QA se corrigio manualmente con:

```sql
revoke all on table public.training_workout_readiness from service_role;
```

La migracion local `20260620_training_workout_readiness.sql` fue reconciliada para incluir ese mismo `REVOKE` en el bloque ACL de tabla.

## Correcciones finales del postcheck

Durante la ejecucion final en QA, el postcheck fallo inicialmente con el error PostgreSQL `42883: operator does not exist: name[] = text[]`.

La causa fue que `pg_attribute.attname` es de tipo PostgreSQL `name`; por eso `array_agg(attname)` produce `name[]`, mientras los literales `array['id']` y equivalentes son `text[]`.

El postcheck corregido aplica casts explicitos `::text` en:

- `a.attname::text as column_name`;
- `array_agg(src.attname::text order by src_ord.n) as source_columns`;
- `array_agg(dst.attname::text order by dst_ord.n) as target_columns`;
- `array_agg(att.attname::text order by ord.n) as columns`.

Tambien se corrigio la validacion del trigger `BEFORE UPDATE FOR EACH ROW`: el bit de `FOR EACH ROW` es `1`, no `4`. El bit `4` corresponde a `INSERT`, que no aplica a este trigger.

El postcheck corregido fue ejecutado en QA y devolvio `D2_QA_VERIFIED` con todos los checks en `true`.

Conteos finales observados en QA:

- `training_workout_readiness_rows = 0`;
- `legacy_training_daily_readiness_rows = 3`.

Production permanece intacta.

## Postcheck robusto

`01_postcheck_readonly.sql` es estrictamente read-only y valida mediante catalogos:

- tabla, columnas y defaults;
- PK, unique constraints e indices;
- FKs mediante `pg_constraint`, `conrelid`, `confrelid`, `conkey`, `confkey` y `confdeltype`;
- trigger mediante `pg_trigger`, `tgtype`, `tgfoid` y `to_regprocedure('public.set_updated_at()')`;
- RLS y policy SELECT propia;
- ACL explicitas de tabla mediante `pg_class.relacl` y `aclexplode`;
- RPC v2 mediante `pg_proc`, `pg_get_function_identity_arguments`, `prosecdef`, `proconfig`, `proacl` y `aclexplode`;
- presencia de la tabla/RPC legacy y ausencia de `cycle_day_id` en `training_daily_readiness`.

El veredicto esperado es `D2_QA_VERIFIED` solo si todos los checks estructurales y ACL son verdaderos.

## Prohibiciones

- No ejecutar estos scripts automaticamente.
- No ejecutar en Production.
- No usar `supabase db push`.
- No modificar datos productivos.
- No incluir UUIDs, payloads ni datos personales en este directorio.