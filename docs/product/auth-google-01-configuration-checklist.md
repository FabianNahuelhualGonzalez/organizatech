# AUTH-GOOGLE-01 · checklist de configuración y QA

Esta entrega prepara código y migración local. No configura ni modifica QA o PROD.

## Google Cloud y Supabase

- Mantener clientes OAuth separados para QA y PROD, sin compartir secretos.
- Registrar en Google únicamente el callback de Supabase mostrado por el proveedor para el proyecto QA; la aplicación vuelve desde Supabase al dominio QA mediante `redirectTo`.
- Usar como `Site URL` de Supabase Auth QA el dominio exacto y estable de la rama `qa`: `https://<qa-branch-url>.vercel.app`.
- Agregar una sola vez `https://<qa-branch-url>.vercel.app/**` a las Redirect URLs de Supabase Auth QA. Ese patrón permite `/login` y su query dinámica sólo en el host QA exacto; no es un wildcard de subdominio.
- Abrir QA siempre desde ese dominio de rama. No usar la URL inmutable de un commit ni cambiar el callback por deploy.
- Configurar `ORGANIZATECH_APP_URL` y `ORGANIZATECH_EVALUATION_ALLOWED_ORIGINS` con esa misma URL exacta. OAuth, Preview, botones de correo y CORS no pueden usar dominios QA distintos.
- Habilitar solamente `openid`, `email` y `profile`; no solicitar acceso offline.
- Mantener Client Secret exclusivamente en Google/Supabase; nunca en variables `NEXT_PUBLIC_*`.
- Verificar `skip_nonce_check = false`, Site URL correcta y branding/dominio del ambiente.

El callback de aplicación permanece same-origin en `/login?flow=google-oauth&intent=<opaco>`. El `intent` y el verificador PKCE viven en `sessionStorage`, que está aislado por origen. Cambiar de origen durante el flujo no puede compartir esa evidencia y debe fallar cerrado. Si Supabase no acepta el `redirectTo`, cae en su `Site URL`; por eso todos los puntos QA deben coincidir con el alias estable que usa el dueño para probar.

No agregar un wildcard global de `vercel.app`, URLs inmutables por commit ni otros patrones que admitan proyectos ajenos. El único wildcard QA aprobado es el de ruta del host estable indicado arriba. Desarrollo local puede conservar únicamente sus Redirect URLs aprobadas (`http://localhost:3000/**` y `http://localhost:3066/**`).

## Orden de liberación

1. Auditoría independiente read-only.
2. Aplicar la migración únicamente en QA mediante ventana autorizada.
3. Configurar Google/Supabase QA sin reutilizar credenciales de PROD.
4. QA manual del dueño: login Usuario/Coach, registro Usuario, Coach Google independiente y dual mismo uid.
5. Probar rechazo password-only inverso, otro provider, otro uid, intent vencido/reutilizado y callback stale.
6. Sólo tras QA PASS preparar configuración y migración PROD con autorización separada.

La aplicación no almacena ni usa `provider_token` o `provider_refresh_token`. La sesión Supabase permanece encapsulada en el cliente transitorio hasta que el owner vigente completa autorización/registro y la transferencia interna al cliente principal.

## Decisión técnica PKCE aceptada

Para el alcance AUTH-GOOGLE-01, el cliente OAuth transitorio mantiene `persistSession: true` porque Auth necesita conservar el `code-verifier` entre el inicio y el callback PKCE. Cada intent usa un `storageKey` aislado y un adapter `scopedStorage`: sólo la clave exacta `<storageKey>-code-verifier` llega a `sessionStorage`; cualquier sesión, access token o refresh token permanece exclusivamente en el `Map` en memoria del cliente transitorio. El callback consume el verifier, completa `exchangeCodeForSession` y elimina esa única entrada persistida. No se acepta ampliar esta excepción a otras claves ni persistir tokens.
