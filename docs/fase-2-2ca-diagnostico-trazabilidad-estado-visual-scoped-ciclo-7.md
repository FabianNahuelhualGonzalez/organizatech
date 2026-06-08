# Fase 2.2CA - Diagnostico trazabilidad estado visual scoped Ciclo 7

## 1. Resumen ejecutivo

2.2CA revisa la falla funcional heredada de 2.2BZ: el Preview QA renderiza correctamente el plan cycle-scoped del Ciclo 7 y no muestra mezcla legacy, pero el dashboard sigue mostrando estado sin progreso y el ejercicio `prueba 07-06` queda visualmente `Pendiente`.

La causa raiz local encontrada es una carrera de refrescos: `refreshData()` puede terminar despues de la carga cycle-scoped y volver a escribir `exercises`, `entries` y `trainingSessions` con datos legacy. En Ciclo 7, ese overwrite deja visible el plan scoped, pero vacia la fuente visual de sesiones/entries que usa el dashboard para marcar `Registrado` / `Completado`.

Se aplico un fix minimo de codigo: cuando se detecta carga cycle-scoped, la UI bloquea el overwrite legacy de estado visual. No se ejecuto SQL, no se toco Supabase remoto, no se navegaron pantallas con Codex y no se crearon ciclos ni sesiones.

## 2. Estado heredado de 2.2BZ

- Preview QA: OK.
- Gate `/qa/training-cycles`: OK.
- Ciclo 7 visible: OK.
- Plan/rutina scoped renderiza: OK.
- Mezcla legacy visible: NO.
- Estado `Registrado` / `Completado`: NO OK.
- Dashboard/progreso: NO OK.
- Production: intacta.

Quedan descartados como causa principal:

- Preview incorrecto.
- Supabase env incorrecto.
- Marker `plan_snapshot.source`.
- Ausencia de Ciclo 7.
- Ausencia de plan scoped.
- Mezcla visual de legacy en el plan.

## 3. IDs reales esperados/requeridos para Ciclo 7

Los IDs reales no fueron ejecutados ni consultados por Codex en Supabase QA porque la fase no autoriza SQL remoto. Para cerrar trazabilidad con datos reales, el usuario puede ejecutar las queries read-only de la seccion 4 y entregar:

- `cycle_id`.
- `cycle_day_id`.
- `training_cycle_exercise_id`.
- `training_session_id`.
- `exercise_entry_id`.

La validacion esperada es:

- El ejercicio del plan `prueba 07-06` y la entry guardada comparten el mismo `training_cycle_exercise_id`.
- La sesion guardada y el dia renderizado comparten el mismo `cycle_day_id`.
- La sesion tiene `cycle_id` del Ciclo 7.
- La entry tiene `exercise_id = null` y `training_cycle_exercise_id` poblado.

## 4. Queries read-only propuestas

```sql
-- 2.2CA QA read-only - Ciclo 7
select
  id as cycle_id,
  name,
  cycle_number,
  status,
  plan_snapshot ->> 'source' as outer_source,
  plan_snapshot -> 'plan' ->> 'source' as inner_source,
  created_at
from public.training_cycles
where cycle_number = 7
order by created_at desc;
```

```sql
-- 2.2CA QA read-only - estructura cycle-scoped del Ciclo 7
select
  c.id as cycle_id,
  r.id as routine_id,
  r.name as routine_name,
  d.id as cycle_day_id,
  d.day_code,
  d.week_index,
  e.id as training_cycle_exercise_id,
  e.name as exercise_name,
  e.source_legacy_exercise_id
from public.training_cycles c
join public.training_cycle_routines r
  on r.cycle_id = c.id
join public.training_cycle_days d
  on d.routine_id = r.id
join public.training_cycle_exercises e
  on e.day_id = d.id
where c.cycle_number = 7
order by r.created_at, d.week_index, d.sort_order, e.sort_order;
```

```sql
-- 2.2CA QA read-only - sesiones/entries scoped del Ciclo 7
select
  ts.id as training_session_id,
  ts.cycle_id,
  ts.cycle_day_id,
  ts.status,
  ts.planned_day,
  ts.planned_date,
  ts.trained_date,
  ts.created_at as session_created_at,
  ee.id as exercise_entry_id,
  ee.exercise_id,
  ee.training_cycle_exercise_id,
  ee.reps,
  ee.weight,
  ee.created_at as entry_created_at
from public.training_sessions ts
left join public.exercise_entries ee
  on ee.session_id = ts.id
where ts.cycle_id = (
  select id
  from public.training_cycles
  where cycle_number = 7
  order by created_at desc
  limit 1
)
order by ts.created_at desc, ee.created_at desc;
```

