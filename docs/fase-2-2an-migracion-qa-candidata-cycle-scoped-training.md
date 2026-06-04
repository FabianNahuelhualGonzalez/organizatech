# Fase 2.2AN - Migracion QA candidata modelo cycle-scoped Training

## 1. Contexto

Arquitectura aprobo la Fase 2.2AM como diseno tecnico base del modelo cycle-scoped Training.

Modelo aprobado:

- `training_cycles`: lifecycle del ciclo activo/cerrado.
- `training_cycle_routines`, `training_cycle_days`, `training_cycle_exercises`: planificacion operativa por ciclo.
- `training_sessions.cycle_id`: ejecucion asociada al ciclo.
- `exercise_entries.training_cycle_exercise_id`: vinculo con ejercicio planificado.
- `plan_snapshot` y `summary_snapshot`: evidencia congelada, no fuente operativa principal.

Esta fase prepara una migracion candidata para QA. No aplica migraciones, no toca Production, no ejecuta SQL remoto y no autoriza activacion productiva.

## 2. Archivos candidatos

Migracion candidata local:

```text
supabase/migrations/20260604_training_cycle_scoped_model.sql
```

Documento tecnico:

```text
docs/fase-2-2an-migracion-qa-candidata-cycle-scoped-training.md
```

## 3. SQL candidato

La migracion candidata define:

1. Extension de `training_cycles`:
   - `duration_weeks`
   - `planned_start_date`
   - `planned_end_date`
   - check para `planned_end_date >= planned_start_date` cuando ambas fechas existan.

2. Nuevas tablas cycle-scoped:
   - `training_cycle_routines`
   - `training_cycle_days`
   - `training_cycle_exercises`

3. Extension de ejecucion:
   - `training_sessions.cycle_id`
   - `training_sessions.cycle_day_id`
   - `exercise_entries.training_cycle_exercise_id`

Nota conservadora MVP: `exercise_entries.exercise_id` sigue siendo obligatorio. `training_cycle_exercise_id` queda como vinculo adicional con el ejercicio planificado del ciclo, sin romper el contrato legacy existente.

4. Indices minimos:
   - `training_cycle_routines(user_id, cycle_id)`
   - `training_cycle_days(user_id, cycle_id, week_index, day_code)`
   - `training_cycle_exercises(user_id, cycle_id, day_id)`
   - `training_sessions(user_id, cycle_id)`

5. Indice unico MVP:
   - una rutina principal por usuario/ciclo/semana/dia.

6. Triggers `updated_at` usando `public.set_updated_at()`.

7. RLS/policies cerradas.

8. GRANTs minimos para `authenticated`.

## 4. Decisiones RPC

### 4.1 SECURITY INVOKER

Las RPC candidatas usan:

```sql
security invoker
```

Decision: `SECURITY INVOKER` es preferible para este flujo porque mantiene el contexto del usuario autenticado y deja que RLS siga aplicando. No se usa `SECURITY DEFINER` porque podria ampliar privilegios si no se fuerza cada validacion manualmente.

### 4.2 Validacion obligatoria de auth.uid()

Cada RPC debe abortar si:

```sql
auth.uid() is null
```

No se recibe `user_id` por parametro. El `user_id` efectivo siempre se deriva de `auth.uid()`.

## 5. RPC candidata: create_training_cycle_with_plan

Objetivo: crear en una transaccion el ciclo y su plan inicial.

Parametros esperados:

- `p_name text`
- `p_cycle_number integer`
- `p_cycle_type text`
- `p_goal text`
- `p_duration_weeks integer`
- `p_planned_start_date date`
- `p_planned_end_date date`
- `p_plan jsonb`

Tablas que escribe:

- `training_cycles`
- `training_cycle_routines`
- `training_cycle_days`
- `training_cycle_exercises`

Validaciones:

- usuario autenticado obligatorio.
- `p_cycle_number > 0`.
- `p_duration_weeks > 0`.
- fechas coherentes.
- no debe existir otro ciclo activo para el usuario.
- `p_plan.routines` debe ser arreglo.
- `p_plan.routines` debe contener al menos una rutina.
- cada rutina debe contener al menos un dia.
- cada dia debe tener `day_code` valido.
- cada dia debe contener al menos un ejercicio.
- cada ejercicio debe tener nombre, sets y reps validos.

Garantia transaccional:

- si falla cualquier rutina, dia o ejercicio, no debe quedar un ciclo huerfano.

## 6. RPC candidata: create_training_session_with_cycle_entries

Objetivo: registrar una sesion y sus entries en una transaccion, asociadas al ciclo activo.

Parametros esperados:

- `p_cycle_id uuid`
- `p_cycle_day_id uuid`
- `p_planned_day text`
- `p_planned_date date`
- `p_trained_date date`
- `p_status text`
- `p_week_number integer`
- `p_notes text`
- `p_entries jsonb`

Tablas que escribe:

- `training_sessions`
- `exercise_entries`

Validaciones:

- usuario autenticado obligatorio.
- `p_cycle_id` debe pertenecer al usuario y estar `active`.
- `p_cycle_day_id` debe pertenecer al mismo usuario y ciclo.
- si `p_status = completed`, debe haber entries.
- cada `training_cycle_exercise_id` debe pertenecer al usuario, ciclo y dia.
- cada entry debe mantener `exercise_id` legacy obligatorio hasta adaptar repositorios/UI para leer entries sin relacion legacy.
- no permitir relacionar datos de otro usuario.

Garantia transaccional:

- si una entry no pertenece al ciclo/dia correcto, no se crea la sesion.

## 7. RLS candidato

Principio:

```text
auth.uid() = user_id
```

Y pertenencia real al ciclo:

```sql
exists (
  select 1
  from public.training_cycles c
  where c.id = cycle_id
    and c.user_id = auth.uid()
    and c.deleted_at is null
)
```

No se proponen policies abiertas. No se propone delete fisico para usuarios autenticados; se mantiene soft delete por `deleted_at`.

## 8. GRANTs minimos

La migracion candidata propone solo privilegios necesarios para `authenticated`:

- `select`, `insert`, `update` sobre tablas cycle-scoped.
- `select`, `insert`, `update` sobre columnas/tablas de ejecucion existentes donde aplica.
- `execute` sobre RPCs candidatas.

No se concede `delete` a usuarios autenticados. No se conceden privilegios a `anon` para el modelo nuevo.

## 9. Plan QA

Validaciones funcionales:

1. Crear ciclo `micro / Descarga / 1 semana / active`.
2. Confirmar `duration_weeks = 1`.
3. Confirmar `planned_start_date` y `planned_end_date` correctos.
4. Crear rutina solo lunes asociada al `cycle_id`.
5. Confirmar que no aparecen dias legacy como Martes/Miercoles.
6. Crear sesion lunes con `training_sessions.cycle_id`.
7. Confirmar entries con `training_cycle_exercise_id`.
8. Cerrar ciclo y confirmar `plan_snapshot` y `summary_snapshot`.
9. Crear ciclo siguiente y confirmar que no arrastra datos anteriores.
10. Confirmar cleanup QA sin tocar Production.

Validaciones RLS multiusuario:

1. Usuario A no puede leer ciclos de Usuario B.
2. Usuario A no puede insertar rutinas/dias/ejercicios asociados a ciclos de Usuario B.
3. Usuario A no puede crear sesiones para ciclos de Usuario B.
4. Usuario A no puede crear entries que apunten a ejercicios planificados de Usuario B.
5. Usuario A no puede actualizar datos cycle-scoped de Usuario B.

Tablas cubiertas:

- `training_cycles`
- `training_cycle_routines`
- `training_cycle_days`
- `training_cycle_exercises`
- `training_sessions`
- `exercise_entries`

## 10. Rollback y reversa QA

Rollback funcional QA:

1. Apagar feature flag QA del modelo cycle-scoped.
2. Volver a legacy.
3. No borrar datos QA automaticamente.
4. Preservar evidencia si la auditoria lo requiere.

Reversa tecnica QA, solo con autorizacion:

1. Eliminar policies/RPCs candidatas.
2. Eliminar columnas nuevas de ejecucion si no hay dependencias.
3. Eliminar tablas cycle-scoped.
4. Eliminar columnas nuevas de `training_cycles`.

Cleanup QA:

- limpiar solo datos QA creados para la prueba.
- no tocar Production.
- no editar ni borrar el registro productivo existente.
- no alterar legacy productivo.

## 11. Riesgos

- Politicas permisivas heredadas en tablas existentes podrian permitir relaciones cruzadas si no se endurecen junto con las columnas nuevas.
- Una RPC sin validacion de pertenencia podria crear sesiones para ciclos ajenos.
- Si se permite escritura parcial sin RPC transaccional, podrian quedar ciclos sin plan.
- Si `exercise_entries` no apunta al ejercicio planificado, se pierde comparacion planificado vs ejecutado.
- Activar UI antes de completar RLS multiusuario podria exponer datos o crear relaciones invalidas.

## 12. Criterios antes de implementar

- Migracion revisada por TI/Arquitectura.
- RLS revisado explicitamente.
- GRANTs minimos aprobados.
- RPCs revisadas con `SECURITY INVOKER`.
- Plan de rollback QA aprobado.
- Feature flag QA definida.
- Production bloqueada.

## 13. Confirmaciones de alcance

- Esta fase no aplica migraciones.
- Esta fase no ejecuta `supabase db push`.
- Esta fase no ejecuta `migration repair`.
- Esta fase no toca Supabase remoto.
- Esta fase no toca Vercel.
- Esta fase no activa Training Cycles en Production.
- Esta fase no hace backfill.
- Esta fase no edita ni borra el registro productivo existente.
