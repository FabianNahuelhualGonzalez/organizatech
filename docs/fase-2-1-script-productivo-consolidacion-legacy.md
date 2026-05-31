# Fase 2.1F - Script productivo de consolidacion legacy Training

## Contexto

Fase 2 Training definio `training_sessions` como fuente de verdad de una sesion diaria real y `exercise_entries` como detalle de ejercicios. El modelo legacy creo multiples `training_sessions` para un entrenamiento real, normalmente una sesion por ejercicio.

La validacion QA sintetica fue exitosa de punta a punta: seed, consolidacion, postchecks, rollback y cleanup. Arquitectura autorizo preparar un script productivo separado, pero Produccion NO esta autorizada para ejecucion.

Este paquete solo prepara documentacion y scripts para auditoria Claude y revision humana.

## Baseline productivo oficial

Dry-run productivo read-only aprobado:

- `affected_users`: 2
- `legacy_group_count`: 5
- `legacy_training_sessions`: 30
- `legacy_exercise_entries`: 30
- `consolidation_candidates`: 3
- `non_candidates`: 2
- `orphan_entries`: 0
- `ownership_issues`: 0
- `mixed_routine_groups`: 0
- `mixed_day_groups`: 0
- `sessions_without_entries`: 0
- `planned_day_not_inferable`: 0
- `planned_date_not_inferable`: 0
- `entries_to_soft_deleted_sessions`: 0
- `audit_table_exists`: false

Clasificaciones:

- `consolidation_candidate`: 3
- `reject_not_legacy_multi_session`: 2

Baseline global:

- `total_reps`: 1157
- `volume_total`: 42941

## Alcance

El script productivo futuro debe consolidar solo los 3 grupos con `classification = 'consolidation_candidate'`.

Debe dejar intactos los 2 grupos `reject_not_legacy_multi_session`.

Resultado esperado post-consolidacion:

- Sesiones legacy activas antes: 30.
- Sesiones activas despues: 5.
- 3 sesiones canonicas consolidadas.
- 2 grupos `reject_not_legacy_multi_session` intactos.
- Sesiones soft-deleted despues: 25.
- `exercise_entries`: 30.
- `total_reps`: 1157.
- `volume_total`: 42941.
- Auditorias `executed`: 3.
- Entries apuntando a sesiones soft-deleted: 0.
- Ownership issues: 0.

## Exclusiones

- No consolidar grupos `reject_not_legacy_multi_session`.
- No tocar datos fuera de los grupos candidatos.
- No hardcodear usuarios, emails, UUIDs ni session IDs reales.
- No mover scripts a `supabase/migrations`.
- No ejecutar sin nueva auditoria Claude.
- No ejecutar sin aprobacion explicita de Arquitectura.

## Archivos

- `supabase/diagnostics/202605_training_legacy_production_consolidation_script.sql`
- `supabase/diagnostics/202605_training_legacy_production_consolidation_rollback.sql`

Ambos scripts modifican datos si se ejecutan. No son migraciones y deben permanecer fuera de `supabase/migrations`.

## Precondiciones obligatorias

Antes de una ejecucion productiva real:

- Auditoria Claude aprobada.
- Aprobacion humana explicita de Arquitectura.
- Ventana controlada definida.
- Backup logico generado y validado.
- Freeze temporal de Training activo.
- Fallback legacy activo.
- Sin despliegues en curso.
- Sin cambios pendientes de schema, RLS o RPC.
- Mecanismo de deteccion de escrituras concurrentes definido.
- Rollback revisado y disponible.
- Dry-run read-only reciente coincide con el baseline oficial.
- Dry-run read-only final ejecutado inmediatamente antes de la ventana.
- Baseline exacto confirmado antes de ejecutar.
- Decision explicita de Arquitectura sobre `completed_at = coalesce(s.completed_at, s.trained_at, s.created_at)`.
- Decision explicita de Arquitectura sobre si `week_number` debe actualizarse en sesiones canonicas o si se deja sin cambios de forma intencional.

## Auditoria y unicidad

El script define `legacy_group_key` como unico dentro del `CREATE TABLE IF NOT EXISTS public.training_session_consolidation_audit`. Esta garantia aplica si la tabla se crea por primera vez durante la ejecucion.

