# Fase 2.1H - Reporte operativo de ventana productiva Training legacy

## 1. Estado de autorizacion

- Preparacion operativa autorizada.
- Backup logico autorizado.
- Dry-run final read-only autorizado.
- Consolidacion productiva no autorizada.
- Modificacion de datos no autorizada.
- Ejecucion del script productivo no autorizada.
- Ejecucion del proceso de reversion no autorizada.
- Este documento no autoriza ejecucion productiva.
- La ejecucion requiere aprobacion explicita final de Arquitectura despues de revisar backup, freeze y dry-run final.

## 2. Datos de ventana

| Campo | Valor |
| --- | --- |
| Fecha | Pendiente |
| Hora inicio | Pendiente |
| Hora termino estimada | Pendiente |
| Duracion estimada | Pendiente |
| Responsable ejecucion | Pendiente |
| Responsable validacion funcional | Pendiente |
| Responsable reversion | Pendiente |
| Canal de comunicacion | Pendiente |
| Criterio de abortar | Pendiente |
| Criterio de exito | Pendiente |

## 3. PRECHECKS

- [ ] Confirmar Supabase Produccion.
- [ ] Confirmar scripts en `main`.
- [ ] Confirmar scripts fuera de `supabase/migrations`.
- [ ] Confirmar fallback legacy activo.
- [ ] Confirmar que no hay deploys en curso.
- [ ] Confirmar que no hay cambios schema/RLS/RPC pendientes.
- [ ] Confirmar que no se ejecutara script productivo sin aprobacion final.
- [ ] Confirmar que no se ejecutara proceso de reversion salvo autorizacion explicita.

Resultado:

```text
Pendiente.
```

## 4. BACKUP

Tablas a respaldar:

- [ ] `training_sessions`
- [ ] `exercise_entries`
- [ ] `routines`
- [ ] `exercises`
- [ ] `training_session_consolidation_audit`, si existe.

Registro:

| Campo | Valor |
| --- | --- |
| Timestamp | Pendiente |
| Ubicacion segura del respaldo | Pendiente |
| Responsable | Pendiente |
| Conteos verificados | Pendiente |
| Resultado | Pendiente: aprobado / fallido |

Regla: si backup falla, no ejecutar.

## 5. FREEZE

| Campo | Valor |
| --- | --- |
| Inicio freeze | Pendiente |
| Fin freeze | Pendiente |
| Metodo de freeze | Pendiente |
| Acciones bloqueadas | Pendiente |
| Validacion sin escrituras concurrentes | Pendiente |
| Conteos antes | Pendiente |
| Conteos despues | Pendiente |

Regla: si freeze no se confirma, no ejecutar.

Si se detectan escrituras concurrentes, abortar.

## 6. BASELINE / DRY-RUN FINAL

Ejecutar solo el dry-run read-only:

```text
supabase/diagnostics/202605_training_legacy_production_dry_run.sql
```

Baseline exacto requerido:

- [ ] `affected_users = 2`
- [ ] `legacy_group_count = 5`
- [ ] `legacy_training_sessions = 30`
- [ ] `legacy_exercise_entries = 30`
- [ ] `consolidation_candidates = 3`
- [ ] `non_candidates = 2`
- [ ] `orphan_entries = 0`
- [ ] `ownership_issues = 0`
- [ ] `mixed_routine_groups = 0`
- [ ] `mixed_day_groups = 0`
- [ ] `sessions_without_entries = 0`
- [ ] `planned_day_not_inferable = 0`
- [ ] `planned_date_not_inferable = 0`
- [ ] `entries_to_soft_deleted_sessions = 0`
- [ ] `total_reps = 1157`
- [ ] `volume_total = 42941`

Espacio para resultado anonimizado:

```text
summary:
Pendiente.

classification_counts:
Pendiente.

impact_by_group:
Pendiente.

impact_by_user_anonymized:
Pendiente.
```

Si algo no coincide con el baseline exacto, no ejecutar.

## 7. SCRIPT PRODUCTIVO

Archivo de referencia:

```text
supabase/diagnostics/202605_training_legacy_production_consolidation_script.sql
```

Estado:

- No autorizado todavia.
- Modifica datos.
- Requiere aprobacion explicita final.
- Consolida solo 3 grupos `consolidation_candidate`.
- Deja intactos 2 grupos `reject_not_legacy_multi_session`.
- Incluye auditoria para permitir reversion controlada.
- Incluye timeouts.
- Incluye postchecks.

