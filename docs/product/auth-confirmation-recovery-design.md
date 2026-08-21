# Diseño AUTH-CONFIRM-01

- Estado: implementación local pendiente de auditoría y QA
- Base de trabajo: `be37f074bc22945e1b0e6e305a5ba8729281d074`
- Alcance: confirmación de signup Usuario/Coach y retorno de password recovery
- Fuera de alcance: AUTH-COACH-02, Google, QA/PROD y configuración remota

## Decisión de producto: primer intento gana

Para una identidad aún no confirmada, el primer `supabase.auth.signUp` que crea el
`auth.users` real es autoritativo. Sus datos y portal permanecen pendientes hasta
confirmar. Un segundo `signUp` puede reenviar el correo normal de Supabase, pero no
modifica ni reemplaza el primer payload. Si Supabase actualiza `raw_user_meta_data`
durante ese retry, un scrub separado elimina el payload repetido sin escribir la tabla
pendiente.

Esto coincide con GoTrue: cuando ya existe el usuario no confirmado, el servicio no
actualiza la fila porque no puede comprobar la identidad declarada por el segundo
request. La UI mantiene el mensaje genérico de revisar el correo y no informa si la
identidad existe.

| Secuencia antes de confirmar | Resultado autoritativo |
| --- | --- |
| Coach A → Usuario B | Coach A |
| Usuario A → Coach B | Usuario A |
| Datos A → datos corregidos B | Datos A |
| Reintentos concurrentes | Única fila ligada al primer `auth.users.id` confirmado por PostgreSQL |

Después de confirmar, una identidad puede agregar la segunda membresía mediante
`register_own_user()` o `register_own_coach(...)`, autenticados y sin otro correo.

## Arquitectura

### Única superficie pública de alta

La única superficie pública que recibe el formulario preconfirmación es
`supabase.auth.signUp`. No existe RPC, tabla, view, Edge Function ni endpoint propio que
guarde PII antes del alta Auth.

El cliente construye metadata mediante una allowlist explícita:

- `organizatech_registration_portal`: `usuario | coach`;
- `display_name`;
- `first_name`, `last_name`, `birth_date`, `gender`, `phone_number`;
- `professional_title`, únicamente para Coach.

No transporta ownership, roles de autorización, IDs de perfil ni objetos crudos del
formulario. El portal en metadata expresa una solicitud de alta; nunca autoriza acceso.
La autoridad posterior continúa siendo `user_registrations` o `coach_registrations`.

### Captura privada y limpieza de metadata

`on_auth_user_00_capture_registration_pending` es un trigger `BEFORE INSERT` sobre
`auth.users`. En la misma transacción:

1. valida el portal y los campos allowlisted;
2. deriva ownership exclusivamente desde `NEW.id`;
3. inserta una única fila en
   `private.auth_registration_pending_memberships`;
4. reemplaza `NEW.raw_user_meta_data` por `{ display_name }` o `{}`.

La fila privada usa `user_id` como PK y FK a `auth.users(id) ON DELETE CASCADE`. La FK es
`DEFERRABLE INITIALLY DEFERRED` porque la captura ocurre antes de que termine el INSERT
del padre. Si el signup falla, ambos writes se revierten. Tras commit no quedan portal,
PII de registro ni markers internos en metadata.

Metadata inválida falla cerrada: se limpia, pero no crea fila pendiente. No existe
binding por correo, UUID opaco, cast UUID→texto ni intent anónimo sin owner.

`on_auth_user_00_scrub_registration_retry_metadata` es un segundo trigger
`BEFORE UPDATE OF raw_user_meta_data`. Se activa sólo cuando la nueva metadata contiene
`organizatech_registration_portal` **o** el marker legacy aprobado. Reemplaza `NEW` por
`{ display_name }` o `{}` antes de retornar y no consulta, inserta ni actualiza el
pendiente. Por tanto, un retry Usuario→Coach, Coach→Usuario o con datos corregidos limpia
la metadata nueva, pero conserva íntegros el portal y los datos del primer INSERT.

La tabla privada mantiene `ENABLE ROW LEVEL SECURITY` y `FORCE ROW LEVEL SECURITY`, sin
policies ni grants a `PUBLIC`, `anon` o `authenticated`. Las funciones internas son
`SECURITY DEFINER`, `search_path = ''`, sin SQL dinámico y sin permiso de ejecución para
roles API.

### Vida de la fila pendiente

No existe TTL local. La validez del enlace la determina Supabase Auth. Una fila ligada y
no consumida se conserva mientras exista `auth.users`, incluso si se solicita un nuevo
correo de confirmación.

Al consumirla se eliminan de la fila privada los campos PII y sólo permanecen
`user_id`, `portal`, timestamps y estado de consumo. El riesgo residual es la retención
de PII de identidades que nunca confirman ni se eliminan. Una política administrativa de
retención deberá diseñarse y aprobarse por separado antes de Producción; AUTH-CONFIRM-01
no agrega Cron ni limpieza oportunista. Ese gate administrativo no puede sustituirse por
un TTL que venza mientras Supabase aún permita confirmar la identidad.

### Confirmación no bloqueante

El finalizador bloquea la fila propia con `FOR UPDATE` y bloquea el perfil antes de
escribir. Según el portal original:

- Usuario inserta únicamente `user_registrations(user_id)`;
- Coach inserta únicamente los campos allowlisted de `coach_registrations`, incluido
  `professional_title`;
