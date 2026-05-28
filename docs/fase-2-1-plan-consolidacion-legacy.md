# Fase 2.1B - Plan tecnico de consolidacion historica legacy

## Estado

Este documento es un plan tecnico para auditoria. No ejecuta cambios y no autoriza modificaciones en Supabase.

Reglas aplicadas:

- No ejecutar SQL.
- No tocar Supabase.
- No tocar Produccion.
- No hacer migraciones aplicables todavia.
- No hacer backfill.
- No hacer cambios funcionales.
- No modificar RLS, policies, RPC ni schema.
- No hacer merge.

Este plan se basa en `docs/protocolo-cambios-base-datos.md` y en el diagnostico read-only de Fase 2.1A.

## Resumen del problema

### Modelo legacy

El modelo legacy de Training podia crear multiples filas en `training_sessions` para un solo entrenamiento real.

Patron observado:

- 1 entrenamiento real podia quedar representado como varias `training_sessions`.
- Cada `training_session` podia tener una o pocas `exercise_entries`.
- Los campos nuevos de Fase 2 quedaron en `NULL` para registros historicos:
  - `routine_id`
  - `calendar_week_start`
  - `planned_day`
  - `planned_date`
  - `trained_date`
  - `completed_at`

### Modelo nuevo

El modelo nuevo aprobado en Fase 2 define:

- 1 `training_session` = 1 entrenamiento real de un usuario en una fecha.
- N `exercise_entries` = detalle de ejercicios dentro de esa sesion.
- `training_sessions` es fuente de verdad para usuario, rutina, fecha, dia planificado y estado.
- `exercise_entries` solo representa detalle de ejercicios.

### Por que fallback no debe ser definitivo

El fallback legacy read-only permite que la app siga mostrando historicos, pero no corrige la semantica de datos.

Si se deja como solucion definitiva:

- El dashboard debe seguir mezclando modelo nuevo y modelo legacy.
- La comparacion semanal puede requerir excepciones permanentes.
- El historico queda mas dificil de auditar.
- Nuevas vistas de Training tendrian que conocer ambos modelos.

### Por que backfill fila por fila no corrige la semantica

Actualizar cada fila legacy individualmente no corrige el problema principal.

El problema no es solo que falten columnas. El problema es que varias filas legacy pueden representar un unico entrenamiento real.

Por eso, un backfill fila por fila podria:

- Mantener duplicados activos.
- Inflar entrenamientos del dashboard.
- Duplicar volumen/reps en analiticas.
- Dejar varias sesiones activas para el mismo entrenamiento real.

La solucion correcta debe consolidar grupos legacy en una sesion canonica.

## Criterios de consolidacion

Un grupo legacy solo debe considerarse consolidable si cumple todas estas condiciones:

- 1 grupo = 1 usuario.
- 1 grupo = 1 `trained_at`.
- 1 grupo = 1 `week_number`.
- 1 grupo = 1 rutina inferible desde `exercise_entries -> exercises.routine_id`.
- 1 grupo = 1 dia planificado inferible desde `exercises.day`.
- `entry_count = distinct_exercise_count`.
- No hay entries huerfanas.
- No hay mezcla de usuarios.
- No hay mezcla de rutinas.
- No hay mezcla de dias.

Si cualquiera de estas condiciones falla, el grupo queda fuera de consolidacion automatica y pasa a revision manual.

## Identificacion de grupos consolidables

El SQL propuesto para auditoria esta en:

- `supabase/diagnostics/202605_training_legacy_consolidation_plan.sql`

Ese archivo esta marcado como:

```sql
-- PLAN / BORRADOR PARA AUDITORIA - NO EJECUTAR
```

No esta en `supabase/migrations` y no debe ejecutarse como migracion.

La query principal agrupa por:

- `user_id`
- `trained_at`
- `week_number`

E infiere:

- `routine_id` desde `exercise_entries -> exercises.routine_id`.
- `planned_day` legacy desde `exercises.day`.
- `planned_day` tecnico como `inferred_planned_day_code`, mapeado a ingles para el modelo nuevo:
  - `Lunes` -> `monday`
  - `Martes` -> `tuesday`
  - `Miercoles` -> `wednesday`
  - `Jueves` -> `thursday`
  - `Viernes` -> `friday`
  - `Sabado` -> `saturday`
  - `Domingo` -> `sunday`
- `trained_date` desde `trained_at::date`.
- `calendar_week_start` desde el lunes de la semana de `trained_at`.
- `planned_date` calculada desde `calendar_week_start` + `inferred_planned_day_code`, si el dia es seguro.

## Seleccion de sesion canonica

Regla propuesta:

1. Elegir la `training_session` mas antigua del grupo por `created_at`.
2. Si hay empate, elegir la de menor `id`.

Esta regla es deterministica porque:

- Ordena por un campo temporal estable.
- Usa `id` como desempate total.
- Para el mismo grupo, siempre retorna la misma sesion canonica.

La sesion canonica se conservaria activa en una fase futura.

## Mapeo conceptual de entries

En una fase futura, no en esta, todas las `exercise_entries` del grupo consolidable deberian apuntar al `canonical_session_id`.

Conceptualmente:

- Cada entry conserva sus datos de ejercicio, peso, reps, RIR y notas.
- Solo cambia su `session_id` hacia la sesion canonica.
- El cambio debe registrarse en auditoria antes de ejecutarse.
- El movimiento debe ser transaccional.

No se ejecuta nada en Fase 2.1B.

## Sesiones legacy duplicadas

En una fase futura:

- `canonical_session_id` se conserva activo.
- Sesiones no canonicas se marcarian con `deleted_at`.
- No debe haber borrado fisico.
- Las sesiones no canonicas deben quedar auditadas para rollback.

Esta decision mantiene trazabilidad sin perder historico.

## Campos nuevos inferidos para sesion canonica

Para la sesion canonica, una futura consolidacion podria poblar:

- `routine_id`: rutina inferida unica del grupo.
- `trained_date`: fecha derivada de `trained_at::date`.
- `calendar_week_start`: lunes de la semana de `trained_at`.
- `planned_day`: codigo tecnico en ingles derivado del valor legacy en espanol de `exercises.day`.
- `planned_date`: fecha calendario de ese dia dentro de `calendar_week_start`.
- `status`: `completed`.
- `completed_at`: valor seguro por definir, preferentemente `trained_at` o `created_at` canonico si Arquitectura lo aprueba.
- `deleted_at`: `null` para la sesion canonica.

No se debe usar `week_number` como fuente principal para nueva logica.

## Tabla staging/auditoria propuesta

Nombre propuesto:

`training_session_consolidation_audit`

Campos sugeridos:

- `id uuid primary key`
- `user_id uuid not null`
- `legacy_group_key text not null`
- `canonical_session_id uuid not null`
- `legacy_session_ids uuid[] not null`
- `entry_ids uuid[] not null`
- `inferred_routine_id uuid not null`
- `inferred_planned_day text not null`
- `inferred_planned_day_code text not null`
- `inferred_trained_date date not null`
- `inferred_calendar_week_start date not null`
- `inferred_planned_date date null`
- `status text not null`
- `created_at timestamptz not null default now()`
- `executed_at timestamptz null`
- `rollback_payload jsonb not null`

No crear tabla todavia.

Uso esperado:

- Registrar la intencion antes de ejecutar.
- Guardar payload suficiente para rollback.
- Evitar operaciones anonimas o irreversibles.
- Permitir auditoria de Claude/Arquitectura antes de tocar datos.

## Rollback conceptual

El rollback debe poder restaurar:

- `session_id` original de cada `exercise_entry`.
- Campos originales de cada `training_session` legacy.
- `deleted_at` original de sesiones no canonicas.
- Campos nuevos originales si existian.

