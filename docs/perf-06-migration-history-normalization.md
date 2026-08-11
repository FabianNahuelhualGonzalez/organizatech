# PERF-06R — Normalización del historial de migraciones

## Motivo y alcance

PERF-06R normaliza los nombres de las 19 migraciones históricas al formato de versión de 14 dígitos que exige Supabase CLI y agrega una migración compensatoria fail-closed para lineages legacy. No cambia el contenido SQL histórico ni PERF-06A/C/B, no ejecuta SQL remoto y no declara equivalencia con producción.

La premisa aprobada para este trabajo es que QA no conserva actualmente filas de historial para estas migraciones. Esa ausencia no se volvió a consultar durante esta implementación porque el alcance prohíbe acceder a QA o PROD. Antes de cualquier aplicación futura debe verificarse de nuevo en QA mediante auditoría read-only.

## Mapping, orden y SHA-256

Los ordinales `000001`, `000002`, etc. sólo fijan un orden determinista dentro de una fecha. No representan una hora histórica ni reconstruyen el momento real de creación o aplicación.

| # | Ruta anterior | Ruta normalizada | SHA-256 |
|---:|---|---|---|
| 1 | `20260513_add_exercise_day.sql` | `20260513000001_add_exercise_day.sql` | `9e817d4aced1dade0b57ac942b67a4c06cf4cc937c6fc26f440c79d40bd24c27` |
| 2 | `20260527_legacy_training_diagnostics.sql` | `20260527000001_legacy_training_diagnostics.sql` | `bc08b6a49b01d1643d0ef99be45e2e5d88ca5ef913911baab4f144f943b206b9` |
| 3 | `20260527_training_sessions_source_of_truth.sql` | `20260527000002_training_sessions_source_of_truth.sql` | `c8ec5b93657f399026a8725f4ce0787f09c1f04d94bbcc8e9636c710bc4b0c00` |
| 4 | `20260531_training_cycles.sql` | `20260531000001_training_cycles.sql` | `457a52c1a99275b1e83482f5dc147a2809e79f14ecd474036a7e3260d5798d33` |
| 5 | `20260604_training_cycle_scoped_model.sql` | `20260604000001_training_cycle_scoped_model.sql` | `9edfb5128a997300b9b2b295180429d2e2ce71c7ee95ed75c4dc005b0834420b` |
| 6 | `20260604_training_cycle_scoped_policy_fix.sql` | `20260604000002_training_cycle_scoped_policy_fix.sql` | `ed1713d581aaedbedd437ac687d0949020a8ad516b870eee7de32e8b0adce0bf` |
| 7 | `20260605_training_cycle_scoped_session_entries_contract.sql` | `20260605000001_training_cycle_scoped_session_entries_contract.sql` | `6b5ef4b13798574d7d723bda849fe0cd790f69eeb7f0470d4d3d20d5484cb55c` |
| 8 | `20260607_training_cycle_scoped_snapshot_source.sql` | `20260607000001_training_cycle_scoped_snapshot_source.sql` | `5b62073b820d1c974f0792ee816cba2b4a76a1041b53b76f21f350184045e915` |
| 9 | `20260608_training_daily_readiness.sql` | `20260608000001_training_daily_readiness.sql` | `a06186a518f35c423d583c537a2839c0a545a66f62da40c2c0d5d6768e413839` |
| 10 | `20260609_fix_training_daily_readiness_rpc_ambiguity.sql` | `20260609000001_fix_training_daily_readiness_rpc_ambiguity.sql` | `600aab78a4b23571e1e54ef067d5865272e8b50bcc0feb43feba3944fcb16c36` |
| 11 | `20260610_training_exercise_lineage.sql` | `20260610000001_training_exercise_lineage.sql` | `45c45cd1e715e1a4209282eaa380c45f34fdb8a4aa1642cfb52f6e064aa11b51` |
| 12 | `20260620_training_workout_readiness.sql` | `20260620000001_training_workout_readiness.sql` | `4ad2f70a144d998956951214fa775fc8b47d1211efcab771599a9149df63fe54` |
| 13 | `20260706_profile_avatar_fields.sql` | `20260706000001_profile_avatar_fields.sql` | `7f2c03b02c0cfbec6c2f8dc275b02fa8080a97ff373e4b431d80e7984c634e8e` |
| 14 | `20260706_profile_personal_fields.sql` | `20260706000002_profile_personal_fields.sql` | `13cce5cdaa82daf8b88983017e945a3ad8c5d48dfcdebd1fc8176fd6596b9327` |
| 15 | `20260707_profile_phone_number.sql` | `20260707000001_profile_phone_number.sql` | `73af18a35ab3d0ac2cc53343c08eb60b7e645a830c479c8d734484756577d03b` |
| 16 | `20260709_p0_d1_harden_training_session_entries_writes.sql` | `20260709000001_p0_d1_harden_training_session_entries_writes.sql` | `24506ca0fe49f9e11a37749dd5ad16ea87eb67d851c7652cdeff2b199ca795c1` |
| 17 | `20260713_p0_h_profile_avatar_hardening.sql` | `20260713000001_p0_h_profile_avatar_hardening.sql` | `75ecc3e7687589140afb98f771aa92d7727ba410950784c1d9ff9fdc56f45d2c` |
| 18 | `20260718_exercise_entries_observation.sql` | `20260718000001_exercise_entries_observation.sql` | `1ee0f019d4eb9f2417693322a6da84c36a1b3250b928181bc7298fd0231ee270` |
| 19 | `20260718_exercise_entries_observation_legacy_lineage.sql` | `20260718000002_exercise_entries_observation_legacy_lineage.sql` | `4d577ead2d9f19629b1a963b128c2f9307660853b72e46d0b69c87b00abdd3b9` |

