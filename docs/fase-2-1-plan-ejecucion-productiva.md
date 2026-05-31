# Fase 2.1E - Plan de ejecucion productiva para consolidacion legacy Training

## Contexto

Fase 2 Training cambio la fuente de verdad del modulo: `training_sessions` representa una sesion diaria real y `exercise_entries` representa el detalle de ejercicios asociado a esa sesion.

El modelo legacy creo multiples `training_sessions` para un solo entrenamiento real, normalmente una sesion por ejercicio. Los datos no se perdieron, pero la semantica historica no coincide con el modelo nuevo.

La validacion QA sintetica fue exitosa de punta a punta:

- seed sintetico QA OK.
- consolidacion sintetica QA OK.
- postchecks consolidacion OK.
- rollback sintetico QA OK.
- postchecks rollback OK.
- cleanup sintetico QA OK.

Produccion no esta autorizada para ejecucion. Este documento solo prepara el plan de evaluacion productiva, dry-run read-only, auditoria Claude y criterios para una futura ventana controlada.

## Archivos relacionados

- `supabase/diagnostics/202605_training_legacy_production_dry_run.sql`
- `supabase/diagnostics/202605_training_legacy_consolidation_qa_script.sql`
- `supabase/diagnostics/202605_training_legacy_consolidation_qa_rollback.sql`
- `docs/protocolo-cambios-base-datos.md`
- `docs/fase-2-1-script-qa-consolidacion-legacy.md`

El dry-run productivo es solo lectura. No es migracion y no debe moverse a `supabase/migrations`.

## Precondiciones productivas

Antes de cualquier ejecucion productiva futura se debe confirmar:

- Conexion correcta a Supabase Produccion.
- Codigo desplegado conocido y estable.
- Fallback legacy activo temporalmente.
- Sin despliegues en curso.
- Sin cambios pendientes de schema, RLS o RPC.
- Equipo informado de la ventana controlada.
- Modulo Training congelado temporalmente.
- Rollback revisado y disponible antes de ejecutar.
- Backup logico generado y validado.
- Auditoria Claude aprobada.
- Aprobacion humana explicita de Arquitectura.

## Snapshot y backup logico

Antes de una ejecucion real se debe generar un export logico timestamped de:

- `training_sessions`
- `exercise_entries`
- `routines`
- `exercises`
- `training_session_consolidation_audit`, si existe

Recomendaciones:

- Guardar exports fuera del dashboard de Supabase.
- Registrar fecha, hora, ambiente y responsable.
- No publicar datos sensibles.
- No incluir emails reales ni datos personales en tickets o documentos.
- Validar conteos antes y despues.
- Mantener los exports disponibles hasta cerrar QA post-produccion y periodo de monitoreo.

El metodo exacto de backup logico debe definirse antes de cualquier ejecucion productiva real. No es requisito para ejecutar el dry-run read-only, pero si es obligatorio antes de una consolidacion productiva.

## Freeze temporal de Training

La consolidacion futura debe evitar escrituras concurrentes sobre Training. Opciones:

- Feature flag para bloquear nuevos guardados de entrenamiento.
- Ventana manual corta con aviso interno.
- Bloqueo temporal del boton o flujo de guardado.
- Ejecucion en horario de bajo uso.

Riesgo principal: si un usuario guarda entrenamiento mientras se consolidan sesiones legacy, los conteos, auditoria o postchecks pueden quedar inconsistentes. Si se detecta escritura concurrente, se aborta y se reprograma.

Antes de una ejecucion productiva real se debe definir el mecanismo de deteccion de escrituras concurrentes durante el freeze, por ejemplo conteo antes/despues de `training_sessions` y `exercise_entries`, bloqueo temporal de UI o monitoreo de registros creados durante la ventana.

## Dry-run productivo read-only

El dry-run debe ejecutarse primero como solo lectura y guardar evidencia de resultados. Debe mostrar:

- Grupos legacy detectados.
- Total de `training_sessions` legacy.
- Total de `exercise_entries` legacy.
- Usuarios afectados, solo como conteo o identificadores anonimizados.
- Candidatos consolidables.
- No candidatos.
- Entries huerfanas.
- Ownership issues.
- Mezcla de rutinas.
- Mezcla de dias.
- `planned_day` inferible.
- `planned_date` inferible.
- Sesiones sin entries.
- Entries apuntando a sesiones soft-deleted.
- Potencial impacto por grupo.

No hardcodear usuarios, emails ni UUIDs.

El primer dry-run productivo aprobado establece el baseline inicial de `group_count`, salvo que Arquitectura defina un baseline previo formal. Ese baseline debe quedar registrado junto con fecha, hora, ambiente y responsable.

`trained_at` puede funcionar como dato temporal indirecto. Al compartir evidencia, tratar fechas y horarios con cuidado y mantener los resultados anonimizados.

## Rol de ejecucion del dry-run

El dry-run productivo debe ejecutarse con un rol administrativo controlado, idealmente desde el SQL Editor de Supabase con permisos suficientes para diagnostico global multiusuario.