Nota de correccion sobre la query sugerida inicialmente: en la migracion local, `training_cycle_exercises` usa `day_id` y `name`; por eso la query usa `e.day_id = d.id` y `e.name as exercise_name`.

## 5. Diagnostico codigo

### Repository scoped

`getCycleScopedTrainingSessionData()` consulta:

- `training_sessions`: incluye `cycle_id`, `cycle_day_id`, `planned_day`, `planned_date`, `trained_date`, `status`.
- `exercise_entries`: incluye `session_id`, `exercise_id`, `training_cycle_exercise_id`, `weight`, `previous_weight`, `reps`.

`mapCycleScopedTrainingSessionData()`:

- Lee `entry.training_cycle_exercise_id`.
- Lo valida como obligatorio para entries cycle-scoped.
- Lo copia a `ExerciseEntry.trainingCycleExerciseId`.
- Copia `session.cycle_id` a `ExerciseEntry.cycleId`.
- Copia `session.cycle_day_id` a `ExerciseEntry.cycleDayId`.
- Copia `session.cycle_id` a `TrainingSession.cycleId`.
- Copia `session.cycle_day_id` a `TrainingSession.cycleDayId`.
- Llena `session.entries` desde `entriesBySessionId`.
- Devuelve `entries` cronologicas desde `mappedSessions.flatMap(session.entries)`.

### Plan scoped hacia UI

`createExerciseTemplatesFromCycleScopedPlan()`:

- Usa `exercise.id` como `ExerciseTemplate.id`.
- Copia `exercise.id` a `ExerciseTemplate.trainingCycleExerciseId`.
- Copia `day.id` a `ExerciseTemplate.cycleDayId`.
- Copia `exercise.cycleId` a `ExerciseTemplate.cycleId`.
- Mantiene `sourceLegacyExerciseId`.

### Dashboard

`DashboardScreen.getDashboardDayData()`:

- En modo scoped recibe `usesCycleScopedSessions = true`.
- Busca sesiones completadas sin filtrar por semana calendario.
- Usa `findDashboardSessionForDay()` y `findDashboardEntries()`.
- `findDashboardEntries()` compara `ExerciseTemplate.trainingCycleExerciseId` contra `ExerciseEntry.trainingCycleExerciseId`.
- El badge `Pendiente` / `Completado` depende de que existan `itemEntries`.

### Fuente del fallo

El dashboard sale del estado vacio con:

```ts
displayEntries.length > 0 ||
displayTrainingSessions.some((session) =>
  session.status === "completed" &&
  !session.deletedAt &&
  session.entries.length > 0
)
```

Si `displayEntries` queda vacio y las sesiones no tienen entries, la UI muestra `Aun no registras progreso` y los ejercicios quedan `Pendiente`, aunque el plan scoped sea correcto.

La carrera encontrada es:

1. `refreshPersistedTrainingCycles()` detecta ciclo cycle-scoped y llama `loadCycleScopedPlanIntoState()`.
2. `loadCycleScopedPlanIntoState()` carga plan, sesiones y entries scoped.
3. Otro `refreshData()` legacy iniciado antes o disparado por auth puede terminar despues.
4. Ese `refreshData()` escribe `setEntries(next.entries)` y `setTrainingSessions(next.sessions)` con la carga legacy.
5. Como las entries cycle-scoped tienen `exercise_id = null`, el flujo legacy no las representa como progreso scoped.
6. Resultado visual: plan scoped visible, pero dashboard sin entries y badge `Pendiente`.

## 6. Causa raiz real

La causa raiz no esta en el ID mapping agregado en 2.2BZ, sino en la proteccion insuficiente del estado visual scoped frente a refrescos legacy tardios. El estado scoped podia ser cargado correctamente y luego quedar sobrescrito por `refreshData()`.

## 7. Cambios aplicados

Archivo modificado:

- `src/components/organizatech-app.tsx`

Cambios:

- Se agrego `isCycleScopedDisplayLockedRef`.
- `loadCycleScopedPlanIntoState()` activa el lock antes de cargar el plan scoped.
- El flujo de creacion cycle-scoped desde setup activa el lock al recibir el plan scoped.
- `refreshData()` ya no pisa `exercises`, `entries`, `trainingSessions`, `activeRoutineDay`, `comparisonDay` ni `trainingPlan` cuando el lock scoped esta activo.
- `clearCycleScopedPlanState()` libera el lock cuando no hay ciclo scoped, el repository esta apagado o el ciclo activo no es scoped.
- `clearUserSessionState()` limpia tambien el estado cycle-scoped.

## 8. Respuestas explicitas del diagnostico

1. El mapper scoped si lee `training_cycle_exercise_id` desde Supabase.
2. El tipo local `CycleScopedTrainingSessionEntryRow` contiene `training_cycle_exercise_id`.
3. El SELECT del repository incluye `training_cycle_exercise_id`.
4. `session.entries` se llena desde `entriesBySessionId` si la query trae entries reales.
5. `displayEntries` se llena desde `scopedSessionData.entries`, salvo que un refresh legacy posterior lo sobrescriba.
6. `trainingCycleExerciseId` llega hasta `ExerciseEntry`.
7. `trainingCycleExerciseId` llega hasta `ExerciseTemplate`.
8. `cycleDayId` llega hasta `TrainingSession`.
9. `cycleDayId` llega hasta `ExerciseTemplate`.
10. `getDashboardDayData()` compara `trainingCycleExerciseId` en scoped y `exerciseId` en legacy.
11. La comparacion del ejercicio `prueba 07-06` requiere confirmar IDs reales con la query read-only de la seccion 4.
12. La comparacion de sesion/dia requiere confirmar `cycle_day_id` real con la query read-only de la seccion 4.
13. Con los IDs mapeados, el estado seguia `Pendiente` porque el estado visual de entries/sessions podia quedar pisado por `refreshData()` legacy.

## 9. Riesgos

- Riesgo menor: si hay un ciclo scoped activo y un refresh legacy termina tarde, ahora se preserva la fuente scoped y el status message puede seguir indicando `Progreso actualizado`; no afecta datos.
- Riesgo menor: usuarios sin ciclo scoped activo mantienen fallback legacy porque el lock se libera en `clearCycleScopedPlanState()`.
- Riesgo pendiente: la validacion real del Ciclo 7 debe hacerse manualmente en Preview QA porque Codex no navega UI en esta fase.

## 10. Rollback

Rollback de codigo:

- Revertir los cambios de `src/components/organizatech-app.tsx` relacionados con `isCycleScopedDisplayLockedRef`.
- No requiere SQL.
- No requiere tocar datos QA o Production.

## 11. Validaciones locales

Pendientes/ejecutadas en la fase:

- `git diff --check`.
- `npm run typecheck`.
- `npm test`.
- `npm run build`.
- Busqueda mojibake extendida en `docs src supabase`.
- Busqueda mojibake corta en `docs src supabase`.

## 12. Validacion manual Preview QA requerida

Usar el Preview QA de la rama `validation/2-2bx-preview-qa` luego de publicar el fix.

Validar manualmente con Ciclo 7 existente:

1. Abrir `/qa/training-cycles`.
2. Confirmar:
   - `VERCEL_ENV = preview`.
   - QA tools enabled.
   - Supabase env qa.
   - Acceso permitido.
   - Ciclo 7 activo.
3. Abrir dashboard principal.
4. Confirmar:
   - El dashboard deja de mostrar `Sin registro de entrenamiento`.
   - El dashboard deja de mostrar `Aun no registras progreso` si existen sessions/entries scoped.
   - `prueba 07-06` deja de quedar `Pendiente`.
   - La sesion aparece `Registrado` / `Completado`.
   - Dashboard/progreso usa datos scoped.
   - No aparece `press banca`.
   - No aparece `abdomen`.
   - No se mezclan datos legacy.
   - No se crean duplicados.
   - No se crea legacy artificial.

## 13. Restricciones cumplidas

- No SQL QA.
- No SQL Production.
- No Supabase remoto.
- No datos productivos.
- No ciclos QA nuevos.
- No ciclos productivos.
- No backfill.
- No `db push`.
- No `migration repair`.
- No navegacion UI con Codex.
- No merge a `main`.
- No activacion de Training Cycles Production.
- No variables Vercel modificadas.

## 14. Decision solicitada a Arquitectura

Solicitar revision del fix 2.2CA y, si se aprueba, autorizar commit/push controlado en `validation/2-2bx-preview-qa` para generar un nuevo Preview QA y validar manualmente Ciclo 7.