Después siguen, sin renombrar ni editar, PERF-06A (`20260810225819`), PERF-06C (`20260810230014`) y PERF-06B (`20260810230028`). La CLI oficial 2.113.0 creó después, en este orden:

| Orden | Migración | SHA-256 |
|---:|---|---|
| 1 | `20260811035538_ensure_legacy_exercise_lineage_invariant.sql` | `85f43eb2e415b45866f8693779cda9da62b70ac960d42edb5c72f84316c6920a` |
| 2 | `20260811035542_reconcile_legacy_exercise_lineages.sql` | `a62b9a41bfaa1a20fe1c594dca081618477ba467a56ed8b85969a23d2cbe0708` |

## Carrera detectada e invariant permanente

La primera compensatoria reparaba el estado observado, pero dejaba una carrera: `saveExercise()` conserva un `upsert` directo normal y otro fallback sin `day`. Un INSERT posterior a la compensación podía crear un ejercicio legacy sin lineage. Los locks de la compensatoria sólo retrasaban ese write y no instalaban una garantía permanente.

La solución instala primero el invariant permanente `public.ensure_legacy_exercise_lineage_invariant()` mediante un único trigger `AFTER INSERT OR UPDATE FOR EACH ROW` sobre `public.exercises`. El trigger corre dentro de la transacción del write original, rechaza tanto `auth.uid() IS NULL` como cualquier actor distinto de `NEW.user_id`, valida rutina parent e incompatibilidades, crea como máximo el lineage faltante con allowlist explícita y exige después exactamente un lineage compatible. Un UPDATE sobre una fila histórica faltante ejecuta la misma reparación. Si el write original hace rollback, el INSERT del lineage también se revierte.

La función es `SECURITY INVOKER`, fija `search_path = pg_catalog` y califica relaciones y funciones externas a `pg_catalog`. El inventario productivo contiene un SELECT y un INSERT directos desde el repository cycle-scoped; además, el RPC invoker histórico `create_training_cycle_with_plan` usa un `ON CONFLICT DO UPDATE` de `updated_at` para recuperar un lineage legacy existente y realiza la vinculación legítima de un lineage scoped recién creado desde origin NULL al cycle exercise que ya lo referencia. No existe otro UPDATE productivo de lineage.

El estado efectivo final revoca los permisos anteriores y concede a `authenticated` sólo SELECT e INSERT de tabla, más UPDATE allowlisted exclusivamente sobre `origin_training_cycle_exercise_id` y `updated_at`. Las tres policies declaran `TO authenticated` y usan ownership relacional completo: legacy exige source existente del actor, `origin_kind = 'legacy'` y ausencia de origin scoped; scoped exige ausencia de source legacy y, cuando existe origin, un cycle exercise del actor que referencia bidireccionalmente el mismo lineage. UPDATE conserva `USING` y `WITH CHECK`. Un trigger `SECURITY INVOKER` adicional mantiene inmutables `user_id`, `origin_kind` y source legacy, y sólo acepta el binding scoped inicial NULL → recurso propio compatible; un origin ya vinculado no puede cambiar. Las funciones trigger fijan `search_path = pg_catalog` y revocan ejecución directa a PUBLIC, anon y authenticated.

No existe grant DELETE, policy DELETE, función ni path productivo de DELETE para `training_exercise_lineages`, por lo que un cliente no puede borrar el lineage y conservar el exercise. El grant histórico UPDATE completo queda revocado por el estado final y reemplazado por la allowlist de una columna con RLS y trigger de identidad.

No se modificó código productivo, JSX, CSS ni copy. El contrato fija el SHA-256 de `src/lib/data/repository.ts` y detecta expresamente ambos upserts directos para demostrar por qué el trigger es obligatorio.

### Orden y concurrencia

Supabase ordena los archivos por sus versiones de 14 dígitos y sólo avanza/registrará la migración siguiente después de completar correctamente la anterior. La migración del invariant usa `SET LOCAL` y toma `SHARE ROW EXCLUSIVE` sobre `public.exercises` antes de crear el trigger. La compensatoria tiene una versión posterior, adquiere primero los locks operativos comenzando por `public.exercises` y sólo entonces consulta catálogos; aborta si no encuentra exactamente la función invoker y el trigger canónico habilitado, `AFTER INSERT OR UPDATE FOR EACH ROW` y con `search_path = pg_catalog`.

