# Rediseño de ciclos: integración y despliegue controlado

Este documento describe el cableado técnico preparado en el repositorio. No registra ninguna ejecución remota. El dueño de producto realiza manualmente Preview, QA, migraciones y despliegues, siempre en QA antes de PROD.

## Alcance integrado

- Constructor productivo de 14 estados, sin el índice del prototipo.
- Duplicación editable del último ciclo como opción recomendada, creación manual y rutina sugerida editable.
- Fechas de inicio y término, edición optimista, extensión exclusiva de la fecha de término y cierre automático posterior al vencimiento.
- Catálogo y ejercicios personalizados con UUID reales, grupos musculares, URL opcional de YouTube y técnicas lineal, pirámide ascendente, pirámide descendente, drop set y fallo.
- Plan versionado, lineage de ejercicio, métricas, recomendaciones por serie opt-in y ejecución avanzada append-only.
- Notificaciones de término en T-7, T-3, T-1, T0 y cierre en T+1, visibles en la campana y con entrega de correo preparada. Los eventos T-2 históricos se conservan sólo para poder leer registros anteriores.
- Adaptación no destructiva de ciclos legacy representables: conserva el mismo ciclo activo y su historial, infiere un término inclusivo cuando falta y mantiene el flujo legacy cuando los datos no se pueden representar de forma segura.
- Aislamiento del portal Usuario respecto del portal Coach.
- Fallback legacy cuando el backend versionado todavía no está instalado. No se cambia el esquema ni el write existente de `training_sessions` o `exercise_entries`.

## Orden obligatorio para QA

1. Verificar que el commit/branch autorizado contiene únicamente el inventario aprobado y que Preview compila.
2. Hacer dry-run contra el proyecto QA y comprobar que toda migración pendiente pertenece a esta lista cerrada, respetando el orden cronológico:
   - `20260829200846_cycle_redesign_schema.sql`
   - `20260829200847_cycle_redesign_api.sql`
   - `20260831213114_cycle_active_replacement.sql`
   - `20260831230440_cycle_active_atomic_replacement.sql`
   - `20260831233757_cycle_active_replacement_snapshot_response.sql`
   - `20260901002250_cycle_active_replacement_exercise_descriptors.sql`
   - `20260902163716_sec_training_rpc_resource_bounds.sql`
   - `20260902183335_sec_training_integer_cast_fix.sql`
   - `20260905201420_cycle_legacy_compatibility_expiry_youtube.sql`
3. Aplicar únicamente el subconjunto que el historial remoto marque como pendiente, en orden cronológico entre las pendientes. QA ya puede tener 846/847 y las dos migraciones de seguridad registradas; PROD puede tener sólo las de seguridad. No reaplicar ni reparar manualmente una migración ya registrada. Si el CLI requiere incluir migraciones pendientes de fecha anterior a la última remota, revisar primero ese inventario exacto con `--include-all --dry-run`. Repetir el dry-run hasta obtener “Remote database is up to date”.
4. Configurar los secretos Edge y la capacidad de Vault indicados abajo sin mostrar valores.
5. Desplegar `process-training-cycle-lifecycle` en QA.
6. Crear el scheduler QA sólo después de verificar que el endpoint, el proyecto y la capacidad pertenecen a QA.
7. Ejecutar la QA manual/visual/funcional del dueño de producto.
8. Sólo con QA PASS repetir el mismo orden en PROD mediante una autorización separada y explícita.

No se debe aplicar una migración sin sus dependencias funcionales. El historial ya
registrado se conserva incluso cuando incluye migraciones de seguridad posteriores
a las nuevas pendientes. Cualquier operación remota exige autorización explícita,
verificación inequívoca del proyecto QA y un dry-run previo; PROD requiere una
autorización posterior y separada.

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
8. Video: “Ver técnica en YouTube” aparece en Entrenemos sólo cuando el ejercicio tiene un enlace válido; abre la técnica sin eliminar el borrador de ejecución al volver a la aplicación.
9. Compatibilidad legacy: un ciclo representable ya activo conserva su identidad, días, ejercicios e historial al habilitar las funciones nuevas; un ciclo no representable continúa en el flujo anterior sin datos parciales. Peso lateral distinto de cero y notas no vacías en rutina/día/ejercicio no tienen representación canónica: mantienen fallback y bloquean reemplazo destructivo, nunca se descartan.
10. Lifecycle: campana T-7/T-3/T-1/T0/T+1 y correos esperados; el ciclo conserva todo T0 y se cierra desde T+1 cuando no hay un entrenamiento en progreso.
11. Separación de portales: Coach no monta ni escribe el constructor Usuario.
12. Fallback: ante RPC inexistentes (`PGRST202`), el flujo legacy continúa disponible.

## Integración con los cambios ya publicados

La base de integración es `main` en `00701bd5012f3b0baf126ca40d7dd292fd9b4dc2`.
Se conservan los cambios de sesión persistente, splash hasta dashboard preparado y
fechas civiles de PR #92, y los límites de recursos de PR #93. Las dos migraciones
de seguridad se ejecutan también en el ensayo local junto con las del rediseño.

En el composition root no entra ni sale una responsabilidad de dominio: se
conserva la coordinación de sesión y se conectan los controllers de ciclos,
notificaciones y ejecución avanzada mediante sus contratos. La lógica propia de
ciclos permanece en `src/features/training-cycle-builder/`. El cambio visible
corresponde al constructor, confirmación de reemplazo, vencimiento y botón de
YouTube autorizados por el dueño; su QA visual y funcional en Preview sigue
pendiente. `ShareWorkoutCard` permanece desconectado.

El ensayo PostgreSQL utiliza una base local reducida y datos sintéticos; no
equivale a una comprobación del estado hospedado. El inventario remoto y la
compatibilidad del CLI se confirman mediante el dry-run QA antes de ejecutar
cualquier cambio remoto.

El runner `supabase/tests/support/run_cycle_active_replacement_embedded_postgres.sh`
admite `chronological`, `qa-upgrade` (seguridad después de 846/847) y `prod-upgrade`
(seguridad antes del rediseño). Cada variante prepara una base efímera desde cero
y ejecuta los mismos escenarios de reemplazo, compatibilidad y YouTube. No prueba
los RPC legacy de escritura de sesiones ni su trigger de entries; esos artefactos
de PR #93 se conservan sin modificaciones y tienen su suite específica de límites.

La auditoría de integración añadió una autorización de correo inmediatamente
antes del envío. El worker requiere el RPC
`authorize_training_cycle_lifecycle_delivery` de la migración pendiente
`20260905201420`. Antes del despliegue remoto, pausar únicamente el scheduler
de ciclos del entorno autorizado y esperar a que terminen sus invocaciones
en curso; mantenerlo pausado durante la migración y actualización de Edge.
Verificar que el worker nuevo esté desplegado antes de reactivar ese scheduler.
Así no queda una instancia antigua enviando sin autorización durante el cambio.
No se requiere rotar credenciales. La autorización es de un solo uso por intento
y valida el estado actual bajo el mismo lock de usuario/portal que una extensión.
Si la extensión/reemplazo ganó primero, no se envía el correo. Si la autorización
ganó primero, el correo puede estar ya en vuelo cuando el usuario extienda:
ningún lock se mantiene durante una llamada de red y no se promete cancelar
mensajes ya autorizados. Denegación, respuesta inválida o incierta impiden enviar.

Un refresh legacy fallido después de una mutación confirmada no se presenta como
un guardado fallido ni como éxito completo: se conserva el resultado confirmado
y se indica recargar para sincronizar, sin reintentar automáticamente la mutación.
