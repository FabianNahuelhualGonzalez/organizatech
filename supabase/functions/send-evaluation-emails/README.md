# Operación de correos de Evaluaciones

Esta función tiene dos entradas autenticadas y no usa `service_role`:

- La app puede solicitar el drenaje inmediato de sus propios envíos con el JWT del usuario y un `Origin` igual a `ORGANIZATECH_APP_URL`.
- El scheduler puede drenar la cola completa y crear el único recordatorio automático, como máximo una vez por asignación, cuando faltan hasta 48 horas. Excluye asignaciones sin fecha, completadas o con vínculo inactivo.

## Configuración requerida por entorno

Configurar primero en QA y sólo después de QA PASS y autorización explícita en PROD:

1. Guardar un secreto aleatorio de al menos 32 caracteres como secreto de la Edge Function `EVALUATION_EMAIL_RPC_SECRET` y, con el mismo valor, en Vault bajo `evaluation_email_rpc_secret`.
2. Configurar `EVALUATION_EMAIL_SCHEDULER_SECRET` con un valor distinto, además de `ORGANIZATECH_APP_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` y las credenciales del proveedor de correo.
3. Desplegar `send-evaluation-emails` con la configuración versionada `verify_jwt = false`; el handler valida explícitamente el JWT/origen de app o el secreto del scheduler y las RPC exigen además la capacidad privada.
4. Programar una invocación `POST` cada 15 minutos con `Authorization: Bearer <EVALUATION_EMAIL_SCHEDULER_SECRET>`. No enviar body ni exponer ninguno de los secretos al cliente.

Este repositorio no crea el job remoto ni configura secretos. Ambos pasos son cambios de entorno y requieren autorización específica para QA o PROD.