Resultado:

```text
Pendiente. No completar sin aprobacion explicita final.
```

## 8. ROLLBACK

Archivo de referencia:

```text
supabase/diagnostics/202605_training_legacy_production_consolidation_rollback.sql
```

Estado:

- No ejecutar salvo error o decision explicita.
- Requiere aprobacion explicita.
- Usa auditoria generada por el script productivo.
- Restaura asociaciones de entries y campos de sesiones.
- Incluye postchecks de reversion.

Resultado:

```text
Pendiente. Completar solo si se autoriza y ejecuta reversion.
```

## 9. POSTCHECKS

- [ ] Auditorias `executed = 3`.
- [ ] Entries auditadas `= 28`.
- [ ] Sesiones canonicas activas `= 3`.
- [ ] Grupos rechazados intactos `= 2`.
- [ ] Sesiones activas finales `= 5`.
- [ ] Sesiones soft-deleted `= 25`.
- [ ] `exercise_entries = 30`.
- [ ] `total_reps = 1157`.
- [ ] `volume_total = 42941`.
- [ ] Entries apuntando a soft-deleted `= 0`.
- [ ] Ownership issues `= 0`.
- [ ] Dashboard funcionando.
- [ ] Carrusel funcionando.
- [ ] Comparacion semanal funcionando.
- [ ] Fallback legacy activo.

Resultado:

```text
Pendiente.
```

## 10. CRITERIOS DE ABORTO

- Sin backup logico: abortar.
- Sin freeze Training: abortar.
- Sin dry-run final aprobado: abortar.
- Sin baseline exacto: abortar.
- Sin proceso de reversion listo: abortar.
- Sin aprobacion explicita final: abortar.
- Si Supabase no es Produccion o hay duda de ambiente: abortar.
- Si hay escrituras concurrentes: abortar.
- Si el script falla: abortar.
- Si postchecks fallan: abortar.
- Si app muestra datos incorrectos: evaluar reversion.

Registro:

```text
Pendiente.
```

## 11. CRITERIOS DE EXITO

- Script ejecutado sin errores.
- Baseline conservado.
- Entries, reps y volumen conservados.
- Dashboard OK.
- Carrusel OK.
- Comparacion semanal OK.
- Fallback legacy activo.
- Sin errores reportados.
- Evidencia guardada.

Registro:

```text
Pendiente.
```

## 12. Comunicacion

Inicio de ventana:

```text
Inicio ventana controlada Training Fase 2.1.
Preparacion operativa en curso.
Consolidacion productiva no autorizada hasta aprobacion final.
Responsables: ejecucion, validacion funcional, reversion.
```

Backup completado:

```text
Backup logico completado.
Tablas respaldadas: training_sessions, exercise_entries, routines, exercises, training_session_consolidation_audit si existe.
Conteos verificados: [OK / detalle].
```

Freeze activado:

```text
Freeze Training activado.
Metodo: [feature flag / bloqueo temporal / ventana manual].
Escrituras concurrentes: [no detectadas / detectadas].
```

Dry-run final aprobado:

```text
Dry-run final read-only aprobado.
Baseline exacto confirmado.
Resultados anonimizados guardados.
```

Solicitud de aprobacion final:

```text
Solicito aprobacion explicita final para ejecutar script productivo de consolidacion Training legacy.
Backup, freeze, dry-run final, baseline y reversion estan confirmados.
```

Ejecucion exitosa:

```text
Consolidacion Training legacy ejecutada exitosamente.
Postchecks OK.
Validacion funcional OK.
Fallback legacy activo.
```

Abortado por criterio:

```text
Ventana Training legacy abortada.
Criterio de aborto: [describir].
No se continua ejecucion.
Accion siguiente: [investigacion / reprogramar / reversion si aplica].
```

Reversion ejecutada:

```text
Reversion Training legacy ejecutada.
Postchecks de reversion OK.
Validacion funcional posterior: [OK / pendiente].
Motivo: [describir].
```

Cierre de ventana:

```text
Cierre ventana Training legacy.
Estado final: [preparacion / consolidado / abortado / revertido].
Evidencia guardada.
Fallback legacy activo.
```

## 13. Cierre

Este documento no autoriza ejecucion productiva.

La ejecucion requiere aprobacion explicita final de Arquitectura despues de revisar backup logico, freeze Training y dry-run final read-only con baseline exacto.
