# Procesamiento QA de Fotos de progreso y Documentos médicos

Estado: procedimiento preparado en `feature/progress-media-qa-processing-phase4e` (`6d9a55f` como base). Ninguna cuenta, principal, bucket, variable, scheduler ni dato remoto fue creado o modificado por este trabajo. **QA PASS requiere ejecución autorizada y evidencia real de Auth, Storage y cola.**

## Inventario y gates previos

Destino único: proyecto Supabase QA y host Node aislado fuera de Vercel. El dueño confirma que el URL Auth/Storage, el alias PostgreSQL `service=organizatech_qa` y el buzón técnico pertenecen al mismo proyecto QA. No usar PROD, `service_role`, una credencial administrativa de Auth ni variables de Vercel. `psql` debe usar `pg_service.conf` y `.pgpass` privados; nunca una contraseña en argumentos. Mantener `set +x` y archivos locales 0600.

| Elemento | Comprobación requerida |
| --- | --- |
| Código | Los dos runners, `node_modules` instalado con `npm ci`, `sharp` resoluble y tests focales PASS |
| Schema | Fase 1 privada y migraciones `20260924140000`, `20260930163231`, `20261001141522` aplicadas exactamente una vez en QA; no reescribir migraciones aplicadas |
| Auth | Hook SQL `private.progress_photo_access_token_hook(jsonb)` configurado en Auth QA, `SECURITY INVOKER`, ejecutable sólo por `supabase_auth_admin` |
| Principals | Un UUID Auth activo de Fotos; un UUID nuevo, distinto y exclusivo para Documentos; ninguno registrado como Alumno o Coach |
| Roles | `progress_photo_publisher` y `progress_document_publisher`: `NOLOGIN`, sin `BYPASSRLS`; grants RPC respectivos, RLS y policies restrictivas Storage |
| Buckets | `progress-check-staging` privado JPEG/WebP 20 MiB; `progress-check-photos` privado; `progress-document-staging` privado PDF 25 MiB; `progress-medical-documents` privado |
| Host | `pdfinfo` de Poppler funcional con un PDF sintético antes de encolar; reloj sincronizado, un solo proceso con lock y timeout |

Una pasada limpia hasta tres reservas y reclama **una** carga nueva por worker. Los scripts sólo imprimen `idle`, `published` o `failed`, nunca IDs/rutas. `failed` y errores no controlados retornan código distinto de cero. El worker de Documentos verifica `pdfinfo` **antes** de reclamar; si falla, no consume la cola. El exit code no reemplaza la consulta posterior de estado, especialmente para limpieza pendiente.

Preflight local en el checkout del host QA:

```sh
set +x
git status --short --branch
git rev-parse --short HEAD
npm ci --no-audit --no-fund
node -e 'require("sharp"); console.log("sharp disponible")'
./node_modules/.bin/tsx --version
command -v pdfinfo
pdfinfo -v
```

Preflight SQL **read-only**, sin seleccionar emails, UUID de usuarios ni rutas de objetos:

```sh
psql 'service=organizatech_qa' -X -v ON_ERROR_STOP=1 <<'SQL'
begin read only;
select version from supabase_migrations.schema_migrations
where version in ('20260924140000','20260930163231','20261001141522') order by version;
select id, public, file_size_limit, allowed_mime_types from storage.buckets
where id in ('progress-check-staging','progress-check-photos',
  'progress-document-staging','progress-medical-documents') order by id;
select rolname, rolcanlogin, rolbypassrls,
  pg_has_role('authenticator'::regrole, oid, 'member') as authenticator_member
from pg_roles where rolname in ('progress_photo_publisher','progress_document_publisher');
select 'photo' as kind, state, count(*) from private.progress_photo_principals group by state
union all select 'document', state, count(*) from private.progress_document_principals group by state;
select p.proname, p.prosecdef, p.proconfig from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='private' and p.proname='progress_photo_access_token_hook';
select polname, polcmd, polpermissive from pg_policy
where polrelid='storage.objects'::regclass and polname like 'progress %' order by polname;
rollback;
SQL
```

