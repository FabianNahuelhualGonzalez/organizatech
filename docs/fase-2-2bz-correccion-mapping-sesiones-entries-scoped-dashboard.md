# Fase 2.2BZ - Correccion mapping sesiones/entries scoped dashboard

## 1. Resumen ejecutivo

2.2BZ corrige el mapping visual entre sesiones/entries cycle-scoped y el dashboard.

2.2BY-Retry confirmo que el Preview QA y el plan operativo scoped funcionan, pero el dashboard seguia mostrando:

```text
Sin registro de entrenamiento
Aun no registras progreso
Ejercicio prueba 07-06: Pendiente
```

aunque QA ya tenia persistencia scoped confirmada en:

```text
training_sessions.cycle_id
training_sessions.cycle_day_id
exercise_entries.training_cycle_exercise_id
exercise_entries.exercise_id = null
```

Esta fase no ejecuta SQL, no navega UI, no crea ciclos QA y no toca Production.

## 2. Estado heredado de 2.2BY-Retry

Estado aceptado:

- Preview QA generado con `target = null`.
- `/qa/training-cycles` OK:
  - `VERCEL_ENV = preview`;
  - QA tools enabled;
  - Supabase env qa;
  - acceso permitido;
  - sesion activa.
- Ciclo 7 visible como active.
- Plan/rutina scoped renderiza.
- No hay mezcla legacy visible del plan.
- Production intacta.

Estado fallido:

- dashboard no muestra la sesion scoped como registrada/completada;
- progreso sigue en estado vacio;
- ejercicio scoped visible queda como `Pendiente`.

## 3. Evidencia del bug

Render observado en Preview QA:

```text
Sin registro de entrenamiento
Aun no registras progreso
prueba 07-06
Pendiente
```

Tambien se observo:

```text
press banca: no aparece
abdomen: no aparece
```

Esto descarta una contaminacion visible de legacy en el plan, pero confirma que la sesion/entry scoped guardada no llega al estado visual del dashboard.

## 4. Diagnostico tecnico

El mapper cycle-scoped ya lee:

```text
training_sessions.cycle_id
training_sessions.cycle_day_id
exercise_entries.training_cycle_exercise_id
```

pero el tipo visual comun `ExerciseEntry` solo exponia `exerciseId`, y `TrainingSession` no exponia `cycleId` / `cycleDayId`.

El dashboard quedaba dependiendo de identidades legacy o de un alias implicito:

```text
ExerciseEntry.exerciseId = training_cycle_exercise_id
```

Ese alias funcionaba parcialmente para metricas, pero no dejaba explicito el modo scoped ni permitia separar el matching:

```text
legacy: exercise_id / exerciseId
scoped: training_cycle_exercise_id / trainingCycleExerciseId
```

Ademas, `hasTrainingEntries` solo consideraba sesiones con `session.entries.length > 0`. Si el estado plano `entries` contiene entries scoped, pero el anidado de la sesion no queda disponible para el dashboard, el panel podia seguir marcando estado vacio.

## 5. Causa raiz

La causa raiz es un contrato visual incompleto:

```text
Las identidades cycle-scoped no estaban representadas explicitamente en los tipos de progreso usados por dashboard/progreso.
```

Esto hacia que el render mezclara supuestos legacy:

- sesion por fecha/calendario;
- entry por `exerciseId`;
- progreso por `session.entries`;

con un modelo scoped que debe matchear por:

- `cycleDayId`;
- `trainingCycleExerciseId`;
- entries del `cycle_id` activo.

## 6. Cambios aplicados

Archivos modificados:

```text
src/lib/progress/types.ts
src/lib/training/cycle-scoped-training-repository.ts
src/components/organizatech-app.tsx
```

Cambios:

- `ExerciseTemplate` ahora puede transportar:
  - `cycleId`;
  - `cycleDayId`;
  - `trainingCycleExerciseId`;
  - `sourceLegacyExerciseId`.
- `ExerciseEntry` ahora puede transportar:
  - `cycleId`;
  - `cycleDayId`;
  - `trainingCycleExerciseId`.
- `TrainingSession` ahora puede transportar:
  - `cycleId`;
  - `cycleDayId`.
