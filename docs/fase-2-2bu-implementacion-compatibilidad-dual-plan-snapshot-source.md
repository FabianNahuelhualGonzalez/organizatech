# Fase 2.2BU - Implementacion controlada de compatibilidad dual plan_snapshot.source

## 1. Resumen ejecutivo

2.2BU implementa localmente la compatibilidad dual para el marcador externo de ciclos cycle-scoped:

```text
plan_snapshot.source
```

El frontend queda preparado para reconocer ciclos existentes con:

```text
cycle-scoped-qa
```

y ciclos nuevos con:

```text
cycle-scoped
```

Ademas, se prepara una migracion candidata nueva que recrea la RPC `create_training_cycle_with_plan` para que los nuevos ciclos persistan:

```text
plan_snapshot.source = "cycle-scoped"
```

No se edita la migracion historica `20260604_training_cycle_scoped_model.sql`. No se aplica SQL remoto. No se activa Training Cycles en Production.

## 2. Estado actual

Estado heredado de 2.2BT:

- `plan_snapshot.source = "cycle-scoped-qa"` estaba documentado como marcador externo escrito por la RPC.
- `plan_snapshot.plan.source` estaba documentado como origen interno del payload frontend.
- Cambiar solo SQL sin adaptar frontend fue clasificado como riesgo para `isCycleScopedTrainingCycle()`, render, guardado scoped y fallback legacy.
- Training Cycles Production sigue apagado.
- `ENABLE_TRAINING_CYCLES_REPOSITORY` no fue activado.
- Ciclo 1 productivo sigue protegido.

Estado tras esta preparacion local:

- Frontend acepta ambos markers externos.
- SQL candidato escribe el marker externo neutral para ciclos nuevos.
- El payload anidado del plan no cambia.
- No hay activacion funcional productiva.

## 3. Cambios aplicados en frontend

Archivo modificado:

```text
src/components/organizatech-app.tsx
```

Funcion ajustada:

```text
isCycleScopedTrainingCycle(cycle)
```

Antes:

```text
Solo reconocia plan_snapshot.source = "cycle-scoped-qa".
```

Ahora:

```text
Reconoce "cycle-scoped-qa" o "cycle-scoped".
```

El cambio es aditivo:

- ciclos QA existentes siguen reconocidos;
- ciclos futuros con marker neutral quedan reconocidos;
- no cambia la lectura de `plan_snapshot.plan.source`;
- no modifica flujos legacy;
- no activa Training Cycles por si mismo.

## 4. Cambios aplicados en SQL/RPC

Archivo creado:

```text
supabase/migrations/20260607_training_cycle_scoped_snapshot_source.sql
```

Contenido:

- recrea `public.create_training_cycle_with_plan`;
- conserva firma, `SECURITY INVOKER` y `search_path`;
- conserva validaciones existentes:
  - usuario autenticado;
  - nombre obligatorio;
  - `cycle_number` valido;
  - `duration_weeks` valido;
  - fechas obligatorias;
  - `planned_end_date >= planned_start_date`;
  - plan con al menos una rutina;
  - cada rutina con al menos un dia;
  - cada dia con al menos un ejercicio;
  - sin ciclo activo duplicado;
- conserva inserciones en:
  - `training_cycles`;
  - `training_cycle_routines`;
  - `training_cycle_days`;
  - `training_cycle_exercises`;
- conserva el `p_plan` anidado dentro de `plan_snapshot.plan`;
- cambia solo el marker externo para nuevos ciclos:

```text
plan_snapshot.source = "cycle-scoped"
```

El patch no hace backfill, no modifica registros existentes y no toca Ciclo 1.

## 5. Confirmacion de migracion historica no editada

No se edito:

```text
supabase/migrations/20260604_training_cycle_scoped_model.sql
```

La correccion se preparo como nueva migracion candidata:

```text
supabase/migrations/20260607_training_cycle_scoped_snapshot_source.sql
```

Esto preserva el historial de migraciones ya aplicadas.

## 6. Compatibilidad dual

### 6.1 Ciclos existentes con "cycle-scoped-qa"

Ciclos existentes de QA/Preview o historicos con:

```text
plan_snapshot.source = "cycle-scoped-qa"
```

siguen siendo reconocidos por frontend como cycle-scoped.

Esto protege:

- render desde tablas `training_cycle_*`;
- guardado cycle-scoped;
- dashboard/progreso scoped;
- bloqueo de fallback legacy silencioso;
- evidencia QA ya validada.

### 6.2 Ciclos nuevos con "cycle-scoped"

Si la migracion candidata se aplica en QA/Preview y luego se autoriza en Production, ciclos nuevos creados por `create_training_cycle_with_plan` usaran:

```text
plan_snapshot.source = "cycle-scoped"
```

El frontend ya reconoce ese valor.

## 7. plan_snapshot.plan.source no cambia

