# Fase 2.1G - Checklist de ventana productiva Training

## Estado actual

- Script productivo de consolidacion preparado.
- Rollback productivo preparado.
- Dry-run productivo read-only ejecutado y baseline confirmado.
- QA sintetico validado de punta a punta: seed, consolidacion, postchecks, rollback y cleanup.
- Claude audito script y rollback.
- Ajustes Claude aplicados.
- Produccion NO esta autorizada todavia.
- Este documento es solo operativo y no autoriza ejecucion.

## Regla principal de seguridad

- Sin backup logico: no ejecutar.
- Sin freeze Training: no ejecutar.
- Sin dry-run final aprobado: no ejecutar.
- Sin baseline exacto: no ejecutar.
- Sin rollback listo: no ejecutar.
- Sin aprobacion explicita final: no ejecutar.

## Checklist previo a la ventana

- Confirmar proyecto Supabase Produccion.
- Confirmar rama/codigo en estado estable.
- Confirmar fallback legacy activo.
- Confirmar que no hay deploys en curso.
- Confirmar que no hay cambios pendientes de schema, RLS o RPC.
- Confirmar que scripts estan en `main`.
- Confirmar que scripts estan fuera de `supabase/migrations`.
- Confirmar que nadie ejecutara flujos Training durante la ventana.
- Confirmar responsable de ejecucion.
- Confirmar responsable de validacion funcional.
- Confirmar responsable de rollback si aplica.

## Backup logico

Exportar antes de cualquier ejecucion productiva:

- `training_sessions`
- `exercise_entries`
- `routines`
- `exercises`
- `training_session_consolidation_audit`, si existe

Requisitos:

- Registrar fecha y hora.
- Registrar ambiente.
- Guardar fuera del dashboard de Supabase.
- No publicar datos sensibles.
- Validar conteos del backup.
- No continuar si el backup falla.

## Freeze Training

Opciones aceptadas:

- Feature flag.
- Bloqueo temporal del boton o flujo de guardado.
- Ventana manual corta.
- Confirmacion de que nadie usara Training.
- Verificacion de conteos antes y despues.

Si se detecta escritura concurrente, abortar.

## Dry-run final

Ejecutar solo:

```text
supabase/diagnostics/202605_training_legacy_production_dry_run.sql
```

Validar baseline exacto:

- `affected_users = 2`
- `legacy_group_count = 5`
- `legacy_training_sessions = 30`
- `legacy_exercise_entries = 30`
- `consolidation_candidates = 3`
- `non_candidates = 2`
- `orphan_entries = 0`
- `ownership_issues = 0`
- `mixed_routine_groups = 0`
- `mixed_day_groups = 0`
- `sessions_without_entries = 0`
- `planned_day_not_inferable = 0`
- `planned_date_not_inferable = 0`
- `entries_to_soft_deleted_sessions = 0`
- `total_reps = 1157`
- `volume_total = 42941`

Si algo no coincide: no ejecutar.

## Decisiones arquitectonicas cerradas

- `completed_at` aprobado con:
  `completed_at = coalesce(s.completed_at, s.trained_at, s.created_at)`
- `week_number` se mantiene sin cambios.
- La nueva logica usa `calendar_week_start`, `trained_date` y `planned_date`.

## Orden operativo futuro

1. Activar freeze.
2. Generar backup logico.
3. Ejecutar dry-run final.
4. Comparar baseline.
5. Pedir aprobacion explicita final.
6. Ejecutar script productivo si se aprueba.
7. Ejecutar postchecks.
8. Validar app.
9. Mantener fallback legacy.
10. Monitorear.
11. Preparar rollback solo si algo falla.

## Script productivo

Archivo:

```text
supabase/diagnostics/202605_training_legacy_production_consolidation_script.sql
```

Notas:

- Modifica datos.
- No ejecutar sin aprobacion explicita.
- Consolida solo 3 grupos `consolidation_candidate`.
- Deja intactos 2 grupos `reject_not_legacy_multi_session`.
- Tiene `lock_timeout` y `statement_timeout`.
- Tiene `rollback_payload`.
- Tiene postchecks.

## Rollback

Archivo:

```text
supabase/diagnostics/202605_training_legacy_production_consolidation_rollback.sql
```

Notas:

- Solo ejecutar si hay error funcional o decision de reversion.
- Requiere aprobacion explicita.
- Usa `rollback_payload`.
- Restaura entries y sesiones.
- Debe validarse con postchecks rollback.

## Postchecks despues de consolidacion

- Auditorias `executed = 3`.
- Entries auditadas `= 28`.
- Sesiones canonicas activas `= 3`.
- Grupos rechazados intactos `= 2`.
- Sesiones activas finales `= 5`.
- Sesiones soft-deleted `= 25`.
- `exercise_entries = 30`.
- `total_reps = 1157`.
- `volume_total = 42941`.
- Entries apuntando a soft-deleted `= 0`.
- Ownership issues `= 0`.
- Dashboard funcionando.
- Carrusel funcionando.
- Comparacion semanal funcionando.

## Criterios de abortar

Abortar si:

- Backup falla.
- Freeze no puede confirmarse.
- Dry-run no coincide.
- Hay escrituras concurrentes.
- Script arroja error.
- Postchecks fallan.
- App muestra datos incorrectos.
- Hay dudas sobre ambiente.
- No hay aprobacion explicita final.

## Evidencia a guardar

- Captura o export del dry-run final.
- Confirmacion backup.
- Hora de inicio y fin.
- Salida del script.
- Salida postchecks.
- Validacion funcional.
- Confirmacion fallback legacy activo.
- Confirmacion de no errores.

## Comunicacion

Plantilla inicio de ventana:

```text
Inicio ventana controlada Training Fase 2.1.
Freeze Training activo.
Backup logico confirmado.
Dry-run final pendiente/confirmado.
Responsables: ejecucion, validacion funcional, rollback.
```

Plantilla ejecucion exitosa:

```text
Consolidacion Training Fase 2.1 ejecutada exitosamente.
Postchecks OK.
Validacion funcional OK.
Fallback legacy activo.
Ventana en monitoreo.
```

Plantilla aborto:

```text
Ventana Training Fase 2.1 abortada.
Criterio de aborto: [describir].
No se continua ejecucion.
Accion siguiente: [rollback / reprogramar / investigacion].
```

Plantilla rollback:

```text
Rollback Training Fase 2.1 ejecutado.
Postchecks rollback OK.
Validacion funcional posterior: [OK / pendiente].
Motivo: [describir].
```

Plantilla cierre:

```text
Cierre ventana Training Fase 2.1.
Estado final: [consolidado / rollback / abortado].
Evidencia guardada.
Fallback legacy activo.
```

## Cierre

Este documento no autoriza ejecucion. La ejecucion requiere aprobacion explicita final de Arquitectura, backup logico, freeze Training, dry-run final exacto y rollback listo.
