# Fase 2.2BX - Correccion render/dashboard post-save cycle-scoped

## 1. Resumen ejecutivo

2.2BX corrige un problema de render del dashboard para sesiones cycle-scoped ya persistidas correctamente.

## 2. Estado heredado de 2.2BW

2.2BW queda aprobada parcialmente.

Estado confirmado en QA:

- Patch SQL 2.2BW aplicado correctamente en QA.
- RPC QA actualizada.
- Nuevo marker `cycle-scoped` confirmado.
- Ciclo 7 creado con `plan_snapshot.source = "cycle-scoped"`.
- Persistencia cycle-scoped confirmada:
  - `training_sessions.cycle_id` poblado;
  - `training_sessions.cycle_day_id` poblado;
  - `exercise_entries.training_cycle_exercise_id` poblado;
  - `exercise_entries.exercise_id = null`.
- Ausencia de legacy artificial confirmada.
- Production intacta.

Falla observada:

```text
La UI muestra "Sin registro de entrenamiento" o no refleja el entrenamiento guardado,
aunque la sesion y sus entries existen en tablas cycle-scoped.
```

2.2BX no ejecuta SQL, no toca Supabase remoto y no crea ciclos QA nuevos.

## 3. Evidencia del bug

Con Ciclo 7 activo:

```text
plan_snapshot.source = cycle-scoped
plan_snapshot.plan.source = ui-main-qa
status = active
```

La base contiene sesiones y entries scoped asociadas al ciclo, pero el panel principal no las refleja y muestra estado sin registro.

Esto descarta un problema primario de persistencia y concentra el riesgo en:

- carga inicial;
- refresh post-save;
- mapeo a estado frontend;
- filtro legacy de dashboard;
- render visible.

## 4. Diagnostico tecnico

La lectura cycle-scoped local queda separada de legacy mediante:

- `isCycleScopedTrainingCycle()`;
- `getCycleScopedTrainingPlan(activeCycle.id)`;
- `getCycleScopedTrainingSessionData(activeCycle.id, cycleScopedPlan)`;
- estado dedicado `cycleScopedPlan`, `cycleScopedExercises`, `entries` y `trainingSessions` cargados desde el ciclo activo.

El frontend actual ya reconoce ambos marcadores:

```text
cycle-scoped-qa
cycle-scoped
```

Por lo tanto, un ciclo nuevo con `plan_snapshot.source = "cycle-scoped"` debe entrar al flujo cycle-scoped siempre que el Preview desplegado incluya 2.2BU o posterior.

El punto de riesgo detectado esta en el dashboard. `DashboardScreen` filtraba sesiones completadas por:

```text
session.calendarWeekStart === currentWeekStart
```

Esa regla es legacy y esta basada en semana calendario actual. En cycle-scoped, las sesiones que llegan al dashboard ya vienen filtradas por `cycle_id` desde el repositorio. Aplicar ademas el filtro de semana calendario puede ocultar sesiones validas del ciclo si `calendarWeekStart` no coincide con la semana visible actual, es null o no representa el rango semantico del ciclo.

Resultado:

```text
La sesion existe y pertenece al ciclo activo, pero el dashboard puede tratarla como no activa para render.
```

## 5. Causa raiz

El render del dashboard mezclaba una regla legacy de calendario semanal con datos cycle-scoped.

Para legacy, `calendarWeekStart` sigue siendo necesario para limitar el dashboard a la semana actual.

Para cycle-scoped, el criterio principal debe ser:

```text
sesiones completadas del cycle_id activo
```

y no:

```text
sesiones completadas de la semana calendario actual
```

## 6. Cambios aplicados

Archivo modificado:

```text
src/components/organizatech-app.tsx
```

Cambio:

- Se agrega la senal `usesCycleScopedSessions` al `DashboardScreen`.
- Cuando hay ciclo activo cycle-scoped, el dashboard no descarta sesiones por `calendarWeekStart`.
- Cuando no hay ciclo cycle-scoped activo, el fallback legacy mantiene el filtro original por semana calendario.

Regla resultante:

```text
Cycle-scoped:
  usar sesiones completadas/no borradas ya filtradas por cycle_id.

Legacy:
  usar sesiones completadas/no borradas de la semana calendario actual.
```

## 7. Compatibilidad legacy

El fallback legacy no cambia.

Para usuarios sin ciclo cycle-scoped activo, el dashboard sigue filtrando por:

```text
calendarWeekStart === currentWeekStart
```

No se modifica:

- `saveTrainingSessionWithEntries`;
- lectura legacy de `exercises`;
- entries con `exercise_id` legacy;
- dashboard legacy;
- grafico legacy.

