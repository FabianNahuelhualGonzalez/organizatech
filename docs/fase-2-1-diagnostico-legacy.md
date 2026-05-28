# Fase 2.1A - Diagnostico legacy read-only de Training

## Objetivo

Preparar un diagnostico 100% read-only para entender el estado de registros legacy en `training_sessions` antes de decidir cualquier backfill, consolidacion o migracion posterior.

Este trabajo sigue el protocolo definido en:

- `docs/protocolo-cambios-base-datos.md`

Regla principal aplicada:

**No se modifica informacion historica sin diagnostico, validacion, respaldo y aprobacion explicita.**

## Alcance

Este diagnostico cubre:

- Sesiones legacy con campos Fase 2 en `NULL`.
- Posibles sesiones antiguas creadas por ejercicio.
- Relacion entre `training_sessions`, `exercise_entries`, `exercises` y `routines`.
- Inferencia posible de `routine_id` y `planned_day`.
- Ambiguedades que requieren revision manual.
- Riesgo preliminar de backfill.

No cubre:

- Backfill automatico.
- Updates masivos.
- Cambios de schema.
- Cambios de RLS, policies o RPC.
- Cambios funcionales de frontend.

## Archivo SQL de diagnostico

El SQL read-only propuesto esta en:

- `supabase/diagnostics/202605_training_legacy_diagnostics.sql`

El archivo empieza con el comentario obligatorio:

```sql
-- Este archivo es solo diagnostico. No ejecutar como migracion. No modifica datos.
```

El archivo no esta dentro de `supabase/migrations` y no debe ejecutarse como migracion.

## Confirmacion read-only

El SQL contiene solo consultas `SELECT`.

No contiene:

- `INSERT`
- `UPDATE`
- `DELETE`
- `UPSERT`
- `MERGE`
- `ALTER`
- `CREATE`
- `DROP`
- `TRUNCATE`
- `GRANT`
- `REVOKE`
- llamadas RPC que modifiquen datos

## Como ejecutar

Orden recomendado:

1. Ejecutar primero en Supabase QA.
2. Revisar resultados y clasificar riesgos.
3. Documentar hallazgos anonimizados.
4. Si se considera ejecutar en Produccion, hacerlo manualmente, solo como lectura, y nunca como migracion.
5. No ejecutar ningun backfill hasta tener plan separado aprobado.

## Explicacion de queries

### 1. Totales generales de sesiones legacy

Cuenta sesiones donde faltan campos de Fase 2:

- `routine_id`
- `trained_date`
- `calendar_week_start`
- `planned_day`
- `planned_date`

Tambien cuenta sesiones donde todos esos campos estan faltantes.

Uso esperado:

- Medir tamano total del problema legacy.
- Separar registros nuevos Fase 2 de registros antiguos.

### 2. Impacto multiusuario

Agrupa sesiones legacy por `user_id`.

Uso esperado:

- Medir impacto por usuario sin hardcodear nombres, emails ni ids.
- Detectar usuarios con mas historico legacy.
- Mantener enfoque SaaS/multiusuario.

### 3. Sesiones duplicadas legacy

Agrupa por:

- `user_id`
- `trained_at`
- `week_number`

Uso esperado:

- Detectar el patron antiguo donde podia existir una `training_session` por ejercicio.
- Identificar fechas con multiples sesiones para un mismo usuario.

### 4. Sesiones legacy con y sin exercise_entries

Clasifica sesiones legacy en:

- `with_entries`
- `without_entries`

Uso esperado:

- Determinar que sesiones tienen detalle real.
- Separar candidatas a reconstruccion desde entries de sesiones que no deberian tocarse automaticamente.

### 5. Detalle de sesiones legacy sin entries

Lista sesiones legacy que no tienen `exercise_entries`.

Uso esperado:

- Revisar manualmente.
- Evitar backfill automatico sin evidencia de entrenamiento registrado.

### 6. Inferencia posible de routine_id

Cruza:

`training_sessions -> exercise_entries -> exercises.routine_id`

Uso esperado:

- Si una sesion apunta a una sola rutina, podria ser candidata a inferencia.
- Si apunta a varias rutinas, requiere revision manual.

### 7. Inferencia posible de planned_day

Cruza:

`training_sessions -> exercise_entries -> exercises.day`

Uso esperado:

- Si una sesion apunta a un solo dia, podria ser candidata a inferencia.
- Si apunta a varios dias, requiere revision manual.

### 8. Clasificacion preliminar de riesgo de backfill

Clasifica cada sesion legacy como:

- `inferable_candidate`
- `manual_review_no_entries`
- `manual_review_multiple_routines`
- `manual_review_multiple_days`
- `manual_review_missing_inference`

Uso esperado:

- Preparar una matriz de decision antes de cualquier backfill.
- No asumir que todos los registros son seguros de corregir automaticamente.

### 9. Sesiones legacy con entries de varias rutinas

Lista sesiones donde los entries apuntan a mas de una `routine_id`.

Uso esperado:

- Marcar alto riesgo.
- Evitar backfill automatico de `routine_id`.

### 10. Sesiones legacy con entries de varios dias

Lista sesiones donde los entries apuntan a mas de un `exercises.day`.

Uso esperado:

- Marcar ambiguedad de `planned_day`.
- Evitar inferencia automatica de dia planificado.

### 11. Entries sin ejercicio asociado

Busca `exercise_entries` cuyo `exercise_id` no encuentra fila en `exercises`.

Uso esperado:

- Detectar registros huerfanos.
- Evitar backfill basado en ejercicio inexistente.

### 12. Inconsistencias entre user_id

Compara:

- `exercise_entries.user_id`
- `training_sessions.user_id`
- `exercises.user_id`

Uso esperado:

- Confirmar integridad multiusuario.
- Detectar cualquier mezcla de datos entre usuarios.

### 13. Resumen de candidatos inferibles vs revision manual

Entrega conteo agregado por tipo de riesgo.

Uso esperado:

- Dimensionar si conviene fallback only, backfill parcial o revision manual.
- Preparar decision de arquitectura para Fase 2.1B.

## Criterios preliminares de decision

### Registros inferibles automaticamente

Un registro podria ser candidato a backfill solo si:

- Tiene entries.
- Todos los entries apuntan a una sola rutina.
- Todos los entries apuntan a un solo dia planificado.
- No hay inconsistencias de `user_id`.
- No hay entries sin ejercicio asociado.

Incluso en ese caso, el backfill debe ser otra tarea separada, revisada y aprobada.

### Registros que requieren revision manual

Requieren revision manual:

- Sesiones sin entries.
- Sesiones con entries de varias rutinas.
- Sesiones con entries de varios dias.
- Entries sin ejercicio asociado.
- Inconsistencias entre usuario de session, entry y exercise.
- Casos donde `trained_at` o `week_number` no sean confiables.

### Registros que no deberian tocarse

No deberian tocarse automaticamente:

- Sesiones sin evidencia de entrenamiento real.
- Sesiones ambiguas.
- Sesiones huerfanas.
- Registros donde no se pueda confirmar ownership completo.

## Recomendacion preliminar

La recomendacion inicial es:

1. Mantener el fallback legacy read-only en la app.
2. Ejecutar este diagnostico primero en QA.
3. Analizar resultados anonimizados.
4. Si el porcentaje de `inferable_candidate` es alto, evaluar backfill parcial en una fase separada.
5. Si hay ambiguedades relevantes, mantener legacy sin tocar y resolver solo casos manuales.
6. No consolidar ni recalcular historicos hasta tener un plan de rollback y validacion.

Por ahora, la opcion mas segura es **fallback only + diagnostico**, sin backfill.

## Riesgos

- `week_number` legacy puede no representar la semana calendario real.
- `trained_at` puede representar una fecha legacy incompleta o no alineada con Fase 2.
- Una sesion legacy puede representar un ejercicio, no un entrenamiento diario completo.
- Una sesion puede tener entries de varias rutinas o varios dias.
- Backfill automatico podria consolidar datos incorrectamente si se asume demasiado.

## Proximos pasos sugeridos

1. Revisar este SQL con Arquitectura TI/Base de Datos.
2. Ejecutar en Supabase QA.
3. Guardar resultados anonimizados.
4. Decidir Fase 2.1B:
   - fallback only;
   - backfill parcial;
   - consolidacion posterior;
   - mantener legacy sin tocar.