- El mapper `getCycleScopedTrainingSessionData()` preserva esos campos desde Supabase QA.
- `createExerciseTemplatesFromCycleScopedPlan()` conserva la identidad scoped del dia y ejercicio.
- `DashboardScreen` usa matching separado:
  - scoped: `trainingCycleExerciseId` / `cycleDayId`;
  - legacy: `exerciseId` / fecha calendario.
- `hasTrainingEntries` en modo scoped tambien considera `displayEntries.length > 0`.

## 7. Riesgos

Riesgos residuales:

- Si Supabase/RLS no retorna `exercise_entries` al cliente, el dashboard seguira sin poder mostrar entries scoped aunque existan en DB.
- Si una sesion scoped existe sin entries asociadas visibles, el dashboard no debe inventar completitud.
- La validacion definitiva requiere Preview QA manual con Ciclo 7 existente.

Riesgos mitigados:

- El fallback legacy queda intacto cuando no hay ciclo scoped activo.
- No se escriben datos.
- No se crean entries ni sesiones.
- No se modifica SQL.

## 8. Rollback

Rollback frontend:

- revertir los cambios en:
  - `src/lib/progress/types.ts`;
  - `src/lib/training/cycle-scoped-training-repository.ts`;
  - `src/components/organizatech-app.tsx`.

Rollback no requiere:

- SQL;
- Supabase write;
- db push;
- migration repair;
- tocar Ciclo 7;
- tocar Production.

## 9. Validaciones locales

Validaciones ejecutadas:

```text
git diff --check: OK, solo warning CRLF conocido
npm run typecheck: OK
npm test: OK
npm run build: fallo en sandbox con spawn EPERM; OK fuera del sandbox
busqueda de mojibake extendida en docs/src/supabase: sin coincidencias
busqueda de mojibake simple en docs/src/supabase: sin coincidencias
```

## 10. Validacion manual Preview QA requerida

La validacion UI debe ejecutarla manualmente el usuario.

Usar el Preview QA correspondiente al commit que incluya 2.2BZ.

Pasos:

1. Abrir Preview QA.
2. Confirmar `/qa/training-cycles`:
   - `VERCEL_ENV = preview`;
   - QA tools enabled;
   - Supabase env qa;
   - acceso permitido;
   - sesion activa.
3. Pulsar solo `Cargar ciclos`.
4. Confirmar Ciclo 7 active.
5. Ir al dashboard principal.
6. Confirmar que no se crean ciclos QA nuevos.
7. Confirmar que el ejercicio `prueba 07-06` deja de aparecer como `Pendiente` si tiene entry guardada.
8. Confirmar que aparece sesion registrada/completada.
9. Confirmar que dashboard/progreso usa datos scoped.
10. Confirmar que no aparecen `press banca` ni `abdomen`.

## 11. Criterios de exito

Con Ciclo 7 QA existente:

- dashboard deja de mostrar `Sin registro de entrenamiento`;
- progreso deja de mostrar estado vacio;
- ejercicio `prueba 07-06` deja de aparecer como `Pendiente` si tiene entry guardada;
- sesion aparece registrada/completada;
- dashboard/progreso usa datos scoped;
- no se mezclan datos legacy;
- no se crean duplicados;
- no se crea legacy artificial;
- Production permanece intacta.

## 12. Restricciones

No autorizado:

- SQL QA;
- SQL Production;
- activar Training Cycles Production;
- activar `ENABLE_TRAINING_CYCLES_REPOSITORY`;
- crear/modificar variables Vercel;
- redeploy Production;
- crear ciclos productivos;
- crear mas ciclos QA;
- backfill;
- tocar Ciclo 1;
- tocar datos productivos;
- db push;
- migration repair;
- merge a main sin autorizacion posterior;
- navegar UI con Codex.

## 13. Decision solicitada a Arquitectura

Solicitar revision del fix 2.2BZ.

Si Arquitectura aprueba:

- autorizar commit/push controlado;
- generar Preview QA posterior;
- pedir al usuario validacion manual del Ciclo 7 existente;
- mantener Production, SQL y feature flags bloqueados.