El source interno del plan se mantiene como payload frontend.

Origen actual:

```text
src/app/page.tsx
```

Valores esperados:

```text
ui-main-qa
ui-main-production
```

La migracion candidata conserva:

```sql
'plan', coalesce(p_plan, '{}'::jsonb)
```

Por lo tanto:

```text
plan_snapshot.plan.source
```

sigue diferenciando si el payload vino de Preview/QA o de Production. El cambio solo afecta:

```text
plan_snapshot.source
```

## 8. Riesgos

### 8.1 Riesgo de SQL aplicado sin frontend actualizado

Mitigado localmente: el frontend ya reconoce `"cycle-scoped"`.

Si se aplicara solo SQL en un entorno que no tiene este frontend, ciclos nuevos podrian no ser detectados como cycle-scoped.

### 8.2 Riesgo de aceptar ambos markers indefinidamente

Compatibilidad dual puede quedar como deuda permanente si no se decide una politica de snapshot a largo plazo.

Mitigacion recomendada:

- mantener dual compatibility mientras existan ciclos historicos con `"cycle-scoped-qa"`;
- documentar `"cycle-scoped"` como marker neutral para ciclos nuevos.

### 8.3 Riesgo de confusion entre source externo e interno

`plan_snapshot.source` y `plan_snapshot.plan.source` tienen propositos distintos.

Mitigacion:

- externo: tipo de modelo `cycle-scoped`;
- interno: origen UI `ui-main-qa` o `ui-main-production`.

### 8.4 Riesgo de activar Production antes de validar QA

La activacion productiva sigue bloqueada. Esta fase solo prepara codigo, SQL candidato y evidencia local.

## 9. Validacion requerida en QA/Preview

Antes de cualquier activacion productiva:

1. Aplicar la migracion candidata solo en QA, con autorizacion separada.
2. Confirmar que la RPC existe y usa:

```text
plan_snapshot.source = "cycle-scoped"
```

3. Confirmar que ciclos existentes con `"cycle-scoped-qa"` siguen renderizando correctamente.
4. Crear, si se autoriza, un ciclo QA nuevo y validar:

```text
plan_snapshot.source = "cycle-scoped"
plan_snapshot.plan.source = "ui-main-qa"
```

5. Validar render cycle-scoped:

- rutina correcta;
- dia correcto;
- ejercicios correctos;
- sin legacy visible;
- sin fallback silencioso.

6. Validar guardado de entrenamiento:

- `training_sessions.cycle_id` correcto;
- `training_sessions.cycle_day_id` correcto;
- `exercise_entries.training_cycle_exercise_id` correcto;
- `exercise_entries.exercise_id` puede quedar null;
- sin legacy artificial.

7. Confirmar Production sigue apagada:

- feature flag OFF/no configurada;
- sin ciclos productivos nuevos;
- sin cambios manuales en datos productivos.

## 10. Rollback

### 10.1 Frontend

La compatibilidad dual es aditiva. El rollback recomendado es no removerla salvo que Arquitectura decida abandonar el marker neutral.

Si se revierte frontend a solo `"cycle-scoped-qa"`, ciclos nuevos con `"cycle-scoped"` dejarian de reconocerse como cycle-scoped.

### 10.2 SQL/RPC

Si el patch SQL falla en QA:

- no aplicar en Production;
- restaurar la RPC QA al contrato anterior, si se autoriza;
- no borrar ciclos;
- no hacer backfill;
- no editar Ciclo 1 ni datos productivos.

Si ya existen ciclos nuevos con `"cycle-scoped"`:

- preferir forward-fix manteniendo compatibilidad dual;
- no cambiar datos manualmente sin autorizacion separada.

## 11. Criterios de aborto

Abortar si:

- el patch intenta editar migracion historica 20260604;
- se intenta activar `ENABLE_TRAINING_CYCLES_REPOSITORY`;
- se intenta tocar Vercel Production;
- se intenta aplicar SQL Production;
- la migracion candidata cambia `plan_snapshot.plan.source`;
- el frontend deja de reconocer `"cycle-scoped-qa"`;
- QA muestra fallback legacy silencioso;
- se crea ciclo productivo;
- se intenta backfill;
- se toca Ciclo 1;
- se ejecuta `db push` o `migration repair`.

## 12. Decision solicitada a Arquitectura

Se solicita a Arquitectura revisar y decidir:

```text
1. Aprobar el enfoque de compatibilidad dual.
2. Aprobar "cycle-scoped" como marker externo neutral para ciclos nuevos.
3. Autorizar una fase posterior de aplicacion QA de la migracion candidata.
4. Mantener Training Cycles Production apagado hasta validar QA/Preview.
```

Hasta esa decision:

- no aplicar SQL remoto;
- no activar Training Cycles;
- no activar feature flag productiva;
- no crear ciclos productivos;
- no hacer commit/push sin autorizacion separada.
