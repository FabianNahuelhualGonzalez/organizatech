# PERF-06C — Revisión local read-only de foreign keys

## Alcance y límites

### Procedencia del inventario

Las 23 filas clasificadas **provienen del advisor remoto PERF-06**, no de un recuento
del DDL. El DDL versionado contiene **38 foreign keys**; las 23 son el subconjunto que
el advisor reportó. Esta tabla **no pretende ser el inventario total de FK del DDL**.

El DDL versionado en `supabase/schema.sql` y `supabase/migrations/` se usó para
**validar nombres de constraint, columnas referentes e índices** de esas 23 filas, junto
con los filtros y relaciones observables en `src/lib/`. Las 15 FK restantes del DDL
son un conjunto heterogéneo y quedan fuera de la tabla de clasificación porque el
advisor no las reportó. Incluyen las relaciones de ownership hacia `auth.users(id)` y
`profiles_id_fkey`, pero no se limitan a ellas: también incluyen
`training_workout_readiness_session_fk`,
`training_cycle_exercises_exercise_lineage_user_fk`,
`exercise_entries_exercise_lineage_user_fk` y otras FK fuera del subconjunto de 23
reportado por el advisor.

El conteo completo inspecciona tanto constraints declaradas directamente en
`CREATE TABLE`/`ALTER TABLE` como constraints creadas condicionalmente dentro de
bloques `DO $$ ... $$`. La reconciliación es: **23 FK del advisor + 15 FK restantes =
38 FK totales**.

### Límites

No se consultó QA ni PROD, no se ejecutó `ANALYZE` y no se interpretaron los 15
índices sin uso registrado como candidatos de eliminación. Con 0–12 filas por tabla
en la evidencia QA disponible, toda recomendación de índice queda diferida hasta
contar con `EXPLAIN (ANALYZE, BUFFERS)` y estadísticas representativas.

`exercise_entries_session_id_fkey` se documenta para completar los 23 hallazgos,
pero queda expresamente excluida de PERF-06C: su ownership corresponde a PERF-06B.

## Clasificación de los 23 hallazgos

“Cubierto” indica cobertura del patrón productivo multiusuario por un índice compuesto
ya existente; no afirma cobertura general de la validación/cascada de la FK cuando la
columna referenciante no es prefijo izquierdo.

