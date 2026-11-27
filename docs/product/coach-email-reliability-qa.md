# Correos de coach y alumno: entrega en QA

## Comportamiento preparado

- Un ciclo nuevo creado por el coach genera la notificación existente `coach_updated` al alumno; el worker de ciclos ahora también la envía por correo mediante el job que ya procesa ese ciclo.
- Una invitación nueva o reenviada conserva las dos copias (alumno y coach). El modo `{"kind":"retry_pending"}` reclama hasta cinco mensajes por ejecución ya reservados con estado `pending` o `failed`, sólo mientras la invitación siga vigente. Revalida el permiso antes de Brevo. No reintenta estados inciertos (`ambiguous` o `sending`) para evitar duplicados.
- Los correos de anamnesis y evaluación siguen naciendo al guardar o enviar la solicitud. Su modo `{"kind":"retry_pending"}` sólo drena mensajes existentes con estado `pending` o `failed`. Excluye los recordatorios automáticos; los recordatorios manuales conservan su flujo.
- Ambos reintentos usan el secreto dedicado del scheduler, la capacidad RPC guardada en Vault y la clave anon; no usan `service_role` ni exponen el código de invitación al cliente.

## Activación exclusivamente en QA

1. Aplicar las migraciones `20261127170500` y `20261127170600` en la base QA con la cadena de migraciones en orden.
2. Desplegar `process-training-cycle-lifecycle`, `send-evaluation-emails` y `send-coach-link-emails` en QA. El último requiere el cambio versionado `verify_jwt = false`: el handler exige JWT de coach para solicitudes normales y secreto del scheduler para reintentos.
3. Configurar un secreto distinto, de al menos 32 caracteres, en `COACH_INVITATION_EMAIL_SCHEDULER_SECRET` para la función de invitaciones y en el invocador privado del job QA. Configurar `EVALUATION_EMAIL_SCHEDULER_SECRET` de igual modo para Evaluaciones, separado de `EVALUATION_EMAIL_RPC_SECRET`. Mantener las capacidades RPC existentes en Vault (`organizatech_email_ledger_rpc_secret` y `evaluation_email_rpc_secret`) y sus equivalentes en las funciones.
4. Crear jobs QA acotados (por ejemplo, cada cinco minutos) que llamen por HTTPS a cada función con `Authorization: Bearer <secreto dedicado>` y exactamente `{"kind":"retry_pending"}`. Nunca configurar un job que invoque `{}` en Evaluaciones. El worker de ciclos conserva su job actual.
5. Probar en `qa.organizatech.cl`: ciclo nuevo del coach, invitación nueva y anamnesis al alumno y al coach; después provocar un fallo de proveedor controlado y confirmar que una entrega `failed` se reintenta una sola vez con la misma clave. Confirmar que cancelar una invitación antes del reintento impide su correo y que `ambiguous` no se reenvía.

El despliegue del código sin los jobs y secretos de los pasos 3 y 4 conserva el envío inmediato pero no habilita los reintentos automáticos. No aplicar estos cambios en producción antes de QA PASS.

La edición directa de una rutina dentro del mismo ciclo tiene una RPC de auditoría, pero no está conectada al flujo visible del coach. Este cambio cubre la creación o sustitución de ciclo que hoy usa la UI. Cuando se conecte la edición directa, necesitará su propia notificación por operación.