Exigir un principal activo de Fotos y ninguno de Documentos antes del alta. Auditar `WITH CHECK`, ownership, `search_path`, EXECUTE y grants reales contra las migraciones. La presencia SQL del hook no prueba su activación en Auth; el login con claim correcto es el gate. Ante drift, detenerse.

## Cambios QA propuestos para aprobación del dueño

**Cambio 1 — crear una cuenta Auth QA exclusiva de Documentos.** Requiere autorización específica para esta cuenta. Usar un buzón QA controlado por el dueño y una contraseña aleatoria robusta. Si QA no permite `signUp` por email, detenerse y acordar otro mecanismo sin `service_role`. En una sesión `bash`, cargar `QA_SUPABASE_URL` y `QA_SUPABASE_ANON_KEY` desde el gestor privado del host y verificar que ambos son de QA. El siguiente comando no muestra credenciales ni ID:

```sh
set +x
umask 077
read -r -s -p 'Email técnico QA: ' QA_DOCUMENT_EMAIL; printf '\n'
read -r -s -p 'Contraseña técnica QA: ' QA_DOCUMENT_PASSWORD; printf '\n'
export QA_DOCUMENT_EMAIL QA_DOCUMENT_PASSWORD
node --input-type=module <<'NODE'
import { createClient } from '@supabase/supabase-js';
const e = process.env;
if (!e.QA_SUPABASE_URL?.startsWith('https://') || !e.QA_SUPABASE_ANON_KEY
  || !e.QA_DOCUMENT_EMAIL || !e.QA_DOCUMENT_PASSWORD)
  throw new Error('configuración QA incompleta');
const client = createClient(e.QA_SUPABASE_URL, e.QA_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const result = await client.auth.signUp({ email: e.QA_DOCUMENT_EMAIL,
  password: e.QA_DOCUMENT_PASSWORD });
if (result.error) throw new Error('alta Auth QA fallida');
console.log('Alta solicitada; verificar confirmación por SQL');
NODE
```

Guardar la contraseña en el gestor de secretos del host aislado **antes** de `unset QA_DOCUMENT_PASSWORD`; no dejarla en historial, repo, archivo `.env` ni variable pública. Confirmar el email QA mediante el enlace del buzón sin pegar enlace, OTP o token en chats o logs. `signUp` puede devolver éxito aparente para un duplicado: comprobar `auth.users.email_confirmed_at` antes del siguiente paso.

**Cambio 2 — registrar el principal activo de Documentos.** Requiere autorización específica para este INSERT en QA. Desde la misma sesión, con conexión humana QA de privilegios acotados:

```sh
set +x
QA_DOCUMENT_AUTH_USER_ID="$(psql 'service=organizatech_qa' -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
\getenv qa_email QA_DOCUMENT_EMAIL
select id from auth.users
where lower(email)=lower(:'qa_email') and email_confirmed_at is not null;
SQL
)"
test -n "$QA_DOCUMENT_AUTH_USER_ID"
psql 'service=organizatech_qa' -X -q -v ON_ERROR_STOP=1 \
  -v uid="$QA_DOCUMENT_AUTH_USER_ID" <<'SQL'
begin;
create temp table target on commit drop as
  select id from auth.users where id=:'uid'::uuid and email_confirmed_at is not null;
do $$ begin
  if (select count(*) from target) <> 1 then
    raise exception 'cuenta QA no confirmada';
  end if;
  if exists (select 1 from public.user_registrations r join target t on r.user_id=t.id)
    or exists (select 1 from private.progress_photo_principals p
      join target t on p.auth_user_id=t.id)
    or exists (select 1 from private.progress_document_principals where state='active') then
    raise exception 'principal técnico en conflicto';
  end if;
end $$;
insert into private.progress_document_principals(auth_user_id,state)
select id,'active' from target;
commit;
SQL
unset QA_DOCUMENT_AUTH_USER_ID QA_DOCUMENT_PASSWORD
```