| # | Foreign key | Columnas referentes | Clasificación primaria | Evidencia y decisión PERF-06C |
|---:|---|---|---|---|
| 1 | `exercises_routine_id_fkey` | `exercises(routine_id)` | Cubierto por otro índice compuesto | `exercises_user_routine_idx(user_id, routine_id)` cubre el acceso productivo con ownership; medir deletes de rutina antes de otro índice. |
| 2 | `exercise_entries_session_id_fkey` | `exercise_entries(session_id)` | Solapado con PERF-06B | Excluido expresamente; PERF-06C no crea ni propone su índice. |
| 3 | `exercise_entries_exercise_id_fkey` | `exercise_entries(exercise_id)` | Cubierto por otro índice compuesto | `entries_user_exercise_idx(user_id, exercise_id)` cubre lecturas legacy por owner/ejercicio; la cascada requiere medición separada. |
| 4 | `training_sessions_routine_id_fkey` | `training_sessions(routine_id)` | Cubierto por otro índice compuesto | `training_sessions_user_routine_week_idx(user_id, routine_id, calendar_week_start)` y el unique parcial cubren los accesos owner/rutina. |
| 5 | `training_cycle_routines_cycle_id_fkey` | `training_cycle_routines(cycle_id)` | Cubierto por otro índice compuesto | Los repositories filtran `user_id + cycle_id`; `training_cycle_routines_user_cycle_idx` cubre ese patrón. |
| 6 | `training_cycle_routines_cycle_user_fk` | `training_cycle_routines(cycle_id, user_id)` | Cubierto por otro índice compuesto | El mismo índice `(user_id, cycle_id)` contiene ambas igualdades del lookup productivo, aunque en orden inverso al FK. |
| 7 | `training_cycle_days_cycle_id_fkey` | `training_cycle_days(cycle_id)` | Cubierto por otro índice compuesto | Los accesos productivos filtran owner/ciclo y están cubiertos por `training_cycle_days_user_cycle_week_day_idx`. |
| 8 | `training_cycle_days_routine_id_fkey` | `training_cycle_days(routine_id)` | Útil principalmente para cascade/delete | El flujo normal carga días por owner/ciclo; un índice aislado sería principalmente útil al borrar/restringir una rutina. |
| 9 | `training_cycle_days_cycle_user_fk` | `training_cycle_days(cycle_id, user_id)` | Cubierto por otro índice compuesto | El índice parcial `(user_id, cycle_id, week_index, day_code)` contiene las dos igualdades productivas. |
| 10 | `training_cycle_days_routine_cycle_fk` | `training_cycle_days(routine_id, cycle_id)` | Útil principalmente para cascade/delete | No hay consulta productiva aislada por este par; sirve sobre todo para validar/borrar el parent compuesto. Requiere volumen real antes de actuar. |
| 11 | `training_cycle_exercises_cycle_id_fkey` | `training_cycle_exercises(cycle_id)` | Cubierto por otro índice compuesto | `training_cycle_exercises_user_cycle_day_idx(user_id, cycle_id, day_id)` cubre las cargas productivas owner/ciclo. |
| 12 | `training_cycle_exercises_day_id_fkey` | `training_cycle_exercises(day_id)` | Necesario por query/JOIN productivo | Policies y carga del plan relacionan ejercicios con día; el índice actual ayuda solo cuando también se conoce owner/ciclo. Medir el JOIN antes de añadir otro. |
| 13 | `training_cycle_exercises_source_legacy_exercise_id_fkey` | `training_cycle_exercises(source_legacy_exercise_id)` | Requiere EXPLAIN/estadísticas futuras | Campo nullable de compatibilidad legacy usado en validaciones; sin evidencia de volumen/selectividad suficiente para un índice aislado. |
| 14 | `training_cycle_exercises_cycle_user_fk` | `training_cycle_exercises(cycle_id, user_id)` | Cubierto por otro índice compuesto | `(user_id, cycle_id, day_id)` contiene las igualdades de ownership/ciclo usadas por repositories. |
| 15 | `training_cycle_exercises_day_cycle_fk` | `training_cycle_exercises(day_id, cycle_id)` | Útil principalmente para cascade/delete | El parent compuesto se valida en writes y deletes; las lecturas normales parten por owner/ciclo. Medir cascadas antes de decidir. |
| 16 | `training_sessions_cycle_id_fkey` | `training_sessions(cycle_id)` | Cubierto por otro índice compuesto | `training_sessions_user_cycle_idx(user_id, cycle_id)` cubre las lecturas productivas por owner/ciclo. |
| 17 | `training_sessions_cycle_day_id_fkey` | `training_sessions(cycle_day_id)` | Cubierto por otro índice compuesto | `training_sessions_user_cycle_day_trained_unique_idx(user_id, cycle_day_id, trained_date)` cubre el acceso owner/día activo. |
| 18 | `exercise_entries_training_cycle_exercise_id_fkey` | `exercise_entries(training_cycle_exercise_id)` | Cubierto por otro índice compuesto | `exercise_entries_user_cycle_exercise_idx(user_id, training_cycle_exercise_id)` cubre el acceso cycle-scoped por owner. |
| 19 | `training_sessions_cycle_day_cycle_fk` | `training_sessions(cycle_day_id, cycle_id)` | Necesario por query/JOIN productivo | El contrato de sesión valida ambos campos y las policies los cruzan con días; los índices actuales cubren cada patrón owner-first, no el par FK aislado. Requiere EXPLAIN. |
| 20 | `training_exercise_lineages_source_legacy_exercise_id_fkey` | `training_exercise_lineages(source_legacy_exercise_id)` | Cubierto por otro índice compuesto | `training_exercise_lineages_user_legacy_unique_idx(user_id, source_legacy_exercise_id)` coincide con el lookup productivo del repository. |
| 21 | `training_exercise_lineages_origin_training_cycle_exercise__fkey` | `training_exercise_lineages(origin_training_cycle_exercise_id)` | Cubierto por otro índice compuesto | El nombre refleja el truncado estándar de PostgreSQL; el unique `(user_id, origin_training_cycle_exercise_id)` cubre el lookup multiusuario. |
| 22 | `training_workout_readiness_cycle_user_fk` | `training_workout_readiness(cycle_id, user_id)` | Baja cardinalidad o evidencia insuficiente | La evidencia QA tiene muy pocas filas y los writes están encapsulados en RPC; no hay base para crear un índice adicional. |
| 23 | `training_workout_readiness_cycle_day_cycle_fk` | `training_workout_readiness(cycle_day_id, cycle_id)` | Requiere EXPLAIN/estadísticas futuras | `training_workout_readiness_cycle_day_created_idx(user_id, cycle_id, cycle_day_id, created_at desc)` no cubre el par de la FK: `cycle_day_id` es la tercera columna y no el prefijo izquierdo, por lo que el índice sólo sirve accesos que ya fijan `user_id` y `cycle_id`. Sin evidencia de beneficio; requiere EXPLAIN. |

## Reconciliación independiente del inventario completo

Las 15 FK fuera del subconjunto reportado por el advisor son:

1. `profiles_id_fkey`.
2. `routines_user_id_fkey`.
3. `exercises_user_id_fkey`.
4. `training_sessions_user_id_fkey`.
5. `exercise_entries_user_id_fkey`.
6. `training_cycles_user_id_fkey`.
7. `training_cycle_routines_user_id_fkey`.
8. `training_cycle_days_user_id_fkey`.
9. `training_cycle_exercises_user_id_fkey`.
10. `training_daily_readiness_user_id_fkey`.
11. `training_exercise_lineages_user_id_fkey`.
12. `training_workout_readiness_user_id_fkey`.
13. `training_workout_readiness_session_fk`.
14. `training_cycle_exercises_exercise_lineage_user_fk`.
15. `exercise_entries_exercise_lineage_user_fk`.

El extractor anterior omitió cinco FK porque sus `ADD CONSTRAINT` están dentro de
bloques `DO $$ ... $$`. Se verificaron explícitamente en las migraciones efectivas:

- `training_cycle_days_routine_cycle_fk` — incluida en la fila 10 del advisor.
- `training_cycle_exercises_day_cycle_fk` — incluida en la fila 15 del advisor.
- `training_sessions_cycle_day_cycle_fk` — incluida en la fila 19 del advisor.
- `training_cycle_exercises_exercise_lineage_user_fk` — una de las 15 restantes.
- `exercise_entries_exercise_lineage_user_fk` — una de las 15 restantes.

Por tanto, el inventario reconciliado contiene **38 FK totales**: **23 provenientes del
advisor**, **15 restantes fuera de ese subconjunto**, y **23 + 15 = 38**.

## Decisión

- Cero índices creados o eliminados en PERF-06C.
- Cero cambios a tablas, constraints o queries.
- Cero acciones sobre los 15 índices sin uso registrado.
- Cualquier índice futuro necesita evidencia de QA representativa, `EXPLAIN` y revisión
  separada del costo de escritura y de cascadas/deletes.