Esta ejecucion puede bypassear RLS, y eso es intencional solo para obtener una vista global de consistencia historica. La evidencia compartida debe mantenerse anonimizada.

Reglas:

- No ejecutar desde frontend.
- No ejecutar con rol `anon`.
- No publicar resultados con datos sensibles.
- No incluir emails, UUIDs productivos ni datos personales en tickets, documentos o capturas compartidas.
- Mantener el SQL en transaccion read-only.

Si el dry-run informa que `training_session_consolidation_audit` existe, ejecutar ademas esta consulta read-only para confirmar auditorias activas:

```sql
select count(*) as active_audit_pending_or_executed
from public.training_session_consolidation_audit
where status in ('pending', 'executed')
  and rolled_back_at is null;
```

Debe retornar 0 antes de cualquier ejecucion productiva.

## Criterios de abortar

No avanzar si ocurre cualquiera de estos casos:

- `group_count` no coincide con el diagnostico aprobado por Arquitectura.
- `orphan_entries > 0`.
- `ownership_issues > 0`.
- Existen grupos con mezcla de rutinas.
- Existen grupos con mezcla de dias.
- `planned_day` no es inferible.
- `planned_date` no es inferible.
- Existen entries apuntando a sesiones con `deleted_at is not null`.
- Existen auditorias `pending` o `executed` sin rollback.
- Se detectan escrituras concurrentes.
- Fallback legacy no esta activo.
- Backup logico no fue generado o validado.
- Claude no aprueba.
- Arquitectura no aprueba.

## Orden futuro propuesto

1. Congelar Training.
2. Generar snapshot logico.
3. Ejecutar dry-run read-only.
4. Revisar resultados y comparar con diagnostico aprobado.
5. Enviar resultados a Claude.
6. Recibir aprobacion humana explicita.
7. Ejecutar script productivo en ventana controlada, si se autoriza.
8. Ejecutar postchecks.
9. Validar dashboard, carrusel y comparacion semanal.
10. Monitorear errores frontend y logs.
11. Mantener fallback legacy temporalmente.
12. Decidir en fase posterior si se retira fallback.

## Rollback productivo

El rollback productivo debe estar disponible antes de ejecutar consolidacion. Debe usar `rollback_payload` y:

- Restaurar `exercise_entries.session_id` original.
- Restaurar campos originales de sesiones canonicas y no canonicas.
- Restaurar `routine_id`, `calendar_week_start`, `planned_day`, `planned_date`, `trained_date`, `status`, `completed_at` y `deleted_at`.
- Marcar `rolled_back_at`.
- Validar entries, sesiones y auditoria.
- No tocar registros fuera de auditoria.

El rollback debe haber sido probado en QA y revisado por Claude antes de cualquier ejecucion productiva.

## Postchecks productivos

Postchecks minimos:

- Total entries antes/despues.
- Total reps antes/despues.
- Volumen antes/despues.
- Sesiones activas duplicadas por `user_id`, `routine_id`, `trained_date`.
- Entries sin `session_id`.
- Entries apuntando a sesiones soft-deleted.
- Auditoria `executed`.
- Cada grupo consolidado con 1 sesion activa.
- Ownership issues en 0.
- Dashboard funcionando.
- Carrusel funcionando.
- Comparacion semanal funcionando o sin regresion conocida.
- Usuarios no afectados siguen viendo sus datos.

## Observabilidad

Guardar evidencia de:

- Resultados del dry-run.
- Conteos antes/despues.
- Hora de inicio y termino.
- Logs de ejecucion.
- Errores frontend.
- Supabase logs si aplica.
- Validacion manual de dashboard, carrusel y comparacion semanal.
- Confirmacion de fallback legacy activo.

## Riesgos

- Perder asociacion correcta de entries.
- Duplicar volumen.
- Mover entries a sesion equivocada.
- Inferir `planned_day` o `planned_date` incorrectamente.
- Escrituras concurrentes durante la ventana.
- Fallback legacy ocultando problemas.
- Rollback incompleto.
- Datos historicos ambiguos.
- Impacto multiusuario si se mezcla ownership.

## Criterio de exito

La ejecucion futura solo se considera exitosa si:

- Consolidacion termina sin errores.
- Entries se conservan.
- Reps y volumen se conservan.
- Auditoria queda completa.
- Dashboard, carrusel y comparacion semanal funcionan.
- Fallback legacy queda activo.
- No hay errores reportados por usuarios.
- Rollback queda disponible y no usado, o usado exitosamente si se requiere.

## Criterio de no avanzar

No pasar a ejecucion productiva si:

- Claude no aprueba.
- Arquitectura no aprueba.
- Dry-run muestra ambiguedad.
- No hay backup logico.
- No hay freeze.
- No hay ventana controlada.
- No hay rollback listo.
- Hay datos sensibles expuestos en evidencia.

## Recomendacion final

Preparar y ejecutar solo el dry-run productivo read-only, guardar resultados anonimizados y enviarlos a Claude. No ejecutar consolidacion productiva todavia. Mantener fallback legacy temporalmente hasta completar auditoria, aprobacion y ventana controlada.
