# AUTH-GOOGLE-01 · checklist de configuración y QA

Esta entrega prepara código y migración local. No configura ni modifica QA o PROD.

## Google Cloud y Supabase

- Crear cliente OAuth Web con orígenes exactos de QA y PROD, sin comodines.
- Registrar el callback de Supabase mostrado por el proveedor Google.
- Configurar en Supabase las redirect URLs exactas `/login?flow=google-oauth...` para cada ambiente.
- Habilitar solamente `openid`, `email` y `profile`; no solicitar acceso offline.
- Mantener Client Secret exclusivamente en Google/Supabase; nunca en variables `NEXT_PUBLIC_*`.
- Verificar `skip_nonce_check = false`, Site URL correcta y branding/dominio del ambiente.

## Orden de liberación

1. Auditoría independiente read-only.
2. Aplicar la migración únicamente en QA mediante ventana autorizada.
3. Configurar Google/Supabase QA sin reutilizar credenciales de PROD.
4. QA manual del dueño: login Usuario/Coach, registro Usuario, Coach Google independiente y dual mismo uid.
5. Probar rechazo password-only inverso, otro provider, otro uid, intent vencido/reutilizado y callback stale.
6. Sólo tras QA PASS preparar configuración y migración PROD con autorización separada.

La aplicación no almacena ni usa `provider_token` o `provider_refresh_token`. La sesión Supabase permanece encapsulada en el cliente transitorio hasta que el owner vigente completa autorización/registro y la transferencia interna al cliente principal.
