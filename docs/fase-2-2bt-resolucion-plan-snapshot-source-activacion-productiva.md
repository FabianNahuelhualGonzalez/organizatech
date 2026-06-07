# Fase 2.2BT - Resolucion de plan_snapshot.source para activacion productiva

## 1. Resumen ejecutivo

Fase 2.2BT prepara la decision tecnica sobre el valor `plan_snapshot.source` antes de cualquier activacion funcional de Training Cycles en Production.

El hallazgo principal es que la RPC `create_training_cycle_with_plan` persiste actualmente el valor externo:

```text
plan_snapshot.source = "cycle-scoped-qa"
```

Ese valor fue aceptable durante QA porque identificaba los ciclos creados por el modelo cycle-scoped. Sin embargo, si se activa Training Cycles en Production sin resolverlo, los ciclos productivos nuevos quedarian auditados con una etiqueta que contiene `qa`, aunque su origen operativo sea Production.

No se aplica ningun fix en esta fase. La recomendacion tecnica es preparar una correccion controlada con compatibilidad dual: mantener reconocimiento de `"cycle-scoped-qa"` para historico/QA y permitir un nuevo marcador productivo o neutral para ciclos futuros.

## 2. Estado actual

Estado aprobado antes de 2.2BT:

- SQL Production fue aplicado y validado en fases previas.
- Training legacy sigue estable.
- Training Cycles sigue apagado en Production.
- `ENABLE_TRAINING_CYCLES_REPOSITORY` sigue ausente/OFF en Production.
- No se han creado ciclos productivos cycle-scoped.
- El Ciclo 1 productivo existente esta protegido y no debe editarse, cerrarse, borrarse ni usarse como prueba.
- La activacion funcional productiva sigue bloqueada.

Estado del riesgo:

- La estructura SQL ya puede crear ciclos cycle-scoped.
- La activacion productiva podria crear ciclos nuevos.
- Antes de crear un ciclo productivo real, debe resolverse o aceptarse formalmente el valor `plan_snapshot.source = "cycle-scoped-qa"`.

## 3. Ubicacion exacta del valor "cycle-scoped-qa"

El valor externo esta definido en la migracion:

```text
supabase/migrations/20260604_training_cycle_scoped_model.sql
```

Dentro de la funcion:

```text
create_training_cycle_with_plan
```

La funcion construye `plan_snapshot` con un objeto JSON y fija el campo superior `source`:

```sql
jsonb_build_object(
  'source', 'cycle-scoped-qa',
  'cycleType', p_cycle_type,
  'goal', p_goal,
  'durationWeeks', p_duration_weeks,
  'plannedStartDate', p_planned_start_date,
  'plannedEndDate', p_planned_end_date,
  'plan', coalesce(p_plan, '{}'::jsonb)
)
```

Ese `source` no viene desde el frontend. Es un literal persistido por la RPC.

## 4. Diferencia entre source externo e interno

Hay dos fuentes distintas dentro del snapshot:

```text
plan_snapshot.source
plan_snapshot.plan.source
```

### 4.1 plan_snapshot.source

`plan_snapshot.source` es el marcador externo del modelo de snapshot. Actualmente lo escribe la RPC como:

```text
cycle-scoped-qa
```

Uso actual:

- Identifica el ciclo como cycle-scoped para el frontend.
- Es leido por `isCycleScopedTrainingCycle`.
- Actua como gate de lectura/render cycle-scoped.

### 4.2 plan_snapshot.plan.source

`plan_snapshot.plan.source` es parte del payload anidado enviado desde el frontend como `p_plan`.

El valor se genera en:

```text
src/app/page.tsx
```

Con esta logica:

```ts
const trainingCyclesSnapshotSource = productionTrainingCyclesRepositoryEnabled
  ? "ui-main-production"
  : "ui-main-qa";
```

Luego se pasa a `OrganizatechApp` y se incorpora en:

```text
createCycleScopedPlanInput(...)
```

Ese valor queda dentro del plan anidado:

```text
plan_snapshot.plan.source = "ui-main-qa" | "ui-main-production"
```

Conclusion:

