# Operación de correos de Evaluaciones

Esta función usa el JWT del usuario y no usa `service_role`:

- La app puede solicitar el drenaje inmediato de sus propios envíos con el JWT del usuario y un `Origin` incluido exactamente en la allowlist del worker.
- `ORGANIZATECH_APP_URL` es la base canónica de los enlaces de correo. En QA debe ser exactamente el mismo alias estable de rama usado por Preview, Supabase Auth y la allowlist del worker; nunca se sustituye por el `Origin` de la petición.
- `ORGANIZATECH_EVALUATION_ALLOWED_ORIGINS` admite únicamente orígenes HTTPS exactos. En QA debe contener un solo valor: el mismo alias estable de rama. No admite comodines, paths, query strings, fragmentos ni credenciales; una configuración inválida falla cerrada.
- Los recordatorios de vencimiento sólo se envían cuando el coach los solicita manualmente desde la app. No hay un recordatorio automático periódico.
- La cola conserva estado e idempotencia, pero no se drena sola: cada intento depende de una invocación explícita autorizada. Un estado `failed` o `ambiguous` no implica reintento automático.
- La respuesta sólo expone contadores agregados (`claimed`, `sent`, `failed`, `ambiguous`, `completionFailed` y `truncated`). Un fallo al completar el estado durable se contabiliza como `ambiguous`; `truncated` impide confirmar éxito si el drenaje acotado de tres lotes no alcanzó a vaciar el trabajo reclamable. Nunca se devuelven destinatarios ni contenido del correo.

> Decisión de producto: no crear ni activar un scheduler de Evaluaciones, y en particular nunca invocar esta función cada 15 minutos. Cualquier automatización futura requiere una decisión de producto y una autorización de despliegue nuevas.

## Configuración requerida por entorno

Configurar primero en QA y sólo después de QA PASS y autorización explícita en PROD:

1. Guardar un secreto aleatorio de al menos 32 caracteres como secreto de la Edge Function `EVALUATION_EMAIL_RPC_SECRET` y, con el mismo valor, en Vault bajo `evaluation_email_rpc_secret`.
2. Configurar `ORGANIZATECH_APP_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` y las credenciales del proveedor de correo.
3. En QA, configurar una sola vez tanto `ORGANIZATECH_APP_URL` como `ORGANIZATECH_EVALUATION_ALLOWED_ORIGINS` con el mismo dominio exacto y estable de la rama `qa`: `https://<qa-branch-url>.vercel.app`. El dueño debe abrir siempre ese mismo Preview. No agregar un dominio alternativo, URLs inmutables por commit ni patrones `*.vercel.app`.
4. Desplegar `send-evaluation-emails` con la configuración versionada `verify_jwt = false`; el handler valida explícitamente el JWT y el origen de la app, y las RPC exigen además la capacidad privada.
5. No crear job, cron ni invocación periódica para Evaluaciones. `EVALUATION_EMAIL_SCHEDULER_SECRET`, si existe como secreto heredado de QA, no se usa mientras no exista una autorización futura explícita.

Este repositorio no crea jobs remotos ni configura secretos. Cualquier cambio de entorno requiere autorización específica para QA o PROD.
