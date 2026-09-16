# Listado propio de invitaciones pendientes — SQL local

Alcance: una RPC de lectura paginada. No es integración UI, auditoría independiente,
ejecución QA/PROD, envío de correo ni aceptación del alumno.

## Cierre técnico de integración ROOT — 2026-09-09

Los cuatro archivos se integraron byte a byte según el handoff congelado. La
prueba PostgreSQL17.5 en ROOT pasó SQL transaccional/rollback y21 checks. La
integración TypeScript pasó120pruebas de invitaciones,84pagos,144dominio y suite
global/lint/build/typecheck/diff; lint/typecheck/diff se repitieron tras agregar
SQL/docs sin cambios en TypeScript/config. Auditoría independiente GPT-5.6 Sol
medio READ-ONLY PASS, sin hallazgos verificables. La auditoría revisó SQL/evidencia,
no ejecutó su propia base PostgreSQL ni QA. Evidencia e informe:
`/tmp/organizatech-coach-pending-list.erJX9K/`. Este anexo posterior al handoff
actualiza sólo estado documental: la migración, test y runner no cambiaron.
La aplicación remota y la QA manual siguen pendientes; no se autoriza producción.

## Inventario congelado de este incremento

- `supabase/migrations/20260909085022_coach_pending_invitations_list.sql`
- `supabase/tests/coach_pending_invitations_list_local.sql`
- `supabase/tests/support/run_coach_pending_invitations_list_postgres.mjs`
- Este documento.

La CLI local 2.114.0 generó el nombre mediante `migration new
coach_pending_invitations_list`, después de consultar version/help, migration help
y migration new help. No se usó link, push, DB remota ni .temp. Contenido editado
mediante apply_patch. SHA-256 de la migración:
`30190a102caf00fde6f687b9191f0f9ca1a1c5fd429e15e75dcebad08acc3590`.

Requiere PostgreSQL 17+ con UTF8 y la collation incorporada `pg_catalog.pg_c_utf8`.
El guard inicial falla con mensaje fijo si falta ese requisito: no crea extensiones,
collations ni fallback dependiente del locale del host. Requiere además la versión
R2 auditada de `20260909044235_coach_invitation_persistence.sql`, SHA-256
`0f72a10fc35fc4203aa65d11c4181206749a56be31302f891ce90afc00eec3fc`.

DATA mantiene intacta su dependencia histórica anterior a R2; NO copiarla a ROOT.
El runner rechaza ese hash antes de crear el cluster. Para probar en DATA acepta
una ruta local explícita de la dependencia R2 congelada, sin copiarla ni editarla:

```sh
node supabase/tests/support/run_coach_pending_invitations_list_postgres.mjs --invitation-migration /Users/fabiannahuelhual/Developer/organizatech-coach-dashboard-01/supabase/migrations/20260909044235_coach_invitation_persistence.sql
```

Tras integrar en ROOT, el mismo runner sin argumentos utiliza y verifica su propia
dependencia R2 local. No acepta una URL ni una conexión de base de datos.

## Contrato exacto

`public.list_own_pending_coach_invitations(p_query text default '', p_limit integer
default 25, p_cursor_created_at timestamptz default null, p_cursor_id uuid default null)`
devuelve JSONB con sólo:

```ts
{
  serverNow: string;
  totalPending: number;
  matchingCount: number;
  items: Array<{
    id: string;
    recipientEmail: string;
    createdAt: string;
    issuedAt: string;
    expiresAt: string;
    state: "pending" | "expired";
  }>;
  nextCursor: { createdAt: string; id: string } | null;
}
```

Sólo filas propias con estado almacenado pending, incluidas vencidas; nunca
cancelled/accepted. `totalPending` precede a búsqueda/cursor; `matchingCount`
aplica búsqueda pero no cursor. El límite 1..50 (default 25) sólo limita la página,
no la cartera. Orden descendente por `(created_at,id)`, comparación estricta de
tupla y hasta limit+1 candidatos. Si existe candidato extra, nextCursor es el
último elemento devuelto, no el extra. Sin resultados: items vacío y cursor null.

El cursor lleva ambos valores o ninguno. Su fecha debe ser finita, dentro de los
años UTC 0001..9999; puede ser futura. Es una posición sin lookup de fila global:
un ancla cancelada, ajena o inexistente no da permisos ni rompe el cursor. Cada
llamada obtiene un snapshot nuevo; cancelaciones entre páginas pueden vaciar una
página o cambiar los conteos. No se promete congelar toda la cartera entre calls.
Fechas de respuesta UTC con seis dígitos de microsegundos, sin pérdida a milisegundos.
Estado expired exactamente cuando expiresAt <= serverNow; no modifica storage.