- `plan_snapshot.source` marca el tipo de snapshot/modelo.
- `plan_snapshot.plan.source` marca el origen operativo del payload UI.
- Cambiar solo uno de los dos puede dejar metadata inconsistente o romper deteccion frontend.

## 5. Evidencia tecnica

### 5.1 RPC SQL donde se persiste el source externo

Archivo:

```text
supabase/migrations/20260604_training_cycle_scoped_model.sql
```

Funcion:

```text
create_training_cycle_with_plan
```

Evidencia:

```sql
'source', 'cycle-scoped-qa'
```

Ese valor queda en:

```text
training_cycles.plan_snapshot.source
```

### 5.2 Frontend donde se identifica un ciclo cycle-scoped

Archivo:

```text
src/components/organizatech-app.tsx
```

Funcion:

```text
isCycleScopedTrainingCycle(cycle)
```

La deteccion actual compara el source externo contra:

```text
cycle-scoped-qa
```

Impacto:

- Si la RPC cambia a otro valor y el frontend no se adapta, los ciclos nuevos podrian no ser reconocidos como cycle-scoped.
- Eso podria afectar render, persistencia de sesiones, dashboard/progreso scoped y bloqueo de fallback legacy.

### 5.3 Frontend donde se genera trainingCyclesSnapshotSource

Archivo:

```text
src/app/page.tsx
```

Variables relevantes:

```ts
const qaTrainingCyclesRepositoryEnabled =
  process.env.VERCEL_ENV === "preview" &&
  process.env.NEXT_PUBLIC_ENABLE_QA_TOOLS === "true" &&
  process.env.NEXT_PUBLIC_SUPABASE_ENV === "qa";

const productionTrainingCyclesRepositoryEnabled =
  process.env.VERCEL_ENV === "production" &&
  process.env.ENABLE_TRAINING_CYCLES_REPOSITORY === "true";

const trainingCyclesSnapshotSource = productionTrainingCyclesRepositoryEnabled
  ? "ui-main-production"
  : "ui-main-qa";
```

Ese valor no reemplaza `plan_snapshot.source`; queda anidado dentro de `plan_snapshot.plan.source`.

## 6. Riesgo de dejar "cycle-scoped-qa" en Production

Riesgo principal:

- Ambiguedad de auditoria: ciclos productivos reales quedarian con una etiqueta `qa`.
- Confusion operativa durante soporte, incidentes o revision historica.
- Posible interpretacion erronea de ciclos productivos como ciclos de prueba.
- Dificultad para separar evidencia QA de uso real sin mirar otros campos.
- Deuda documental permanente si se acepta sin decision formal.

Riesgo tecnico inmediato:

- El frontend actual funciona con ese valor porque lo usa como identificador cycle-scoped.
- No hay ruptura funcional por dejarlo, pero si hay deuda semantica/productiva.

## 7. Riesgo de cambiar el valor sin adaptar frontend

Cambiar solamente la RPC de:

```text
cycle-scoped-qa
```

a otro valor puede romper la deteccion actual del frontend.

Riesgos:

- `isCycleScopedTrainingCycle` podria devolver `false` para ciclos productivos nuevos.
- La UI podria no cargar `getCycleScopedTrainingPlan(activeCycle.id)`.
- Podria reaparecer fallback legacy o bloqueo de flujo.
- Guardado de sesiones cycle-scoped podria no ejecutarse.
- Dashboard/progreso scoped podria no usar las sesiones correctas.

Conclusion:

No conviene cambiar el valor SQL externo sin actualizar tambien la compatibilidad frontend.

## 8. Alternativas

### A) Aceptar formalmente "cycle-scoped-qa"

Descripcion:

- No modificar SQL.
- No modificar frontend.
- Documentar que `"cycle-scoped-qa"` es un marcador tecnico historico del modelo cycle-scoped, no una afirmacion de ambiente.

Ventajas:

- Menor riesgo inmediato.
- No requiere patch antes de activacion.
- El frontend actual ya lo reconoce.

Desventajas:

- Metadata productiva queda semanticamente confusa.
- La palabra `qa` en ciclos productivos puede generar ruido de auditoria.
- Requiere aceptacion formal explicita.

Veredicto tecnico:

- Posible, pero no recomendado si se busca trazabilidad limpia en Production.