El `rollback_payload` deberia guardar, como minimo:

- Estado completo de cada `training_session` involucrada.
- Estado completo de cada `exercise_entry` involucrada o al menos su `id` y `session_id` original.
- Timestamp de ejecucion.
- Usuario afectado.
- Grupo legacy afectado.

Rollback conceptual futuro:

1. Leer `rollback_payload`.
2. Restaurar `exercise_entries.session_id` original.
3. Restaurar campos originales de sesiones legacy.
4. Limpiar `deleted_at` de sesiones no canonicas si antes estaba `null`.
5. Marcar auditoria como revertida en una columna futura si se define.

No ejecutar rollback ni consolidacion en esta fase.

## Validaciones post-consolidacion propuestas

Despues de una futura consolidacion en QA, validar:

### Integridad de conteos

- Total de `exercise_entries` antes/despues.
- Total de `training_sessions` fisicas antes/despues.
- Total de sesiones activas antes/despues.

### Integridad de metricas

- Total reps antes/despues.
- Total peso simple antes/despues.
- Total volumen antes/despues, si se usa para analiticas.

### Integridad relacional

- No existen `exercise_entries` sin `session_id`.
- No existen entries apuntando a sesiones de otro usuario.
- No existen entries apuntando a ejercicios de otro usuario.
- No se mezclan usuarios.

### Integridad semantica

- Cada grupo consolidado queda con 1 sesion activa.
- No hay sesiones activas duplicadas para `user_id/routine_id/trained_date`.
- Cada sesion canonica tiene entries asociadas.
- Las sesiones no canonicas quedan marcadas logicamente, no borradas.

### Validacion funcional

- Dashboard/carrusel muestra los mismos entrenamientos.
- Comparacion semanal no duplica volumen ni reps.
- Guardado nuevo Fase 2 sigue funcionando.
- Fallback legacy no se rompe para datos no consolidados.

## Orden futuro propuesto

### Fase 2.1B

Plan tecnico, documentacion y SQL de auditoria.

Estado: sin ejecucion.

### Fase 2.1C

Auditoria Claude/Arquitectura.

Revisar:

- Criterios de consolidacion.
- Query de grupos.
- Regla canonica.
- Diseno de auditoria.
- Rollback.

Claude debe auditar este plan antes de preparar cualquier SQL ejecutable, script transaccional o procedimiento de backfill.

### Fase 2.1D

Script QA.

Preparar SQL transaccional o RPC interna para QA, con staging/auditoria.

### Fase 2.1E

Ejecucion QA.

Ejecutar solo en Supabase QA.

### Fase 2.1F

Validacion QA.

Validar dashboard, carrusel, comparacion semanal, conteos y multiusuario.

### Fase 2.1G

Decision Produccion.

Produccion solo despues de:

- Auditoria aprobada.
- QA validado.
- Validacion completa en Supabase QA antes de cualquier accion productiva.
- Rollback probado o documentado.
- Ventana de ejecucion definida.
- Respaldo/plan de recuperacion aprobado.

## Riesgos

- Duplicar volumen.
- Duplicar reps.
- Mover entries a sesion equivocada.
- Inferir `planned_day` incorrecto.
- Inferir `routine_id` incorrecto.
- Afectar comparacion semanal.
- Romper fallback legacy para grupos no consolidados.
- Mezclar usuarios.
- Marcar como duplicada una sesion que no lo era.
- Rollback incompleto.

## Recomendacion preliminar

Se recomienda:

1. Preparar consolidacion solo en QA.
2. Mantener fallback legacy mientras tanto.
3. No tocar Produccion.
4. No ejecutar backfill hasta auditoria Claude y validacion QA.
5. Usar staging/auditoria antes de cualquier cambio de datos.
6. Consolidar solo grupos que cumplan criterios estrictos.
7. Dejar fuera los grupos ambiguos.

La recomendacion actual es avanzar con auditoria del plan, no con ejecucion.
