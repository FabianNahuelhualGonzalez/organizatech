# Calendar reminder notifications — configuración futura QA

Esta entrega deja preparada localmente la campana persistente y el envío opcional por Brevo. No aplica SQL, no despliega funciones y no configura secretos.

## Política horaria

- La hora del recordatorio es una hora civil de `America/Santiago`.
- Si una hora no existe por el cambio DST, se mueve al primer minuto civil válido posterior.
- Si una hora ocurre dos veces, se usa el primer instante (el más temprano).
- `10 minutos`, `1 hora` y `1 día` se restan como duraciones absolutas desde el instante ya resuelto.
- La campana admite un catch-up acotado de dos días. El correo sólo se encola hasta diez minutos tarde para evitar mensajes obsoletos.

## Configuración QA pendiente

1. Aplicar `20260827120000_calendar_notification_delivery.sql` después de `20260827000000_email_onboarding_transactional_email.sql`. Aplicar luego `20260827165000_calendar_notification_claim_ambiguity_fix.sql`; este hotfix califica los targets `ON CONFLICT` del worker y no cambia tablas, datos ni privilegios.
2. Crear una capability aleatoria distinta a la de onboarding. Guardarla en Vault como `organizatech_calendar_reminder_rpc_secret` y como secreto Edge `CALENDAR_REMINDER_RPC_SECRET`.
3. Crear otro secreto independiente `CALENDAR_REMINDER_SCHEDULER_SECRET` para invocar el worker programado.
4. Configurar en la función sólo `BREVO_API_KEY`, sender verificado, `ORGANIZATECH_APP_URL`, anon key y los dos secretos anteriores. Nunca usar `service_role`.
5. Desplegar `send-calendar-reminders` con `verify_jwt = false`; la autenticación efectiva es el secreto scheduler en el borde y la capability Vault en las RPC.
6. Programar el POST con una cadencia máxima de cinco minutos. No incluir secretos en URL, payload, logs o respuestas.
7. Validar en QA: preferencia correo activa/inactiva, misma `auth.uid()` en Usuario/Coach, otra identidad aislada, campana read/unread, dos workers concurrentes, reintento 429 y resultados ambiguos sin reenvío.
8. Verificar en Brevo el template HTML/texto, sender `organizatech.cl`, tracking desactivado e idempotencia real con la misma clave.

PROD requiere una autorización separada después del PASS de Preview y QA manual del dueño.
