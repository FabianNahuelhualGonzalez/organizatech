# Clientes activos — controlador y conexión SDK aislados

## Alcance de este incremento

Conectar el repositorio de identidad activa ya auditado a un controlador de
búsqueda, carga y paginación explícitas, sin montar pantallas ni agregar lógica
de pagos, actividad, aceptación del alumno o historial. No cambia SQL.

Para dos consumidores reales (invitaciones pendientes y vínculos activos), se
extrae exclusivamente la mecánica privada de listado dentro de `coach-clients`.
Cada wrapper conserva sus contratos públicos y su allowlist de filas; cada
instancia tiene estado, consulta, operación y listeners independientes. No hay
store universal, cola global, registro de endpoints ni invitaciones ficticias.

## Ownership y archivos

- DOMAIN: helper privado de hooks; controller/contrato/tests/doc Active;
  extracción del controller Pending y ajuste acotado de su test de imports.
- MAIN: `integration/coach-active-relationships-runtime.ts` y test de SDK;
  este documento, actualización del documento Pending y registro de dos tests
  en package más el hash de su contrato existente.
- Inmutables: cinco SQL Coach, repositorios/DTO/SDK ya auditados, composition
  root, package-lock, UI, otros worktrees y stash protegido.

DOMAIN entregó siete fuentes congeladas después de 56 pruebas focales y 279
de regresión, typecheck, lint e integridad local. MAIN verificó los dos originales
Pending y transfirió únicamente las siete rutas acordadas mediante apply_patch;
su documentación Pending previa se conserva con un anexo nuevo. No se copiaron
carpetas ni diffs en marcha. Evidencia de integración ROOT en
`/tmp/organizatech-coach-active-controller.s9haKk/`.

## API técnica

`createCoachActiveRelationshipsRuntime({connection,pageSize?})` devuelve el
controller Active. La configuración pública y principal existente llegan del
futuro owner. Construir no consulta Auth ni HTTP. Se capturan configuración,
identidad y callbacks, y una guarda monotónica compartida por controller/source
impide revivir la instancia tras observar cambio de contexto.

El propietario de pantalla deberá invalidar o disponer al cambiar cuenta,
generación, portal, membresía o salida; ante una desvinculación conocida deberá
invalidar datos. Esto no detecta por sí solo cambios remotos posteriores a una
lectura exitosa ni autoriza acceso a actividad futura.

El snapshot mantiene `totalActive` y cursor `{linkedAt,id}` reales, con filas
`{id,studentName,studentEmail,linkedAt}`. `id` es el episodio, no el alumno.
No añade ciclo ausente, entrenamientos cero, fechas de invitación ni estado
pending. Conserva snapshots de nombre/correo y fechas futuras finitas permitidas
por el esquema; no agrega restricciones a los datos históricos.

Operaciones esperadas, preservando el contrato técnico Pending:

- `setQuery`/`invalidate`: cancelar y limpiar sin iniciar I/O automáticamente.
- `load`: primera página explícita y una sola operación simultánea.
- `reload`: sustituir operación anterior; conservar filas de la misma query
  mientras carga/falla, pero descartar su cursor anterior.
- `loadNext`: mantener filas y cursor ante error para retry explícito; las
  respuestas viejas no se mezclan tras cambiar query/reload/contexto.
- `dispose`: limpiar de forma terminal; promises públicas canceladas se
  resuelven aunque la fuente ignore AbortSignal.
- Metadatos por llamada, no cartera congelada: counts pueden disminuir y una
  página posterior puede quedar vacía después de revocaciones.

El repositorio previo valida DTO estricto, ownership contextual, microsegundos y
respuestas. Su deadline total cubre Auth y RPC; usa el mismo token comprobado
con getUser y POST exacto sin retries. Errores nunca equivalen a vacío exitoso.

## Validaciones y estado

PASS de código integrado en ROOT: 247 pruebas de invitaciones/clientes (incluidos
los 33 casos Pending conservados, 23 Active y 18 del runtime SDK nuevo), 84 de
pagos y 144 de dominio. Después del inventario completo se ejecutaron de forma
secuencial npm test global (pretest, test y posttest), lint, build, typecheck y
git diff --check, todos con exit 0. El SDK usa Auth/fetch sintéticos, sin red.

Integridad: baseline 221, total 229, otros 216 archivos previos preservados;
13 rutas del incremento, siete fuentes DOMAIN exactas, cinco SQL, root, lockfile
y stash intactos. Logs y manifiesto congelado en el directorio de evidencia.
Auditoría independiente GPT-5.6 Sol media READ-ONLY: PASS, sin hallazgos
HIGH/MEDIUM/LOW verificables. El auditor ejecutó 247 pruebas focales y diff,
comprobó inventario/hashes y examinó los logs de los demás gates sin atribuirse
su ejecución. Informe `sol-audit.md` SHA-256
188314e7768f4c07dbf8aee15dbf92a49729d4a65ee5bd0018caff3f59d708e2;
manifest auditado SHA-256
67d746fd40ef7534402eabbcc341ac94cfc9ea83e0c86d14e2e6279e7ad5f8da.
Después del dictamen sólo cambia este documento; `post-audit-integrity.json`
verifica los otros 12 archivos auditados, baseline, transferencia y protegidos.
El PASS técnico de este incremento no equivale a QA ni Coach completo PASS.

Las recomendaciones de Supabase orientan token fijado/verificado, cancelación,
guardas de sesión y ausencia de retries; se reutiliza la infraestructura auditada.
SDK real con Auth/fetch sintéticos no equivale a Auth/PostgREST desplegados.
No hay QA manual IA, Preview nuevo, SQL remoto, commit, push ni cambios en PROD.
La aplicación de migraciones QA sigue esperando inventario exacto aprobado.
