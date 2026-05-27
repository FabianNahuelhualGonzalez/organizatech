# Training Sessions como fuente de verdad

## Objetivo

Fase 2 cambia el modelo de guardado de entrenamiento para que una fila de `training_sessions` represente una sesion diaria real de entrenamiento.

La relacion objetivo es:

```text
1 training_session = 1 entrenamiento real de un usuario en una fecha
N exercise_entries = detalle de ejercicios dentro de esa sesion
```

## Alcance de este PR

- Migracion aditiva de `routines` y `training_sessions`.
- RPC transaccional `create_training_session_with_entries`.
- Nuevo guardado desde repository usando una sesion diaria y multiples entries.
- Dashboard/carrusel leyendo completitud desde `training_sessions`.
- Diagnostico SQL legacy de solo lectura.

## Fuera de alcance

- Backfill historico automatico.
- Produccion.
- `training_cycles`.
- `cycle_week`.
- Comparacion semanal completa basada en `calendar_week_start`.
- UX de soft delete de rutinas.

## Fuente de verdad

Para nuevos entrenamientos:

- `training_sessions.status` define si la sesion esta completada o saltada.
- `training_sessions.planned_date` manda para saber que slide/dia planificado queda completado.
- `training_sessions.planned_day` complementa cuando no existe `planned_date`.
- `training_sessions.trained_date` representa la fecha real en que el usuario ejecuto el entrenamiento.
- `exercise_entries` solo entrega detalle de ejercicios, pesos, reps, RIR y notas.

No usar para completitud:

- `notes`.
- `exerciseId` actual.
- `week_number`.
- cantidad de entries.

## Legacy

`week_number`, `trained_at` y datos historicos antiguos se mantienen por compatibilidad.

No se recalculan historicos automaticamente. Antes de cualquier backfill se debe revisar manualmente:

- sesiones duplicadas por usuario/fecha;
- sesiones sin entries;
- entries cuyo usuario no coincide con la sesion;
- entries cuyo usuario no coincide con el ejercicio;
- week_number sospechoso.

El archivo `supabase/migrations/20260527_legacy_training_diagnostics.sql` contiene consultas de diagnostico read-only.

## QA esperada

1. Crear rutina con varios ejercicios.
2. Guardar entrenamiento completo.
3. Confirmar 1 fila en `training_sessions`.
4. Confirmar N filas en `exercise_entries` con el mismo `session_id`.
5. Intentar guardar duplicado para mismo usuario/rutina/fecha y confirmar error.
6. Validar Usuario A vs Usuario B.
7. Validar que Preview usa Supabase QA.
8. Confirmar que Produccion no recibe datos.

## Subfase pendiente

Comparacion semanal debe migrar completamente a `training_sessions.calendar_week_start` en una subfase posterior. En este PR se evita introducir nueva dependencia fuerte de `week_number`, pero se mantiene compatibilidad legacy donde la pantalla todavia la necesita.