Comprobar además cualquier tabla de registro Coach existente en QA antes del INSERT. Verificar con un **login nuevo** que la cuenta obtiene sólo `progress_document_publisher`, `sub` correcto y expiración ≤ 900 s; comprobar que Fotos conserva `progress_photo_publisher` y otro UUID. Si falla el claim, detenerse: no ampliar grants por ensayo.

**Cambio 3 — instalar Poppler en el host aislado Debian/Ubuntu**, previa autorización del dueño para ese host:

```sh
sudo apt-get update
sudo apt-get install --no-install-recommends poppler-utils
command -v pdfinfo
pdfinfo -v
```

El worker consume `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y las cuatro variables privadas `PROGRESS_PHOTO_TECHNICAL_EMAIL`, `PROGRESS_PHOTO_TECHNICAL_PASSWORD`, `PROGRESS_DOCUMENT_TECHNICAL_EMAIL`, `PROGRESS_DOCUMENT_TECHNICAL_PASSWORD`. Los nombres `NEXT_PUBLIC_*` son heredados por código existente; las credenciales técnicas nunca deben entrar allí ni en Vercel. Inyectar los seis valores sólo en el proceso privado del host QA. No mostrar `env`.

## Pasadas y evidencia QA

El dueño prepara un Alumno QA ya registrado y con vínculo Coach activo. Con su JWT de Alumno, usar las RPC públicas `begin_own_progress_photo_upload` / `begin_own_medical_document_upload`, subir a staging por Storage con MIME correspondiente y `upsert: false`, y encolar con `finalize_own_*`. No insertar manualmente en `private.*` para fabricar una cola. Cada reserva dura una hora. Ejecutar los casos de uno en uno; la pasada reclama el más antiguo.

Fixtures sintéticos: JPEG real, PDF real generado para QA, falso PDF con MIME `application/pdf` y bytes inválidos, PDF válido de exactamente 25 MiB y archivo de 25 MiB + 1 byte. Verificar `pdfinfo` local para ambos PDF válidos antes de subirlos. Para más de 6 MiB, usar TUS autenticado si la subida estándar falla; un rechazo del transporte no prueba el límite del worker. Nunca usar información médica real.

Preparar fixtures con archivos locales 0600 y comprobar el parser antes de subir. El PDF grande contiene relleno blanco antes de `%%EOF`; si `pdfinfo` no lo acepta, detenerse y generar otro PDF válido con tamaño exacto antes de continuar:

```sh
set +x
umask 077
QA_RUN_DIR="$(mktemp -d)"
export QA_RUN_DIR
node --input-type=module <<'NODE'
import { writeFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import sharp from 'sharp';
const dir = process.env.QA_RUN_DIR;
const real = Buffer.from(new jsPDF().output('arraybuffer'));
const eof = Buffer.from('%%EOF');
const pos = real.lastIndexOf(eof);
if (pos < 0) throw new Error('PDF fixture inválido');
const prefix = real.subarray(0, pos);
const sized = (size) => Buffer.concat([prefix,
  Buffer.alloc(size - prefix.length - eof.length, 0x20), eof]);
writeFileSync(`${dir}/real.pdf`, real, { mode: 0o600 });
writeFileSync(`${dir}/fake.pdf`, Buffer.from('%PDF-1.7\n' + 'x'.repeat(64) + '\n%%EOF\n'), { mode: 0o600 });
writeFileSync(`${dir}/max.pdf`, sized(25 * 1024 * 1024), { mode: 0o600 });
writeFileSync(`${dir}/over.pdf`, sized(25 * 1024 * 1024 + 1), { mode: 0o600 });
await sharp({ create: { width: 512, height: 512, channels: 3,
  background: '#3c7aff' } }).jpeg().toFile(`${dir}/photo.jpg`);
NODE
pdfinfo "$QA_RUN_DIR/real.pdf" >/dev/null 2>&1 || exit 1
pdfinfo "$QA_RUN_DIR/max.pdf" >/dev/null 2>&1 || exit 1
pdfinfo "$QA_RUN_DIR/over.pdf" >/dev/null 2>&1 || exit 1
if pdfinfo "$QA_RUN_DIR/fake.pdf" >/dev/null 2>&1; then exit 1; fi
test "$(wc -c < "$QA_RUN_DIR/max.pdf")" -eq 26214400
test "$(wc -c < "$QA_RUN_DIR/over.pdf")" -eq 26214401
```

El siguiente bloque autentica un Alumno QA mediante credenciales efímeras del gestor privado, reserva, sube y encola exactamente un caso. Definir antes `QA_PROBE_KIND=photo|document`, `QA_PROBE_LABEL` distinto, `QA_PROBE_FILE`, `QA_STUDENT_EMAIL` y `QA_STUDENT_PASSWORD`, además del URL y anon key QA. Para `over.pdf`, definir `QA_EXPECT_REJECT=1`; no se encola y la reserva expira. No se muestran JWT, UUID ni rutas:

```sh
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const e = process.env;
const photo = e.QA_PROBE_KIND === 'photo';
if (!['photo','document'].includes(e.QA_PROBE_KIND) || !/^[a-z0-9_-]+$/.test(e.QA_PROBE_LABEL ?? '')
  || !e.QA_PROBE_FILE || !e.QA_RUN_DIR || !e.QA_SUPABASE_URL?.startsWith('https://')
  || !e.QA_SUPABASE_ANON_KEY || !e.QA_STUDENT_EMAIL || !e.QA_STUDENT_PASSWORD)
  throw new Error('configuración QA incompleta');
const client = createClient(e.QA_SUPABASE_URL, e.QA_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const login = await client.auth.signInWithPassword({ email: e.QA_STUDENT_EMAIL,
  password: e.QA_STUDENT_PASSWORD });
if (login.error || !login.data.session) throw new Error('login Alumno QA fallido');
const reserved = await client.rpc(photo ? 'begin_own_progress_photo_upload'
  : 'begin_own_medical_document_upload', photo ? { p_pose: 'frente', p_format: 'jpeg' } : {});
if (reserved.error || !reserved.data) throw new Error('reserva QA fallida');
const { uploadId, bucketId, objectName, mimeType } = reserved.data;
if (!uploadId || !bucketId || !objectName
  || mimeType !== (photo ? 'image/jpeg' : 'application/pdf'))
  throw new Error('reserva QA inválida');
const bytes = readFileSync(e.QA_PROBE_FILE);
const staged = await client.storage.from(bucketId).upload(objectName,
  new Blob([bytes], { type: mimeType }), { contentType: mimeType, upsert: false });
if (e.QA_EXPECT_REJECT === '1') {
  if (!staged.error) throw new Error('Storage aceptó archivo sobre el límite');
  console.log('Storage rechazó archivo sobre el límite');
} else {
  if (staged.error) throw new Error('subida QA fallida');
  const queued = await client.rpc(photo ? 'finalize_own_progress_photo_upload'
    : 'finalize_own_medical_document_upload', { p_upload_id: uploadId });
  if (queued.error) throw new Error('encolado QA fallido');
  writeFileSync(`${e.QA_RUN_DIR}/${e.QA_PROBE_LABEL}.id`, uploadId,
    { mode: 0o600, flag: 'wx' });
  console.log('Carga QA encolada');
}
await client.auth.signOut();
NODE
```

Secuencia: `photo.jpg` con etiqueta `photo`, ejecutar una pasada Fotos y consultar; `real.pdf` con `real`, `fake.pdf` con `fake`, `max.pdf` con `max`, cada uno seguido de una pasada Documentos y consulta; `over.pdf` con `over` y `QA_EXPECT_REJECT=1`, sin pasada inmediata. Fijar las variables `QA_PROBE_*` para cada caso sin mostrar su contenido. Si Storage rechaza `max.pdf` por transporte, no declarar PASS del límite; preparar otra reserva y una carga TUS autenticada en un procedimiento QA revisado antes de repetir.

En host QA, desde el checkout revisado, tras cada carga encolada y con lock compartido:

```sh
flock -n /run/lock/organizatech-qa-media.lock \
  timeout 180s ./node_modules/.bin/tsx scripts/run_progress_photo_publisher.ts
flock -n /run/lock/organizatech-qa-media.lock \
  timeout 180s ./node_modules/.bin/tsx scripts/run_medical_document_publisher.ts
```

Ejecutar sólo el worker correspondiente al caso. Si el usuario no puede escribir en `/run/lock`, usar el mismo archivo de lock en un directorio privado 0700 del servicio. Nunca correr dos instancias. Consulta de evidencia QA **read-only**, con `QA_PROBE_LABEL` correspondiente al caso recién procesado; no imprime IDs ni rutas:

```sh
psql 'service=organizatech_qa' -X -v ON_ERROR_STOP=1 \
  -v uid="$(cat "$QA_RUN_DIR/$QA_PROBE_LABEL.id")" <<'SQL'
begin read only;
with uploads as (
  select state, final_asset_id, bucket_id, object_name, final_object_name,
    'progress-check-photos'::text as final_bucket
  from private.progress_photo_uploads where id=:'uid'::uuid
  union all
  select state, final_asset_id, bucket_id, object_name, final_object_name,
    'progress-medical-documents'::text
  from private.progress_document_uploads where id=:'uid'::uuid
)
select u.state, u.final_asset_id is not null as has_asset_id,
  exists (select 1 from private.progress_assets a
    where a.id=u.final_asset_id and a.available_at is not null) as available,
  exists (select 1 from storage.objects o
    where o.bucket_id=u.bucket_id and o.name=u.object_name) as staging_exists,
  exists (select 1 from storage.objects o
    where o.bucket_id=u.final_bucket and o.name=u.final_object_name) as final_exists
from uploads u;
rollback;
SQL
```

Una foto o PDF válido exige `published`, asset disponible, objeto final y ausencia de staging. PDF falso exige ningún asset y `cleaned` tras limpieza; `cleanup_pending` obliga a otra pasada. El archivo 25 MiB + 1 byte debe ser rechazado por Storage o por validación sin asset final. Registrar sólo estado, conteos, tamaño y hora QA. Borrar fixtures y archivos `.id` locales al finalizar.

El test local `verify-medical-document.contract.ts` cubre parser, MIME incorrecto, falso PDF, truncamiento y >25 MiB; no sustituye Auth/Storage reales. La QA visual y funcional pertenece al dueño de producto.

## Scheduler QA propuesto, fuera de Vercel

Un `systemd` timer en el host aislado inicia un servicio `Type=oneshot` cada cinco minutos, con `Persistent=false`. Usuario de sistema exclusivo sin login, checkout fijado a commit revisado, `RuntimeDirectory` 0700, `flock -n` común para ambos workers, `timeout 180s` por worker y ejecución secuencial. Usar `LoadCredential` desde el gestor privado del host, wrapper 0700 fuera del repo y filesystem del servicio de sólo lectura salvo runtime. El wrapper exporta secretos sólo al proceso hijo, nunca los escribe ni los imprime. El monitor alerta por exit code, `failed`, `queued` antiguos y `cleanup_pending` atascados sin capturar payloads o rutas. Activación sólo tras las pasadas manuales PASS y comprobación de revocación de principal activo con JWT previo.

Archivos propuestos del host, para revisión previa: `/usr/local/libexec/organizatech-qa-media-pass`, `/etc/systemd/system/organizatech-qa-media.service`, `/etc/systemd/system/organizatech-qa-media.timer` y seis credenciales privadas 0400 bajo `/etc/organizatech/qa-media/`. Secuencia posterior a aprobación: instalar archivos, `sudo systemctl daemon-reload`, `sudo systemctl start organizatech-qa-media.service`, verificar SQL QA y, sólo con PASS, `sudo systemctl enable --now organizatech-qa-media.timer`. No se instalaron ni activaron aquí.

Para revocar Documentos: detener el scheduler, cambiar su principal QA a `revoked` con `revoked_at` y `updated_at` simultáneos mediante transacción aprobada, cerrar sesiones Auth y rotar contraseña. No borrar principal ni assets. PROD requiere otro gate y autorización separada.

### Archivos exactos propuestos para el host QA

Contenido de `/usr/local/libexec/organizatech-qa-media-pass` (root, 0700). El proveedor de secretos entrega las seis credenciales 0400 indicadas; el wrapper sólo las mantiene en memoria del proceso:

```sh
#!/usr/bin/env bash
set -euo pipefail
for name in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY \
  PROGRESS_PHOTO_TECHNICAL_EMAIL PROGRESS_PHOTO_TECHNICAL_PASSWORD \
  PROGRESS_DOCUMENT_TECHNICAL_EMAIL PROGRESS_DOCUMENT_TECHNICAL_PASSWORD; do
  printf -v "$name" '%s' "$(cat "$CREDENTIALS_DIRECTORY/$name")"
  export "$name"
done
flock -n "$RUNTIME_DIRECTORY/pass.lock" bash -c '
  photo_rc=0
  timeout 180s ./node_modules/.bin/tsx scripts/run_progress_photo_publisher.ts || photo_rc=$?
  document_rc=0
  timeout 180s ./node_modules/.bin/tsx scripts/run_medical_document_publisher.ts || document_rc=$?
  test "$photo_rc" -eq 0 && test "$document_rc" -eq 0
'
```

Contenido de `/etc/systemd/system/organizatech-qa-media.service`. La ruta `WorkingDirectory` es la del checkout QA del host, fijado a un commit revisado; si difiere, el dueño la sustituye antes de instalar:

```ini
[Unit]
Description=Organizatech QA media queues, one pass
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=organizatech-qa-media
Group=organizatech-qa-media
WorkingDirectory=/opt/organizatech/qa-worker
ExecStart=/usr/local/libexec/organizatech-qa-media-pass
Environment=PATH=/usr/local/bin:/usr/bin:/bin
RuntimeDirectory=organizatech-qa-media
RuntimeDirectoryMode=0700
LoadCredential=NEXT_PUBLIC_SUPABASE_URL:/etc/organizatech/qa-media/NEXT_PUBLIC_SUPABASE_URL
LoadCredential=NEXT_PUBLIC_SUPABASE_ANON_KEY:/etc/organizatech/qa-media/NEXT_PUBLIC_SUPABASE_ANON_KEY
LoadCredential=PROGRESS_PHOTO_TECHNICAL_EMAIL:/etc/organizatech/qa-media/PROGRESS_PHOTO_TECHNICAL_EMAIL
LoadCredential=PROGRESS_PHOTO_TECHNICAL_PASSWORD:/etc/organizatech/qa-media/PROGRESS_PHOTO_TECHNICAL_PASSWORD
LoadCredential=PROGRESS_DOCUMENT_TECHNICAL_EMAIL:/etc/organizatech/qa-media/PROGRESS_DOCUMENT_TECHNICAL_EMAIL
LoadCredential=PROGRESS_DOCUMENT_TECHNICAL_PASSWORD:/etc/organizatech/qa-media/PROGRESS_DOCUMENT_TECHNICAL_PASSWORD
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
TimeoutStartSec=7min
```

Contenido de `/etc/systemd/system/organizatech-qa-media.timer`:

```ini
[Unit]
Description=Organizatech QA media queue schedule

[Timer]
OnBootSec=5min
OnUnitInactiveSec=5min
AccuracySec=1s
Persistent=false
Unit=organizatech-qa-media.service

[Install]
WantedBy=timers.target
```

Primera activación, sólo después de autorización del host y QA PASS de las pasadas manuales: `sudo systemctl daemon-reload`, `sudo systemctl start organizatech-qa-media.service`, comprobar estados SQL QA y logs saneados, y finalmente `sudo systemctl enable --now organizatech-qa-media.timer`. Confirmar con `sudo systemctl list-timers organizatech-qa-media.timer`. No se ejecutaron esos comandos aquí.