## 8. Validaciones locales

Validaciones ejecutadas:

```text
git diff --check: OK, solo warning CRLF conocido en organizatech-app.tsx
npm run typecheck: OK
npm test: OK
npm run build: OK fuera del sandbox
busqueda de mojibake extendida en docs/src/supabase: sin coincidencias
busqueda de mojibake simple en docs/src/supabase: sin coincidencias
```

Nota:

```text
npm run build dentro del sandbox fallo con spawn EPERM.
La misma validacion fuera del sandbox compilo correctamente.
```

## 9. Condicion de Preview

Para validar Ciclo 7 con:

```text
plan_snapshot.source = "cycle-scoped"
```

el Preview debe corresponder a un despliegue que incluya:

- 2.2BU: compatibilidad dual `cycle-scoped-qa` / `cycle-scoped`;
- 2.2BX: correccion de render/dashboard post-save.

Si se usa un Preview anterior a 2.2BU, el ciclo con `source = "cycle-scoped"` puede no ser reconocido como cycle-scoped y la validacion queda invalida.

## 10. Validacion Preview/QA requerida

Usar el Ciclo 7 existente.

No crear ciclos QA nuevos.

Validar:

- `/qa/training-cycles` indica:
  - `VERCEL_ENV = preview`;
  - QA tools enabled;
  - Supabase env = qa;
  - acceso permitido;
  - sesion activa.
- App principal carga Ciclo 7 como ciclo activo.
- La rutina y ejercicios vienen desde tablas cycle-scoped.
- Tras guardar entrenamiento:
  - se mantiene render cycle-scoped;
  - dashboard refleja la sesion guardada;
  - no aparece fallback legacy silencioso;
  - no aparecen rutinas/ejercicios legacy;
  - no se crean ciclos QA nuevos.

## 11. Criterios de exito

Con Ciclo 7 existente:

- el panel principal deja de mostrar estado sin registro cuando existen sesiones scoped;
- la sesion guardada aparece completada/registrada;
- dashboard/progreso usa datos scoped;
- historial visible no mezcla legacy;
- no se crean registros duplicados;
- no se crea legacy artificial;
- Production permanece intacta.

## 12. Riesgos

Riesgos residuales:

- Si el Preview validado no contiene 2.2BU, `plan_snapshot.source = "cycle-scoped"` puede no activar el repositorio scoped.
- El fix asume que `getCycleScopedTrainingSessionData()` ya entrega solo sesiones del `cycle_id` activo.
- Sesiones QA historicas con fechas o `calendarWeekStart` anteriores pueden seguir existiendo, pero no deben forzar fallback legacy ni ocultar sesiones del ciclo activo.

## 13. Rollback

Rollback frontend:

- revertir el cambio de `usesCycleScopedSessions` en `DashboardScreen`;
- volver al filtro legacy estricto por `calendarWeekStart`;
- mantener intactos datos QA y SQL aplicado previamente.

Rollback no requiere:

- SQL;
- Supabase write;
- db push;
- migration repair;
- modificar Ciclo 7.

## 14. Criterios de aborto

Abortar validacion funcional si:

- Preview no corresponde a un commit que incluya 2.2BU y 2.2BX.
- Preview no apunta a Supabase QA.
- `/qa/training-cycles` no permite acceso.
- Ciclo 7 no aparece como active en QA.
- La UI muestra legacy como fuente de verdad.
- Se requiere crear un ciclo QA nuevo para continuar.
- Aparece cualquier senal de Production.

## 15. Restricciones mantenidas

No autorizado en 2.2BX:

- SQL Production;
- SQL QA adicional;
- Supabase remoto;
- db push;
- migration repair;
- activation de Training Cycles Production;
- activacion de `ENABLE_TRAINING_CYCLES_REPOSITORY`;
- variables Vercel;
- redeploy Production;
- ciclos productivos;
- datos productivos;
- crear ciclos QA nuevos;
- modificar/borrar Ciclo 7.

## 16. Decision solicitada a Arquitectura

Solicitar revision del diagnostico y del fix local 2.2BX.

Si Arquitectura aprueba:

- autorizar commit/push controlado de los archivos de 2.2BX;
- esperar Preview correspondiente;
- validar Ciclo 7 existente en Preview/QA;
- mantener Production y feature flag bloqueadas.

## 17. Estado esperado

2.2BX deja listo el cambio frontend local para auditoria y posterior commit/push controlado.

La validacion funcional debe hacerse en Preview/QA solo despues de que exista un deployment correspondiente al commit que incluya esta correccion.