### B) Cambiar a "cycle-scoped-production"

Descripcion:

- Modificar la RPC para que `plan_snapshot.source` quede como:

```text
cycle-scoped-production
```

Ventajas:

- Evita etiqueta `qa` en ciclos productivos.
- Deja claro que el ciclo fue creado en Production.

Desventajas:

- Requiere adaptar frontend para reconocer el nuevo valor.
- Mezcla modelo y ambiente en el mismo campo.
- Para QA/Preview se deberia decidir si conservar `"cycle-scoped-qa"` o parametrizar por ambiente.

Veredicto tecnico:

- Viable solo con compatibilidad dual en frontend.

### C) Compatibilidad dual

Descripcion:

- Mantener reconocimiento de `"cycle-scoped-qa"` para historico/QA.
- Agregar reconocimiento de un nuevo valor para ciclos futuros.
- Actualizar RPC para escribir el nuevo valor.

Valores posibles:

```text
cycle-scoped
cycle-scoped-production
```

Ventajas:

- No rompe ciclos QA/historicos.
- Permite crear ciclos productivos con metadata limpia.
- Reduce riesgo de fallback legacy accidental.
- Permite rollout controlado en Preview/QA antes de activacion Production.

Desventajas:

- Requiere patch SQL/RPC y frontend.
- Requiere auditoria y validacion Preview/QA.

Veredicto tecnico:

- Recomendado.

### D) Usar "ui-main-production"

Descripcion:

- Reusar como `plan_snapshot.source` el mismo valor generado por frontend para `plan_snapshot.plan.source`.

Ventajas:

- Expresa origen UI productivo.

Desventajas:

- Conflacion de conceptos: tipo de modelo vs origen UI.
- Requiere adaptar frontend.
- Pierde el marcador claro de modelo cycle-scoped.
- Podria complicar deteccion si en el futuro hay otros origenes UI.

Veredicto tecnico:

- No recomendado.

### E) Usar "cycle-scoped" como marcador externo neutral

Descripcion:

- Cambiar `plan_snapshot.source` a:

```text
cycle-scoped
```

- Mantener `plan_snapshot.plan.source` para distinguir:

```text
ui-main-qa
ui-main-production
```

Ventajas:

- Separa modelo de ambiente.
- Evita `qa` en metadata productiva.
- Permite que el frontend identifique el tipo de ciclo sin depender del entorno.
- Mantiene evidencia operativa en el plan anidado.

Desventajas:

- Requiere patch SQL/RPC y frontend.
- Requiere compatibilidad dual con `"cycle-scoped-qa"`.

Veredicto tecnico:

- Es la variante recomendada dentro de la alternativa C.

## 9. Recomendacion tecnica

Recomendacion:

```text
Adoptar compatibilidad dual y cambiar el marcador externo futuro a "cycle-scoped".
```

Implementacion recomendada, solo si Arquitectura autoriza una fase posterior:

1. Actualizar frontend para que `isCycleScopedTrainingCycle` acepte:

```text
cycle-scoped
cycle-scoped-qa
```

2. Actualizar la RPC `create_training_cycle_with_plan` para que nuevos ciclos escriban:

```text
plan_snapshot.source = "cycle-scoped"
```

3. Mantener `plan_snapshot.plan.source` como:

```text
ui-main-qa
ui-main-production
```

4. Validar en Preview/QA antes de cualquier activacion productiva.
5. Mantener feature flag Production OFF hasta que el patch este aprobado.
6. No crear ciclos productivos mientras la decision siga abierta.

Motivo:

- Evita metadata productiva con etiqueta QA.
- Preserva compatibilidad con ciclos QA existentes.
- Reduce riesgo de render/guardado legacy accidental.
- Mantiene trazabilidad por capas: modelo externo y origen interno.

## 10. Archivos a modificar si el fix es aprobado

Archivos probables:

```text
src/components/organizatech-app.tsx
```

Motivo:

- Actualizar `isCycleScopedTrainingCycle` para aceptar compatibilidad dual.

```text
supabase/migrations/<nueva_migracion>_training_cycle_scoped_snapshot_source.sql
```

Motivo:

- Reemplazar o recrear la RPC `create_training_cycle_with_plan` con `plan_snapshot.source = "cycle-scoped"`.
- No editar migraciones historicas ya aplicadas; preparar patch nuevo.

Archivos posiblemente documentales:

```text
docs/<fase_posterior>.md
```

Motivo:

- Documentar decision, rollout, postchecks y rollback.

Archivo que probablemente no requiere cambio:

```text
src/app/page.tsx
```

Motivo:

- La generacion de `trainingCyclesSnapshotSource` sigue siendo valida para `plan_snapshot.plan.source`.

## 11. QA/Preview validation

Validacion recomendada para una fase posterior:

1. Confirmar Preview/QA:

```text
VERCEL_ENV = preview
NEXT_PUBLIC_ENABLE_QA_TOOLS = true
NEXT_PUBLIC_SUPABASE_ENV = qa
```

2. Confirmar ciclo QA existente con:

```text
plan_snapshot.source = "cycle-scoped-qa"
```

sigue siendo reconocido como cycle-scoped.

3. Aplicar patch SQL solo en QA, si se autoriza.
4. Crear un nuevo ciclo QA controlado, si se autoriza.
5. Confirmar nuevo snapshot:

```text
plan_snapshot.source = "cycle-scoped"
plan_snapshot.plan.source = "ui-main-qa"
```

6. Confirmar render cycle-scoped:

- rutina correcta;
- dia correcto;
- ejercicios correctos;
- sin fallback legacy;
- sin rutinas legacy.

7. Confirmar guardado de sesion:

- `training_sessions.cycle_id` poblado;
- `training_sessions.cycle_day_id` poblado;
- `exercise_entries.training_cycle_exercise_id` poblado;
- `exercise_entries.exercise_id` puede quedar null;
- sin legacy artificial.

8. Confirmar Production sigue apagada:

- feature flag OFF/no configurada;
- no ciclos productivos nuevos.

## 12. Rollback

Rollback frontend:

- Mantener compatibilidad dual es de bajo riesgo.
- Si se requiere rollback, se puede volver a aceptar solo `"cycle-scoped-qa"`, pero eso bloquearia o romperia ciclos nuevos con `"cycle-scoped"`.
- Mejor estrategia: conservar dual compatibility mientras existan ciclos QA/historicos.

Rollback SQL/RPC:

- Restaurar la RPC para escribir `"cycle-scoped-qa"` solo con autorizacion explicita.
- No borrar ciclos.
- No hacer backfill.
- No editar ciclos productivos sin autorizacion separada.

Forward-fix preferido:

- Si un ciclo queda con un valor nuevo no reconocido, actualizar frontend para reconocerlo.
- Evitar cambios manuales sobre datos productivos.

## 13. Criterios de aborto

Abortar la correccion futura si:

- Se intenta activar Training Cycles en Production antes de resolver la decision.
- El patch SQL toca datos productivos existentes.
- La correccion requiere backfill no autorizado.
- El frontend no mantiene compatibilidad con `"cycle-scoped-qa"`.
- QA deja de reconocer ciclos existentes.
- Se observa fallback legacy silencioso.
- Se intenta crear ciclo productivo real durante validacion.
- El feature flag Production aparece activo antes de completar validaciones.
- La migracion o RPC propuesta no fue auditada.

## 14. Decision solicitada a Arquitectura

Se solicita a Arquitectura elegir una de estas rutas:

```text
A) Aceptar formalmente "cycle-scoped-qa" como marcador tecnico permanente.
B) Cambiar a "cycle-scoped-production" con compatibilidad dual frontend.
C) Cambiar a "cycle-scoped" con compatibilidad dual frontend. Recomendado.
D) Usar "ui-main-production" como source externo. No recomendado.
```

Decision recomendada:

```text
Autorizar una fase posterior para implementar la alternativa C:
plan_snapshot.source = "cycle-scoped"
con frontend compatible con "cycle-scoped" y "cycle-scoped-qa".
```

Hasta que esa decision quede cerrada:

- no activar Training Cycles en Production;
- no activar `ENABLE_TRAINING_CYCLES_REPOSITORY`;
- no crear ciclos productivos;
- no modificar Ciclo 1;
- no ejecutar backfill.