- el perfil se actualiza con una allowlist explícita sólo cuando el finalizador creó la
  membresía;
- `ON CONFLICT (user_id) DO NOTHING` preserva una membresía existente sin sobrescribirla.

La operación está dentro de un bloque PL/pgSQL con manejo `WHEN OTHERS`. Si falta la fila,
faltan perfiles, los datos son inconsistentes o una escritura falla, el subbloque revierte
sus cambios y retorna `NEW`. Ninguna excepción del finalizador se propaga para revertir
`email_confirmed_at`. La cuenta confirmada queda recuperable mediante los flujos
autenticados existentes.

`consumed_at`, el PK de membresía y `ON CONFLICT DO NOTHING` hacen idempotentes los
callbacks y eventos duplicados. Las búsquedas usan sólo PK UUID sin conversiones a texto.

### Callback y recovery

Signup usa exclusivamente:

`/login?flow=signup-confirmation`

El portal no viaja en la URL. El RPC autenticado
`get_own_auth_registration_confirmation()` no recibe argumentos, deriva `auth.uid()` y
devuelve sólo `status` y `portal` propios. No almacena PII y no está concedido a `anon`.

Password recovery usa exclusivamente:

`/login?flow=password-recovery`

Los builders aceptan sólo `window.location.origin`, path `/login` y flows cerrados. Los
eventos `PASSWORD_RECOVERY`, `SIGNED_IN` e `INITIAL_SESSION` mantienen owners por
identidad para impedir respuestas cruzadas A/B.

## Redirect allowlists documentadas

Configurar primero en QA y sólo después de QA PASS. No se realizó ningún cambio remoto.

QA debe usar una de estas opciones, reemplazando los placeholders por valores aprobados:

- alias Preview QA exacto: `https://<qa-preview-alias>.vercel.app/**`; o
- patrón limitado al owner real: `https://*-<team-or-account-slug>.vercel.app/**`;
- `http://localhost:3000/**`;
- `http://localhost:3066/**`.

Está prohibido usar un wildcard que acepte cualquier subdominio de `vercel.app`. El slug
real debe ser confirmado por el dueño antes de modificar Supabase.

Producción continúa limitada a:

- `https://organizatech.cl/**`;
- `https://www.organizatech.cl/**`.

Preview y Development deben seguir apuntando a Supabase QA. No se agrega variable de
entorno, CAPTCHA, Turnstile ni plantilla Coach personalizada.

## Verificaciones exclusivas de PostgreSQL/Supabase QA

Estas comprobaciones son read-only salvo la prueba funcional de signup controlada. No se
ejecutaron en este trabajo.

1. Confirmar owner y `BYPASSRLS` de tabla y funciones. Este control es un **gate material
   obligatorio de QA**: los contratos locales no pueden demostrar los privilegios del
   rol que ejecutará los triggers hosted.

   ```sql
   select
     namespace.nspname,
     class.relname,
     owner.rolname as owner_name,
     owner.rolbypassrls
   from pg_catalog.pg_class as class
   join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
   join pg_catalog.pg_roles as owner on owner.oid = class.relowner
   where namespace.nspname = 'private'
     and class.relname = 'auth_registration_pending_memberships';

   select
     procedure.oid::regprocedure,
     owner.rolname as owner_name,
     owner.rolbypassrls,
     procedure.prosecdef,
     procedure.proconfig
   from pg_catalog.pg_proc as procedure
   join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
   where procedure.oid in (
     'private.capture_auth_registration_pending_membership()'::regprocedure,
     'private.scrub_auth_registration_retry_metadata()'::regprocedure,
     'private.finalize_auth_registration_pending_membership()'::regprocedure,
     'public.get_own_auth_registration_confirmation()'::regprocedure
   );
   ```

2. Confirmar estado final de RLS, ACL y triggers reales con `pg_class.relrowsecurity`,
   `pg_class.relforcerowsecurity`, `aclexplode`, `has_function_privilege` y
   `pg_get_triggerdef`.
3. Ejecutar signup QA Usuario y Coach; verificar que `raw_user_meta_data` conserva sólo
   `display_name` y que la fila privada queda ligada al mismo `auth.users.id`.
4. Repetir antes de confirmar con portal/datos distintos y concurrentemente; verificar
   una sola fila y payload inicial intacto, y que cada UPDATE de retry deje
   `raw_user_meta_data` sólo como `{}` o `{display_name}`.
5. Confirmar correo con fila válida, ausente y datos inválidos dentro de casos QA
   controlados; `email_confirmed_at` debe persistir siempre y sólo el caso válido crea la
   membresía original.
6. Repetir callback y agregar después la segunda membresía por el RPC autenticado
   existente; no debe sobrescribir la primera.
7. Antes de autorizar Producción, aprobar una política administrativa separada para la
   PII de identidades abandonadas. No ejecutar limpieza mientras una identidad siga
   confirmable sin una decisión explícita de producto y seguridad.

## Fuentes vigentes revisadas

- [Supabase `signUp`](https://supabase.com/docs/reference/javascript/auth-signup)
- [User Management y triggers](https://supabase.com/docs/guides/auth/managing-user-data)
- [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase Changelog](https://supabase.com/changelog?tags=auth)
- [PostgreSQL trigger behavior](https://www.postgresql.org/docs/current/trigger-definition.html)

El breaking change de abril de 2025 permite crear triggers sobre `auth.users`, pero exige
mantener las funciones y tablas propias fuera del schema `auth`, como hace este diseño.
