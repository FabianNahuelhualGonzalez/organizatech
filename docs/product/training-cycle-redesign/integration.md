# Rediseño de ciclos: integración y despliegue controlado

Este documento describe el cableado técnico preparado en el repositorio. No registra ninguna ejecución remota. El dueño de producto realiza manualmente Preview, QA, migraciones y despliegues, siempre en QA antes de PROD.

## Alcance integrado

- Constructor productivo de 14 estados, sin el índice del prototipo.
- Duplicación editable del último ciclo como opción recomendada, creación manual y rutina sugerida editable.
- Fechas de inicio y término, edición optimista, extensión exclusiva de la fecha de término y cierre automático posterior al vencimiento.
- Catálogo y ejercicios personalizados con UUID reales, grupos musculares, URL opcional de YouTube y técnicas lineal, pirámide ascendente, pirámide descendente, drop set y fallo.
- Plan versionado, lineage de ejercicio, métricas, recomendaciones por serie opt-in y ejecución avanzada append-only.
- Notificaciones de término en T-3, T-2, T-1, T0 y cierre en T+1, visibles en la campana y con entrega de correo preparada.
- Aislamiento del portal Usuario respecto del portal Coach.
- Fallback legacy cuando el backend versionado todavía no está instalado. No se cambia el esquema ni el write existente de `training_sessions` o `exercise_entries`.

## Orden obligatorio para QA

1. Verificar que el commit/branch autorizado contiene únicamente el inventario aprobado y que Preview compila.
2. Hacer dry-run contra el proyecto QA y confirmar que las únicas migraciones pendientes son, en este orden:
   - `20260829200846_cycle_redesign_schema.sql`
   - `20260829200847_cycle_redesign_api.sql`
3. Aplicar únicamente esas dos migraciones en QA y repetir el dry-run hasta obtener “Remote database is up to date”.
4. Configurar los secretos Edge y la capacidad de Vault indicados abajo sin mostrar valores.
5. Desplegar `process-training-cycle-lifecycle` en QA.
6. Crear el scheduler QA sólo después de verificar que el endpoint, el proyecto y la capacidad pertenecen a QA.
7. Ejecutar la QA manual/visual/funcional del dueño de producto.
8. Sólo con QA PASS repetir el mismo orden en PROD mediante una autorización separada y explícita.

No se debe aplicar la migración API sin la migración de esquema precedente. Ningún agente debe enlazar un proyecto, ejecutar SQL, crear secretos, desplegar funciones o programar el worker automáticamente.

## Secretos y Vault

La función usa exclusivamente estos nombres; los valores no pertenecen al repositorio ni a esta documentación:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `TRAINING_CYCLE_LIFECYCLE_RPC_SECRET`
- `TRAINING_CYCLE_LIFECYCLE_SCHEDULER_SECRET`
- `BREVO_API_KEY`
- `ORGANIZATECH_EMAIL_SENDER`
- `ORGANIZATECH_EMAIL_SENDER_NAME`
- `ORGANIZATECH_APP_URL`

Vault debe contener la capacidad `organizatech_training_cycle_lifecycle_rpc_secret`, con el mismo valor que `TRAINING_CYCLE_LIFECYCLE_RPC_SECRET`. El secreto del scheduler protege el endpoint Edge y no se guarda en tablas de producto. Nunca usar `service_role` en el cliente ni en este worker.

## Worker y scheduler

- Función: `process-training-cycle-lifecycle`.
- La función valida el secreto del scheduler, reclama un lote acotado, limita concurrencia y tiempo de respuesta, envía por Brevo y completa cada entrega con token de intento.
- Los RPC de claim/complete verifican en base de datos la capacidad guardada en Vault.
- La cadencia debe configurarse manualmente en QA con el proyecto QA explícito. El mismo criterio se replica en PROD sólo después de QA PASS.
- Repeticiones del scheduler son idempotentes: una entrega ya confirmada no debe volver a enviarse.

## QA manual del dueño de producto

Validar al menos:

1. Usuario sin ciclo: manual y sugerido disponibles; no aparece duplicación inexistente.
2. Usuario con historial: duplicar último aparece recomendado y todo el borrador sigue editable.
3. Catálogo y personalizado: fuente correcta, UUID real, músculo principal y URL de YouTube válida/inválida.
4. Series: las cinco técnicas, repeticiones y kilos distintos por serie/drop; recomendación sólo al aceptarla.
5. Activación: un único ciclo activo, revisión optimista y conflicto visible sin sobrescritura.
6. Fechas: inicio inmutable después de activar; sólo el término se puede extender.
7. Entrenemos: los datos legacy terminan de guardarse; la ejecución avanzada muestra sincronizando, éxito o error reintentable sin duplicar ni corromper el entrenamiento.
8. Video: abrir YouTube no elimina el borrador de ejecución al volver a la aplicación.
9. Lifecycle: campana T-3/T-2/T-1/T0/T+1 y correos esperados; mañana de T0 el ciclo queda cerrado y puede originar el siguiente.
10. Separación de portales: Coach no monta ni escribe el constructor Usuario.
11. Fallback: ante RPC inexistentes (`PGRST202`), el flujo legacy continúa disponible.

## Limitación documental

La integración fue preparada y validada sólo con código, contratos y documentación local del repositorio. No se consultaron documentos actuales de Supabase porque el dueño de producto prohibió navegación durante esta fase; por eso la compatibilidad final del CLI y del proyecto hospedado debe confirmarse mediante el dry-run QA antes de ejecutar cualquier cambio remoto.
