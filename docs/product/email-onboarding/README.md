# EMAIL-ONBOARDING-01

Implementación local de correos transaccionales de confirmación y bienvenida para Usuario y Coach. Este cambio no despliega funciones, no aplica SQL y no configura proyectos remotos.

## Arquitectura

- `auth-send-email-hook` reemplaza el envío SMTP de Supabase Auth. Verifica la firma Standard Webhooks sobre el body raw antes de parsear o llamar a Brevo.
- `send-welcome-email` requiere JWT y vuelve a resolver la identidad con `/auth/v1/user`. El destinatario sale de `auth.users` y el tipo sale de la membresía materializada.
- `private.transactional_email_deliveries` mantiene idempotencia y estados `pending`, `sent` o `failed`. No persiste el email en claro; sólo un fingerprint contextual y el `messageId` de Brevo.
- Los cuatro RPC exigen una capability Edge↔Vault. Los RPC de bienvenida requieren además `auth.uid()` y ownership.
- Un rechazo transitorio explícito 425/429 obtiene como máximo un segundo intento dentro del mismo presupuesto y con la misma clave determinística. Los demás fallos explícitos de Brevo quedan `failed` y pueden reclamarse en una invocación posterior. Un timeout, 408, 5xx o una respuesta 2xx ilegible queda `pending` porque el resultado es ambiguo: nunca se reclama automáticamente y requiere reconciliación manual o un futuro worker controlado antes de cualquier reintento. Esta entrega no incluye scheduler ni worker de reconciliación.

El Send Email Hook es global. El fallback neutral cubre todas las acciones Auth actuales, incluidas recovery, magic link, cambio de email y notificaciones de seguridad. Los enlaces con token usan exclusivamente el `SUPABASE_URL` server-side como origen Auth y construyen `/auth/v1/verify` en ese origen. Los valores firmados `redirect_to` y `site_url` son destinos validados de la aplicación: nunca determinan el host de verificación. Para notificaciones se prioriza `redirect_to` y se conserva `site_url` sólo como fallback si el redirect está ausente. GoTrue no incluye el destinatario alternativo de `identity_unlinked_notification` en el payload del hook; mientras esa limitación upstream exista, el fallback usa el `user.email` firmado.

## Configuración futura (QA primero)

Después de auditoría independiente:

1. Aplicar la migración en QA.
2. Generar una capability aleatoria de alta entropía y guardar el mismo valor como secreto Edge `EMAIL_LEDGER_RPC_SECRET` y en Vault con nombre `organizatech_email_ledger_rpc_secret`.
3. Configurar sólo como secretos Edge: `BREVO_API_KEY` y `SEND_EMAIL_HOOK_SECRET`.
4. Configurar `ORGANIZATECH_EMAIL_SENDER`, `ORGANIZATECH_EMAIL_SENDER_NAME` y una URL HTTPS en `ORGANIZATECH_APP_URL`.
5. Desplegar `auth-send-email-hook` con verificación JWT desactivada y `send-welcome-email` con verificación JWT activada, según `supabase/config.toml`.
6. Configurar el Send Email Hook de Auth apuntando a la primera función.
7. Desactivar en Brevo el tracking de aperturas y clics para este flujo y comprobar en QA que el CTA renderizado conserva exactamente la URL Auth, sin reescritura. `contactPixelTrackingConsent: false` no reemplaza esta validación.
8. Verificar en QA que el sender y su dominio estén autorizados y autenticados para envío (incluidos SPF, DKIM y DMARC cuando correspondan).
9. Validar la idempotencia real del proveedor repitiendo en QA la misma solicitud con la misma clave: no debe crearse un segundo mensaje. Registrar también la respuesta de duplicado para que una reconciliación futura no la marque como fallo reintentable.
10. Validar en QA firma/replay, los dos portales, Google, doble submit, cambio de email seguro, recovery y todas las notificaciones de seguridad antes de considerar PROD.

No se necesita ni se permite `service_role`. Los valores reales de los secretos nunca deben escribirse en el repositorio, logs o respuestas.

## Previews

Los ocho archivos en [`previews/`](previews/) se regeneran desde el renderer con:

```sh
npx tsx scripts/render-email-onboarding-previews.ts --write
```

Para comprobar que están sincronizados sin escribir:

```sh
npx tsx scripts/render-email-onboarding-previews.ts --check
```