Búsqueda: máximo 254 bytes UTF8 del query crudo, antes de transformación. Query
null es inválido. En ambos operandos: btrim de espacio ASCII, NFD, eliminación
exacta de U+0300..U+036F y Unicode simple lowercase mediante pg_c_utf8. Se busca
substring literal con strpos: %, _ y backslash no son comodines. No se alteran
emails almacenados. El servidor es autoridad del matching: `ΟΣ` se convierte en
`οσ` mediante Unicode simple; JavaScript puede producir `ος` por contexto. El
mapper no debe reinterpretar/rechazar los resultados con un fold JS diferente.

## Seguridad y consistencia

SECURITY DEFINER con search_path vacío y sólo EXECUTE para authenticated, revocado
para PUBLIC/anon. Reutiliza auth.uid + membresía Coach real y su lock FOR UPDATE
exclusivo desde el principio. Captura serverNow después de obtenerlo. Conteos y
página se leen en un solo SELECT/snapshot; sólo se agregan a JSON hasta 50 items.
Las tres tablas existentes conservan RLS default-deny/FORCE y ACLs sin cambios.
No hay parámetros de ownership, nombres, códigos, generación, actividad ni lookup
de cuenta Alumno por email. No hay INSERT, UPDATE, DELETE, reserva ni vinculación.

No se agrega índice: owner_page ya soporta owner + orden/seek de created_at/id;
el parcial pending-recipient acota conteos por dueño. Substring normalizado y
conteos exactos requieren recorrer candidatos propios; otro btree equivalente no
resuelve ese coste. Contención por Coach y carteras grandes requieren medición
posterior autorizada; este lote no promete tiempos constantes ni escala verificada.

Input inválido dentro de la función: 22023/mensaje fijo sin parámetros. Identidad
o membresía inválida: 42501 del helper existente. Los errores de coerción de tipos
anteriores al cuerpo también deben sanitizarse en el adaptador. No hay logging.

## Evidencia local y límites

Runner PostgreSQL 17.5 macOS arm64, mismo binario público fijado por SHA-256 que el
soporte previo. Descarga sólo ese artefacto público; cluster propio 0700, socket
Unix privado, puerto 55445 sin listener TCP, limpieza de su directorio exacto.
Descarta opciones PG heredadas, no carga dotenv ni recibe credenciales. Su bootstrap
Auth/membresías es SINTÉTICO y no debe ejecutarse contra Supabase real.

SQL BEGIN/ROLLBACK: ACLs/RLS/defaults/search_path, anon/no identidad/no Coach,
ownership y ausencia de descubrimiento, input/límites UTF8, pares de cursor,
infinidades/años, empates y microsegundos, 67 pendientes propios, estados excluidos,
búsqueda literal/case/NFC/NFD/acentos/sigma, invariancia de datos, paginación completa,
cancelar ancla, regeneración y RLS ante grant accidental. Los fixtures accepted sólo
prueban exclusión del listado; no crean episodios ni atribuyen consentimiento.

Runner: 21 comprobaciones adicionales, incluidas dos conexiones con espera SQL
real observada por wait_event_type=Lock, snapshot/reloj posterior al commit,
aislamiento entre Coaches, cancelación contra lectura, siguiente página vacía,
baja de membresía y prueba explícita de diferencia Unicode simple frente a JS.
Resultados locales: SQL transaccional + runner PASS, node --check y ESLint focal
PASS. Se ejecuta diff-check y comparación de los 38 hashes baseline en el handoff.
No se ejecutó npm test global DATA; registro focal/metadata de migración y gates
integrados quedan reservados a MAIN/ROOT. No se cambiaron package, lock ni SQL previo.

No advisors remotos, Auth/PostgREST real, QA manual, despliegue, commit/push ni
garantía de producto completo. Auditoría independiente posterior fuera de este lote.

Referencias técnicas consultadas: [PostgreSQL 17 strings](https://www.postgresql.org/docs/17/functions-string.html),
[collation pg_c_utf8](https://www.postgresql.org/docs/17/collation.html) y
[Supabase functions](https://supabase.com/docs/guides/database/functions).
Las guías Supabase/Postgres orientaron permisos mínimos, keyset, snapshot único,
orden de locks y reutilización de índices. El índice changelog.md no fue legible
por el lector; se consultó el changelog HTML público, sin acceso a proyecto remoto.