- Si un INSERT termina antes de que el invariant obtenga el lock, la instalación espera su commit y la compensatoria posterior ve esa fila.
- Si el invariant obtiene primero el lock, el INSERT espera; cuando puede terminar, el trigger ya está confirmado y crea el lineage en la misma transacción.
- Un INSERT bloqueado durante la instalación cae necesariamente en una de esas dos ramas: no puede confirmar entre trigger y compensatoria sin quedar cubierto.
- Un INSERT posterior al trigger y un UPDATE de una fila antigua faltante deben terminar con exactamente un lineage compatible.
- Un rollback del write original revierte también el lineage creado por el AFTER trigger.

Por lo tanto no existe una ventana exitosa de write sobre `exercises` que termine sin lineage: los writes anteriores quedan para la compensatoria y los posteriores quedan bajo el invariant.

## Baseline y reconstrucción local

Este repositorio no versiona `supabase/config.toml`. Una configuración nueva generada por Supabase CLI 2.113.0 usa `[db.migrations] schema_paths = []`; esa opción describe fuentes declarativas y no convierte `supabase/schema.sql` en una migración ejecutada automáticamente por `db reset`. Además, las primeras migraciones históricas ejecutan `ALTER TABLE` sobre tablas creadas en `schema.sql`, lo que demuestra la dependencia real del baseline.

La reconstrucción reproducible debe hacerse únicamente en una copia local desechable con Supabase local disponible:

1. Crear un directorio temporal fuera del repositorio e inicializarlo con `npx --yes supabase@2.113.0 init`.
2. Copiar `supabase/schema.sql` byte-idéntico como la primera migración temporal, con una versión válida anterior a todas las demás, por ejemplo `20000101000000_schema_baseline.sql`.
3. Copiar después los 19 archivos normalizados, PERF-06A/C/B, el invariant y la compensatoria, conservando nombres y bytes.
4. Ejecutar `npx --yes supabase@2.113.0 start` y `npx --yes supabase@2.113.0 db reset --no-seed` sólo en esa copia.
5. Verificar que INSERT y UPDATE de exercises crean/reparan exactamente un lineage, que el rollback del write también revierte el lineage y que la función no es invocable directamente. Después validar caso cero; crear dentro de una transacción dos filas históricas sintéticas sin referencias; aplicar la compensatoria y comprobar dos lineages; reaplicarla y comprobar no-op; probar cardinalidad distinta de 0/2, ownership, referencias inválidas y ausencia del invariant; hacer rollback de fixtures.
6. Detener la instancia y eliminar el directorio temporal y cualquier `.temp`.

Así, el orden probado conceptualmente es `schema.sql` → 19 históricas → PERF-06A → PERF-06C → PERF-06B → invariant → compensatoria. No se modifica silenciosamente `config.toml` y no se presupone que `db reset` cargue `schema.sql`. En este workspace no había Docker ni PostgreSQL local, por lo que la ejecución material de esta reconstrucción queda pendiente y debe constar como no validada, no como PASS.

## Tratamiento de QA y PROD

QA es el único primer destino posible. Antes de bootstrap debe confirmarse read-only que su historial sigue ausente, que el esquema material coincide con el baseline esperado y que la cardinalidad pendiente es exactamente cero o dos. Luego corresponde reconciliar/crear el historial mediante un procedimiento separado y aprobado, ejecutar el bootstrap y aplicar la compensatoria, siempre con snapshot y rollback definidos.

No se permite asumir que PROD sea equivalente a QA. Cualquier cardinalidad distinta de 0/2 aborta la compensatoria. Este cambio no es compatible con PROD por declaración y no puede mergearse hasta una auditoría separada de PROD, inicialmente read-only.

## Tabla diagnóstica excluida

`public.training_session_consolidation_audit` queda expresamente fuera de esta migración compartida. No se elimina, mueve, renombra ni incorpora a un baseline. Una eventual eliminación es una operación QA-only que requiere autorización DDL separada.

## Rollback propuesto

El rollback de nombres consiste en revertir exclusivamente el mapping de 19 rutas, después de verificar nuevamente que sus SHA-256 no cambiaron. El rollback del invariant requiere una transacción autorizada que elimine primero el trigger y luego la función; no elimina datos. El rollback de datos de la compensatoria no es automático: requiere una auditoría separada que identifique exclusivamente lineages con el marker JSONB compensatorio de PERF-06R y demuestre que ninguna entry ni ejercicio de ciclo los referencia. Sólo entonces podría proponerse eliminar esas filas mediante una operación autorizada; nunca se deben tocar lineages preexistentes ni tablas de ejercicios, entries o ciclos.