Si la tabla ya existe sin esa constraint, este script no intenta `ALTER TABLE` para agregarla, porque esa operacion debe revisarse y aprobarse por separado. En ese caso, el riesgo residual es la duplicidad logica de auditorias para un mismo grupo; la mitigacion operativa es abortar si existen auditorias `pending` o `executed` sin rollback antes de ejecutar.

Ambos scripts definen `lock_timeout` y `statement_timeout` con `SET LOCAL` dentro de la transaccion para evitar esperas indefinidas ante lock contention inesperado.

## Backup logico obligatorio

Antes de ejecutar en Produccion, exportar con timestamp:

- `training_sessions`
- `exercise_entries`
- `routines`
- `exercises`
- `training_session_consolidation_audit`, si existe

Los exports deben guardarse fuera del dashboard de Supabase, con ambiente, fecha, hora y responsable. No publicar datos sensibles.

## Freeze Training obligatorio

Durante la ventana se debe impedir o detectar escrituras concurrentes en Training. Opciones:

- Feature flag.
- Bloqueo temporal del flujo de guardado.
- Ventana manual corta con aviso.
- Conteo antes/despues de `training_sessions` y `exercise_entries`.
- Monitoreo de registros creados durante la ventana.

Si se detectan escrituras concurrentes, abortar y reprogramar.

## Orden de ejecucion futuro

1. Confirmar ventana.
2. Activar freeze Training.
3. Generar backup logico.
4. Ejecutar dry-run read-only final.
5. Confirmar baseline oficial.
6. Ejecutar script productivo solo si Claude y Arquitectura aprueban.
7. Ejecutar postchecks.
8. Validar dashboard, carrusel y comparacion semanal.
9. Monitorear errores.
10. Mantener fallback legacy temporalmente.
11. Documentar evidencia.

## Rollback

El rollback productivo separado usa `rollback_payload` para:

- Restaurar `exercise_entries.session_id`.
- Restaurar campos originales de sesiones canonicas y no canonicas.
- Restaurar `deleted_at`.
- Marcar `rolled_back_at`.
- Validar entries, sesiones y auditoria.
- No tocar los 2 grupos `reject_not_legacy_multi_session`.

El rollback aborta si no existen exactamente 3 auditorias `executed` sin rollback, o si ya se aplico rollback.

## Postchecks

Postchecks esperados tras consolidacion:

- Auditorias `executed`: 3.
- Entries auditadas: 28.
- Sesiones canonicas activas: 3.
- Grupos rechazados intactos: 2.
- Sesiones activas totales del baseline: 5.
- Sesiones soft-deleted del baseline: 25.
- Total `exercise_entries`: 30.
- `total_reps`: 1157.
- `volume_total`: 42941.
- Entries apuntando a sesiones soft-deleted: 0.
- Ownership issues: 0.

Postchecks esperados tras rollback:

- Auditorias marcadas `rolled_back`: 3.
- Entries restauradas a `session_id` original.
- Campos originales de sesiones restaurados.
- Sesiones activas legacy del baseline: 30.
- Sesiones soft-deleted del baseline: 0.
- `total_reps`: 1157.
- `volume_total`: 42941.

## Criterios de abortar

Abortar si:

- Baseline no coincide exactamente.
- Hay auditorias `pending` o `executed` sin rollback.
- Hay entries apuntando a sesiones soft-deleted antes de iniciar.
- Hay orphan entries.
- Hay ownership issues.
- Hay mezcla de rutinas.
- Hay mezcla de dias.
- Hay `planned_day` o `planned_date` no inferible.
- No hay backup.
- No hay freeze.
- Se detectan escrituras concurrentes.
- Claude o Arquitectura no aprueban.

## Criterio de exito

Exito significa:

- Script termina sin errores.
- Solo se consolidan 3 candidatos.
- Los 2 grupos rechazados quedan intactos.
- Entries, reps y volumen se conservan.
- Auditoria queda completa.
- Dashboard, carrusel y comparacion semanal funcionan.
- Fallback legacy sigue activo.
- Rollback queda disponible.

## Evidencia requerida

- Dry-run final.
- Backup logico registrado.
- Hora de inicio y termino.
- Salida del script productivo.
- Salida de postchecks.
- Validacion funcional.
- Confirmacion de fallback legacy activo.
- Confirmacion de que no hay errores reportados.

## Advertencia

Produccion NO esta autorizada para ejecucion con este commit. Los scripts deben enviarse a Claude y Arquitectura. Cualquier ejecucion requiere aprobacion explicita, backup, freeze, ventana controlada y rollback disponible.
